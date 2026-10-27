"""Cheklar: qabul qilish, adminlar guruhiga yuborish, tasdiqlash / rad etish."""
import hashlib
import logging
import os
import uuid
from datetime import timedelta

from aiogram import Bot
from aiogram.exceptions import TelegramAPIError
from aiogram.types import BufferedInputFile, InlineKeyboardButton, InlineKeyboardMarkup
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.bot import texts
from app.config import get_settings
from app.domain.pipeline import stage_after_receipt
from app.models import AdminUser, Funnel, KeyValue, Lead, Payment, Tariff
from app.services.leads import event, set_stage, set_step
from app.timeutil import fmt_datetime, now_utc

log = logging.getLogger(__name__)
REJECT_REASONS = ["Summa mos emas", "Chek o'qilmaydi", "To'lov topilmadi", "Boshqa sabab"]


def special_active(lead: Lead, now=None) -> bool:
    now = now or now_utc()
    return lead.special_price_locked or (lead.deadline_at is not None and now <= lead.deadline_at)


def price_for(lead: Lead, tariff: Tariff, funnel: Funnel, now=None) -> int | None:
    """Lid uchun hozirgi narx. None — taklif yopilgan."""
    if special_active(lead, now):
        return tariff.special_price
    if funnel.after_deadline == "closed":
        return None
    return tariff.regular_price


async def get_setting(db: AsyncSession, key: str, default=None):
    kv = await db.get(KeyValue, key)
    return kv.value if kv else default


def store_file(data: bytes, ext: str) -> str:
    d = os.path.join(get_settings().storage_dir, "receipts", now_utc().strftime("%Y-%m"))
    os.makedirs(d, exist_ok=True)
    path = os.path.join(d, f"{uuid.uuid4().hex}{ext}")
    with open(path, "wb") as fh:
        fh.write(data)
    return path


async def create_receipt(db: AsyncSession, lead: Lead, *, tariff_id: int | None, method: str, kind: str,
                         amount: int, data: bytes, mime: str, ext: str, uploaded_by: str | None = None) -> Payment:
    digest = hashlib.sha256(data).hexdigest()
    dup = (await db.execute(
        select(Payment.id).where(Payment.file_hash == digest).order_by(Payment.id).limit(1))).scalar()
    now = now_utc()
    p = Payment(
        lead_id=lead.id, tariff_id=tariff_id, method=method, kind=kind, amount=amount, status="pending",
        file_path=store_file(data, ext), file_mime=mime, file_hash=digest, duplicate_of=dup,
        submitted_at=now, within_deadline=special_active(lead, now), uploaded_by=uploaded_by,
    )
    db.add(p)
    await db.flush()
    event(db, lead, "receipt", payment_id=p.id, amount=amount, kind=kind, method=method)
    if lead.payment_status == "none":
        await set_step(db, lead, "receipt_sent", now)
    await set_stage(db, lead, stage_after_receipt(lead.stage), uploaded_by or "bot")
    await db.commit()
    return p


def group_caption(p: Payment, lead: Lead, tariff: Tariff | None) -> str:
    return texts.GROUP_RECEIPT.format(
        id=p.id, name=lead.first_name, phone=lead.phone or "—", tariff=tariff.name if tariff else "—",
        method=texts.METHOD_NAMES.get(p.method, p.method), amount=texts.money(p.amount),
        kind=texts.KIND_NAMES.get(p.kind, p.kind),
        deadline=(fmt_datetime(lead.deadline_at) + (" — muddat ichida" if p.within_deadline else " — muddatdan keyin"))
        if lead.deadline_at else "—",
        dup=texts.GROUP_DUP.format(dup=p.duplicate_of) if p.duplicate_of else "",
    )


def decision_keyboard(pid: int) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(inline_keyboard=[[
        InlineKeyboardButton(text="Tasdiqlash", callback_data=f"pay_ok:{pid}"),
        InlineKeyboardButton(text="Rad etish", callback_data=f"pay_no:{pid}"),
    ]])


def reasons_keyboard(pid: int) -> InlineKeyboardMarkup:
    rows = [[InlineKeyboardButton(text=r, callback_data=f"pay_reason:{pid}:{i}")]
            for i, r in enumerate(REJECT_REASONS)]
    rows.append([InlineKeyboardButton(text="Ortga", callback_data=f"pay_back:{pid}")])
    return InlineKeyboardMarkup(inline_keyboard=rows)


async def post_to_group(bot: Bot, db: AsyncSession, p: Payment) -> None:
    chat_id = await get_setting(db, "admin_group_chat_id")
    lead = await db.get(Lead, p.lead_id)
    tariff = await db.get(Tariff, p.tariff_id) if p.tariff_id else None
    await notify_manager(bot, db, lead, texts.MANAGER_RECEIPT.format(
        name=lead.first_name, phone=lead.phone or "—", amount=texts.money(p.amount),
        kind=texts.KIND_NAMES.get(p.kind, p.kind)))
    if not chat_id:
        log.warning("admin_group_chat_id sozlanmagan — chek faqat admin panelda")
        return
    with open(p.file_path, "rb") as fh:
        data = fh.read()
    caption = group_caption(p, lead, tariff)
    name = os.path.basename(p.file_path)
    try:
        if p.file_mime.startswith("image/"):
            msg = await bot.send_photo(chat_id, BufferedInputFile(data, name), caption=caption,
                                       reply_markup=decision_keyboard(p.id))
        else:
            msg = await bot.send_document(chat_id, BufferedInputFile(data, name), caption=caption,
                                          reply_markup=decision_keyboard(p.id))
    except TelegramAPIError as e:
        log.error("Chekni guruhga yuborib bo'lmadi: %s", e)
        return
    p.group_chat_id = msg.chat.id
    p.group_message_id = msg.message_id
    await db.commit()


async def is_payment_admin(db: AsyncSession, tg_user_id: int) -> AdminUser | None:
    return (await db.execute(select(AdminUser).where(
        AdminUser.tg_user_id == tg_user_id, AdminUser.active.is_(True),
        AdminUser.role.in_(("super_admin", "sales"))))).scalar_one_or_none()


async def _decide(db: AsyncSession, pid: int, status: str, who: str, reason: str | None) -> Payment | None:
    """Atomik: faqat 'pending' chek o'zgaradi — bir chekni ikki marta tasdiqlab bo'lmaydi."""
    res = await db.execute(
        update(Payment).where(Payment.id == pid, Payment.status == "pending")
        .values(status=status, decided_at=now_utc(), decided_by=who, reject_reason=reason)
        .returning(Payment.id))
    if res.scalar() is None:
        return None
    p = await db.get(Payment, pid)
    await db.refresh(p)
    return p


async def approve(bot: Bot, db: AsyncSession, pid: int, who: str) -> Payment | None:
    p = await _decide(db, pid, "approved", who, None)
    if not p:
        return None
    lead = await db.get(Lead, p.lead_id)
    funnel = await db.get(Funnel, lead.funnel_id)
    tariff = await db.get(Tariff, p.tariff_id) if p.tariff_id else None
    event(db, lead, "payment_approved", payment_id=p.id, kind=p.kind, amount=p.amount, by=who)
    await set_stage(db, lead, "won", who)
    if p.within_deadline:
        lead.special_price_locked = True
    send_invite = False
    if p.kind == "full" or (p.kind == "remaining" and (lead.remaining_amount or 0) <= p.amount):
        lead.payment_status = "full"
        lead.remaining_amount = 0 if p.kind == "remaining" else lead.remaining_amount
        await set_step(db, lead, "full_paid")
        send_invite = True
        text = texts.PAY_APPROVED_FULL
    elif p.kind == "remaining":
        lead.remaining_amount = (lead.remaining_amount or 0) - p.amount
        text = texts.PAY_APPROVED_REMAINING
    else:
        lead.payment_status = "deposit"
        if lead.remaining_amount is None and tariff:
            price = tariff.special_price if p.within_deadline else tariff.regular_price
            lead.remaining_amount = max(price - p.amount, 0)
        await set_step(db, lead, "deposit_paid")
        text = texts.PAY_APPROVED_DEPOSIT
    # sotuv va deadline xabarlari yuborish paytida segment bo'yicha o'tkazib yuboriladi (domain.segments)
    if p.kind == "deposit" and not lead.manager_id:
        lead.manager_id = await next_manager(db)
    await db.commit()

    await safe_send(bot, lead, text)
    if send_invite:
        await send_channel_invite(bot, db, lead, funnel)
    if p.kind == "deposit":
        await notify_manager(bot, db, lead, texts.MANAGER_DEPOSIT.format(name=lead.first_name,
                                                                          phone=lead.phone or "—"))
    await update_group_message(bot, p, texts.GROUP_APPROVED.format(who=who, at=fmt_datetime(p.decided_at)), lead,
                               tariff)
    return p


async def reject(bot: Bot, db: AsyncSession, pid: int, reason: str, who: str) -> Payment | None:
    p = await _decide(db, pid, "rejected", who, reason)
    if not p:
        return None
    lead = await db.get(Lead, p.lead_id)
    tariff = await db.get(Tariff, p.tariff_id) if p.tariff_id else None
    event(db, lead, "payment_rejected", payment_id=p.id, reason=reason, by=who)
    if lead.payment_status == "none":
        await set_step(db, lead, "receipt_rejected")
    await db.commit()
    kb = InlineKeyboardMarkup(inline_keyboard=[[InlineKeyboardButton(
        text=texts.RESEND_RECEIPT, callback_data=f"receipt_again:{p.tariff_id or 0}:{p.method}:{p.kind}")]])
    await safe_send(bot, lead, texts.PAY_REJECTED.format(reason=reason), kb)
    await update_group_message(bot, p, texts.GROUP_REJECTED.format(who=who, at=fmt_datetime(p.decided_at),
                                                                   reason=reason), lead, tariff)
    return p


async def update_group_message(bot: Bot, p: Payment, suffix: str, lead: Lead, tariff: Tariff | None) -> None:
    if not p.group_chat_id:
        return
    try:
        await bot.edit_message_caption(chat_id=p.group_chat_id, message_id=p.group_message_id,
                                       caption=group_caption(p, lead, tariff) + suffix, reply_markup=None)
    except TelegramAPIError as e:
        log.warning("Guruh xabarini yangilab bo'lmadi: %s", e)


async def safe_send(bot: Bot, lead: Lead, text: str, markup=None) -> bool:
    if lead.blocked:
        return False
    try:
        await bot.send_message(lead.tg_user_id, text, reply_markup=markup)
        return True
    except TelegramAPIError as e:
        log.warning("Lidga yuborib bo'lmadi (%s): %s", lead.id, e)
        return False


async def send_channel_invite(bot: Bot, db: AsyncSession, lead: Lead, funnel: Funnel) -> bool:
    """Yopiq kanalga bir kishilik, 24 soatlik havola (bot kanalda admin bo'lishi kerak)."""
    if not funnel.channel_id:
        log.warning("channel_id sozlanmagan (voronka %s)", funnel.id)
        return False
    try:
        link = await bot.create_chat_invite_link(funnel.channel_id, name=f"lead{lead.id}", member_limit=1,
                                                 expire_date=now_utc() + timedelta(hours=24))
    except TelegramAPIError as e:
        log.error("Taklif havolasini yaratib bo'lmadi: %s", e)
        return False
    kb = InlineKeyboardMarkup(inline_keyboard=[[InlineKeyboardButton(text=texts.CHANNEL_BUTTON,
                                                                     url=link.invite_link)]])
    ok = await safe_send(bot, lead, texts.CHANNEL_BUTTON + ":", kb)
    if ok:
        event(db, lead, "invite_sent")
        await db.commit()
    return ok


async def next_manager(db: AsyncSession) -> int | None:
    """Navbat bilan biriktirish: eng kam lid biriktirilgan faol sotuv menejeri."""
    load = (select(Lead.manager_id, func.count().label("n")).where(Lead.manager_id.is_not(None))
            .group_by(Lead.manager_id).subquery())
    row = (await db.execute(
        select(AdminUser.id).outerjoin(load, load.c.manager_id == AdminUser.id)
        .where(AdminUser.role == "sales", AdminUser.active.is_(True))
        .order_by(func.coalesce(load.c.n, 0), AdminUser.id).limit(1))).first()
    return row[0] if row else None


async def notify_manager(bot: Bot, db: AsyncSession, lead: Lead, text: str) -> None:
    if not lead.manager_id:
        return
    m = await db.get(AdminUser, lead.manager_id)
    if m and m.tg_user_id and m.active:
        try:
            await bot.send_message(m.tg_user_id, text)
        except TelegramAPIError as e:
            log.warning("Menejerga yuborib bo'lmadi: %s", e)


async def safe_notify_admins(bot: Bot, db: AsyncSession, text: str, exclude_id: int | None = None) -> None:
    """Super adminlarga Telegram xabari (masalan rekvizitlar o'zgarganda)."""
    admins = (await db.execute(select(AdminUser).where(
        AdminUser.role == "super_admin", AdminUser.active.is_(True), AdminUser.tg_user_id.is_not(None)))).scalars()
    for a in admins:
        if a.id == exclude_id:
            continue
        try:
            await bot.send_message(a.tg_user_id, text)
        except TelegramAPIError as e:
            log.warning("Adminga yuborib bo'lmadi: %s", e)
