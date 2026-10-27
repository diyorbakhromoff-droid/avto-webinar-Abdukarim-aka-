"""Lidlar ro'yxati, qo'ng'iroq ro'yxatlari, lid kartasi, menejer amallari, Excel eksport."""
import io
import os
from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import StreamingResponse
from openpyxl import Workbook
from pydantic import BaseModel
from sqlalchemy import Select, and_, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.common import audit, funnel_or_404, iso, parse_iso
from app.bot import texts
from app.db import get_db
from app.domain.pipeline import STAGES, DayInfo, PathInput, funnel_path, stage_after_contact
from app.models import (
    AdminUser, Attendance, Broadcast, ChainMessage, ContactLog, Flow, FlowNode, FlowRun, Funnel, Lead, LeadEvent,
    LeadSession, Payment, ScheduledMessage, Tariff,
)
from app.security.auth import SALES
from app.services import payments as pay
from app.services.leads import EVENT_TITLES, STEP_LABELS, active_session, event, set_stage
from app.services.sessions import plan_for_session
from app.services.tg import get_bot
from app.timeutil import fmt_datetime, local_to_utc, now_utc

router = APIRouter(prefix="/api/admin", tags=["admin"])

CALL_LISTS = [
    ("deposit_paid", "Boshlang'ich to'laganlar"),
    ("full_paid", "To'liq to'laganlar"),
    ("offer_not_paid", "Ofertani ko'rgan, to'lamagan"),
    ("clicked_no_receipt", "Tugma bosgan, chek yubormagan"),
    ("receipt_rejected", "Chek rad etilgan"),
    ("no_session", "Sessiya tanlamagan"),
    ("day1_missed", "1-kunni ko'rmagan"),
    ("day2_missed", "2-kunni ko'rmagan"),
    ("left_before_offer", "Ofertagacha chiqib ketgan"),
    ("cold", "Sovuq lidlar"),
    ("blocked", "Botni bloklagan"),
]


def list_condition(key: str, f: Funnel, now: datetime):
    match key:
        case "deposit_paid":
            return Lead.payment_status == "deposit"
        case "full_paid":
            return Lead.payment_status == "full"
        case "offer_not_paid":
            return and_(Lead.reached_offer_at.is_not(None), Lead.payment_status == "none")
        case "clicked_no_receipt":
            return and_(Lead.step == "clicked_buy",
                        Lead.step_at <= now - timedelta(minutes=f.stuck_no_receipt_min))
        case "receipt_rejected":
            return Lead.step == "receipt_rejected"
        case "no_session":
            return and_(Lead.step == "phone", Lead.step_at <= now - timedelta(minutes=f.stuck_no_session_min))
        case "day1_missed" | "day2_missed" | "left_before_offer":
            return Lead.step == key
        case "cold":
            return Lead.cold.is_(True)
        case "blocked":
            return Lead.blocked.is_(True)
    raise HTTPException(400, "Noma'lum ro'yxat")


def last_receipt():
    return (select(Payment.status).where(Payment.lead_id == Lead.id)
            .order_by(Payment.id.desc()).limit(1).scalar_subquery())


def filtered(f: Funnel, list_: str | None, step: str | None, source: str | None, manager_id: int | None,
             q: str | None, date_from: date | None, date_to: date | None) -> Select:
    now = now_utc()
    stmt = select(Lead, AdminUser, last_receipt().label("receipt")).outerjoin(
        AdminUser, AdminUser.id == Lead.manager_id).where(Lead.funnel_id == f.id)
    if list_:
        stmt = stmt.where(list_condition(list_, f, now))
    if step:
        stmt = stmt.where(Lead.step == step)
    if source:
        stmt = stmt.where(Lead.source == source)
    if manager_id:
        stmt = stmt.where(Lead.manager_id == manager_id)
    if q:
        like = f"%{q.strip()}%"
        digits = "".join(ch for ch in q if ch.isdigit())
        conds = [Lead.first_name.ilike(like), Lead.username.ilike(like)]
        if digits:
            conds.append(func.regexp_replace(Lead.phone, r"\D", "", "g").like(f"%{digits}%"))
        stmt = stmt.where(or_(*conds))
    if date_from:
        stmt = stmt.where(Lead.created_at >= local_to_utc(date_from, datetime.min.time()))
    if date_to:
        stmt = stmt.where(Lead.created_at < local_to_utc(date_to + timedelta(days=1), datetime.min.time()))
    return stmt


def row_out(lead: Lead, mgr: AdminUser | None, receipt: str | None) -> dict:
    return {
        "id": lead.id, "name": lead.first_name, "phone": lead.phone, "username": lead.username,
        "source": lead.source,
        "day1_minutes": lead.day1_watched_sec // 60 if lead.day1_watched_sec is not None else None,
        "day2_minutes": lead.day2_watched_sec // 60 if lead.day2_watched_sec is not None else None,
        "reached_offer": lead.reached_offer_at is not None, "clicked_buy": lead.clicked_buy_at is not None,
        "receipt": receipt or "none", "payment_status": lead.payment_status,
        "manager": {"id": mgr.id, "name": mgr.name} if mgr else None,
        "step": lead.step, "step_label": STEP_LABELS.get(lead.step, lead.step), "step_since": iso(lead.step_at),
        "last_contact_at": iso(lead.last_contact_at), "blocked": lead.blocked, "unsubscribed": lead.unsubscribed,
        "created_at": iso(lead.created_at), "stage": lead.stage, "stage_label": STAGES.get(lead.stage, lead.stage),
    }


class Filters:
    def __init__(self, funnel_id: int, list: str | None = None, step: str | None = None,
                 source: str | None = None, manager_id: int | None = None, q: str | None = None,
                 date_from: date | None = None, date_to: date | None = None):
        self.funnel_id, self.list, self.step, self.source = funnel_id, list, step, source
        self.manager_id, self.q, self.date_from, self.date_to = manager_id, q, date_from, date_to

    def stmt(self, f: Funnel) -> Select:
        return filtered(f, self.list, self.step, self.source, self.manager_id, self.q, self.date_from, self.date_to)


@router.get("/call-lists")
async def call_lists(funnel_id: int, db: AsyncSession = Depends(get_db), _=Depends(SALES)):
    f = await funnel_or_404(db, funnel_id)
    now = now_utc()
    out = []
    for key, label in CALL_LISTS:
        n = (await db.execute(select(func.count()).select_from(Lead).where(
            Lead.funnel_id == f.id, list_condition(key, f, now)))).scalar()
        out.append({"key": key, "label": label, "count": n})
    return out


@router.get("/leads")
async def leads(flt: Filters = Depends(), page: int = 1, page_size: int = Query(50, le=500),
                db: AsyncSession = Depends(get_db), _=Depends(SALES)):
    f = await funnel_or_404(db, flt.funnel_id)
    stmt = flt.stmt(f)
    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar()
    rows = (await db.execute(stmt.order_by(Lead.step_at.desc()).offset((page - 1) * page_size)
                             .limit(page_size))).all()
    return {"items": [row_out(*r) for r in rows], "total": total}


@router.get("/leads/export.xlsx")
async def export(flt: Filters = Depends(), db: AsyncSession = Depends(get_db), me: AdminUser = Depends(SALES)):
    f = await funnel_or_404(db, flt.funnel_id)
    rows = (await db.execute(flt.stmt(f).order_by(Lead.created_at))).all()
    wb = Workbook()
    ws = wb.active
    ws.title = "Lidlar"
    ws.append(["Ism", "Telefon", "Username", "Manba", "Ro'yxat", "1-kun (daq)", "2-kun (daq)", "Oferta",
               "Tugma", "Chek", "To'lov", "Menejer", "Bosqich", "Oxirgi qadam", "Qadam vaqti"])
    for lead, mgr, receipt in rows:
        r = row_out(lead, mgr, receipt)
        ws.append([r["name"], r["phone"], r["username"], r["source"], fmt_datetime(lead.created_at),
                   r["day1_minutes"], r["day2_minutes"], "ha" if r["reached_offer"] else "yo'q",
                   "ha" if r["clicked_buy"] else "yo'q", r["receipt"], r["payment_status"],
                   mgr.name if mgr else "", r["stage_label"], r["step_label"], fmt_datetime(lead.step_at)])
    audit(db, me.name, "leads_exported", f"{len(rows)} ta lid")
    await db.commit()
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return StreamingResponse(buf, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                             headers={"Content-Disposition": 'attachment; filename="lidlar.xlsx"'})


# ── sotuv doskasi ──

PIPELINE_PAGE = 30


def paid_sum():
    return (select(func.coalesce(func.sum(Payment.amount), 0)).where(
        Payment.lead_id == Lead.id, Payment.status == "approved", Payment.refunded.is_(False)).scalar_subquery())


def next_call():
    return (select(ContactLog.callback_at).where(ContactLog.lead_id == Lead.id, ContactLog.result == "callback")
            .order_by(ContactLog.id.desc()).limit(1).scalar_subquery())


def last_note():
    return (select(ContactLog.note).where(ContactLog.lead_id == Lead.id, ContactLog.note != "")
            .order_by(ContactLog.id.desc()).limit(1).scalar_subquery())


def card_out(lead: Lead, mgr: AdminUser | None, receipt: str | None, paid: int | None, call_at: datetime | None,
             note: str | None) -> dict:
    r = row_out(lead, mgr, receipt)
    return {k: r[k] for k in ("id", "name", "phone", "username", "stage", "step", "step_label", "step_since",
                              "manager", "payment_status", "receipt", "day1_minutes", "day2_minutes", "blocked",
                              "unsubscribed", "created_at")} | {
        "stage_at": iso(lead.stage_at), "paid": paid or 0, "note": note or "",
        "callback_at": iso(call_at) if lead.stage == "callback" else None,
    }


def stage_order(stage: str, call_at):
    if stage == "callback":
        return call_at.asc().nulls_last(), Lead.id
    if stage == "new":  # avtovoronkada yaqinda harakat qilganlar tepada
        return Lead.step_at.desc(), Lead.id.desc()
    return Lead.stage_at.desc(), Lead.id.desc()


@router.get("/pipeline")
async def pipeline(flt: Filters = Depends(), stage: str | None = None, offset: int = 0,
                   db: AsyncSession = Depends(get_db), _=Depends(SALES)):
    """Bosqichlar bo'yicha ustunlar. stage berilsa — faqat shu ustunning keyingi kartalari."""
    f = await funnel_or_404(db, flt.funnel_id)
    if stage is not None and stage not in STAGES:
        raise HTTPException(400, "Noma'lum bosqich")
    base = flt.stmt(f)
    paid, call_at, note = paid_sum(), next_call(), last_note()
    cards = base.add_columns(paid, call_at, note)

    async def items(st: str, off: int) -> list[dict]:
        rows = (await db.execute(cards.where(Lead.stage == st).order_by(*stage_order(st, call_at))
                                 .offset(off).limit(PIPELINE_PAGE))).all()
        return [card_out(*r) for r in rows]

    if stage:
        return {"items": await items(stage, max(offset, 0))}
    sq = base.add_columns(paid.label("paid")).subquery()
    agg = {k: (n, total) for k, n, total in (await db.execute(
        select(sq.c.stage, func.count(), func.coalesce(func.sum(sq.c.paid), 0)).group_by(sq.c.stage))).all()}
    out = []
    for key, label in STAGES.items():
        n, total = agg.get(key, (0, 0))
        out.append({"key": key, "label": label, "count": n, "sum": int(total),
                    "items": await items(key, 0) if n else []})
    return {"stages": out}


def payment_out(p: Payment, lead: Lead, tariff: Tariff | None) -> dict:
    return {
        "id": p.id, "lead_id": lead.id, "lead_name": lead.first_name, "lead_phone": lead.phone,
        "tariff": tariff.name if tariff else "—", "method": p.method, "kind": p.kind, "amount": p.amount,
        "status": p.status, "reject_reason": p.reject_reason, "submitted_at": iso(p.submitted_at),
        "decided_at": iso(p.decided_at), "decided_by": p.decided_by, "within_deadline": p.within_deadline,
        "duplicate_of": p.duplicate_of, "refunded": p.refunded,
        "file_url": f"/api/admin/payments/{p.id}/file", "file_mime": p.file_mime,
    }


def event_details(e: LeadEvent) -> str:
    d = e.data or {}
    match e.type:
        case "start":
            return f"manba: {d.get('source') or '—'}"
        case "phone":
            return d.get("phone", "")
        case "session_chosen" | "session_changed":
            at = parse_iso(d.get("day1_at"))
            return f"1-kun: {fmt_datetime(at)} · 2-kun: {fmt_datetime(at + timedelta(hours=24))}" if at else ""
        case "rescheduled":
            at = parse_iso(d.get("day1_at") or d.get("day2_at"))
            return f"{d.get('day')}-kun: {fmt_datetime(at)}" if at else ""
        case "joined":
            late = d.get("late_min", 0)
            return f"{d.get('day')}-kun · " + (f"{late} daqiqa kech" if late else "o'z vaqtida")
        case "day_result":
            ok = "ko'rdi" if d.get("ok") else "ko'rmadi"
            return f"{d.get('day')}-kun: {d.get('watched_min', 0)} daqiqa — {ok}"
        case "receipt" | "payment_approved":
            return f"{texts.money(d.get('amount'))} ({texts.KIND_NAMES.get(d.get('kind'), '')})"
        case "payment_rejected":
            return f"sabab: {d.get('reason', '')}"
        case "contact":
            return d.get("summary", "")
        case "deadline_changed":
            at = parse_iso(d.get("deadline_at"))
            return f"yangi: {fmt_datetime(at)}" if at else ""
        case "left_live":
            return f"{d.get('day')}-kun, {d.get('minute', 0)}-daqiqada"
        case "clicked_buy":
            return "Mini App" if d.get("source") == "miniapp" else "bot"
        case "stage":
            return (f"{STAGES.get(d.get('old'), d.get('old'))} → {STAGES.get(d.get('stage'), d.get('stage'))}"
                    + (f" ({d['by']})" if d.get("by") else ""))
    return ""


@router.get("/leads/{lid}")
async def lead_card(lid: int, db: AsyncSession = Depends(get_db), _=Depends(SALES)):
    lead = await db.get(Lead, lid)
    if not lead:
        raise HTTPException(404, "Lid topilmadi")
    f = await db.get(Funnel, lead.funnel_id)
    mgr = await db.get(AdminUser, lead.manager_id) if lead.manager_id else None
    receipt = (await db.execute(select(Payment.status).where(Payment.lead_id == lid)
                                .order_by(Payment.id.desc()).limit(1))).scalar()
    card = row_out(lead, mgr, receipt)
    sessions = (await db.execute(select(LeadSession).where(LeadSession.lead_id == lid)
                                 .order_by(LeadSession.id))).scalars().all()
    active = next((s for s in reversed(sessions) if s.status != "replaced"), None)
    watch = []
    days: dict[int, DayInfo] = {}
    if active:
        for day, day_at, dur in ((1, active.day1_at, f.day1_duration_sec), (2, active.day2_at, f.day2_duration_sec)):
            a = (await db.execute(select(Attendance).where(Attendance.session_id == active.id,
                                                           Attendance.day == day, Attendance.day_at == day_at)
                                  )).scalar_one_or_none()
            days[day] = DayInfo(
                at=day_at, evaluated=active.day1_evaluated if day == 1 else active.day2_evaluated,
                watched_min=a.watched_sec // 60 if a else None, duration_min=dur // 60,
                ok=active.day1_watched if day == 1 else None, joined_at=a.joined_at if a else None)
            if a:
                watch.append({"day": day, "minutes": a.watched_sec // 60, "duration_min": dur // 60,
                              "percent": round(a.watched_sec * 100 / dur) if dur else 0,
                              "reached_offer": a.reached_offer,
                              "offer_min": f.day2_offer_sec // 60 if day == 2 else None})
    pays = (await db.execute(select(Payment, Tariff).outerjoin(Tariff, Tariff.id == Payment.tariff_id)
                             .where(Payment.lead_id == lid).order_by(Payment.id.desc()))).all()
    approved = [p for p, _ in pays if p.status == "approved"]
    path = funnel_path(PathInput(
        registered_at=lead.created_at, source=lead.source, phone_at=lead.phone_at,
        session_at=sessions[0].created_at if sessions else None, day1=days.get(1), day2=days.get(2),
        reached_offer_at=lead.reached_offer_at, clicked_buy_at=lead.clicked_buy_at,
        receipt_at=pays[-1][0].submitted_at if pays else None, receipt_status=pays[0][0].status if pays else None,
        paid_at=approved[-1].decided_at if approved else None, payment_status=lead.payment_status, now=now_utc()))
    contacts = (await db.execute(select(ContactLog).where(ContactLog.lead_id == lid)
                                 .order_by(ContactLog.id.desc()))).scalars()
    events = (await db.execute(select(LeadEvent).where(LeadEvent.lead_id == lid)
                               .order_by(LeadEvent.at.desc(), LeadEvent.id.desc()).limit(300))).scalars()
    msgs = (await db.execute(
        select(ScheduledMessage, ChainMessage.title, Broadcast.id)
        .outerjoin(ChainMessage, ChainMessage.id == ScheduledMessage.chain_message_id)
        .outerjoin(Broadcast, Broadcast.id == ScheduledMessage.broadcast_id)
        .where(ScheduledMessage.lead_id == lid, ScheduledMessage.status != "cancelled")
        .order_by(ScheduledMessage.send_at.desc()).limit(200))).all()
    status_uz = {"sent": "yuborildi", "pending": "rejalashtirilgan", "skipped": "o'tkazib yuborildi",
                 "failed": "xato", "sending": "yuborilmoqda"}
    runs = (await db.execute(
        select(FlowRun, Flow.name, FlowNode.title, FlowNode.type).join(Flow, Flow.id == FlowRun.flow_id)
        .outerjoin(FlowNode, FlowNode.id == FlowRun.node_id).where(FlowRun.lead_id == lid)
        .order_by(FlowRun.id.desc()).limit(20))).all()
    card.update(
        registered_at=iso(lead.created_at),
        sessions=[{"id": s.id, "day1_at": iso(s.day1_at), "day2_at": iso(s.day2_at), "status": s.status}
                  for s in sessions],
        watch=watch, deadline_at=iso(lead.deadline_at), remaining_amount=lead.remaining_amount,
        remaining_due_date=lead.remaining_due_date.isoformat() if lead.remaining_due_date else None,
        payments=[payment_out(p, lead, t) for p, t in pays],
        contacts=[{"at": iso(c.at), "manager": c.manager_name, "result": c.result, "callback_at": iso(c.callback_at),
                   "note": c.note} for c in contacts],
        tags=lead.tags or [], stage_at=iso(lead.stage_at),
        path=[{"key": p.key, "label": p.label, "state": p.state, "at": iso(p.at), "detail": p.detail} for p in path],
        flow_runs=[{"id": r.id, "flow_id": r.flow_id, "flow_name": fname, "node_title": ntitle, "node_type": ntype,
                    "status": r.status, "waiting_for": r.waiting_for, "wait_until": iso(r.wait_until),
                    "started_at": iso(r.started_at), "updated_at": iso(r.updated_at), "reason": r.ended_reason}
                   for r, fname, ntitle, ntype in runs],
        events=[{"at": iso(e.at), "type": e.type, "title": EVENT_TITLES.get(e.type, e.type),
                 "details": event_details(e)} for e in events],
        messages=[{"at": iso(sm.sent_at or sm.send_at), "title": title or (f"Ommaviy xabar #{bid}" if bid else "—"),
                   "status": status_uz.get(sm.status, sm.status) + (f" ({sm.reason})" if sm.reason else "")}
                  for sm, title, bid in msgs],
    )
    return card


async def _lead(db: AsyncSession, lid: int) -> Lead:
    lead = await db.get(Lead, lid)
    if not lead:
        raise HTTPException(404, "Lid topilmadi")
    return lead


class ContactIn(BaseModel):
    result: str
    callback_at: str | None = None
    note: str = ""


RESULT_UZ = {"no_answer": "javob bermadi", "callback": "qayta qo'ng'iroq", "sold": "sotildi", "refused": "rad etdi"}


async def log_contact(db: AsyncSession, lead: Lead, me: AdminUser, result: str, cb: datetime | None,
                      note: str) -> None:
    if result == "callback":  # yangi vaqt eskisining o'rnini bosadi — ikki marta eslatilmaydi
        await db.execute(update(ContactLog).where(
            ContactLog.lead_id == lead.id, ContactLog.result == "callback", ContactLog.reminded.is_(False))
            .values(reminded=True))
    db.add(ContactLog(lead_id=lead.id, manager_name=me.name, result=result, callback_at=cb, note=note))
    lead.last_contact_at = now_utc()
    summary = RESULT_UZ[result] + (f" ({fmt_datetime(cb)})" if cb else "") + (f": {note}" if note else "")
    event(db, lead, "contact", summary=f"{me.name} — {summary}")


@router.post("/leads/{lid}/contact")
async def contact(lid: int, body: ContactIn, db: AsyncSession = Depends(get_db), me: AdminUser = Depends(SALES)):
    if body.result not in RESULT_UZ:
        raise HTTPException(400, "Noto'g'ri natija")
    lead = await _lead(db, lid)
    cb = parse_iso(body.callback_at)
    if body.result == "callback" and not cb:
        raise HTTPException(400, "Qayta qo'ng'iroq vaqtini kiriting")
    await set_stage(db, lead, stage_after_contact(lead.stage, body.result), me.name)
    await log_contact(db, lead, me, body.result, cb, body.note.strip())
    await db.commit()
    return {"ok": True, "stage": lead.stage}


class StageIn(BaseModel):
    stage: str
    callback_at: str | None = None
    note: str = ""


@router.post("/leads/{lid}/stage")
async def change_stage(lid: int, body: StageIn, db: AsyncSession = Depends(get_db),
                       me: AdminUser = Depends(SALES)):
    """Doskada kartani boshqa ustunga surish. Qayta qo'ng'iroqqa — vaqt bilan, rad etishga — sabab bilan."""
    if body.stage not in STAGES:
        raise HTTPException(400, "Noma'lum bosqich")
    lead = await _lead(db, lid)
    cb = parse_iso(body.callback_at)
    note = body.note.strip()
    if body.stage == "callback" and not cb:
        raise HTTPException(400, "Qayta qo'ng'iroq vaqtini kiriting")
    await set_stage(db, lead, body.stage, me.name)
    if body.stage == "callback":
        await log_contact(db, lead, me, "callback", cb, note)
    elif body.stage == "lost" and note:
        await log_contact(db, lead, me, "refused", None, note)
    await db.commit()
    return {"ok": True, "stage": lead.stage}


class AssignIn(BaseModel):
    manager_id: int | None


@router.post("/leads/{lid}/assign")
async def assign(lid: int, body: AssignIn, db: AsyncSession = Depends(get_db), me: AdminUser = Depends(SALES)):
    lead = await _lead(db, lid)
    if body.manager_id:
        m = await db.get(AdminUser, body.manager_id)
        if not m or m.role not in ("sales", "super_admin"):
            raise HTTPException(400, "Menejer topilmadi")
    lead.manager_id = body.manager_id
    event(db, lead, "manager_assigned", manager_id=body.manager_id, by=me.name)
    await db.commit()
    return {"ok": True}


class DeadlineIn(BaseModel):
    deadline_at: str


@router.post("/leads/{lid}/deadline")
async def deadline(lid: int, body: DeadlineIn, db: AsyncSession = Depends(get_db), me: AdminUser = Depends(SALES)):
    """Muddat haqiqiy: faqat admin lid kartasidan qo'lda uzaytira oladi."""
    lead = await _lead(db, lid)
    at = parse_iso(body.deadline_at)
    if not at:
        raise HTTPException(400, "Sana noto'g'ri")
    lead.deadline_at = at
    event(db, lead, "deadline_changed", deadline_at=iso(at), by=me.name)
    # "deadline tugashidan X oldin" xabarlari yangi muddatga ko'chadi
    s = await active_session(db, lead.id)
    if s:
        await plan_for_session(db, lead, s, await db.get(Funnel, lead.funnel_id))
    audit(db, me.name, "deadline_changed", f"lid #{lid}: {fmt_datetime(at)}")
    await db.commit()
    return {"ok": True}


class PlanIn(BaseModel):
    remaining_amount: int | None = None
    remaining_due_date: date | None = None


@router.post("/leads/{lid}/payment-plan")
async def payment_plan(lid: int, body: PlanIn, db: AsyncSession = Depends(get_db), _=Depends(SALES)):
    lead = await _lead(db, lid)
    lead.remaining_amount = body.remaining_amount
    if lead.remaining_due_date != body.remaining_due_date:
        lead.remaining_reminded_at = None
    lead.remaining_due_date = body.remaining_due_date
    await db.commit()
    return {"ok": True}


@router.post("/leads/{lid}/send-invite")
async def send_invite(lid: int, db: AsyncSession = Depends(get_db), me: AdminUser = Depends(SALES)):
    lead = await _lead(db, lid)
    f = await db.get(Funnel, lead.funnel_id)
    if not await pay.send_channel_invite(get_bot(), db, lead, f):
        raise HTTPException(400, "Havola yuborilmadi: kanal sozlanmagan, bot kanalda admin emas yoki lid botni bloklagan")
    audit(db, me.name, "invite_sent", f"lid #{lid}")
    await db.commit()
    return {"ok": True}


@router.post("/leads/{lid}/receipt")
async def upload_receipt(lid: int, file: UploadFile = File(...), tariff_id: int | None = Form(default=None),
                         kind: str = Form(...), method: str = Form(...), amount: int = Form(...),
                         db: AsyncSession = Depends(get_db), me: AdminUser = Depends(SALES)):
    """Menejerga to'g'ridan-to'g'ri berilgan chek — bot cheklari bilan bir xil navbatga tushadi."""
    if kind not in ("deposit", "full", "remaining") or method not in ("card", "payme", "click"):
        raise HTTPException(400, "Noto'g'ri tur yoki usul")
    lead = await _lead(db, lid)
    mime = file.content_type or "application/octet-stream"
    if not (mime.startswith("image/") or mime == "application/pdf"):
        raise HTTPException(400, "Faqat rasm yoki PDF")
    ext = os.path.splitext(file.filename or "")[1][:10] or (".pdf" if mime == "application/pdf" else ".jpg")
    p = await pay.create_receipt(db, lead, tariff_id=tariff_id, method=method, kind=kind, amount=amount,
                                 data=await file.read(), mime=mime, ext=ext, uploaded_by=me.name)
    await pay.post_to_group(get_bot(), db, p)
    t = await db.get(Tariff, tariff_id) if tariff_id else None
    return payment_out(p, lead, t)


class BulkMessageIn(BaseModel):
    lead_ids: list[int]
    text: str
    buttons: list[list[dict]] = []
    media_id: int | None = None


@router.post("/leads/message")
async def bulk_message(body: BulkMessageIn, db: AsyncSession = Depends(get_db), me: AdminUser = Depends(SALES)):
    if not body.lead_ids or not (body.text.strip() or body.media_id):
        raise HTTPException(400, "Lid va matn tanlang")
    first = await _lead(db, body.lead_ids[0])
    b = Broadcast(funnel_id=first.funnel_id, segment="all", text=body.text, buttons=body.buttons,
                  media_id=body.media_id, lead_ids=body.lead_ids, send_at=None, status="scheduled",
                  created_by=me.name)
    db.add(b)
    audit(db, me.name, "leads_messaged", f"{len(body.lead_ids)} ta lid")
    await db.commit()
    return {"queued": len(body.lead_ids)}

