"""«Xabarlar vaqti»: zanjir xabarlari qachon ketishi, oraliqlar, navbatdagilar va bekor qilish.

Vaqt qoidasi xabarning o'zida (trigger + offset yoki aniq sana). Har bir lidning jadvali o'z ro'yxat va efir
vaqtidan hisoblanadi, shuning uchun bir lidning jadvali boshqasiga ta'sir qilmaydi. Barcha vaqtlar UTC da
saqlanadi, admin panelda Toshkent vaqtida ko'rsatiladi.
"""
import logging
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.admin.chain import ChainIn, fixed_of, jsonable, segment_label, trigger_label, validate
from app.api.common import audit, funnel_or_404, iso, parse_iso
from app.db import get_db
from app.domain import slots
from app.domain.planning import SessionTimes, plan_chain
from app.models import AdminUser, Broadcast, ChainHistory, ChainMessage, Lead, ScheduledMessage
from app.security.auth import ANY, CONTENT
from app.services.leads import quiet_of
from app.services.sessions import chain_item, replan_message
from app.timeutil import now_utc

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/admin", tags=["admin"])

# vaqtni shu sahifadan o'zgartirsa bo'ladigan triggerlar ("stuck" va "on_button" — faqat kechikishi)
TIMING_TRIGGERS = {"after_registration", "before_day", "at_day_start", "after_day_end", "before_deadline",
                   "left_live", "stuck", "on_button", "at_datetime"}
BEFORE_TRIGGERS = {"before_day", "before_deadline"}   # offset katta — vaqt oldinroq


async def classic_messages(db: AsyncSession, fid: int) -> list[ChainMessage]:
    return list((await db.execute(select(ChainMessage).where(
        ChainMessage.funnel_id == fid, ChainMessage.flow_node_id.is_(None))
        .order_by(ChainMessage.sort, ChainMessage.id))).scalars())


@router.get("/funnels/{fid}/timing")
async def timing(fid: int, registered_at: str | None = None, day1_at: str | None = None,
                 db: AsyncSession = Depends(get_db), _=Depends(CONTENT)):
    """Har bir xabar: vaqt qoidasi, namunaviy lid uchun aniq vaqti, navbatda kutayotganlar soni."""
    f = await funnel_or_404(db, fid)
    reg = parse_iso(registered_at) or now_utc()
    options = slots.day1_options(slots.SlotConfig.from_funnel(f), reg)
    day1 = parse_iso(day1_at) or (options[0] if options else reg + timedelta(days=1))
    if day1 <= reg:
        raise HTTPException(400, "1-kun efiri ro'yxatdan keyin bo'lishi kerak")
    day2 = slots.day2_for(day1)
    deadline = day2 + timedelta(seconds=f.day2_duration_sec, hours=f.deadline_hours)
    msgs = await classic_messages(db, fid)
    active = [m for m in msgs if m.status == "active"]
    times = SessionTimes(reg, day1, day2, f.day1_duration_sec, f.day2_duration_sec, deadline)
    plan = {p.item.id: p for p in plan_chain([chain_item(m) for m in active], times, reg, quiet_of(f))}
    queue = {mid: (n, first) for mid, n, first in (await db.execute(
        select(ScheduledMessage.chain_message_id, func.count(), func.min(ScheduledMessage.send_at))
        .where(ScheduledMessage.status == "pending", ScheduledMessage.chain_message_id.in_([m.id for m in msgs]))
        .group_by(ScheduledMessage.chain_message_id))).all()}
    casts = (await db.execute(select(Broadcast).where(
        Broadcast.funnel_id == fid, Broadcast.lead_ids.is_(None), Broadcast.status == "scheduled")
        .order_by(Broadcast.send_at.nulls_first()))).scalars()
    items = []
    for m in msgs:
        p = plan.get(m.id)
        n, first = queue.get(m.id, (0, None))
        items.append({
            "id": m.id, "title": m.title, "kind": m.kind, "status": m.status, "trigger_type": m.trigger_type,
            "trigger_day": m.trigger_day, "offset_minutes": m.offset_minutes, "fixed_at": iso(m.fixed_at),
            "stuck_step": m.stuck_step, "button_key": m.button_key, "segment": m.segment,
            "segment_label": segment_label(m), "required": m.required, "sort": m.sort, "rule": trigger_label(m),
            "planned_at": iso(p.send_at) if p else None,
            "plan_status": p.status if p else ("draft" if m.status != "active" else "event"),
            "plan_reason": p.reason if p else None, "pending": n, "next_at": iso(first),
        })
    return {
        "sample": {"registered_at": iso(reg), "day1_at": iso(day1), "day2_at": iso(day2), "deadline_at": iso(deadline),
                   "day1_end": iso(times.day_end(1)), "day2_end": iso(times.day_end(2)),
                   "day1_options": [iso(o) for o in options[:12]]},
        "quiet": {"start": f.quiet_start, "end": f.quiet_end},
        "messages": items,
        "broadcasts": [{"id": b.id, "text": b.text, "segment": b.segment, "send_at": iso(b.send_at)} for b in casts],
    }


class TimingIn(BaseModel):
    trigger_type: str
    trigger_day: int | None = None
    offset_minutes: int = 0
    fixed_at: str | None = None
    shift_following: bool = False   # bir guruhdagi keyingi xabarlarni ham shuncha surish (oraliqlar saqlanadi)


def _later(trigger: str, offset: int, other: int) -> bool:
    return other < offset if trigger in BEFORE_TRIGGERS else other > offset


@router.patch("/chain/{mid}/timing")
async def set_timing(mid: int, body: TimingIn, db: AsyncSession = Depends(get_db), me: AdminUser = Depends(CONTENT)):
    m = await db.get(ChainMessage, mid)
    if not m:
        raise HTTPException(404, "Xabar topilmadi")
    if m.flow_node_id:
        raise HTTPException(400, "Sxemadagi xabar vaqti sxemaning o'zida sozlanadi")
    if body.trigger_type not in TIMING_TRIGGERS:
        raise HTTPException(400, "Bu vaqt turini bu yerda tanlab bo'lmaydi")
    data = ChainIn(**{k: getattr(m, k) for k in (
        "title", "kind", "text", "media_ids", "buttons", "stuck_step", "button_key", "segment", "segment_day",
        "segment_minute", "required", "status", "sort")},
        trigger_type=body.trigger_type, trigger_day=body.trigger_day, offset_minutes=body.offset_minutes,
        fixed_at=body.fixed_at)
    validate(data)
    new = {"trigger_type": data.trigger_type, "trigger_day": data.trigger_day if data.trigger_type not in (
        "after_registration", "before_deadline", "at_datetime", "stuck", "on_button") else None,
        "offset_minutes": 0 if data.trigger_type == "at_datetime" else data.offset_minutes,
        "fixed_at": fixed_of(data, m.fixed_at)}
    old = (m.trigger_type, m.trigger_day, m.offset_minutes)
    shifted = 0
    if body.shift_following and old[:2] == (new["trigger_type"], new["trigger_day"]) and \
            new["trigger_type"] != "at_datetime" and new["offset_minutes"] != old[2]:
        delta = new["offset_minutes"] - old[2]
        for o in await classic_messages(db, m.funnel_id):
            if o.id == m.id or (o.trigger_type, o.trigger_day) != old[:2] or o.stuck_step != m.stuck_step \
                    or not _later(o.trigger_type, old[2], o.offset_minutes):
                continue
            value = max(0, o.offset_minutes + delta)
            if value != o.offset_minutes:
                db.add(ChainHistory(message_id=o.id, user_name=me.name,
                                    changes={"offset_minutes": [o.offset_minutes, value]}))
                o.offset_minutes, o.updated_by, o.updated_at = value, me.name, now_utc()
                await replan_message(db, o)
                shifted += 1
    changes = {k: [jsonable(getattr(m, k)), jsonable(v)] for k, v in new.items() if getattr(m, k) != v}
    if changes:
        for k, v in new.items():
            setattr(m, k, v)
        m.updated_by, m.updated_at = me.name, now_utc()
        db.add(ChainHistory(message_id=m.id, user_name=me.name, changes=changes))
        await replan_message(db, m)
    audit(db, me.name, "chain_timing",
          f"«{m.title}»: {trigger_label(m)}" + (f", yana {shifted} ta xabar surildi" if shifted else ""))
    await db.commit()
    log.info("Xabar vaqti o'zgardi: #%s %s (%s), surildi: %s", m.id, trigger_label(m), me.name, shifted)
    return {"ok": True, "shifted": shifted, "rule": trigger_label(m)}


@router.get("/chain/{mid}/queue")
async def queue(mid: int, db: AsyncSession = Depends(get_db), _=Depends(CONTENT)):
    """Shu xabarni kutayotgan lidlar (eng yaqini birinchi)."""
    base = select(ScheduledMessage, Lead.first_name).join(Lead, Lead.id == ScheduledMessage.lead_id).where(
        ScheduledMessage.chain_message_id == mid, ScheduledMessage.status == "pending")
    total = (await db.execute(select(func.count()).select_from(base.subquery()))).scalar()
    rows = (await db.execute(base.order_by(ScheduledMessage.send_at).limit(100))).all()
    return {"total": total, "items": [{"id": sm.id, "lead_id": sm.lead_id, "lead_name": name or "—",
                                       "send_at": iso(sm.send_at)} for sm, name in rows]}


@router.post("/scheduled/{sid}/cancel")
async def cancel_scheduled(sid: int, db: AsyncSession = Depends(get_db), me: AdminUser = Depends(ANY)):
    """Bitta lidga rejalashtirilgan bitta xabarni bekor qilish (boshqa lidlarga ta'sir qilmaydi)."""
    sm = await db.get(ScheduledMessage, sid, with_for_update=True)
    if not sm:
        raise HTTPException(404, "Xabar topilmadi")
    if sm.status != "pending":
        raise HTTPException(400, "Bu xabar endi navbatda emas (yuborilgan yoki bekor qilingan)")
    if sm.flow_run_id or sm.flow_node_id:
        raise HTTPException(400, "Sxemadagi xabarni sxemaning o'zida to'xtating")
    sm.status, sm.reason = "cancelled", f"bekor qilindi: {me.name}"[:200]
    audit(db, me.name, "scheduled_cancelled", f"lid #{sm.lead_id}, navbat #{sm.id}")
    await db.commit()
    log.info("Navbatdagi xabar bekor qilindi: #%s lid=%s (%s)", sm.id, sm.lead_id, me.name)
    return {"ok": True}
