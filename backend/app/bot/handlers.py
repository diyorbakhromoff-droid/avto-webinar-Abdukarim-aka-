"""Telegram bot: ro'yxat, sessiya tanlash, menyu, to'lov va cheklar, adminlar guruhi."""
import logging
import re
from datetime import datetime, timezone

from aiogram import Bot, F, Router
from aiogram.enums import ChatType
from aiogram.filters import KICKED, MEMBER, ChatMemberUpdatedFilter, Command, CommandObject, CommandStart, StateFilter
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.types import CallbackQuery, ChatMemberUpdated, InlineKeyboardButton, InlineKeyboardMarkup, Message
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.bot import flows, texts
from app.models import ChainMessage, Funnel, Lead, LeadStep, Media, Question, ScheduledMessage, Tariff
from app.services import flow_engine, payments, test_send
from app.services.leads import cancel_pending, event, lead_for_tg, plan_stuck_messages, set_step
from app.services.render import Payload, fill, send_payload, variables
from app.services.sessions import SessionError, choose_day1, choose_day2
from app.timeutil import now_utc

log = logging.getLogger(__name__)
router = Router()
private = F.chat.type == ChatType.PRIVATE


class Ask(StatesGroup):
    question = State()


class Receipt(StatesGroup):
    waiting = State()


def normalize_phone(text: str) -> str | None:
    digits = re.sub(r"\D", "", text or "")
    if len(digits) == 9:
        digits = "998" + digits
    if len(digits) != 12 or not digits.startswith("998"):
        return None
    return f"+{digits[:3]} {digits[3:5]} {digits[5:8]} {digits[8:10]} {digits[10:]}"


def parse_start(payload: str | None) -> tuple[str | None, str]:
    """t.me/<bot>?start=<voronka>_<manba>"""
    if not payload:
        return None, ""
    slug, _, source = payload.partition("_")
    return slug, source[:64]


async def current_lead(db: AsyncSession, user_id: int) -> tuple[Lead | None, Funnel | None]:
    lead = await lead_for_tg(db, user_id)
    if not lead:
        return None, None
    return lead, await db.get(Funnel, lead.funnel_id)


# ─────────────────────────── /start va ro'yxat ───────────────────────────

@router.message(CommandStart(), private)
async def start(message: Message, command: CommandObject, db: AsyncSession, bot: Bot, state: FSMContext):
    await state.clear()
    slug, source = parse_start(command.args)
    funnel = None
    if slug:
        funnel = (await db.execute(select(Funnel).where(Funnel.slug == slug))).scalar_one_or_none()
    if funnel is None:
        lead, funnel = await current_lead(db, message.from_user.id)
        if funnel is None:
            funnel = (await db.execute(select(Funnel).order_by(Funnel.id).limit(1))).scalar_one_or_none()
    if funnel is None:
        await message.answer("Hozircha faol webinar yo'q.")
        return
    lead = await lead_for_tg(db, message.from_user.id, funnel.id)
    if lead:
        lead.blocked = False
        await db.commit()
        if lead.phone:
            await message.answer(texts.ALREADY.format(status=""), reply_markup=flows.main_menu())
            await flows.send_my_session(bot, db, lead, funnel)
        else:
            await message.answer(texts.ASK_PHONE, reply_markup=flows.phone_keyboard())
        return

    lead = Lead(funnel_id=funnel.id, tg_user_id=message.from_user.id, username=message.from_user.username,
                first_name=message.from_user.first_name or "", source=source, step="started", step_at=now_utc())
    db.add(lead)
    await db.flush()
    event(db, lead, "start", source=source)
    db.add(LeadStep(lead_id=lead.id, step="started", entered_at=lead.step_at))
    await plan_stuck_messages(db, lead, "no_phone", lead.step_at)
    await db.commit()

    welcome = fill(funnel.welcome_text or "Assalomu alaykum, {ism}! 2 kunlik bepul webinarga xush kelibsiz.",
                   variables(lead, None, None))
    await message.answer(welcome)
    await message.answer(texts.ASK_PHONE, reply_markup=flows.phone_keyboard())


async def save_phone(message: Message, db: AsyncSession, bot: Bot, lead: Lead, funnel: Funnel, phone: str):
    lead.phone = phone
    lead.phone_at = now_utc()
    event(db, lead, "phone", phone=phone)
    await set_step(db, lead, "phone", lead.phone_at)
    await db.commit()
    await message.answer(texts.PHONE_THANKS, reply_markup=flows.main_menu())
    if funnel.lead_magnet_media_id:
        media = await db.get(Media, funnel.lead_magnet_media_id)
        if media:
            p = Payload(kind=media.kind, text=funnel.lead_magnet_caption, media=[media], buttons=[])
            try:
                await send_payload(bot, db, lead.tg_user_id, p, fill(funnel.lead_magnet_caption,
                                                                      variables(lead, None, None)), None)
            except Exception as e:  # lid magnit yuborilmasa ham ro'yxat davom etadi
                log.error("Lid magnitni yuborib bo'lmadi: %s", e)
    await flows.send_day1_options(bot, lead, funnel)


@router.message(F.contact, private)
async def on_contact(message: Message, db: AsyncSession, bot: Bot):
    lead, funnel = await current_lead(db, message.from_user.id)
    if not lead:
        await message.answer("Boshlash uchun /start bosing.")
        return
    if message.contact.user_id and message.contact.user_id != message.from_user.id:
        await message.answer(texts.BAD_PHONE)
        return
    phone = normalize_phone(message.contact.phone_number)
    if not phone:
        await message.answer(texts.BAD_PHONE)
        return
    if lead.phone:
        await message.answer(texts.PHONE_THANKS, reply_markup=flows.main_menu())
        return
    await save_phone(message, db, bot, lead, funnel, phone)


# ─────────────────────────── menyu ───────────────────────────

@router.message(F.text == texts.MENU_MY, private)
async def menu_my(message: Message, db: AsyncSession, bot: Bot):
    lead, funnel = await current_lead(db, message.from_user.id)
    if lead:
        await flows.send_my_session(bot, db, lead, funnel)


@router.message(F.text == texts.MENU_ASK, private)
async def menu_ask(message: Message, state: FSMContext):
    await state.set_state(Ask.question)
    await message.answer(texts.ASK_QUESTION)


@router.message(StateFilter(Ask.question), F.text, private)
async def on_question(message: Message, db: AsyncSession, state: FSMContext):
    await state.clear()
    lead, _ = await current_lead(db, message.from_user.id)
    if not lead:
        return
    db.add(Question(lead_id=lead.id, text=message.text[:4000], source="bot"))
    event(db, lead, "question")
    await db.commit()
    await message.answer(texts.QUESTION_OK)


@router.message(F.text == texts.MENU_STOP, private)
async def menu_stop(message: Message, db: AsyncSession):
    lead, _ = await current_lead(db, message.from_user.id)
    if not lead:
        return
    lead.unsubscribed = True
    event(db, lead, "unsubscribed")
    await db.commit()
    kb = InlineKeyboardMarkup(inline_keyboard=[[InlineKeyboardButton(text="Qayta yoqish", callback_data="resume")]])
    await message.answer(texts.STOPPED, reply_markup=kb)


@router.callback_query(F.data == "resume")
async def resume(call: CallbackQuery, db: AsyncSession):
    lead, _ = await current_lead(db, call.from_user.id)
    if lead:
        lead.unsubscribed = False
        event(db, lead, "subscribed")
        await db.commit()
    await call.message.edit_text(texts.RESUMED)
    await call.answer()


# ─────────────────────────── sessiya ───────────────────────────

def _ts(value: str) -> datetime:
    return datetime.fromtimestamp(int(value), tz=timezone.utc)


@router.callback_query(F.data.startswith("slot1:"))
async def pick_day1(call: CallbackQuery, db: AsyncSession, bot: Bot):
    lead, funnel = await current_lead(db, call.from_user.id)
    if not lead or not lead.phone:
        await call.answer("Avval telefon raqamingizni yuboring.", show_alert=True)
        return
    try:
        s = await choose_day1(db, lead, funnel, _ts(call.data.split(":")[1]))
        await db.commit()
    except SessionError as e:
        await db.rollback()
        await call.answer(str(e), show_alert=True)
        lead, funnel = await current_lead(db, call.from_user.id)
        await flows.send_reschedule(bot, db, lead, funnel)
        return
    await call.message.edit_reply_markup(reply_markup=None)
    await call.message.answer(
        texts.SESSION_BOOKED.format(d1=flows.fmt_day(s.day1_at), d2=flows.fmt_day(s.day2_at)),
        reply_markup=flows.session_keyboard(s, funnel))
    await call.answer()


@router.callback_query(F.data.startswith("slot2:"))
async def pick_day2(call: CallbackQuery, db: AsyncSession, bot: Bot):
    lead, funnel = await current_lead(db, call.from_user.id)
    try:
        s = await choose_day2(db, lead, funnel, _ts(call.data.split(":")[1]))
        await db.commit()
    except SessionError as e:
        await db.rollback()
        await call.answer(str(e), show_alert=True)
        return
    await call.message.edit_reply_markup(reply_markup=None)
    await call.message.answer(flows.session_text(s), reply_markup=flows.session_keyboard(s, funnel))
    await call.answer()


@router.callback_query(F.data == "change")
async def change(call: CallbackQuery, db: AsyncSession, bot: Bot):
    lead, funnel = await current_lead(db, call.from_user.id)
    if lead:
        await flows.send_reschedule(bot, db, lead, funnel)
    await call.answer()


async def track_click(db: AsyncSession, lead: Lead, track: str) -> ChainMessage | None:
    """Zanjir tugmasi bosilishini statistikaga yozadi; 'tugma bosilganda' xabarini yuboradi."""
    if not track or not track.isdigit():
        return None
    sm = await db.get(ScheduledMessage, int(track))
    if not sm or sm.lead_id != lead.id or not sm.chain_message_id:
        return None
    event(db, lead, "button_click", chain_message_id=sm.chain_message_id)
    await db.commit()
    return await db.get(ChainMessage, sm.chain_message_id)


@router.callback_query(F.data.startswith("fl:"))
async def flow_button(call: CallbackQuery, db: AsyncSession):
    """Sxemadagi xabar tugmasi: lid shu tugmaning chizig'i bo'ylab keyingi blokka o'tadi."""
    parts = call.data.split(":")
    result = "invalid"
    if len(parts) == 4 and all(p.isdigit() for p in parts[1:]):
        result = await flow_engine.on_button(db, call.from_user.id, int(parts[1]), int(parts[2]), int(parts[3]))
        await db.commit()
    await call.answer(texts.FLOW_BUTTON_OLD if result in ("old", "inactive") else None)


@router.callback_query(F.data.startswith("t:"))
async def test_button(call: CallbackQuery):
    """Admin paneldan yuborilgan test xabaridagi tugma: hech narsa o'zgarmaydi, faqat nima bo'lishi aytiladi."""
    what = test_send.BUTTON_HINTS.get(call.data[2:], "tegishli amal bajariladi")
    await call.answer(texts.TEST_BUTTON.format(what=what), show_alert=True)


@router.callback_query(F.data.startswith("resched:"))
async def resched(call: CallbackQuery, db: AsyncSession, bot: Bot):
    lead, funnel = await current_lead(db, call.from_user.id)
    if lead:
        await track_click(db, lead, call.data.split(":", 1)[1])
        await flows.send_reschedule(bot, db, lead, funnel)
    await call.answer()


# ─────────────────────────── to'lov ───────────────────────────

@router.callback_query(F.data.startswith("buy:"))
async def buy(call: CallbackQuery, db: AsyncSession, bot: Bot):
    lead, funnel = await current_lead(db, call.from_user.id)
    if lead:
        await track_click(db, lead, call.data.split(":", 1)[1])
        await flows.send_tariffs(bot, db, lead, funnel)
    await call.answer()


@router.callback_query(F.data.startswith("tariff:"))
async def pick_tariff(call: CallbackQuery, db: AsyncSession):
    tid = int(call.data.split(":")[1])
    await call.message.answer(texts.CHOOSE_METHOD, reply_markup=flows.methods_keyboard(tid))
    await call.answer()


@router.callback_query(F.data.startswith("method:"))
async def pick_method(call: CallbackQuery, db: AsyncSession, state: FSMContext):
    _, tid, method = call.data.split(":")
    lead, funnel = await current_lead(db, call.from_user.id)
    tariff = await db.get(Tariff, int(tid))
    if not lead or not tariff:
        await call.answer()
        return
    price = payments.price_for(lead, tariff, funnel)
    if price is None:
        await call.message.answer(texts.OFFER_CLOSED)
        await call.answer()
        return
    if lead.payment_status == "none" and tariff.deposit_enabled and tariff.deposit_amount < price:
        kb = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text=texts.FULL_AMOUNT.format(amount=texts.money(price)),
                                  callback_data=f"amount:{tid}:{method}:full")],
            [InlineKeyboardButton(text=texts.DEPOSIT_AMOUNT.format(amount=texts.money(tariff.deposit_amount)),
                                  callback_data=f"amount:{tid}:{method}:deposit")],
        ])
        await call.message.answer(texts.CHOOSE_AMOUNT, reply_markup=kb)
    else:
        kind = "remaining" if lead.payment_status == "deposit" else "full"
        await show_requisites(call.message, db, state, lead, funnel, tariff, method, kind)
    await call.answer()


@router.callback_query(F.data.startswith("amount:"))
async def pick_amount(call: CallbackQuery, db: AsyncSession, state: FSMContext):
    _, tid, method, kind = call.data.split(":")
    lead, funnel = await current_lead(db, call.from_user.id)
    tariff = await db.get(Tariff, int(tid))
    if lead and tariff:
        await show_requisites(call.message, db, state, lead, funnel, tariff, method, kind)
    await call.answer()


async def show_requisites(message: Message, db: AsyncSession, state: FSMContext, lead: Lead, funnel: Funnel,
                          tariff: Tariff, method: str, kind: str):
    price = payments.price_for(lead, tariff, funnel) or tariff.regular_price
    if kind == "deposit":
        amount = tariff.deposit_amount
    elif kind == "remaining":
        amount = lead.remaining_amount or max(price - tariff.deposit_amount, 0)
    else:
        amount = price
    await state.set_state(Receipt.waiting)
    await state.update_data(tariff_id=tariff.id, method=method, kind=kind, amount=amount)
    send_btn = [InlineKeyboardButton(text=texts.SEND_RECEIPT, callback_data="receipt_hint")]
    if method == "card":
        text = texts.CARD_DETAILS.format(card=funnel.card_number, holder=funnel.card_holder,
                                         amount=texts.money(amount))
        kb = InlineKeyboardMarkup(inline_keyboard=[send_btn])
    else:
        url = funnel.payme_url if method == "payme" else funnel.click_url
        text = texts.LINK_DETAILS.format(method=texts.METHOD_NAMES[method], amount=texts.money(amount))
        rows = [[InlineKeyboardButton(text=f"{texts.METHOD_NAMES[method]} orqali to'lash", url=url)]] if url else []
        kb = InlineKeyboardMarkup(inline_keyboard=rows + [send_btn])
    await message.answer(text, reply_markup=kb)


@router.callback_query(F.data == "receipt_hint")
async def receipt_hint(call: CallbackQuery):
    await call.message.answer(texts.WAIT_RECEIPT)
    await call.answer()


@router.callback_query(F.data.startswith("receipt_again:"))
async def receipt_again(call: CallbackQuery, db: AsyncSession, state: FSMContext):
    _, tid, method, kind = call.data.split(":")
    lead, funnel = await current_lead(db, call.from_user.id)
    tariff = await db.get(Tariff, int(tid)) if tid != "0" else None
    if lead and tariff:
        await show_requisites(call.message, db, state, lead, funnel, tariff, method, kind)
    await call.answer()


@router.message(StateFilter(Receipt.waiting), F.photo | F.document, private)
async def on_receipt(message: Message, db: AsyncSession, bot: Bot, state: FSMContext):
    data = await state.get_data()
    lead, _ = await current_lead(db, message.from_user.id)
    if not lead:
        return
    if message.photo:
        file = message.photo[-1]
        mime, ext = "image/jpeg", ".jpg"
    else:
        file = message.document
        mime = file.mime_type or "application/octet-stream"
        if not (mime.startswith("image/") or mime == "application/pdf"):
            await message.answer(texts.WAIT_RECEIPT)
            return
        ext = ".pdf" if mime == "application/pdf" else ".jpg"
    buf = await bot.download(file)
    p = await payments.create_receipt(db, lead, tariff_id=data.get("tariff_id"), method=data.get("method", "card"),
                                      kind=data.get("kind", "full"), amount=int(data.get("amount", 0)),
                                      data=buf.read(), mime=mime, ext=ext)
    await state.clear()
    await message.answer(texts.RECEIPT_OK)
    await payments.post_to_group(bot, db, p)


@router.message(F.photo | F.document, private)
async def receipt_without_choice(message: Message, db: AsyncSession, bot: Bot):
    lead, funnel = await current_lead(db, message.from_user.id)
    if lead and lead.phone:
        await message.answer(texts.RECEIPT_NEED_CHOICE)
        await flows.send_tariffs(bot, db, lead, funnel)


@router.message(F.text, private)
async def any_text(message: Message, db: AsyncSession, bot: Bot):
    lead, funnel = await current_lead(db, message.from_user.id)
    if not lead:
        await message.answer("Boshlash uchun /start bosing.")
        return
    if not lead.phone:
        phone = normalize_phone(message.text)
        if not phone:
            await message.answer(texts.BAD_PHONE, reply_markup=flows.phone_keyboard())
            return
        await save_phone(message, db, bot, lead, funnel, phone)
        return
    if lead.ask_until and lead.ask_until > now_utc():
        # sxema "savolingizni yozing" deb so'ragan edi
        lead.ask_until = None
        db.add(Question(lead_id=lead.id, text=message.text[:4000], source="bot"))
        event(db, lead, "question")
        await db.commit()
        await message.answer(texts.QUESTION_OK)
        return
    await flows.send_my_session(bot, db, lead, funnel)


# ─────────────────────────── adminlar guruhi ───────────────────────────

@router.message(Command("chatid"))
async def chat_id(message: Message):
    await message.answer(f"Chat ID: <code>{message.chat.id}</code>")


async def _admin_or_alert(call: CallbackQuery, db: AsyncSession):
    admin = await payments.is_payment_admin(db, call.from_user.id)
    if not admin:
        await call.answer(texts.GROUP_NOT_ALLOWED, show_alert=True)
    return admin


@router.callback_query(F.data.startswith("pay_ok:"))
async def pay_ok(call: CallbackQuery, db: AsyncSession, bot: Bot):
    admin = await _admin_or_alert(call, db)
    if not admin:
        return
    p = await payments.approve(bot, db, int(call.data.split(":")[1]), admin.name)
    await call.answer("Tasdiqlandi" if p else texts.GROUP_ALREADY, show_alert=not p)


@router.callback_query(F.data.startswith("pay_no:"))
async def pay_no(call: CallbackQuery, db: AsyncSession):
    if not await _admin_or_alert(call, db):
        return
    pid = int(call.data.split(":")[1])
    await call.message.edit_reply_markup(reply_markup=payments.reasons_keyboard(pid))
    await call.answer()


@router.callback_query(F.data.startswith("pay_back:"))
async def pay_back(call: CallbackQuery, db: AsyncSession):
    if not await _admin_or_alert(call, db):
        return
    await call.message.edit_reply_markup(reply_markup=payments.decision_keyboard(int(call.data.split(":")[1])))
    await call.answer()


@router.callback_query(F.data.startswith("pay_reason:"))
async def pay_reason(call: CallbackQuery, db: AsyncSession, bot: Bot):
    admin = await _admin_or_alert(call, db)
    if not admin:
        return
    _, pid, idx = call.data.split(":")
    reason = payments.REJECT_REASONS[int(idx)]
    p = await payments.reject(bot, db, int(pid), reason, admin.name)
    await call.answer("Rad etildi" if p else texts.GROUP_ALREADY, show_alert=not p)


# ─────────────────────────── bloklash ───────────────────────────

@router.my_chat_member(ChatMemberUpdatedFilter(member_status_changed=KICKED))
async def on_block(update: ChatMemberUpdated, db: AsyncSession):
    """Lid botni bloklasa — yuborish to'xtaydi, statistikada alohida ko'rinadi."""
    leads = (await db.execute(select(Lead).where(Lead.tg_user_id == update.from_user.id))).scalars().all()
    for lead in leads:
        if not lead.blocked:
            lead.blocked = True
            event(db, lead, "blocked")
            await cancel_pending(db, lead.id, "botni bloklagan", chain_only=False)
    await db.commit()


@router.my_chat_member(ChatMemberUpdatedFilter(member_status_changed=MEMBER))
async def on_unblock(update: ChatMemberUpdated, db: AsyncSession):
    leads = (await db.execute(select(Lead).where(Lead.tg_user_id == update.from_user.id))).scalars().all()
    for lead in leads:
        lead.blocked = False
    await db.commit()
