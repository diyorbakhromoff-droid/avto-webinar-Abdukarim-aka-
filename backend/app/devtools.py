"""Lokal ishlab chiqish uchun: demo ma'lumotlar va Mini App initData.

python -m app.devtools demo        — tariflar, video, turli bosqichdagi lidlar
python -m app.devtools initdata 4242  — brauzerda Mini App'ni sinash uchun initData
"""
import asyncio
import random
import sys
import time
from datetime import timedelta

from sqlalchemy import select

from app.config import get_settings
from app.db import SessionLocal
from app.models import Attendance, Funnel, Lead, LeadSession, LiveComment, Payment, Question, Tariff
from app.security.initdata import sign
from app.services.leads import event, set_step
from app.timeutil import now_utc

SAMPLE_HLS = "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8"
NAMES = ["Madina", "Sevara", "Dilnoza", "Gulnora", "Zarina", "Malika", "Nodira", "Kamola", "Shahnoza", "Feruza"]


async def demo() -> None:
    async with SessionLocal() as db:
        f = (await db.execute(select(Funnel).order_by(Funnel.id).limit(1))).scalar_one()
        f.day1_video_id = f.day2_video_id = SAMPLE_HLS
        f.day1_duration_sec, f.day2_duration_sec, f.day2_offer_sec = 74 * 60, 82 * 60, 58 * 60
        f.speaker_name, f.speaker_title = "[Spiker ismi]", "Arab tili o'qituvchisi"
        f.between_summary = ["Arab alifbosi 28 harfdan iborat", "Harf so'zdagi o'rniga qarab 4 xil yoziladi",
                             "Uy vazifasi: 5 ta harfni 10 martadan yozing"]
        f.bonuses = ["[bonus 1]", "[bonus 2]"]
        f.card_number, f.card_holder = "8600 0000 0000 0000", "[Karta egasi]"
        if not (await db.execute(select(Tariff).where(Tariff.funnel_id == f.id))).first():
            db.add(Tariff(funnel_id=f.id, name="Standart", description="Darslar + uy vazifasi tekshiruvi",
                          special_price=1_490_000, regular_price=1_990_000, sort=0))
            db.add(Tariff(funnel_id=f.id, name="VIP", description="+ shaxsiy kurator",
                          special_price=2_490_000, regular_price=2_990_000, sort=1))
        for t, a, txt in [(30, "Madina", "Assalomu alaykum!"), (95, "Sevara", "Alifbodan boshlaymizmi?"),
                          (300, "Dilnoza", "Rahmat, tushunarli")]:
            db.add(LiveComment(funnel_id=f.id, day=1, t=t, author=a, text=txt))
        now = now_utc()
        # Mini App sinovi uchun: 4242 — 1-kun 10 daqiqa oldin boshlangan
        lead = Lead(funnel_id=f.id, tg_user_id=4242, first_name="Madina", phone="+998 90 123 45 67",
                    source="ig_reels3", phone_at=now - timedelta(hours=5))
        db.add(lead)
        await db.flush()
        s = LeadSession(lead_id=lead.id, day1_at=now - timedelta(minutes=10), day2_at=now + timedelta(hours=23, minutes=50))
        db.add(s)
        lead.deadline_at = s.day2_at + timedelta(minutes=82, hours=24)
        await set_step(db, lead, "session")
        steps = ["started", "phone", "session", "day1_missed", "day1_watched", "left_before_offer",
                 "reached_offer", "clicked_buy", "receipt_sent", "deposit_paid", "full_paid"]
        for i in range(30):
            reg = now - timedelta(hours=random.randint(2, 120))
            ld = Lead(funnel_id=f.id, tg_user_id=10_000 + i, first_name=random.choice(NAMES), source=random.choice(
                ["ig_reels3", "ig_story1", "tg_ads"]), created_at=reg, step_at=reg)
            db.add(ld)
            await db.flush()
            step = random.choice(steps)
            event(db, ld, "start", source=ld.source)
            if step != "started":
                ld.phone = f"+998 9{random.randint(0, 9)} {random.randint(100, 999)} {random.randint(10, 99)} {random.randint(10, 99)}"
                ld.phone_at = reg
            if step not in ("started", "phone"):
                d1 = reg + timedelta(hours=6)
                ss = LeadSession(lead_id=ld.id, day1_at=d1, day2_at=d1 + timedelta(days=1), day1_evaluated=True,
                                 day1_watched=step != "day1_missed")
                db.add(ss)
                await db.flush()
                if step != "day1_missed":
                    db.add(Attendance(session_id=ss.id, lead_id=ld.id, day=1, day_at=d1, watched_sec=random.randint(56, 74) * 60))
                    ld.day1_watched_sec = random.randint(56, 74) * 60
                if step in ("left_before_offer", "reached_offer", "clicked_buy", "receipt_sent", "deposit_paid", "full_paid"):
                    reached = step != "left_before_offer"
                    db.add(Attendance(session_id=ss.id, lead_id=ld.id, day=2, day_at=ss.day2_at,
                                      watched_sec=random.randint(60, 80) * 60 if reached else 30 * 60,
                                      reached_offer=reached))
                    ld.day2_watched_sec = random.randint(60, 80) * 60 if reached else 30 * 60
                    ss.day2_evaluated, ss.day2_joined = True, True
                    if reached:
                        ld.reached_offer_at = ss.day2_at + timedelta(minutes=58)
                ld.deadline_at = ss.day2_at + timedelta(minutes=82, hours=24)
            if step in ("clicked_buy", "receipt_sent", "deposit_paid", "full_paid"):
                ld.clicked_buy_at = now - timedelta(hours=random.randint(1, 20))
            if step in ("receipt_sent", "deposit_paid", "full_paid"):
                kind = "deposit" if step != "full_paid" else "full"
                db.add(Payment(lead_id=ld.id, method=random.choice(["card", "payme", "click"]), kind=kind,
                               amount=100_000 if kind == "deposit" else 1_490_000,
                               status="pending" if step == "receipt_sent" else "approved",
                               file_path="/dev/null", file_mime="image/jpeg", file_hash=f"demo{i}",
                               within_deadline=True, decided_by=None if step == "receipt_sent" else "Nodira",
                               decided_at=None if step == "receipt_sent" else now))
                ld.payment_status = {"deposit_paid": "deposit", "full_paid": "full"}.get(step, "none")
            await set_step(db, ld, step, reg + timedelta(hours=random.randint(1, 40)))
            if random.random() < 0.2:
                db.add(Question(lead_id=ld.id, text="Kurs qachon boshlanadi?", source="miniapp"))
        await db.commit()
        print("Demo ma'lumotlar yaratildi. Mini App sinovi: python -m app.devtools initdata 4242")


def initdata(user_id: int) -> str:
    return sign({"auth_date": str(int(time.time())), "query_id": "dev",
                 "user": f'{{"id":{user_id},"first_name":"Madina"}}'}, get_settings().bot_token)


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    if cmd == "demo":
        asyncio.run(demo())
    elif cmd == "initdata":
        print(initdata(int(sys.argv[2])))
    else:
        print(__doc__)
