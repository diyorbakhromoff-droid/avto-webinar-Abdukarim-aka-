"""Xabarlarni lid uchun tayyorlash va Telegram'ga yuborish."""
import html
from dataclasses import dataclass
from datetime import datetime

from aiogram import Bot
from aiogram.types import (
    FSInputFile, InlineKeyboardButton, InlineKeyboardMarkup, InputMediaAudio, InputMediaDocument,
    InputMediaPhoto, InputMediaVideo, Message, WebAppInfo,
)
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models import Lead, LeadSession, Media
from app.timeutil import fmt_date, fmt_datetime, fmt_time, now_utc


@dataclass
class Payload:
    """Yuboriladigan xabar: zanjir xabari, ommaviy xabar yoki test."""
    kind: str
    text: str
    media: list[Media]
    buttons: list[list[dict]]
    trigger_day: int | None = None


def variables(lead: Lead | None, session: LeadSession | None, trigger_day: int | None,
              now: datetime | None = None) -> dict[str, str]:
    now = now or now_utc()
    name = (lead.first_name if lead else "") or "do'stim"
    efir_at = None
    if session:
        if trigger_day == 2 or (trigger_day is None and now > session.day1_at):
            efir_at = session.day2_at
        else:
            efir_at = session.day1_at
    return {
        "ism": html.escape(name),
        "efir_sanasi": fmt_date(efir_at) if efir_at else "",
        "efir_vaqti": fmt_time(efir_at) if efir_at else "",
        "deadline": fmt_datetime(lead.deadline_at) if lead and lead.deadline_at else "",
    }


def fill(text: str, vars: dict[str, str]) -> str:
    for k, v in vars.items():
        text = text.replace("{" + k + "}", v)
    return text


def keyboard(buttons: list[list[dict]], track: str | None = None) -> InlineKeyboardMarkup | None:
    """Tugmalar: url | webapp | reschedule | pay. track — bosishni hisoblash uchun belgi."""
    if not buttons:
        return None
    s = get_settings()
    rows = []
    for r, row in enumerate(buttons):
        out = []
        for c, b in enumerate(row):
            text = b.get("text") or "Ochish"
            t = b.get("type")
            if t == "url" and b.get("url"):
                url = b["url"]
                if track:
                    url = f"{s.miniapp_url}/api/r/{track}/{r}/{c}"
                out.append(InlineKeyboardButton(text=text, url=url))
            elif t == "webapp":
                out.append(InlineKeyboardButton(text=text, web_app=WebAppInfo(url=s.miniapp_url)))
            elif t == "reschedule":
                out.append(InlineKeyboardButton(text=text, callback_data=f"resched:{track or ''}"))
            elif t == "pay":
                out.append(InlineKeyboardButton(text=text, callback_data=f"buy:{track or ''}"))
        if out:
            rows.append(out)
    return InlineKeyboardMarkup(inline_keyboard=rows) if rows else None


def _input(media: Media):
    return media.tg_file_id or FSInputFile(media.path, filename=media.filename)


def _file_id(msg: Message) -> str | None:
    for attr in ("video", "video_note", "voice", "audio", "document", "animation"):
        obj = getattr(msg, attr, None)
        if obj:
            return obj.file_id
    if msg.photo:
        return msg.photo[-1].file_id
    return None


async def send_payload(bot: Bot, db: AsyncSession, chat_id: int, p: Payload, text: str,
                       markup: InlineKeyboardMarkup | None) -> None:
    """Xabar turiga qarab yuboradi va birinchi yuborishda Telegram file_id ni keshlaydi."""
    kind = p.kind
    media = p.media[0] if p.media else None
    sent: Message | list[Message]
    caption = text or None
    if kind == "text" or not media:
        sent = await bot.send_message(chat_id, text or "⁣", reply_markup=markup,
                                      disable_web_page_preview=True)
    elif kind == "photo":
        sent = await bot.send_photo(chat_id, _input(media), caption=caption, reply_markup=markup)
    elif kind == "video":
        sent = await bot.send_video(chat_id, _input(media), caption=caption, reply_markup=markup,
                                    supports_streaming=True)
    elif kind == "video_note":
        sent = await bot.send_video_note(chat_id, _input(media), reply_markup=markup)
    elif kind == "voice":
        sent = await bot.send_voice(chat_id, _input(media), caption=caption, reply_markup=markup)
    elif kind == "audio":
        sent = await bot.send_audio(chat_id, _input(media), caption=caption, reply_markup=markup)
    elif kind == "document":
        sent = await bot.send_document(chat_id, _input(media), caption=caption, reply_markup=markup)
    elif kind == "album":
        items = []
        for i, m in enumerate(p.media):
            cap = caption if i == 0 else None
            cls = {"photo": InputMediaPhoto, "video": InputMediaVideo, "audio": InputMediaAudio}.get(
                m.kind, InputMediaDocument)
            items.append(cls(media=_input(m), caption=cap))
        sent = await bot.send_media_group(chat_id, items)
        if markup:
            await bot.send_message(chat_id, "Davom etish uchun tugmani bosing:", reply_markup=markup)
    else:
        sent = await bot.send_message(chat_id, text, reply_markup=markup)

    msgs = sent if isinstance(sent, list) else [sent]
    changed = False
    for m, msg in zip(p.media, msgs):
        if not m.tg_file_id:
            fid = _file_id(msg)
            if fid:
                m.tg_file_id = fid
                changed = True
    if changed:
        await db.commit()
