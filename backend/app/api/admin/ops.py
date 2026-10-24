"""To'lovlar navbati, savollar, ommaviy xabarlar."""
import os
from datetime import date as date_
from datetime import time, timedelta

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.admin.leads import payment_out
from app.api.common import audit, funnel_or_404, iso, parse_iso
from app.bot import texts
from app.db import get_db
from app.domain.segments import SEGMENTS
from app.models import AdminUser, Broadcast, Lead, LeadSession, Media, Payment, Question, Tariff
from app.security.auth import ANY, CONTENT, SALES
from app.services import payments as pay
from app.services.render import Payload, keyboard, send_payload
from app.services.tg import get_bot
from app.timeutil import local_to_utc, now_utc

router = APIRouter(prefix="/api/admin", tags=["admin"])


# ── to'lovlar ──

@router.get("/payments")
async def payments(funnel_id: int, status: str = "pending", db: AsyncSession = Depends(get_db), _=Depends(SALES)):
    q = (select(Payment, Lead, Tariff).join(Lead, Lead.id == Payment.lead_id)
         .outerjoin(Tariff, Tariff.id == Payment.tariff_id).where(Lead.funnel_id == funnel_id))
    if status != "all":
        q = q.where(Payment.status == status)
    order = Payment.submitted_at.asc() if status == "pending" else Payment.submitted_at.desc()
    rows = (await db.execute(q.order_by(order).limit(500))).all()
    return [payment_out(p, lead, t) for p, lead, t in rows]


@router.get("/payments/{pid}/file")
async def payment_file(pid: int, db: AsyncSession = Depends(get_db), _=Depends(SALES)):
    p = await db.get(Payment, pid)
    if not p or not os.path.isfile(p.file_path):
        raise HTTPException(404, "Fayl topilmadi")
    return FileResponse(p.file_path, media_type=p.file_mime)


async def _payment_row(db: AsyncSession, pid: int) -> dict:
    p = await db.get(Payment, pid)
    await db.refresh(p)
    lead = await db.get(Lead, p.lead_id)
    t = await db.get(Tariff, p.tariff_id) if p.tariff_id else None
    return payment_out(p, lead, t)


@router.post("/payments/{pid}/approve")
async def approve(pid: int, db: AsyncSession = Depends(get_db), me: AdminUser = Depends(SALES)):
    if not await pay.approve(get_bot(), db, pid, me.name):
        raise HTTPException(409, texts.GROUP_ALREADY)
    return await _payment_row(db, pid)


class RejectIn(BaseModel):
    reason: str


@router.post("/payments/{pid}/reject")
async def reject(pid: int, body: RejectIn, db: AsyncSession = Depends(get_db), me: AdminUser = Depends(SALES)):
    if not await pay.reject(get_bot(), db, pid, body.reason.strip() or "Boshqa sabab", me.name):
        raise HTTPException(409, texts.GROUP_ALREADY)
    return await _payment_row(db, pid)


@router.post("/payments/{pid}/refund")
async def refund(pid: int, db: AsyncSession = Depends(get_db), me: AdminUser = Depends(SALES)):
    p = await db.get(Payment, pid)
    if not p or p.status != "approved":
        raise HTTPException(400, "Faqat tasdiqlangan to'lovni qaytarish mumkin")
    p.refunded = True
    audit(db, me.name, "payment_refunded", f"#{pid}")
    await db.commit()
    return await _payment_row(db, pid)


# ── savollar ──

def question_out(q: Question, lead: Lead) -> dict:
    return {"id": q.id, "lead_id": lead.id, "lead_name": lead.first_name, "text": q.text, "source": q.source,
            "created_at": iso(q.created_at), "answer": q.answer, "answered_at": iso(q.answered_at)}


@router.get("/questions")
async def questions(funnel_id: int, answered: bool = False, db: AsyncSession = Depends(get_db), _=Depends(SALES)):
    q = (select(Question, Lead).join(Lead, Lead.id == Question.lead_id)
         .where(Lead.funnel_id == funnel_id, Question.source == "bot",
                Question.answer.is_not(None) if answered else Question.answer.is_(None))
         .order_by(Question.created_at.desc()).limit(500))
    return [question_out(qq, lead) for qq, lead in (await db.execute(q)).all()]


class AnswerIn(BaseModel):
    text: str


@router.post("/questions/{qid}/answer")
async def answer(qid: int, body: AnswerIn, db: AsyncSession = Depends(get_db), me: AdminUser = Depends(SALES)):
    q = await db.get(Question, qid)
    if not q or not body.text.strip():
        raise HTTPException(400, "Javob matnini yozing")
    lead = await db.get(Lead, q.lead_id)
    if not await pay.safe_send(get_bot(), lead, texts.ANSWER.format(answer=body.text.strip())):
        raise HTTPException(400, "Lidga yuborib bo'lmadi (botni bloklagan bo'lishi mumkin)")
    q.answer, q.answered_by, q.answered_at = body.text.strip(), me.name, now_utc()
    await db.commit()
    return question_out(q, lead)


# ── efir chati: efir davomida Mini App'da yozilgan fikr va savollar ──

def chat_out(q: Question, lead: Lead, s: LeadSession | None, show_phone: bool) -> dict:
    session_at = (s.day1_at if q.day == 1 else s.day2_at) if s and q.day else None
    return {"id": q.id, "lead_id": lead.id, "lead_name": lead.first_name,
            "lead_phone": lead.phone if show_phone else None, "text": q.text, "day": q.day,
            "video_sec": q.video_sec, "session_at": iso(session_at), "created_at": iso(q.created_at),
            "answer": q.answer, "answered_at": iso(q.answered_at), "answered_by": q.answered_by}


@router.get("/chat")
async def chat(funnel_id: int, date: date_ | None = None, day: int | None = None, status: str = "all",
               db: AsyncSession = Depends(get_db), me: AdminUser = Depends(ANY)):
    q = (select(Question, Lead, LeadSession).join(Lead, Lead.id == Question.lead_id)
         .outerjoin(LeadSession, LeadSession.id == Question.session_id)
         .where(Lead.funnel_id == funnel_id, Question.source == "miniapp"))
    if day:
        q = q.where(Question.day == day)
    if status == "unanswered":
        q = q.where(Question.answer.is_(None))
    if date:
        q = q.where(Question.created_at >= local_to_utc(date, time.min),
                    Question.created_at < local_to_utc(date + timedelta(days=1), time.min))
    rows = (await db.execute(q.order_by(Question.created_at.desc()).limit(1000))).all()
    show_phone = me.role != "content"
    return [chat_out(qq, lead, s, show_phone) for qq, lead, s in rows]


@router.get("/chat/sessions")
async def chat_sessions(funnel_id: int, db: AsyncSession = Depends(get_db), _=Depends(ANY)):
    """Chat xabarlari bor efirlar: qaysi kun, qaysi vaqt, nechta xabar."""
    at = case((Question.day == 2, LeadSession.day2_at), else_=LeadSession.day1_at)
    rows = (await db.execute(
        select(Question.day, at.label("at"), func.count(), func.count().filter(Question.answer.is_(None)))
        .join(Lead, Lead.id == Question.lead_id).join(LeadSession, LeadSession.id == Question.session_id)
        .where(Lead.funnel_id == funnel_id, Question.source == "miniapp", Question.day.is_not(None))
        .group_by(Question.day, "at").order_by(at.desc()).limit(100))).all()
    return [{"day": d, "at": iso(a), "count": n, "unanswered": u} for d, a, n, u in rows]


@router.post("/chat/{qid}/reply")
async def chat_reply(qid: int, body: AnswerIn, db: AsyncSession = Depends(get_db), me: AdminUser = Depends(ANY)):
    q = await db.get(Question, qid)
    if not q or q.source != "miniapp" or not body.text.strip():
        raise HTTPException(400, "Javob matnini yozing")
    lead = await db.get(Lead, q.lead_id)
    text_ = texts.CHAT_ANSWER.format(question=q.text[:300], answer=body.text.strip())
    if not await pay.safe_send(get_bot(), lead, text_):
        raise HTTPException(400, "Lidga yuborib bo'lmadi (botni bloklagan bo'lishi mumkin)")
    q.answer, q.answered_by, q.answered_at = body.text.strip(), me.name, now_utc()
    await db.commit()
    s = await db.get(LeadSession, q.session_id) if q.session_id else None
    return chat_out(q, lead, s, me.role != "content")


# ── ommaviy xabar ──

def broadcast_out(b: Broadcast) -> dict:
    return {"id": b.id, "segment": b.segment, "text": b.text, "buttons": b.buttons, "media_id": b.media_id,
            "send_at": iso(b.send_at), "status": b.status, "recipients": b.recipients, "created_at": iso(b.created_at)}


class BroadcastIn(BaseModel):
    segment: str
    text: str = ""
    buttons: list[list[dict]] = []
    media_id: int | None = None
    send_at: str | None = None


@router.get("/funnels/{fid}/broadcasts")
async def broadcasts(fid: int, db: AsyncSession = Depends(get_db), _=Depends(CONTENT)):
    rows = (await db.execute(select(Broadcast).where(Broadcast.funnel_id == fid, Broadcast.lead_ids.is_(None))
                             .order_by(Broadcast.id.desc()).limit(200))).scalars()
    return [broadcast_out(b) for b in rows]


@router.post("/funnels/{fid}/broadcasts")
async def create_broadcast(fid: int, body: BroadcastIn, db: AsyncSession = Depends(get_db),
                           me: AdminUser = Depends(CONTENT)):
    await funnel_or_404(db, fid)
    if body.segment not in SEGMENTS and body.segment != "cold":
        raise HTTPException(400, "Noto'g'ri segment")
    if not body.text.strip() and not body.media_id:
        raise HTTPException(400, "Matn yoki media kiriting")
    b = Broadcast(funnel_id=fid, segment=body.segment, text=body.text, buttons=body.buttons,
                  media_id=body.media_id, send_at=parse_iso(body.send_at), status="scheduled", created_by=me.name)
    db.add(b)
    audit(db, me.name, "broadcast_created", f"segment={body.segment}")
    await db.commit()
    return broadcast_out(b)


class TestIn(BaseModel):
    text: str = ""
    buttons: list[list[dict]] = []
    media_id: int | None = None


@router.post("/broadcasts/test")
async def test_broadcast(body: TestIn, db: AsyncSession = Depends(get_db), me: AdminUser = Depends(CONTENT)):
    if not me.tg_user_id:
        raise HTTPException(400, "Sozlamalarda Telegram ID ingizni kiriting")
    media = [m] if body.media_id and (m := await db.get(Media, body.media_id)) else []
    p = Payload(media[0].kind if media else "text", body.text, media, body.buttons)
    try:
        await send_payload(get_bot(), db, me.tg_user_id, p, "[TEST] " + body.text, keyboard(body.buttons))
    except Exception as e:
        raise HTTPException(400, f"Yuborib bo'lmadi: {e}")
    return {"ok": True}
