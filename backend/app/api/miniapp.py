"""Mini App API: efir sahifasi holati, heartbeat, savollar, oferta."""
from datetime import timedelta

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.common import iso
from app.bot import flows
from app.config import get_settings
from app.db import get_db
from app.domain.access import AccessInput, DayAttendance, compute_state
from app.domain.slots import SlotConfig, can_change_day1
from app.models import Attendance, Funnel, Heartbeat, Lead, LeadSession, LiveComment, Question, Tariff
from app.security.initdata import InitDataError, validate
from app.services.leads import active_session, event, lead_for_tg, set_step
from app.services.payments import price_for, special_active
from app.services.tg import get_bot
from app.services.video import hls_url
from app.timeutil import now_utc

router = APIRouter(prefix="/api/app", tags=["miniapp"])

HEARTBEAT_MAX_GAP = 40  # soniya: shundan katta bo'shliq ko'rish vaqtiga qo'shilmaydi
OFFER_STEPS = {"session", "day1_watched", "day1_missed", "day2_missed", "left_before_offer"}


async def webapp_lead(authorization: str = Header(default=""), db: AsyncSession = Depends(get_db)) -> Lead:
    s = get_settings()
    scheme, _, data = authorization.partition(" ")
    if scheme.lower() != "tma":
        raise HTTPException(401, "Sahifani bot ichidan oching")
    try:
        user = validate(data, s.bot_token, s.initdata_max_age_sec)
    except InitDataError as e:
        raise HTTPException(401, f"Telegram ma'lumoti tasdiqlanmadi: {e}")
    lead = await lead_for_tg(db, user.id)
    if not lead:
        raise HTTPException(404, "Avval botda ro'yxatdan o'ting")
    return lead


async def _attendance(db: AsyncSession, s: LeadSession, day: int) -> Attendance | None:
    day_at = s.day1_at if day == 1 else s.day2_at
    return (await db.execute(select(Attendance).where(
        Attendance.session_id == s.id, Attendance.day == day, Attendance.day_at == day_at))).scalar_one_or_none()


def _att(a: Attendance | None) -> DayAttendance:
    return DayAttendance(joined=a is not None, watched_sec=a.watched_sec if a else 0,
                         reached_offer=a.reached_offer if a else False)


def access_input(s: LeadSession, f: Funnel, a1: Attendance | None, a2: Attendance | None, now) -> AccessInput:
    return AccessInput(now=now, day1_at=s.day1_at, day2_at=s.day2_at, day1_duration_sec=f.day1_duration_sec,
                       day2_duration_sec=f.day2_duration_sec, late_entry_minutes=f.late_entry_minutes,
                       day1_threshold=f.day1_watch_threshold, day1=_att(a1), day2=_att(a2))


async def _offer(db: AsyncSession, lead: Lead, f: Funnel, visible_from: int | None, soft: bool, now) -> dict:
    tariffs = (await db.execute(select(Tariff).where(Tariff.funnel_id == f.id).order_by(Tariff.sort))).scalars().all()
    items = []
    for t in tariffs:
        p = price_for(lead, t, f, now)
        items.append({
            "id": t.id, "name": t.name, "description": t.description, "special_price": t.special_price,
            "regular_price": t.regular_price, "price_now": p if p is not None else t.regular_price,
            "deposit_amount": t.deposit_amount if t.deposit_enabled else None,
        })
    active = special_active(lead, now)
    return {
        "course_title": f.offer_course_title or f.course_title, "tariffs": items, "bonuses": f.bonuses or [],
        "deadline_at": iso(lead.deadline_at), "special_active": active,
        "closed": (not active) and f.after_deadline == "closed",
        "visible_from_sec": visible_from, "soft": soft,
    }


@router.get("/state")
async def state(lead: Lead = Depends(webapp_lead), db: AsyncSession = Depends(get_db)):
    f = await db.get(Funnel, lead.funnel_id)
    now = now_utc()
    resp = {
        "server_time": iso(now),
        "lead": {"first_name": lead.first_name},
        "funnel": {
            "course_title": f.course_title, "webinar_title": f.webinar_title, "topic": f.topic,
            "speaker_name": f.speaker_name, "speaker_title": f.speaker_title,
            "speaker_photo_url": f.speaker_photo_url, "logo_url": f.logo_url,
            "theme": {"primary": f.theme_primary, "background": f.theme_background, "bg_image_url": f.bg_image_url},
            "late_entry_minutes": f.late_entry_minutes,
        },
        "state": "no_session", "session": None, "live": None, "between": None, "missed": None, "offer": None,
    }
    s = await active_session(db, lead.id)
    if not s:
        return resp
    a1, a2 = await _attendance(db, s, 1), await _attendance(db, s, 2)
    res = compute_state(access_input(s, f, a1, a2, now))
    resp["state"] = res.state
    resp["session"] = {
        "id": s.id, "day1_at": iso(s.day1_at), "day2_at": iso(s.day2_at),
        "can_change": not s.day1_evaluated and can_change_day1(SlotConfig.from_funnel(f), now, s.day1_at),
    }
    if res.state == "live":
        day = res.day
        comments = (await db.execute(select(LiveComment).where(
            LiveComment.funnel_id == f.id, LiveComment.day == day).order_by(LiveComment.t))).scalars().all()
        resp["live"] = {
            "day": day, "start_at": iso(res.started_at),
            "duration_sec": f.day1_duration_sec if day == 1 else f.day2_duration_sec,
            "hls_url": hls_url(f.day1_video_id if day == 1 else f.day2_video_id),
            "comments": [{"t": c.t, "author": c.author, "text": c.text} for c in comments],
        }
        if day == 2:
            resp["offer"] = await _offer(db, lead, f, f.day2_offer_sec, False, now)
        elif f.day1_soft_offer_sec is not None:
            resp["offer"] = await _offer(db, lead, f, f.day1_soft_offer_sec, True, now)
    elif res.state == "between":
        watched = a1.watched_sec if a1 else 0
        resp["between"] = {
            "day1_percent": min(100, round(watched * 100 / f.day1_duration_sec)) if f.day1_duration_sec else 0,
            "day2_at": iso(s.day2_at), "summary": f.between_summary or [],
        }
    elif res.state in ("missed", "closed"):
        used = lead.day1_reschedules if res.day == 1 else lead.day2_reschedules
        resp["missed"] = {"day": res.day, "started_at": iso(res.started_at),
                          "reschedules_left": 0 if lead.cold else max(f.reschedule_limit - used, 0)}
    elif res.state == "ended":
        resp["offer"] = await _offer(db, lead, f, None, False, now)
    return resp


class HeartbeatIn(BaseModel):
    session_id: int
    day: int = Field(ge=1, le=2)
    position_sec: int = Field(ge=0)


@router.post("/heartbeat")
async def heartbeat(body: HeartbeatIn, lead: Lead = Depends(webapp_lead), db: AsyncSession = Depends(get_db)):
    now = now_utc()
    s = await db.get(LeadSession, body.session_id)
    if not s or s.lead_id != lead.id or s.status == "replaced":
        raise HTTPException(403, "Bu efir sizga tegishli emas")
    f = await db.get(Funnel, lead.funnel_id)
    a = await _attendance(db, s, body.day)
    a1 = a if body.day == 1 else await _attendance(db, s, 1)
    a2 = a if body.day == 2 else await _attendance(db, s, 2)
    res = compute_state(access_input(s, f, a1, a2, now))
    day_at = s.day1_at if body.day == 1 else s.day2_at
    duration = f.day1_duration_sec if body.day == 1 else f.day2_duration_sec
    in_window = day_at <= now <= day_at + timedelta(seconds=duration + 60)
    if not (res.state == "live" and res.day == body.day) and not (a and in_window):
        raise HTTPException(409, "Efir hozir ochiq emas")
    # pauza va o'tkazish yo'q: pozitsiyani server vaqtidan hisoblaymiz
    position = min(int((now - day_at).total_seconds()), duration)
    if a is None:
        a = Attendance(session_id=s.id, lead_id=lead.id, day=body.day, day_at=day_at, joined_at=now,
                       join_position_sec=position, max_position_sec=position, last_position_sec=position,
                       last_heartbeat_at=now, watched_sec=0)
        db.add(a)
        event(db, lead, "joined", day=body.day, late_min=position // 60)
    else:
        gap = (now - a.last_heartbeat_at).total_seconds() if a.last_heartbeat_at else 0
        if 0 < gap <= HEARTBEAT_MAX_GAP:
            a.watched_sec = min(a.watched_sec + int(gap), duration)
        a.last_heartbeat_at = now
        a.last_position_sec = position
        a.max_position_sec = max(a.max_position_sec, position)
    if body.day == 1:
        lead.day1_watched_sec = a.watched_sec
    else:
        lead.day2_watched_sec = a.watched_sec
        if not a.reached_offer and f.day2_offer_sec and position >= f.day2_offer_sec:
            a.reached_offer = True
            if lead.reached_offer_at is None:
                lead.reached_offer_at = now
            event(db, lead, "reached_offer")
            if lead.payment_status == "none" and lead.step in OFFER_STEPS:
                await set_step(db, lead, "reached_offer", now)
    await db.flush()
    db.add(Heartbeat(funnel_id=f.id, lead_id=lead.id, attendance_id=a.id, day=body.day, position_sec=position))
    await db.commit()
    return {"ok": True, "server_time": iso(now)}


class QuestionIn(BaseModel):
    text: str = Field(min_length=1, max_length=2000)


@router.post("/question")
async def question(body: QuestionIn, lead: Lead = Depends(webapp_lead), db: AsyncSession = Depends(get_db)):
    db.add(Question(lead_id=lead.id, text=body.text.strip(), source="miniapp"))
    event(db, lead, "question")
    await db.commit()
    return {"ok": True}


class OfferClickIn(BaseModel):
    tariff_id: int | None = None


@router.post("/offer-click")
async def offer_click(body: OfferClickIn, lead: Lead = Depends(webapp_lead), db: AsyncSession = Depends(get_db)):
    f = await db.get(Funnel, lead.funnel_id)
    await flows.send_tariffs(get_bot(), db, lead, f, source="miniapp", preselected=body.tariff_id)
    return {"ok": True}


@router.post("/reschedule")
async def reschedule(lead: Lead = Depends(webapp_lead), db: AsyncSession = Depends(get_db)):
    f = await db.get(Funnel, lead.funnel_id)
    await flows.send_reschedule(get_bot(), db, lead, f)
    return {"ok": True}
