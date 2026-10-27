"""Test xabari: admin xabarni lidlarga ketishidan oldin o'z Telegramida yoki test chatida ko'radi.

Lidlar va navbat (scheduled_messages) bilan hech qanday aloqasi yo'q: manzil faqat ikkitadan biri —
adminning o'z Telegram ID si yoki sozlamalardagi test chati. Ixtiyoriy chat ID qabul qilinmaydi.
"""
import html
import logging
import re
from dataclasses import dataclass, field
from datetime import datetime, timedelta

from aiogram import Bot
from aiogram.exceptions import (
    TelegramBadRequest, TelegramForbiddenError, TelegramMigrateToChat, TelegramNetworkError, TelegramRetryAfter,
    TelegramUnauthorizedError,
)
from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup, WebAppInfo
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.domain import slots
from app.models import AdminUser, AuditLog, Funnel, KeyValue, Lead, LeadSession
from app.services.leads import active_session
from app.services.render import Payload, fill, send_payload, variables
from app.timeutil import fmt_datetime, now_utc

log = logging.getLogger(__name__)

TEST_CHAT_KEY = "test_chat_id"
SAMPLE_NAME = "Madina"
KNOWN_VARS = {"ism", "efir_sanasi", "efir_vaqti", "deadline"}

# test xabaridagi tugma bosilganda adminga tushuntirish (lidga nima bo'lishi)
BUTTON_HINTS = {
    "webapp": "efir sahifasi (Mini App) ochiladi. Mini App faqat shaxsiy chatda ochiladi — o'zingizga test yuboring",
    "reschedule": "efir vaqtini qayta tanlash ro'yxati chiqadi",
    "pay": "tariflar va to'lov usullari chiqadi",
    "next": "lid sxemada shu tugmaning chizig'i bo'ylab keyingi blokka o'tadi",
}


class TestSendError(Exception):
    pass


@dataclass
class TestResult:
    target: str
    sent_at: datetime
    variables: dict[str, str]
    data_source: str
    notes: list[str] = field(default_factory=list)


async def test_chat_id(db: AsyncSession) -> int | None:
    kv = await db.get(KeyValue, TEST_CHAT_KEY)
    return int(kv.value) if kv and kv.value else None


async def resolve_target(db: AsyncSession, me: AdminUser, target: str) -> tuple[int, str]:
    if target == "me":
        if not me.tg_user_id:
            raise TestSendError("Profilingizda Telegram ID yo'q. Super admin Sozlamalar → Foydalanuvchilar "
                                "bo'limida ID ingizni kiritsin, keyin botga /start bosing.")
        return me.tg_user_id, "Sizning Telegramingiz"
    if target == "chat":
        chat_id = await test_chat_id(db)
        if not chat_id:
            raise TestSendError("Test chati sozlanmagan. Sozlamalar → «Test chati» ga guruh ID sini kiriting.")
        return chat_id, "Test chati"
    raise TestSendError("Noma'lum manzil")


def test_keyboard(buttons: list[list[dict]], private: bool) -> tuple[InlineKeyboardMarkup | None, list[str]]:
    """Asl tugmalar ko'rinishida, lekin bosilganda lid uchun hech narsa sodir bo'lmaydi — faqat izoh chiqadi.
    Havolalar asl manziliga ochiladi (bosishlarni hisoblash yo'li orqali emas)."""
    notes: list[str] = []
    rows = []
    for row in buttons or []:
        out = []
        for b in row:
            text = b.get("text") or "Ochish"
            t = b.get("type")
            if t == "url" and b.get("url"):
                out.append(InlineKeyboardButton(text=text, url=b["url"]))
            elif t == "webapp" and private:
                out.append(InlineKeyboardButton(text=text, web_app=WebAppInfo(url=get_settings().miniapp_url)))
            elif t in BUTTON_HINTS:
                if t == "webapp":
                    notes.append("Guruhda Mini App tugmasi ochilmaydi — bosilganda izoh chiqadi. "
                                 "To'liq tekshirish uchun o'zingizga yuboring.")
                out.append(InlineKeyboardButton(text=text, callback_data=f"t:{t}"))
        if out:
            rows.append(out)
    return (InlineKeyboardMarkup(inline_keyboard=rows) if rows else None), notes


async def sample_variables(db: AsyncSession, funnel: Funnel | None, name: str, trigger_day: int | None,
                           now: datetime) -> dict[str, str]:
    """Namunaviy lid: eng yaqin efir vaqtini tanlagan deb hisoblanadi."""
    day1 = None
    if funnel:
        opts = slots.day1_options(slots.SlotConfig.from_funnel(funnel), now)
        day1 = opts[0] if opts else None
    day1 = day1 or (now + timedelta(days=1)).replace(minute=0, second=0, microsecond=0)
    s = LeadSession(day1_at=day1, day2_at=slots.day2_for(day1))
    deadline = None
    if funnel:
        deadline = s.day2_at + timedelta(seconds=funnel.day2_duration_sec, hours=funnel.deadline_hours)
    lead = Lead(first_name=name or SAMPLE_NAME, deadline_at=deadline)
    return variables(lead, s, trigger_day, now)


async def verify_chat(bot: Bot, chat_id: int) -> tuple[int, str]:
    """Bot shu guruhga yoza oladimi: tekshiradi va tasdiq xabarini yuboradi. Guruh superguruhga aylangan bo'lsa
    (ID -100... ga o'zgaradi) — yangi ID bilan davom etadi. Qaytaradi: (haqiqiy ID, guruh nomi)."""
    for _ in range(2):
        try:
            chat = await bot.get_chat(chat_id)
            await bot.send_message(chat.id, "✅ Test chati ulandi. Admin paneldan yuborilgan test xabarlari shu yerga "
                                            "keladi — lidlar ularni ko'rmaydi.")
            return chat.id, chat.title or chat.full_name or str(chat.id)
        except TelegramMigrateToChat as e:
            chat_id = e.migrate_to_chat_id
    raise TestSendError("Guruh ID si o'zgargan — guruhda /chatid yozib, yangi ID ni kiriting.")


def explain(e: Exception) -> str:
    """Telegram xatosini admin tushunadigan tilga o'giradi."""
    if isinstance(e, TelegramNetworkError):
        return "Telegram serveriga ulanib bo'lmadi (tarmoq). Birozdan keyin qayta urinib ko'ring."
    if isinstance(e, TelegramUnauthorizedError):
        return "Bot tokeni noto'g'ri — server sozlamalaridagi BOT_TOKEN ni tekshiring."
    if isinstance(e, TelegramRetryAfter):
        return f"Telegram cheklovi: {e.retry_after} soniyadan keyin qayta urinib ko'ring."
    if isinstance(e, TelegramForbiddenError):
        return ("Bot bu chatga yoza olmaydi: shaxsiy chat bo'lsa botga /start bosing, guruh bo'lsa botni "
                "guruhga qo'shing.")
    if isinstance(e, TelegramBadRequest):
        msg = e.message.lower()
        if "chat not found" in msg:
            bot = get_settings().bot_username
            return (f"Chat topilmadi: bot (@{bot}) bu guruhda yo'q yoki ID noto'g'ri. Botni guruhga qo'shing — u guruhga "
                    f"to'g'ri ID ni o'zi yozadi (yoki guruhda /chatid@{bot} yozing) va o'sha ID ni kiriting. "
                    "Guruh superguruhga aylangan bo'lsa, ID -100 bilan boshlanadigan yangisiga o'zgaradi.")
        if "can't parse entities" in msg:
            return f"Matndagi formatlash xato (yopilmagan teg?): {e.message}"
        if "button_type_invalid" in msg or "web app" in msg:
            return "Tugma bu chat turida ishlamaydi (Mini App faqat shaxsiy chatda)."
        if "wrong file" in msg or "failed to get http url content" in msg:
            return f"Media faylni Telegram qabul qilmadi: {e.message}"
        return f"Telegram rad etdi: {e.message}"
    return f"Yuborib bo'lmadi: {e}"


async def send_test(bot: Bot, db: AsyncSession, me: AdminUser, *, target: str, title: str, payload: Payload,
                    funnel: Funnel | None, lead_id: int | None = None, sample_name: str = "") -> TestResult:
    chat_id, target_label = await resolve_target(db, me, target)
    now = now_utc()
    if lead_id:
        if me.role not in ("super_admin", "sales"):
            raise TestSendError("Haqiqiy lid ma'lumoti bilan test faqat sotuv bo'limi va super admin uchun")
        lead = await db.get(Lead, lead_id)
        if not lead or (funnel and lead.funnel_id != funnel.id):
            raise TestSendError("Lid topilmadi")
        vars_ = variables(lead, await active_session(db, lead.id), payload.trigger_day, now)
        source = f"lid: {lead.first_name or '—'} (#{lead.id})"
    else:
        vars_ = await sample_variables(db, funnel, sample_name.strip(), payload.trigger_day, now)
        source = "namunaviy ma'lumot"
    markup, notes = test_keyboard(payload.buttons, private=chat_id > 0)
    unknown = sorted(set(re.findall(r"\{(\w+)\}", payload.text or "")) - KNOWN_VARS)
    if unknown:
        notes.append("Noma'lum o'zgaruvchi (lidga ham shundayligicha boradi): "
                     + ", ".join("{" + u + "}" for u in unknown))
    empty = sorted(k for k in KNOWN_VARS if "{" + k + "}" in (payload.text or "") and not vars_.get(k))
    if empty:
        notes.append("Bu ma'lumotda bo'sh qoladi: " + ", ".join("{" + k + "}" for k in empty))
    body = fill(payload.text, vars_)
    header = f"🧪 <b>TEST</b> · {html.escape(title)}\n<i>{html.escape(source)}. Lidlarga yuborilmadi.</i>"
    try:
        try:
            await bot.send_message(chat_id, header, disable_notification=True)
        except TelegramMigrateToChat as e:
            # test guruhi superguruhga aylangan — yangi ID ni saqlab, o'shanga yuboramiz
            chat_id = e.migrate_to_chat_id
            kv = await db.get(KeyValue, TEST_CHAT_KEY)
            if kv:
                kv.value = chat_id
            await bot.send_message(chat_id, header, disable_notification=True)
        await send_payload(bot, db, chat_id, payload, body, markup)
    except Exception as e:  # noqa: BLE001 — har qanday xato adminga tushunarli matn bo'lib qaytadi
        log.warning("Test xabar yuborilmadi: %s → %s (%s): %s", title, target_label, me.name, e)
        raise TestSendError(explain(e)) from e
    db.add(AuditLog(user_name=me.name, action="test_sent", details=f"{title} → {target_label} ({source})"))
    await db.commit()
    log.info("Test xabar: %s → %s (%s, %s)", title, target_label, me.name, source)
    shown = {k: html.unescape(v) for k, v in vars_.items()}
    return TestResult(target_label, now, shown, source, notes)


def result_out(r: TestResult) -> dict:
    return {"ok": True, "target": r.target, "sent_at": r.sent_at.isoformat(), "sent_at_label": fmt_datetime(r.sent_at),
            "variables": r.variables, "data_source": r.data_source, "notes": r.notes}
