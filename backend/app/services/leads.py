"""Lid holati: qadamlar, voqealar, to'xtab qolish eslatmalari."""
from datetime import datetime

from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.planning import ChainItem, QuietHours, plan_stuck
from app.domain.segments import LeadSnapshot
from app.models import ChainMessage, Funnel, Lead, LeadEvent, LeadSession, LeadStep, Payment, ScheduledMessage
from app.timeutil import now_utc, parse_hhmm

STEP_LABELS = {
    "started": "Telefon bermadi",
    "phone": "Sessiya tanlamadi",
    "session": "Sessiya tanladi",
    "day1_missed": "1-kunni ko'rmadi",
    "day1_watched": "1-kunni ko'rdi",
    "day2_missed": "2-kunni ko'rmadi",
    "left_before_offer": "Ofertagacha chiqdi",
    "reached_offer": "Ofertani ko'rdi",
    "clicked_buy": "Tugma bosdi",
    "receipt_sent": "Chek yubordi",
    "receipt_rejected": "Chek rad etildi",
    "deposit_paid": "Boshlang'ich to'ladi",
    "full_paid": "To'liq to'ladi",
    "cold": "Sovuq lid",
}

# qaysi qadamda "to'xtab qolish" eslatmalari ishlaydi
STEP_TO_STUCK = {
    "started": "no_phone",
    "phone": "no_session",
    "clicked_buy": "no_receipt",
    "receipt_rejected": "receipt_rejected",
}

EVENT_TITLES = {
    "start": "/start",
    "phone": "Telefon berdi",
    "session_chosen": "Sessiya tanladi",
    "session_changed": "Vaqtni o'zgartirdi",
    "rescheduled": "Qayta vaqt tanladi",
    "joined": "Efirga kirdi",
    "day_result": "Kun yakuni",
    "reached_offer": "Oferta momentiga yetdi",
    "clicked_buy": "«Kursga yozilish» tugmasini bosdi",
    "button_click": "Tugmani bosdi",
    "receipt": "Chek yubordi",
    "payment_approved": "To'lov tasdiqlandi",
    "payment_rejected": "Chek rad etildi",
    "question": "Savol yubordi",
    "unsubscribed": "Xabarlarni to'xtatdi",
    "subscribed": "Xabarlarni qayta yoqdi",
    "blocked": "Botni blokladi",
    "contact": "Menejer izohi",
    "deadline_changed": "Deadline o'zgartirildi",
    "invite_sent": "Kanal havolasi yuborildi",
    "cold": "Sovuq segmentga o'tdi",
    "manager_assigned": "Menejer biriktirildi",
}


def event(db: AsyncSession, lead: Lead, type_: str, **data) -> None:
    db.add(LeadEvent(lead_id=lead.id, type=type_, data=data))


async def active_session(db: AsyncSession, lead_id: int) -> LeadSession | None:
    return (await db.execute(
        select(LeadSession).where(LeadSession.lead_id == lead_id, LeadSession.status != "replaced")
        .order_by(LeadSession.id.desc()).limit(1)
    )).scalar_one_or_none()


async def snapshot(db: AsyncSession, lead: Lead, session: LeadSession | None = None) -> LeadSnapshot:
    if session is None:
        session = await active_session(db, lead.id)
    pending = (await db.execute(
        select(Payment.id).where(Payment.lead_id == lead.id, Payment.status == "pending").limit(1)
    )).first() is not None
    return LeadSnapshot(
        payment_status=lead.payment_status,
        has_pending_receipt=pending,
        day1_watched=session.day1_watched if session else None,
        day2_joined=session.day2_joined if session else None,
        reached_offer=lead.reached_offer_at is not None,
        blocked=lead.blocked,
        unsubscribed=lead.unsubscribed,
        cold=lead.cold,
    )


def quiet_of(funnel: Funnel) -> QuietHours:
    return QuietHours(parse_hhmm(funnel.quiet_start), parse_hhmm(funnel.quiet_end))


async def set_step(db: AsyncSession, lead: Lead, step: str, at: datetime | None = None) -> None:
    """Qadamni o'zgartiradi: eski qadamning eslatmalari bekor bo'ladi, yangisiniki rejalashtiriladi."""
    if lead.step == step:
        return
    at = at or now_utc()
    old_stuck = STEP_TO_STUCK.get(lead.step)
    await db.execute(update(LeadStep).where(LeadStep.lead_id == lead.id, LeadStep.left_at.is_(None))
                     .values(left_at=at, next_step=step))
    db.add(LeadStep(lead_id=lead.id, step=step, entered_at=at))
    lead.step = step
    lead.step_at = at
    if old_stuck:
        await db.execute(
            update(ScheduledMessage)
            .where(ScheduledMessage.lead_id == lead.id, ScheduledMessage.status == "pending",
                   ScheduledMessage.dedupe_key.like(f"stuck:{old_stuck}:%"))
            .values(status="cancelled", reason="lid keyingi qadamga o'tdi")
        )
    new_stuck = STEP_TO_STUCK.get(step)
    if new_stuck:
        await plan_stuck_messages(db, lead, new_stuck, at)


async def plan_stuck_messages(db: AsyncSession, lead: Lead, stuck_step: str, entered_at: datetime) -> None:
    funnel = await db.get(Funnel, lead.funnel_id)
    msgs = (await db.execute(
        select(ChainMessage).where(ChainMessage.funnel_id == lead.funnel_id, ChainMessage.status == "active",
                                   ChainMessage.trigger_type == "stuck", ChainMessage.stuck_step == stuck_step)
    )).scalars().all()
    quiet = quiet_of(funnel)
    stamp = int(entered_at.timestamp())
    for m in msgs:
        item = ChainItem(m.id, m.title, m.trigger_type, None, m.offset_minutes, m.required, m.sort)
        send_at = plan_stuck(item, entered_at, quiet)
        # har bir qadamga kirish alohida: lid qadamga qaytsa eslatma yana ishlaydi
        await db.execute(insert(ScheduledMessage).values(
            lead_id=lead.id, chain_message_id=m.id, dedupe_key=f"stuck:{stuck_step}:{m.id}:{stamp}",
            send_at=send_at, status="pending",
        ).on_conflict_do_nothing())


async def cancel_pending(db: AsyncSession, lead_id: int, reason: str, *, session_id: int | None = None,
                         chain_only: bool = True) -> None:
    q = update(ScheduledMessage).where(ScheduledMessage.lead_id == lead_id, ScheduledMessage.status == "pending")
    if session_id is not None:
        q = q.where(ScheduledMessage.session_id == session_id)
    if chain_only:
        q = q.where(ScheduledMessage.chain_message_id.is_not(None))
    await db.execute(q.values(status="cancelled", reason=reason))


async def lead_for_tg(db: AsyncSession, tg_user_id: int, funnel_id: int | None = None) -> Lead | None:
    """Foydalanuvchining oxirgi faol voronkadagi lidi."""
    q = select(Lead).where(Lead.tg_user_id == tg_user_id)
    if funnel_id:
        q = q.where(Lead.funnel_id == funnel_id)
    return (await db.execute(q.order_by(Lead.step_at.desc()).limit(1))).scalar_one_or_none()
