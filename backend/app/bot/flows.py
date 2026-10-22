"""Bot va Mini App API birga ishlatadigan oqimlar: vaqt tanlash, tarif tanlash, menyu."""
from datetime import timedelta

from aiogram import Bot
from aiogram.types import (
    InlineKeyboardButton, InlineKeyboardMarkup, KeyboardButton, ReplyKeyboardMarkup, WebAppInfo,
)
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.bot import texts
from app.config import get_settings
from app.domain import slots
from app.models import Funnel, Lead, LeadSession, Tariff
from app.services.leads import active_session, event, set_step
from app.services.payments import price_for, safe_send, special_active
from app.timeutil import fmt_date, fmt_datetime, fmt_time, now_utc, slot_label


def main_menu() -> ReplyKeyboardMarkup:
    return ReplyKeyboardMarkup(keyboard=[[KeyboardButton(text=texts.MENU_MY), KeyboardButton(text=texts.MENU_ASK)],
                                         [KeyboardButton(text=texts.MENU_STOP)]], resize_keyboard=True)


def phone_keyboard() -> ReplyKeyboardMarkup:
    return ReplyKeyboardMarkup(keyboard=[[KeyboardButton(text=texts.PHONE_BUTTON, request_contact=True)]],
                               resize_keyboard=True, one_time_keyboard=True)


def enter_button() -> InlineKeyboardButton:
    return InlineKeyboardButton(text=texts.ENTER_BUTTON, web_app=WebAppInfo(url=get_settings().miniapp_url))


def fmt_day(dt) -> str:
    return f"{fmt_date(dt)}, {fmt_time(dt)}"


async def send_day1_options(bot: Bot, lead: Lead, f: Funnel) -> None:
    now = now_utc()
    opts = slots.day1_options(slots.SlotConfig.from_funnel(f), now)
    if not opts:
        await safe_send(bot, lead, texts.NO_SLOTS)
        return
    kb = InlineKeyboardMarkup(inline_keyboard=[[
        InlineKeyboardButton(text=slot_label(now, dt), callback_data=f"slot1:{int(dt.timestamp())}") for dt in opts
    ]])
    await safe_send(bot, lead, texts.CHOOSE_DAY1, kb)


async def send_day2_options(bot: Bot, lead: Lead, f: Funnel) -> None:
    now = now_utc()
    opts = slots.day2_reschedule_options(slots.SlotConfig.from_funnel(f), now)
    if not opts:
        await safe_send(bot, lead, texts.NO_SLOTS)
        return
    kb = InlineKeyboardMarkup(inline_keyboard=[[
        InlineKeyboardButton(text=slot_label(now, dt), callback_data=f"slot2:{int(dt.timestamp())}") for dt in opts
    ]])
    await safe_send(bot, lead, texts.CHOOSE_DAY2, kb)


async def send_reschedule(bot: Bot, db: AsyncSession, lead: Lead, f: Funnel) -> None:
    """Qaysi kunni qayta tanlash kerakligini o'zi aniqlaydi (TZ 4.4)."""
    s = await active_session(db, lead.id)
    if lead.cold:
        await safe_send(bot, lead, texts.LIMIT_REACHED)
        return
    if s and s.day1_watched and s.day2_joined is False:
        if lead.day2_reschedules >= f.reschedule_limit:
            await safe_send(bot, lead, texts.LIMIT_REACHED)
        else:
            await send_day2_options(bot, lead, f)
        return
    if s and s.day1_watched is False and lead.day1_reschedules >= f.reschedule_limit:
        await safe_send(bot, lead, texts.LIMIT_REACHED)
        return
    if s and s.day1_evaluated is False and now_utc() >= s.day1_at:
        await safe_send(bot, lead, session_text(s))
        return
    if s and s.day1_evaluated is False and not slots.can_change_day1(
            slots.SlotConfig.from_funnel(f), now_utc(), s.day1_at):
        await safe_send(bot, lead, texts.CHANGE_LATE.format(n=int(f.min_hours_before)))
        return
    if s and s.day1_watched:
        await safe_send(bot, lead, session_text(s))
        return
    await send_day1_options(bot, lead, f)


def session_text(s: LeadSession) -> str:
    return texts.SESSION_INFO.format(d1=fmt_day(s.day1_at), d2=fmt_day(s.day2_at))


def session_keyboard(s: LeadSession, f: Funnel) -> InlineKeyboardMarkup:
    now = now_utc()
    rows = []
    if s.day1_at - timedelta(minutes=30) <= now or s.day1_evaluated:
        rows.append([enter_button()])
    if not s.day1_evaluated and slots.can_change_day1(slots.SlotConfig.from_funnel(f), now, s.day1_at):
        rows.append([InlineKeyboardButton(text=texts.CHANGE_BUTTON, callback_data="change")])
    return InlineKeyboardMarkup(inline_keyboard=rows)


async def send_my_session(bot: Bot, db: AsyncSession, lead: Lead, f: Funnel) -> None:
    s = await active_session(db, lead.id)
    if not s:
        await safe_send(bot, lead, texts.SESSION_NONE)
        await send_day1_options(bot, lead, f)
        return
    await safe_send(bot, lead, session_text(s), session_keyboard(s, f))


def methods_keyboard(tariff_id: int) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(inline_keyboard=[[
        InlineKeyboardButton(text=texts.METHOD_NAMES[m], callback_data=f"method:{tariff_id}:{m}")
        for m in ("card", "payme", "click")
    ]])


async def send_tariffs(bot: Bot, db: AsyncSession, lead: Lead, f: Funnel, source: str = "bot",
                       preselected: int | None = None) -> None:
    """«Kursga yozilish» — tarif tanlash (Mini App yoki bot tugmasidan). Mini App'da tanlangan tarif bo'lsa —
    darhol to'lov usuli so'raladi."""
    now = now_utc()
    if lead.clicked_buy_at is None:
        lead.clicked_buy_at = now
    event(db, lead, "clicked_buy", source=source)
    if lead.payment_status == "none" and lead.step not in ("receipt_sent",):
        await set_step(db, lead, "clicked_buy", now)
    await db.commit()
    tariffs = (await db.execute(select(Tariff).where(Tariff.funnel_id == f.id).order_by(Tariff.sort))).scalars().all()
    buttons = []
    for t in tariffs:
        price = price_for(lead, t, f, now)
        if price is None:
            continue
        buttons.append([InlineKeyboardButton(text=f"{t.name} — {texts.money(price)}", callback_data=f"tariff:{t.id}")])
    if not buttons:
        await safe_send(bot, lead, texts.OFFER_CLOSED)
        return
    chosen = next((t for t in tariffs if t.id == preselected and price_for(lead, t, f, now) is not None), None)
    if chosen:
        price = price_for(lead, chosen, f, now)
        await safe_send(bot, lead, f"<b>{chosen.name}</b> — {texts.money(price)}\n\n{texts.CHOOSE_METHOD}",
                        methods_keyboard(chosen.id))
        return
    note = texts.DEADLINE_NOTE.format(deadline=fmt_datetime(lead.deadline_at)) \
        if special_active(lead, now) and lead.deadline_at and not lead.special_price_locked else ""
    await safe_send(bot, lead, texts.CHOOSE_TARIFF.format(deadline=note), InlineKeyboardMarkup(inline_keyboard=buttons))
