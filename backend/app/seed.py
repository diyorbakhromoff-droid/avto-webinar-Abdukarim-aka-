"""Boshlang'ich ma'lumotlar: birinchi super admin, standart voronka va progrev zanjiri.

python -m app.seed   — takroriy ishga tushirish xavfsiz (bor narsa qayta yaratilmaydi).
"""
import asyncio
import logging

from sqlalchemy import func, select

from app.config import get_settings
from app.db import SessionLocal
from app.models import AdminUser, ChainMessage, Funnel
from app.security.auth import hash_password

log = logging.getLogger("seed")

ENTER = [[{"type": "webapp", "text": "Efirga kirish"}]]
RESCHED = [[{"type": "reschedule", "text": "Boshqa vaqt tanlash"}]]
PAY = [[{"type": "pay", "text": "Kursga yozilish"}]]

# (title, trigger_type, day, offset_min, segment, required, buttons, text, system_key, stuck_step)
DEFAULT_CHAIN = [
    ("Spiker bilan tanishuv", "after_registration", None, 60, "all", False, [],
     "{ism}, efirdan oldin spiker bilan tanishib oling: [spiker haqida 2–3 gap].", None, None),
    ("Ertaga efir", "before_day", 1, 1440, "all", False, [],
     "{ism}, ertaga {efir_vaqti} da webinarning 1-kuni. Eslatmani o'zim yuboraman.", None, None),
    ("Efirgacha 2 soat", "before_day", 1, 120, "all", True, [],
     "{ism}, efirgacha 2 soat qoldi! Bugun {efir_vaqti} da uchrashamiz. Telefoningizni quvvatlab qo'ying.",
     None, None),
    ("15 daqiqa qoldi", "before_day", 1, 15, "all", True, ENTER,
     "15 daqiqadan keyin boshlaymiz. Tugmani bosib efir sahifasini oching.", None, None),
    ("1-kun boshlandi", "at_day_start", 1, 0, "all", True, ENTER,
     "Efir boshlandi! «Efirga kirish» tugmasini bosing.", None, None),
    ("1-kun: hali kirmaganlar", "at_day_start", 1, 10, "all", True, ENTER,
     "{ism}, efir 10 daqiqa oldin boshlandi. Hali ulgurasiz — kiring.", "late_reminder", None),
    ("1-kun xulosasi", "after_day_end", 1, 5, "day1_attended", True, ENTER,
     "{ism}, bugun qatnashganingiz uchun rahmat!\n\n<b>Uy vazifasi:</b> [uy vazifasi]\n\n"
     "Ertaga {efir_vaqti} da 2-kun: [2-kunda nima bo'lishi].", None, None),
    ("1-kun: boshqa vaqt", "after_day_end", 1, 0, "day1_missed", True, RESCHED,
     "{ism}, bugungi efirni ko'ra olmadingiz. Sizga qulay boshqa vaqtni tanlang — webinar boshidan boshlanadi.",
     None, None),
    ("Bugun 2-kun", "before_day", 2, 120, "day1_attended", True, [],
     "{ism}, bugun {efir_vaqti} da webinarning 2-kuni. Eng muhim qismi shu kuni.", None, None),
    ("2-kun: 15 daqiqa", "before_day", 2, 15, "day1_attended", True, ENTER,
     "15 daqiqadan keyin 2-kun boshlanadi.", None, None),
    ("2-kun boshlandi", "at_day_start", 2, 0, "day1_attended", True, ENTER,
     "2-kun boshlandi! «Efirga kirish» tugmasini bosing.", None, None),
    ("2-kun: hali kirmaganlar", "at_day_start", 2, 10, "day1_attended", True, ENTER,
     "{ism}, 2-kun 10 daqiqa oldin boshlandi. Kiring — eng muhim qismi oldinda.", "late_reminder", None),
    ("2-kun: boshqa vaqt", "after_day_end", 2, 0, "day2_missed", True, RESCHED,
     "{ism}, 2-kunni ko'ra olmadingiz. Faqat 2-kunni boshqa vaqtga tanlang.", None, None),
    ("Ofertagacha chiqib ketganlar", "after_day_end", 2, 0, "left_before_offer", True, PAY,
     "{ism}, efir oxirida kurs haqida taklif bo'ldi: [taklif mazmuni]. Maxsus narx {deadline} gacha.",
     None, None),
    ("Deadline eslatmasi", "after_day_end", 2, 120, "not_paid", True, PAY,
     "{ism}, maxsus narx {deadline} gacha amal qiladi. Savollar bo'lsa, «Savol berish» tugmasini bosing.",
     None, None),
    ("Telefon: 1 soat", "stuck", None, 60, "all", True, [],
     "{ism}, joyingizni band qilish uchun telefon raqamingizni yuboring — «Raqamni yuborish» tugmasini bosing.",
     None, "no_phone"),
    ("Telefon: 24 soat", "stuck", None, 1440, "all", True, [],
     "{ism}, webinarga joylar hali bor. Raqamingizni yuborsangiz, vaqt tanlashni taklif qilaman.",
     None, "no_phone"),
    ("Vaqt tanlash: 2 soat", "stuck", None, 120, "all", True, [[{"type": "reschedule", "text": "Vaqt tanlash"}]],
     "{ism}, siz hali efir vaqtini tanlamadingiz. Qulay vaqtni tanlang:", None, "no_session"),
    ("Vaqt tanlash: 24 soat", "stuck", None, 1440, "all", True, [[{"type": "reschedule", "text": "Vaqt tanlash"}]],
     "{ism}, webinar har kuni bo'ladi — o'zingizga qulay vaqtni tanlang.", None, "no_session"),
    ("1-kun: efirdan chiqib ketganlar", "left_live", 1, 3, "all", True, [[{"type": "webapp", "text": "Efirga qaytish"}]],
     "{ism}, efir hali davom etyapti — eng muhim qismi oldinda. Qaytib kiring:", None, None),
    ("2-kun: efirdan chiqib ketganlar", "left_live", 2, 3, "all", True, [[{"type": "webapp", "text": "Efirga qaytish"}]],
     "{ism}, efirdan chiqib ketdingiz. Kurs haqidagi taklif hali oldinda — qaytib kiring:", None, None),
    ("Deadline: 3 soat qoldi", "before_deadline", None, 180, "not_paid", True, PAY,
     "{ism}, maxsus narx tugashiga 3 soat qoldi ({deadline} gacha). Keyin oddiy narxga o'tadi.", None, None),
    ("Chek yuborilmadi", "stuck", None, 60, "all", True, PAY,
     "{ism}, to'lovni yakunlamadingiz. Rekvizitlarni qayta ko'rish uchun tugmani bosing va chekni yuboring.",
     None, "no_receipt"),
]


async def seed() -> None:
    s = get_settings()
    async with SessionLocal() as db:
        if not (await db.execute(select(func.count()).select_from(AdminUser))).scalar():
            if not s.initial_admin_password:
                raise SystemExit("INITIAL_ADMIN_PASSWORD o'rnatilmagan")
            db.add(AdminUser(login=s.initial_admin_login, name="Super admin", role="super_admin",
                             password_hash=hash_password(s.initial_admin_password)))
            log.info("Super admin yaratildi: %s", s.initial_admin_login)
        if not (await db.execute(select(func.count()).select_from(Funnel))).scalar():
            f = Funnel(slug="notiqlik", name="Notiqlik", course_title="Notiqlik kursi",
                       topic="Ishonch bilan gapirish", offer_course_title="Notiqlik kursi",
                       welcome_text="Assalomu alaykum, {ism}! 2 kunlik bepul webinarga xush kelibsiz.")
            db.add(f)
            await db.flush()
            for i, (title, trig, day, off, seg, req, btns, text, key, stuck) in enumerate(DEFAULT_CHAIN):
                db.add(ChainMessage(funnel_id=f.id, title=title, kind="text", text=text, buttons=btns,
                                    trigger_type=trig, trigger_day=day, offset_minutes=off, segment=seg,
                                    required=req, status="active", sort=i, system_key=key, stuck_step=stuck,
                                    updated_by="tizim"))
            log.info("Standart voronka va %s ta progrev xabari yaratildi", len(DEFAULT_CHAIN))
        await db.commit()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    asyncio.run(seed())
