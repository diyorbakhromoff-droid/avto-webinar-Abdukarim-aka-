"""Xabarlar navbatini yuborish: Telegram tezlik chegaralari, 429 va 403 xatolari."""
import asyncio
import logging
import time
from datetime import timedelta

from aiogram import Bot
from aiogram.exceptions import (
    TelegramAPIError, TelegramBadRequest, TelegramForbiddenError, TelegramRetryAfter,
)
from sqlalchemy import select, text, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.bot import flows as bot_flows
from app.bot import texts
from app.db import SessionLocal
from app.domain.planning import stale_reason
from app.domain.segments import broadcast_allowed, chain_allowed, flow_allowed
from app.models import (
    Attendance, Broadcast, ChainMessage, FlowNode, Funnel, Lead, LeadSession, Media, ScheduledMessage,
)
from app.services import flow_engine
from app.services.leads import cancel_pending, event, snapshot
from app.services.render import Payload, fill, keyboard, send_payload, variables
from app.timeutil import now_utc

log = logging.getLogger(__name__)

DAY1_SEGMENTS = {"day1_attended", "day1_missed"}
DAY2_SEGMENTS = {"day2_attended", "day2_missed", "reached_offer", "left_before_offer"}
MAX_ATTEMPTS = 3
ASK_WINDOW = timedelta(hours=24)   # "savolingizni yozing" dan keyin shuncha vaqt yozilgan matn — savol


class RateLimiter:
    """Umumiy tezlik: soniyasiga N ta xabar (Telegram ~30)."""

    def __init__(self, per_sec: float):
        self.interval = 1.0 / per_sec
        self.next_at = 0.0
        self.lock = asyncio.Lock()

    async def wait(self) -> None:
        async with self.lock:
            now = time.monotonic()
            if self.next_at > now:
                await asyncio.sleep(self.next_at - now)
            self.next_at = max(now, self.next_at) + self.interval

    async def pause(self, seconds: float) -> None:
        async with self.lock:
            self.next_at = max(self.next_at, time.monotonic() + seconds)


async def claim_due(limit: int = 300) -> list[int]:
    """Vaqti kelgan xabarlarni 'sending' holatiga o'tkazib oladi (bir nechta worker xavfsiz)."""
    async with SessionLocal() as db:
        rows = (await db.execute(text("""
            UPDATE scheduled_messages SET status = 'sending'
            WHERE id IN (
                SELECT id FROM scheduled_messages
                WHERE status = 'pending' AND send_at <= now()
                ORDER BY send_at LIMIT :limit FOR UPDATE SKIP LOCKED)
            RETURNING id, lead_id
        """), {"limit": limit})).all()
        await db.commit()
    # bitta chatga soniyasiga 1 ta: bir lidning ikkinchi xabari keyingi aylanishga qoladi
    seen, ids, later = set(), [], []
    for sid, lead_id in sorted(rows):
        (later if lead_id in seen else ids).append(sid)
        seen.add(lead_id)
    if later:
        async with SessionLocal() as db:
            await db.execute(update(ScheduledMessage).where(ScheduledMessage.id.in_(later))
                             .values(status="pending", send_at=now_utc() + timedelta(seconds=1.2)))
            await db.commit()
    return ids


async def _finish(db: AsyncSession, sm: ScheduledMessage, status: str, reason: str | None = None) -> None:
    sm.status = status
    sm.reason = reason[:200] if reason else None
    if status == "sent":
        sm.sent_at = now_utc()
    await db.commit()
    what = f"zanjir #{sm.chain_message_id}" if sm.chain_message_id else (
        f"ommaviy #{sm.broadcast_id}" if sm.broadcast_id else f"sxema bloki #{sm.flow_node_id}")
    log.log(logging.WARNING if status == "failed" else logging.INFO, "Xabar %s: navbat #%s, lid #%s, %s%s",
            status, sm.id, sm.lead_id, what, f" — {reason}" if reason else "")


async def _postpone(db: AsyncSession, sm: ScheduledMessage, seconds: int, reason: str) -> None:
    sm.status = "pending"
    sm.send_at = now_utc() + timedelta(seconds=seconds)
    sm.reason = reason
    await db.commit()


async def send_one(bot: Bot, limiter: RateLimiter, sid: int) -> None:
    async with SessionLocal() as db:
        sm = await db.get(ScheduledMessage, sid)
        if not sm or sm.status != "sending":
            return
        lead = await db.get(Lead, sm.lead_id)
        if lead.blocked:
            await _finish(db, sm, "skipped", "botni bloklagan")
            return
        session = await db.get(LeadSession, sm.session_id) if sm.session_id else None
        if session is None and sm.chain_message_id:
            session = (await db.execute(select(LeadSession).where(
                LeadSession.lead_id == lead.id, LeadSession.status != "replaced")
                .order_by(LeadSession.id.desc()).limit(1))).scalar_one_or_none()
        snap = await snapshot(db, lead, session)

        if sm.flow_node_id and not sm.chain_message_id:
            # sxemadagi amal: yangi vaqt tanlash yoki savol so'rash
            node = await db.get(FlowNode, sm.flow_node_id)
            action = (node.config or {}).get("action") if node and node.type == "action" else None
            if action not in ("reschedule", "ask"):
                await _finish(db, sm, "skipped", "amal topilmadi")
                return
            if snap.unsubscribed:
                await _finish(db, sm, "skipped", "xabarlarni to'xtatgan")
                return

            async def deliver():
                if action == "reschedule":
                    await bot_flows.send_reschedule(bot, db, lead, await db.get(Funnel, lead.funnel_id))
                else:
                    await bot.send_message(lead.tg_user_id, texts.ASK_QUESTION)
                    lead.ask_until = now_utc() + ASK_WINDOW
            await _deliver(bot, limiter, db, sm, lead, deliver)
            return

        if sm.chain_message_id:
            msg = await db.get(ChainMessage, sm.chain_message_id)
            if not msg or msg.status != "active":
                await _finish(db, sm, "skipped", "xabar faol emas")
                return
            node = await db.get(FlowNode, msg.flow_node_id) if msg.flow_node_id else None
            if node is not None and node.type == "message":
                # sxemadagi xabar: kimga borishini sxema hal qilgan; faqat umumiy cheklovlar
                ok, why = flow_allowed(snap, bool((node.config or {}).get("paid_ok")))
                if not ok:
                    await _finish(db, sm, "skipped", why)
                    await flow_engine.on_message_skipped(db, sm, why)
                    await db.commit()
                    return
                payload = Payload(msg.kind, msg.text, await _media(db, msg.media_ids), msg.buttons or [],
                                  msg.trigger_day)
                await _send_payload(bot, limiter, db, sm, lead, session, payload)
                return
            funnel = await db.get(Funnel, lead.funnel_id)
            stale = _stale(msg, sm, session, funnel, lead)
            if stale:
                await _finish(db, sm, "skipped", stale)
                return
            if session and _results_pending(msg.segment, session, funnel):
                await _postpone(db, sm, 30, "kun natijasi kutilmoqda")
                return
            ok, why = chain_allowed(msg.segment, snap, msg.segment_day or msg.trigger_day, msg.segment_minute)
            if ok and msg.system_key == "late_reminder" and session:
                day_at = session.day1_at if (msg.trigger_day or 1) == 1 else session.day2_at
                joined = (await db.execute(select(Attendance.id).where(
                    Attendance.session_id == session.id, Attendance.day == (msg.trigger_day or 1),
                    Attendance.day_at == day_at).limit(1))).first()
                if joined:
                    ok, why = False, "efirga kirgan"
            if not ok:
                await _finish(db, sm, "skipped", why)
                return
            payload = Payload(msg.kind, msg.text, await _media(db, msg.media_ids), msg.buttons or [], msg.trigger_day)
        elif sm.broadcast_id:
            b = await db.get(Broadcast, sm.broadcast_id)
            stale = None if b.lead_ids else stale_reason("broadcast", b.send_at or sm.send_at, now_utc())
            if stale:
                await _finish(db, sm, "skipped", stale)
                return
            # menejer tanlagan lidlarga xabar ham "xabarlarni to'xtatgan" lidga bormaydi
            allowed = not snap.unsubscribed if b.lead_ids else broadcast_allowed(b.segment, snap)
            if not allowed:
                await _finish(db, sm, "skipped", "segmentga mos emas yoki xabarlarni to'xtatgan")
                return
            media = await _media(db, [b.media_id] if b.media_id else [])
            payload = Payload(media[0].kind if media else "text", b.text, media, b.buttons or [])
        else:
            await _finish(db, sm, "skipped", "bo'sh")
            return
        await _send_payload(bot, limiter, db, sm, lead, session, payload)


async def _send_payload(bot: Bot, limiter: RateLimiter, db: AsyncSession, sm: ScheduledMessage, lead: Lead,
                        session: LeadSession | None, payload: Payload) -> None:
    body = fill(payload.text, variables(lead, session, payload.trigger_day))
    markup = keyboard(payload.buttons, track=str(sm.id))
    await _deliver(bot, limiter, db, sm, lead,
                   lambda: send_payload(bot, db, lead.tg_user_id, payload, body, markup))


async def _deliver(bot: Bot, limiter: RateLimiter, db: AsyncSession, sm: ScheduledMessage, lead: Lead,
                   send) -> None:
    """Telegram'ga yuborish va xatolarni ishlash (429 — kutish, 403 — bloklagan, qolgani — qayta urinish)."""
    await limiter.wait()
    try:
        await send()
    except TelegramRetryAfter as e:
        await limiter.pause(e.retry_after)
        await _postpone(db, sm, int(e.retry_after) + 1, "429: retry_after")
        return
    except TelegramForbiddenError:
        lead.blocked = True
        event(db, lead, "blocked", chain_message_id=sm.chain_message_id)
        await cancel_pending(db, lead.id, "botni bloklagan", chain_only=False)
        await _finish(db, sm, "failed", "403: botni bloklagan")
        return
    except TelegramBadRequest as e:
        await _finish(db, sm, "failed", f"400: {e.message}")
        return
    except (TelegramAPIError, OSError) as e:
        sm.attempts += 1
        if sm.attempts >= MAX_ATTEMPTS:
            await _finish(db, sm, "failed", str(e))
        else:
            await _postpone(db, sm, 60, f"qayta urinish: {e}")
        return
    await _finish(db, sm, "sent")


def _stale(msg: ChainMessage, sm: ScheduledMessage, s: LeadSession | None, f: Funnel, lead: Lead) -> str | None:
    """Vaqti o'tib ketgan xabar (masalan, worker to'xtab qolgan bo'lsa) noto'g'ri vaqtda yuborilmaydi."""
    day = msg.trigger_day or 1
    start = (s.day1_at if day == 1 else s.day2_at) if s else None
    end = start + timedelta(seconds=f.day1_duration_sec if day == 1 else f.day2_duration_sec) if start else None
    return stale_reason(msg.trigger_type, sm.send_at, now_utc(), day_start=start, day_end=end,
                        deadline=lead.deadline_at)


def _results_pending(segment: str, s: LeadSession, f: Funnel) -> bool:
    """Kun tugagan, lekin natija hali baholanmagan bo'lsa — segmentni tekshirishni kutamiz."""
    now = now_utc()
    if segment in DAY1_SEGMENTS | DAY2_SEGMENTS and not s.day1_evaluated \
            and now >= s.day1_at + timedelta(seconds=f.day1_duration_sec):
        return True
    if segment in DAY2_SEGMENTS and not s.day2_evaluated \
            and now >= s.day2_at + timedelta(seconds=f.day2_duration_sec):
        return True
    return False


async def _media(db: AsyncSession, ids: list[int]) -> list[Media]:
    if not ids:
        return []
    items = (await db.execute(select(Media).where(Media.id.in_(ids)))).scalars().all()
    by_id = {m.id: m for m in items}
    return [by_id[i] for i in ids if i in by_id]


async def recover_after_restart() -> int:
    """Qayta ishga tushganda: 'sending' da qolib ketganlar navbatga qaytadi. Navbat bazada turadi, shuning uchun
    rejalashtirilgan xabarlar yo'qolmaydi; vaqti o'tib ketganlari yuborishda stale_reason bilan tushib qoladi."""
    async with SessionLocal() as db:
        n = len((await db.execute(update(ScheduledMessage).where(ScheduledMessage.status == "sending")
                                  .values(status="pending").returning(ScheduledMessage.id))).all())
        await db.commit()
    if n:
        log.info("Qayta ishga tushish: %s ta xabar navbatga qaytarildi", n)
    return n


async def run_sender(bot: Bot, per_sec: float) -> None:
    limiter = RateLimiter(per_sec)
    sem = asyncio.Semaphore(40)

    async def guarded(sid: int):
        async with sem:
            try:
                await send_one(bot, limiter, sid)
            except Exception:
                log.exception("Xabarni yuborishda kutilmagan xato (id=%s)", sid)
                async with SessionLocal() as db:
                    await db.execute(update(ScheduledMessage).where(ScheduledMessage.id == sid,
                                                                    ScheduledMessage.status == "sending")
                                     .values(status="failed", reason="ichki xato"))
                    await db.commit()

    await recover_after_restart()
    while True:
        ids = await claim_due()
        if ids:
            await asyncio.gather(*(guarded(i) for i in ids))
        else:
            await asyncio.sleep(1.0)
