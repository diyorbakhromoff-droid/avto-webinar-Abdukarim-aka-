"""Integratsiya testlari (PostgreSQL): TZ 14-bo'lim qabul qilish mezonlari."""
from datetime import date, datetime, time, timedelta

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import func, select

from app.models import (
    AdminUser, Attendance, ChainMessage, Funnel, Lead, LeadSession, Payment, ScheduledMessage, Tariff,
)
from app.security.auth import create_token, hash_password
from app.security.initdata import sign
from app.services import payments as pay
from app.services.sessions import SessionError, choose_day1, choose_day2, evaluate_finished_days
from app.timeutil import local_to_utc

TUE = date(2026, 10, 20)


def tash(d: date, hh: int, mm: int = 0) -> datetime:
    return local_to_utc(d, time(hh, mm))


async def make_funnel(db, **kw) -> Funnel:
    f = Funnel(slug="arab", name="Arab tili", day1_duration_sec=74 * 60, day2_duration_sec=82 * 60,
               day2_offer_sec=58 * 60, day1_video_id="v1", day2_video_id="v2", **kw)
    db.add(f)
    await db.flush()
    msgs = [
        ("Spiker", "after_registration", None, 240, "all", False, None),
        ("2 soat", "before_day", 1, 120, "all", True, None),
        ("Boshlandi", "at_day_start", 1, 0, "all", True, None),
        ("Qayta", "after_day_end", 1, 0, "day1_missed", True, None),
        ("2-kun 2 soat", "before_day", 2, 120, "day1_attended", True, None),
        ("Deadline", "after_day_end", 2, 120, "not_paid", True, None),
        ("Vaqt tanlang", "stuck", None, 120, "all", True, "no_session"),
    ]
    for i, (title, trig, day, off, seg, req, stuck) in enumerate(msgs):
        db.add(ChainMessage(funnel_id=f.id, title=title, text=f"{title}: {{ism}}", trigger_type=trig,
                            trigger_day=day, offset_minutes=off, segment=seg, required=req, sort=i,
                            stuck_step=stuck))
    db.add(Tariff(funnel_id=f.id, name="Standart", special_price=1_500_000, regular_price=2_000_000,
                  deposit_enabled=True, deposit_amount=100_000))
    await db.commit()
    return f


async def make_lead(db, f, reg: datetime, tg=1001) -> Lead:
    lead = Lead(funnel_id=f.id, tg_user_id=tg, first_name="Madina", phone="+998 90 123 45 67", source="ig",
                created_at=reg, phone_at=reg, step="phone", step_at=reg)
    db.add(lead)
    await db.commit()
    return lead


async def pending(db, lead_id) -> dict[str, datetime]:
    rows = (await db.execute(select(ChainMessage.title, ScheduledMessage.send_at)
                             .join(ChainMessage, ChainMessage.id == ScheduledMessage.chain_message_id)
                             .where(ScheduledMessage.lead_id == lead_id, ScheduledMessage.status == "pending"))).all()
    return dict(rows)


async def test_session_choice_and_schedule(db):
    f = await make_funnel(db)
    now = tash(TUE, 12)
    lead = await make_lead(db, f, now)
    s = await choose_day1(db, lead, f, tash(TUE, 20), now=now)
    await db.commit()
    assert s.day2_at == tash(TUE + timedelta(days=1), 20)
    p = await pending(db, lead.id)
    assert p["2 soat"] == tash(TUE, 18)
    assert p["Boshlandi"] == tash(TUE, 20) - timedelta(minutes=1)
    assert p["2-kun 2 soat"] == tash(TUE + timedelta(days=1), 18)
    assert lead.step == "session"
    assert lead.deadline_at == s.day2_at + timedelta(minutes=82) + timedelta(hours=24)


async def test_change_time_moves_reminders_without_duplicates(db):
    f = await make_funnel(db)
    now = tash(TUE, 9)
    lead = await make_lead(db, f, now)
    await choose_day1(db, lead, f, tash(TUE, 14), now=now)
    await db.commit()
    assert (await pending(db, lead.id))["2 soat"] == tash(TUE, 12)
    await choose_day1(db, lead, f, tash(TUE, 20), now=tash(TUE, 9, 30))
    await db.commit()
    p = await pending(db, lead.id)
    assert p["2 soat"] == tash(TUE, 18)
    assert p["2-kun 2 soat"] == tash(TUE + timedelta(days=1), 18)
    total = (await db.execute(select(func.count()).select_from(ScheduledMessage).where(
        ScheduledMessage.lead_id == lead.id, ScheduledMessage.status == "pending"))).scalar()
    assert total == len(p)  # har bir xabar bitta


async def test_sent_message_not_resent_after_change(db):
    f = await make_funnel(db)
    now = tash(TUE, 9)
    lead = await make_lead(db, f, now)
    await choose_day1(db, lead, f, tash(TUE, 20), now=now)
    await db.commit()
    sm = (await db.execute(select(ScheduledMessage).join(ChainMessage).where(
        ChainMessage.title == "Spiker", ScheduledMessage.lead_id == lead.id))).scalar_one()
    sm.status = "sent"
    await db.commit()
    await choose_day1(db, lead, f, tash(TUE + timedelta(days=1), 14), now=tash(TUE, 15))
    await db.commit()
    assert "Spiker" not in await pending(db, lead.id)


async def test_cannot_change_less_than_n_hours(db):
    f = await make_funnel(db)
    lead = await make_lead(db, f, tash(TUE, 9))
    await choose_day1(db, lead, f, tash(TUE, 14), now=tash(TUE, 9))
    await db.commit()
    with pytest.raises(SessionError):
        await choose_day1(db, lead, f, tash(TUE, 20), now=tash(TUE, 12))


async def add_watch(db, s: LeadSession, day: int, watched_sec: int, reached=False):
    db.add(Attendance(session_id=s.id, lead_id=s.lead_id, day=day, day_at=s.day1_at if day == 1 else s.day2_at,
                      watched_sec=watched_sec, reached_offer=reached))
    await db.commit()


async def test_day1_evaluation_and_reschedule_limit(db):
    f = await make_funnel(db, reschedule_limit=3)
    lead = await make_lead(db, f, tash(TUE, 9))
    s = await choose_day1(db, lead, f, tash(TUE, 14), now=tash(TUE, 9))
    await db.commit()
    await add_watch(db, s, 1, 30 * 60)  # 40% — ko'rmadi
    await evaluate_finished_days(db, now=tash(TUE, 15, 20))
    await db.refresh(lead)
    await db.refresh(s)
    assert s.day1_watched is False and lead.step == "day1_missed"
    # 2-kun eslatmalari bekor qilingan
    assert "2-kun 2 soat" not in await pending(db, lead.id)

    now = tash(TUE, 16)
    for i in range(3):
        nxt = (await choose_day1(db, lead, f, (await _first_option(f, now)), now=now))
        await db.commit()
        evaluate_at = nxt.day1_at + timedelta(minutes=80)
        await evaluate_finished_days(db, now=evaluate_at)
        await db.refresh(lead)
        now = evaluate_at
    assert lead.day1_reschedules == 3
    assert lead.cold and lead.step == "cold"
    with pytest.raises(SessionError):
        await choose_day1(db, lead, f, await _first_option(f, now), now=now)


async def _first_option(f, now):
    from app.domain.slots import SlotConfig, day1_options
    return day1_options(SlotConfig.from_funnel(f), now)[0]


async def test_watched_day1_gets_between_and_day2_reschedule(db):
    f = await make_funnel(db)
    lead = await make_lead(db, f, tash(TUE, 9))
    s = await choose_day1(db, lead, f, tash(TUE, 14), now=tash(TUE, 9))
    await db.commit()
    await add_watch(db, s, 1, 60 * 60)  # 81%
    await evaluate_finished_days(db, now=tash(TUE, 15, 20))
    await db.refresh(s)
    assert s.day1_watched is True
    await evaluate_finished_days(db, now=tash(TUE + timedelta(days=1), 15, 30))
    await db.refresh(s)
    await db.refresh(lead)
    assert s.day2_joined is False and lead.step == "day2_missed"
    # faqat 2-kunni qayta tanlash
    from app.domain.slots import SlotConfig, day2_reschedule_options
    now = tash(TUE + timedelta(days=1), 16)
    opt = day2_reschedule_options(SlotConfig.from_funnel(f), now)[0]
    s2 = await choose_day2(db, lead, f, opt, now=now)
    await db.commit()
    assert s2.id == s.id and s2.day1_at == tash(TUE, 14) and s2.day2_at == opt
    assert lead.day2_reschedules == 1


async def test_receipt_approve_flow(db, bot):
    f = await make_funnel(db, channel_id=-100500)
    lead = await make_lead(db, f, tash(TUE, 9))
    lead.deadline_at = datetime.now().astimezone() + timedelta(hours=5)
    sales = AdminUser(login="nodira", name="Nodira", role="sales", password_hash="x", tg_user_id=777)
    db.add(sales)
    await db.commit()
    tariff = (await db.execute(select(Tariff))).scalar_one()

    p = await pay.create_receipt(db, lead, tariff_id=tariff.id, method="card", kind="deposit", amount=100_000,
                                 data=b"receipt-bytes", mime="image/jpeg", ext=".jpg")
    assert p.within_deadline and lead.step == "receipt_sent"
    dup = await pay.create_receipt(db, lead, tariff_id=tariff.id, method="card", kind="deposit", amount=100_000,
                                   data=b"receipt-bytes", mime="image/jpeg", ext=".jpg")
    assert dup.duplicate_of == p.id

    assert await pay.is_payment_admin(db, 777)
    assert not await pay.is_payment_admin(db, 999)
    approved = await pay.approve(bot, db, p.id, "Nodira")
    assert approved.status == "approved"
    assert await pay.approve(bot, db, p.id, "Boshqa") is None  # ikki marta tasdiqlab bo'lmaydi
    await db.refresh(lead)
    assert lead.payment_status == "deposit" and lead.special_price_locked
    assert lead.remaining_amount == 1_400_000
    assert lead.manager_id == sales.id
    # boshlang'ich to'lovda kanalga avtomatik havola yo'q
    assert not [c for c in bot.calls if c[0] == "create_chat_invite_link"]

    full = await pay.create_receipt(db, lead, tariff_id=tariff.id, method="payme", kind="remaining",
                                    amount=1_400_000, data=b"second", mime="application/pdf", ext=".pdf")
    await pay.approve(bot, db, full.id, "Nodira")
    await db.refresh(lead)
    assert lead.payment_status == "full" and lead.step == "full_paid"
    assert [c for c in bot.calls if c[0] == "create_chat_invite_link"]


async def test_reject_sends_reason(db, bot):
    f = await make_funnel(db)
    lead = await make_lead(db, f, tash(TUE, 9))
    p = await pay.create_receipt(db, lead, tariff_id=None, method="card", kind="full", amount=1,
                                 data=b"x", mime="image/jpeg", ext=".jpg")
    await pay.reject(bot, db, p.id, "Summa mos emas", "Nodira")
    await db.refresh(lead)
    assert lead.step == "receipt_rejected"
    assert any("Summa mos emas" in (t or "") for t in bot.texts())


# ── API: rollar va Mini App ──

@pytest.fixture
async def client():
    from app.main import app
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


async def test_roles_content_cannot_see_leads(db, client):
    f = await make_funnel(db)
    content = AdminUser(login="kamola", name="Kamola", role="content", password_hash=hash_password("parol12345"))
    db.add(content)
    await db.commit()
    h = {"Authorization": f"Bearer {create_token(content)}"}
    assert (await client.get(f"/api/admin/leads?funnel_id={f.id}", headers=h)).status_code == 403
    assert (await client.get(f"/api/admin/funnels/{f.id}/requisites", headers=h)).status_code == 403
    assert (await client.get(f"/api/admin/payments?funnel_id={f.id}", headers=h)).status_code == 403
    assert (await client.get(f"/api/admin/funnels/{f.id}/chain", headers=h)).status_code == 200
    r = await client.post("/api/admin/auth/login", json={"login": "kamola", "password": "parol12345"})
    assert r.status_code == 200 and r.json()["user"]["role"] == "content"


async def test_requisites_change_is_logged(db, client):
    f = await make_funnel(db)
    su = AdminUser(login="boss", name="Boss", role="super_admin", password_hash="x")
    db.add(su)
    await db.commit()
    h = {"Authorization": f"Bearer {create_token(su)}"}
    r = await client.put(f"/api/admin/funnels/{f.id}/requisites", headers=h,
                         json={"card_number": "8600 1234 5678 9012", "card_holder": "Ism", "payme_url": "",
                               "click_url": ""})
    assert r.status_code == 200
    audit = (await client.get("/api/admin/audit", headers=h)).json()
    assert audit[0]["action"] == "requisites_changed"


async def test_miniapp_state_and_heartbeat(db, client, monkeypatch):
    f = await make_funnel(db)
    lead = await make_lead(db, f, tash(TUE, 9), tg=4242)
    now = datetime.now().astimezone()
    s = LeadSession(lead_id=lead.id, day1_at=now - timedelta(minutes=10), day2_at=now + timedelta(hours=23, minutes=50))
    db.add(s)
    await db.commit()
    init = sign({"auth_date": str(int(now.timestamp())), "user": '{"id":4242,"first_name":"Madina"}'},
                "123456:TEST-TOKEN")
    h = {"Authorization": f"tma {init}"}
    st = (await client.get("/api/app/state", headers=h)).json()
    assert st["state"] == "live" and st["live"]["day"] == 1
    assert st["live"]["hls_url"]
    r = await client.post("/api/app/heartbeat", headers=h, json={"session_id": s.id, "day": 1, "position_sec": 600})
    assert r.status_code == 200
    a = (await db.execute(select(Attendance).where(Attendance.session_id == s.id))).scalar_one()
    assert 595 <= a.join_position_sec <= 605  # server vaqti bo'yicha 10-daqiqa
    assert (await client.get("/api/app/state", headers={"Authorization": "tma bad"})).status_code == 401


async def test_simulate_endpoint(db, client):
    f = await make_funnel(db)
    su = AdminUser(login="boss", name="Boss", role="super_admin", password_hash="x")
    db.add(su)
    await db.commit()
    h = {"Authorization": f"Bearer {create_token(su)}"}
    rows = (await client.post(f"/api/admin/funnels/{f.id}/chain/simulate", headers=h, json={
        "registered_at": tash(TUE, 17).isoformat(), "day1_at": tash(TUE, 20).isoformat()})).json()
    by = {r["title"]: r for r in rows}
    assert by["Spiker"]["status"] == "skipped"
    assert by["2 soat"]["status"] == "scheduled"


async def test_unpaid_count_matches_manual(db):
    """Statistikadagi raqamlar lidlar ro'yxatidan qo'lda sanalganiga mos keladi."""
    from app.services.stats import StatsFilter, funnel_numbers
    f = await make_funnel(db)
    for i in range(5):
        lead = await make_lead(db, f, tash(TUE, 9), tg=5000 + i)
        if i < 3:
            await choose_day1(db, lead, f, tash(TUE, 20), now=tash(TUE, 9))
    db.add(Lead(funnel_id=f.id, tg_user_id=6000, first_name="Telefonsiz"))
    await db.commit()
    n = await funnel_numbers(db, StatsFilter(f.id))
    assert (n["start"], n["phone"], n["session"]) == (6, 5, 3)
    assert (await db.execute(select(func.count()).select_from(Payment))).scalar() == 0
