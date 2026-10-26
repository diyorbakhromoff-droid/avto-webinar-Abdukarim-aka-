"""Davriy vazifalar: kun natijalari, ommaviy xabarlar, menejer eslatmalari, heartbeat agregatsiyasi."""
import logging
from datetime import timedelta

from aiogram import Bot
from sqlalchemy import delete, select, text
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.bot import texts
from app.db import SessionLocal
from app.domain.segments import broadcast_allowed
from app.models import Broadcast, ContactLog, Heartbeat, KeyValue, Lead, ScheduledMessage
from app.services.leads import snapshot
from app.services import flow_engine
from app.services.payments import notify_manager
from app.services.sessions import detect_left_live, evaluate_finished_days
from app.timeutil import TZ, now_utc, to_local

log = logging.getLogger(__name__)
HEARTBEAT_RETENTION_DAYS = 30


async def evaluate_days() -> None:
    async with SessionLocal() as db:
        n = await evaluate_finished_days(db)
        if n:
            log.info("Baholangan kunlar: %s", n)


async def left_live() -> None:
    async with SessionLocal() as db:
        n = await detect_left_live(db)
        if n:
            log.info("Efirdan chiqib ketganlar: %s", n)


async def flow_events() -> None:
    n = await flow_engine.process_events()
    if n:
        log.debug("Sxema: %s ta voqea", n)


async def flow_tick() -> None:
    n = await flow_engine.tick()
    if n:
        log.info("Sxema: %s ta lid keyingi blokka o'tdi", n)


async def expand_broadcasts() -> None:
    """Vaqti kelgan ommaviy xabarni segmentdagi har bir lid uchun navbatga qo'yadi."""
    async with SessionLocal() as db:
        due = (await db.execute(select(Broadcast).where(
            Broadcast.status == "scheduled",
            (Broadcast.send_at.is_(None)) | (Broadcast.send_at <= now_utc())))).scalars().all()
        for b in due:
            q = select(Lead).where(Lead.funnel_id == b.funnel_id, Lead.blocked.is_(False))
            if b.lead_ids:
                q = q.where(Lead.id.in_(b.lead_ids))
            leads = (await db.execute(q)).scalars().all()
            n = 0
            now = now_utc()
            for lead in leads:
                if not b.lead_ids and not broadcast_allowed(b.segment, await snapshot(db, lead)):
                    continue
                await db.execute(insert(ScheduledMessage).values(
                    lead_id=lead.id, broadcast_id=b.id, dedupe_key=f"b{b.id}", send_at=now, status="pending",
                ).on_conflict_do_nothing())
                n += 1
            b.recipients = n
            b.status = "sending"
        await db.commit()

        sending = (await db.execute(select(Broadcast).where(Broadcast.status == "sending"))).scalars().all()
        for b in sending:
            left = (await db.execute(select(ScheduledMessage.id).where(
                ScheduledMessage.broadcast_id == b.id, ScheduledMessage.status.in_(("pending", "sending")))
                .limit(1))).first()
            if not left:
                b.status = "done"
        await db.commit()


async def manager_reminders(bot: Bot) -> None:
    """Qolgan to'lov sanasi va qayta qo'ng'iroq vaqti kelganda menejerga Telegram xabari."""
    async with SessionLocal() as db:
        today = to_local(now_utc()).date()
        leads = (await db.execute(select(Lead).where(
            Lead.remaining_due_date.is_not(None), Lead.remaining_due_date <= today,
            Lead.payment_status == "deposit",
            (Lead.remaining_reminded_at.is_(None)) | (Lead.remaining_reminded_at < now_utc() - timedelta(days=1)),
        ))).scalars().all()
        for lead in leads:
            await notify_manager(bot, db, lead, texts.MANAGER_REMAINING_DUE.format(
                name=lead.first_name, phone=lead.phone or "—", amount=texts.money(lead.remaining_amount)))
            lead.remaining_reminded_at = now_utc()
        calls = (await db.execute(select(ContactLog, Lead).join(Lead, Lead.id == ContactLog.lead_id).where(
            ContactLog.result == "callback", ContactLog.reminded.is_(False),
            ContactLog.callback_at <= now_utc()))).all()
        for c, lead in calls:
            await notify_manager(bot, db, lead, texts.MANAGER_CALLBACK.format(
                name=lead.first_name, phone=lead.phone or "—", note=c.note or "—"))
            c.reminded = True
        await db.commit()


async def aggregate_heartbeats(db: AsyncSession) -> None:
    """Kecha va undan oldingi kunlar heartbeatlarini daqiqa bo'yicha agregatsiya qiladi, 30 kundan eskisini o'chiradi."""
    today_start = to_local(now_utc()).replace(hour=0, minute=0, second=0, microsecond=0)
    await db.execute(text("""
        INSERT INTO watch_buckets (funnel_id, day, session_date, minute, viewers, joined)
        SELECT h.funnel_id, h.day, (h.created_at AT TIME ZONE :tz)::date, h.position_sec / 60,
               count(DISTINCT h.attendance_id), 0
        FROM heartbeats h
        WHERE h.created_at >= :since AND h.created_at < :until
        GROUP BY 1, 2, 3, 4
        ON CONFLICT (funnel_id, day, session_date, minute) DO UPDATE SET viewers = EXCLUDED.viewers
    """), {"tz": str(TZ), "since": today_start - timedelta(days=2), "until": today_start})
    await db.execute(delete(Heartbeat).where(
        Heartbeat.created_at < now_utc() - timedelta(days=HEARTBEAT_RETENTION_DAYS)))
    await db.commit()


async def daily(bot: Bot) -> None:
    """Kuniga bir marta (03:00 Toshkent) ishlaydigan vazifalar."""
    async with SessionLocal() as db:
        kv = await db.get(KeyValue, "daily_last_run")
        today = to_local(now_utc()).date().isoformat()
        if (kv and kv.value == today) or to_local(now_utc()).hour < 3:
            return
        await aggregate_heartbeats(db)
        if kv:
            kv.value = today
        else:
            db.add(KeyValue(key="daily_last_run", value=today))
        await db.commit()
        log.info("Kunlik vazifalar bajarildi")
