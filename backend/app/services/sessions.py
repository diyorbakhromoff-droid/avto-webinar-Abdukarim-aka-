"""Sessiya tanlash, vaqtni o'zgartirish, qayta tanlash va progrevni rejalashtirish."""
from datetime import datetime, timedelta

from sqlalchemy import and_, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain import slots
from app.domain.planning import EVENT_TRIGGERS, ChainItem, SessionTimes, plan_chain
from app.models import Attendance, ChainMessage, Funnel, Lead, LeadEvent, LeadSession, ScheduledMessage
from app.services.leads import active_session, cancel_pending, event, quiet_of, set_step
from app.timeutil import now_utc


class SessionError(Exception):
    pass


def chain_item(m: ChainMessage) -> ChainItem:
    return ChainItem(m.id, m.title, m.trigger_type, m.trigger_day, m.offset_minutes, m.required, m.sort)


def session_times(lead: Lead, s: LeadSession, f: Funnel) -> SessionTimes:
    return SessionTimes(lead.phone_at or lead.created_at, s.day1_at, s.day2_at,
                        f.day1_duration_sec, f.day2_duration_sec, lead.deadline_at or _deadline(s, f))


async def active_chain(db: AsyncSession, funnel_id: int) -> list[ChainMessage]:
    return list((await db.execute(
        select(ChainMessage).where(ChainMessage.funnel_id == funnel_id, ChainMessage.status == "active",
                                   ChainMessage.flow_node_id.is_(None))
        .order_by(ChainMessage.sort, ChainMessage.id)
    )).scalars().all())


def dedupe_key(message_id: int, session_id: int, session_bound: bool) -> str:
    return f"c{message_id}:s{session_id}" if session_bound else f"c{message_id}"


async def plan_for_session(db: AsyncSession, lead: Lead, s: LeadSession, f: Funnel,
                           messages: list[ChainMessage] | None = None, now: datetime | None = None) -> None:
    """Zanjirni rejalashtiradi. Yuborilganlar qayta yuborilmaydi; kutayotganlar yangi vaqtga ko'chadi."""
    now = now or now_utc()
    messages = messages if messages is not None else await active_chain(db, f.id)
    planned = plan_chain([chain_item(m) for m in messages], session_times(lead, s, f), now, quiet_of(f))
    for p in planned:
        if p.status == "event":
            continue
        key = dedupe_key(p.item.id, s.id, p.session_bound)
        if p.send_at is None:
            await db.execute(
                update(ScheduledMessage)
                .where(ScheduledMessage.lead_id == lead.id, ScheduledMessage.dedupe_key == key,
                       ScheduledMessage.status == "pending")
                .values(status="cancelled", reason=p.reason)
            )
            continue
        stmt = insert(ScheduledMessage).values(
            lead_id=lead.id, chain_message_id=p.item.id, session_id=s.id if p.session_bound else None,
            dedupe_key=key, session_bound=p.session_bound, send_at=p.send_at, status="pending",
        )
        await db.execute(stmt.on_conflict_do_update(
            index_elements=["lead_id", "dedupe_key"],
            set_={"send_at": stmt.excluded.send_at, "status": "pending", "reason": None},
            where=ScheduledMessage.status.in_(("pending", "cancelled")),
        ))


def _deadline(s: LeadSession, f: Funnel) -> datetime:
    return s.day2_at + timedelta(seconds=f.day2_duration_sec) + timedelta(hours=f.deadline_hours)


async def choose_day1(db: AsyncSession, lead: Lead, f: Funnel, day1_at: datetime,
                      now: datetime | None = None) -> LeadSession:
    """Lid 1-kun vaqtini tanlaydi (birinchi marta, o'zgartirish yoki ko'rmagandan keyin qayta tanlash)."""
    now = now or now_utc()
    cfg = slots.SlotConfig.from_funnel(f)
    valid = slots.day1_options(cfg, now - timedelta(minutes=10))
    if day1_at not in valid and day1_at not in slots.day1_options(cfg, now):
        raise SessionError("Bu vaqt endi mavjud emas, qaytadan tanlang.")
    current = await active_session(db, lead.id)

    if current and current.day1_evaluated is False and now < current.day1_at:
        # 1-kun hali boshlanmagan — vaqtni o'zgartirish
        if not slots.can_change_day1(cfg, now, current.day1_at):
            raise SessionError(f"Vaqtni efirdan kamida {int(cfg.min_hours_before)} soat oldin o'zgartirish mumkin.")
        current.day1_at = day1_at
        current.day2_at = slots.day2_for(day1_at)
        lead.deadline_at = _deadline(current, f)
        event(db, lead, "session_changed", day1_at=day1_at.isoformat())
        await db.flush()
        await plan_for_session(db, lead, current, f, now=now)
        return current

    if current and current.day1_watched is False:
        if lead.day1_reschedules >= f.reschedule_limit:
            raise SessionError("Qayta tanlash imkoniyati tugagan.")
        lead.day1_reschedules += 1
        current.status = "replaced"
        await cancel_pending(db, lead.id, "sessiya almashtirildi", session_id=current.id)
        event(db, lead, "rescheduled", day=1, day1_at=day1_at.isoformat())
    elif current and current.day1_evaluated is False:
        raise SessionError("Efiringiz allaqachon boshlangan.")
    elif current:
        raise SessionError("Sizda faol sessiya bor.")
    else:
        event(db, lead, "session_chosen", day1_at=day1_at.isoformat())

    s = LeadSession(lead_id=lead.id, day1_at=day1_at, day2_at=slots.day2_for(day1_at), status="active")
    db.add(s)
    lead.deadline_at = _deadline(s, f)
    lead.day1_watched_sec = None
    lead.day2_watched_sec = None
    await db.flush()
    await set_step(db, lead, "session", now)
    await plan_for_session(db, lead, s, f, now=now)
    return s


async def choose_day2(db: AsyncSession, lead: Lead, f: Funnel, day2_at: datetime,
                      now: datetime | None = None) -> LeadSession:
    """1-kunni ko'rib, 2-kunni ko'rmagan lid faqat 2-kunni qayta tanlaydi."""
    now = now or now_utc()
    cfg = slots.SlotConfig.from_funnel(f)
    s = await active_session(db, lead.id)
    if not s or not s.day1_watched or s.day2_joined is not False:
        raise SessionError("2-kunni qayta tanlash mumkin emas.")
    if day2_at not in slots.day2_reschedule_options(cfg, now - timedelta(minutes=10)) \
            and day2_at not in slots.day2_reschedule_options(cfg, now):
        raise SessionError("Bu vaqt endi mavjud emas, qaytadan tanlang.")
    if lead.day2_reschedules >= f.reschedule_limit:
        raise SessionError("Qayta tanlash imkoniyati tugagan.")
    lead.day2_reschedules += 1
    s.day2_at = day2_at
    s.day2_evaluated = False
    s.day2_joined = None
    s.status = "active"
    lead.deadline_at = _deadline(s, f)
    lead.day2_watched_sec = None
    event(db, lead, "rescheduled", day=2, day2_at=day2_at.isoformat())
    await set_step(db, lead, "day1_watched", now)
    # 2-kunga bog'liq xabarlar qayta yuborilishi uchun: shu sessiyadagi 2-kun xabarlari kalitini yangilaymiz
    await db.execute(
        update(ScheduledMessage)
        .where(ScheduledMessage.session_id == s.id, ScheduledMessage.status.in_(("sent", "skipped", "failed")),
               ScheduledMessage.chain_message_id.in_(
                   select(ChainMessage.id).where(ChainMessage.trigger_day == 2)))
        .values(dedupe_key=ScheduledMessage.dedupe_key + f":r{lead.day2_reschedules}")
    )
    await plan_for_session(db, lead, s, f, now=now)
    return s


def watched_enough(f: Funnel, watched_sec: int) -> bool:
    return f.day1_duration_sec > 0 and watched_sec >= f.day1_watch_threshold * f.day1_duration_sec


async def evaluate_finished_days(db: AsyncSession, now: datetime | None = None) -> int:
    """Kun tugaganda natijani belgilaydi: ko'rdi / ko'rmadi, qayta tanlash limiti, sovuq segment."""
    now = now or now_utc()
    count = 0
    rows = (await db.execute(
        select(LeadSession, Lead, Funnel)
        .join(Lead, Lead.id == LeadSession.lead_id).join(Funnel, Funnel.id == Lead.funnel_id)
        .where(LeadSession.status == "active", LeadSession.day1_evaluated.is_(False),
               LeadSession.day1_at <= now - timedelta(seconds=1))
        .limit(500)
    )).all()
    for s, lead, f in rows:
        if now < s.day1_at + timedelta(seconds=f.day1_duration_sec):
            continue
        att = (await db.execute(select(Attendance).where(
            Attendance.session_id == s.id, Attendance.day == 1))).scalars().all()
        watched = max((a.watched_sec for a in att), default=0)
        s.day1_evaluated = True
        s.day1_watched = watched_enough(f, watched)
        event(db, lead, "day_result", day=1, watched_min=watched // 60, ok=s.day1_watched)
        if s.day1_watched:
            await set_step(db, lead, "day1_watched", now)
        else:
            # 2-kun eslatmalari endi kerak emas — lidga 1-kunni qayta tanlash taklif qilinadi
            await db.execute(
                update(ScheduledMessage)
                .where(ScheduledMessage.session_id == s.id, ScheduledMessage.status == "pending",
                       ScheduledMessage.chain_message_id.in_(
                           select(ChainMessage.id).where(ChainMessage.trigger_day == 2)))
                .values(status="cancelled", reason="1-kunni ko'rmadi")
            )
            if lead.day1_reschedules >= f.reschedule_limit:
                await make_cold(db, lead, now)
            else:
                await set_step(db, lead, "day1_missed", now)
        count += 1

    rows = (await db.execute(
        select(LeadSession, Lead, Funnel)
        .join(Lead, Lead.id == LeadSession.lead_id).join(Funnel, Funnel.id == Lead.funnel_id)
        .where(LeadSession.status == "active", LeadSession.day1_watched.is_(True),
               LeadSession.day2_evaluated.is_(False), LeadSession.day2_at <= now)
        .limit(500)
    )).all()
    for s, lead, f in rows:
        if now < s.day2_at + timedelta(seconds=f.day2_duration_sec):
            continue
        att = (await db.execute(select(Attendance).where(
            and_(Attendance.session_id == s.id, Attendance.day == 2, Attendance.day_at == s.day2_at)))).scalars().all()
        s.day2_evaluated = True
        s.day2_joined = bool(att)
        reached = any(a.reached_offer for a in att)
        event(db, lead, "day_result", day=2, watched_min=max((a.watched_sec for a in att), default=0) // 60,
              ok=reached)
        if lead.payment_status == "none" and lead.step not in ("clicked_buy", "receipt_sent", "receipt_rejected"):
            if not s.day2_joined:
                if lead.day2_reschedules >= f.reschedule_limit:
                    await make_cold(db, lead, now)
                else:
                    await set_step(db, lead, "day2_missed", now)
            elif not reached:
                await set_step(db, lead, "left_before_offer", now)
        if s.day2_joined:
            s.status = "completed"
        count += 1
    await db.commit()
    return count


async def make_cold(db: AsyncSession, lead: Lead, now: datetime) -> None:
    lead.cold = True
    await set_step(db, lead, "cold", now)
    await cancel_pending(db, lead.id, "sovuq lid")
    event(db, lead, "cold")


async def replan_message(db: AsyncSession, m: ChainMessage) -> None:
    """Admin xabarni qo'shsa yoki vaqtini o'zgartirsa — kelajakdagi sessiyalar uchun qayta rejalashtirish.
    Sxemadagi xabarlar bu yerda emas (flow_engine.replan_node)."""
    if m.flow_node_id:
        return
    f = await db.get(Funnel, m.funnel_id)
    now = now_utc()
    if m.status != "active":
        await db.execute(
            update(ScheduledMessage)
            .where(ScheduledMessage.chain_message_id == m.id, ScheduledMessage.status == "pending")
            .values(status="cancelled", reason="xabar qoralamaga o'tkazildi")
        )
        return
    if m.trigger_type in EVENT_TRIGGERS:
        # vaqtga bog'liq eski rejalar endi kerak emas
        await db.execute(
            update(ScheduledMessage)
            .where(ScheduledMessage.chain_message_id == m.id, ScheduledMessage.status == "pending",
                   ScheduledMessage.dedupe_key.not_like("stuck:%"), ScheduledMessage.dedupe_key.not_like("left:%"))
            .values(status="cancelled", reason="trigger o'zgardi")
        )
        return
    # trigger turi o'zgargan bo'lishi mumkin — kutayotganlarni bekor qilib, qaytadan rejalashtiramiz
    await db.execute(
        update(ScheduledMessage)
        .where(ScheduledMessage.chain_message_id == m.id, ScheduledMessage.status == "pending",
               ScheduledMessage.dedupe_key.not_like("stuck:%"), ScheduledMessage.dedupe_key.not_like("left:%"))
        .values(status="cancelled", reason="qayta rejalashtirildi")
    )
    horizon = now - timedelta(seconds=f.day2_duration_sec or 0)
    rows = (await db.execute(
        select(LeadSession, Lead)
        .join(Lead, Lead.id == LeadSession.lead_id)
        .where(Lead.funnel_id == f.id, LeadSession.status == "active", LeadSession.day2_at >= horizon,
               Lead.blocked.is_(False), Lead.cold.is_(False))
    )).all()
    for s, lead in rows:
        await plan_for_session(db, lead, s, f, messages=[m], now=now)


LEFT_AFTER = timedelta(seconds=150)   # shuncha vaqt heartbeat kelmasa — lid efirdan chiqib ketgan
END_MARGIN = timedelta(minutes=2)     # video oxirida chiqqanlar "chiqib ketgan" hisoblanmaydi


async def detect_left_live(db: AsyncSession, now: datetime | None = None) -> int:
    """Efir davomida chiqib ketganlarni topadi va "chiqib ketganda" xabarlarini rejalashtiradi."""
    now = now or now_utc()
    rows = (await db.execute(
        select(Attendance, LeadSession, Lead, Funnel)
        .join(LeadSession, LeadSession.id == Attendance.session_id)
        .join(Lead, Lead.id == Attendance.lead_id).join(Funnel, Funnel.id == Lead.funnel_id)
        .where(Attendance.left_at.is_(None), Attendance.last_heartbeat_at < now - LEFT_AFTER,
               Attendance.day_at >= now - timedelta(hours=6))
    )).all()
    count = 0
    for a, s, lead, f in rows:
        duration = timedelta(seconds=f.day1_duration_sec if a.day == 1 else f.day2_duration_sec)
        if now >= a.day_at + duration or a.max_position_sec >= (duration - END_MARGIN).total_seconds():
            continue  # efir tugagan yoki oxirigacha ko'rgan
        a.left_at = a.last_heartbeat_at
        event(db, lead, "left_live", day=a.day, minute=a.max_position_sec // 60)
        msgs = (await db.execute(select(ChainMessage).where(
            ChainMessage.funnel_id == f.id, ChainMessage.status == "active", ChainMessage.flow_node_id.is_(None),
            ChainMessage.trigger_type == "left_live", ChainMessage.trigger_day == a.day))).scalars().all()
        stamp = int(a.left_at.timestamp())
        for m in msgs:
            await db.execute(insert(ScheduledMessage).values(
                lead_id=lead.id, chain_message_id=m.id, session_id=s.id,
                dedupe_key=f"left:{m.id}:{a.id}:{stamp}",
                send_at=max(now, a.left_at + timedelta(minutes=m.offset_minutes)), status="pending",
            ).on_conflict_do_nothing())
        count += 1
    await db.commit()
    return count


async def mark_returned(db: AsyncSession, a: Attendance) -> None:
    """Lid efirga qaytdi — "chiqib ketganda" xabarlari kerak emas."""
    if a.left_at is None:
        return
    a.left_at = None
    db.add(LeadEvent(lead_id=a.lead_id, type="returned", data={"day": a.day}))
    await db.execute(
        update(ScheduledMessage)
        .where(ScheduledMessage.status == "pending", ScheduledMessage.dedupe_key.like(f"left:%:{a.id}:%"))
        .values(status="cancelled", reason="efirga qaytdi"))
