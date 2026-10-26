"""Progrev zanjiri: CRUD, test yuborish, o'zgarishlar tarixi, "lid sifatida sinash"."""
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.common import funnel_or_404, iso, parse_iso
from app.db import get_db
from app.domain.flow_rules import ensure_button_ids, next_buttons
from app.domain.honesty import honesty_warnings
from app.domain.media_rules import validate_message
from app.domain.planning import SessionTimes, plan_chain
from app.domain.segments import MINUTE_SEGMENTS, SEGMENTS, WATCH_SEGMENTS
from app.domain.slots import day2_for
from app.models import AdminUser, ChainHistory, ChainMessage, Flow, FlowNode, Funnel, Media, ScheduledMessage
from app.security.auth import CONTENT
from app.services import flow_engine
from app.services.leads import quiet_of
from app.services.render import Payload, fill, keyboard, send_payload, variables
from app.services.sessions import chain_item, replan_message
from app.services.tg import get_bot
from app.timeutil import fmt_datetime, now_utc

router = APIRouter(prefix="/api/admin", tags=["admin"])

TRIGGERS = {"after_registration", "before_day", "at_day_start", "after_day_end", "before_deadline", "left_live",
            "on_button", "stuck", "flow"}
# sxemadagi "Zanjir" blokining xabarlari faqat vaqtga bog'langan bo'ladi ("ro'yxatdan keyin" — "zanjirga kirgach")
CHAIN_ITEM_TRIGGERS = {"after_registration", "before_day", "at_day_start", "after_day_end", "before_deadline"}
DAY_TRIGGERS = {"before_day", "at_day_start", "after_day_end", "left_live"}
KINDS = {"text", "photo", "video", "video_note", "voice", "audio", "document", "album"}
STUCK_STEPS = {"no_phone", "no_session", "no_receipt", "receipt_rejected"}
EDITABLE = ["title", "kind", "text", "media_ids", "buttons", "trigger_type", "trigger_day", "offset_minutes",
            "stuck_step", "button_key", "segment", "segment_day", "segment_minute", "required", "status", "sort"]
TIMING = {"trigger_type", "trigger_day", "offset_minutes", "required", "status", "stuck_step"}


class ChainIn(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    kind: str = "text"
    text: str = ""
    media_ids: list[int] = []
    buttons: list[list[dict]] = []
    trigger_type: str
    trigger_day: int | None = None
    offset_minutes: int = 0
    stuck_step: str | None = None
    button_key: str | None = None
    segment: str = "all"
    segment_day: int | None = None
    segment_minute: int | None = None
    required: bool = False
    status: str = "active"
    sort: int = 0
    flow_node_id: int | None = None


def validate(body: ChainIn, node_type: str | None = None) -> None:
    """node_type: sxemadagi blok turi (message | chain) yoki None — oddiy zanjir xabari."""
    errors = []
    if node_type == "message" and body.trigger_type != "flow":
        errors.append("Sxemadagi xabar bloki vaqtni o'zi belgilamaydi")
    if node_type == "chain" and body.trigger_type not in CHAIN_ITEM_TRIGGERS:
        errors.append("Zanjirdagi xabarga vaqt tanlang (zanjirga kirgach, kun oldidan, boshlanishida, tugagach, deadline)")
    if node_type is None and body.trigger_type == "flow":
        errors.append("Bu turdagi xabar faqat sxemada bo'ladi")
    if node_type != "message" and next_buttons(body.buttons):
        errors.append("«Keyingi blok» tugmasi faqat sxemadagi «Xabar» blokida ishlaydi")
    if body.kind not in KINDS:
        errors.append("Noto'g'ri xabar turi")
    if body.trigger_type not in TRIGGERS:
        errors.append("Noto'g'ri trigger")
    if body.trigger_type in DAY_TRIGGERS and body.trigger_day not in (1, 2):
        errors.append("Kun (1 yoki 2) tanlanmagan")
    if body.trigger_type == "stuck" and body.stuck_step not in STUCK_STEPS:
        errors.append("To'xtab qolish qadami tanlanmagan")
    if body.trigger_type == "on_button" and not body.button_key:
        errors.append("Tugma kaliti kiritilmagan")
    if body.segment not in SEGMENTS:
        errors.append("Noto'g'ri segment")
    if body.segment in WATCH_SEGMENTS and (body.segment_day or body.trigger_day) not in (1, 2):
        errors.append("Qaysi kun videosi ekanini tanlang")
    if body.segment in MINUTE_SEGMENTS and not (body.segment_minute and body.segment_minute > 0):
        errors.append("Videoning daqiqasini kiriting")
    if body.offset_minutes < 0:
        errors.append("Vaqt manfiy bo'lishi mumkin emas")
    if body.status not in ("active", "draft"):
        errors.append("Holat: active yoki draft")
    if body.kind == "album" and body.buttons:
        errors.append("Albomga tugma qo'shib bo'lmaydi — tugmalarni keyingi xabarga qo'ying")
    errors += validate_message(body.kind, body.text, len(body.media_ids), body.buttons)
    if errors:
        raise HTTPException(400, "; ".join(errors))


async def stats_for(db: AsyncSession, funnel_id: int) -> dict[int, dict]:
    sent = dict((await db.execute(
        select(ScheduledMessage.chain_message_id, func.count())
        .join(ChainMessage, ChainMessage.id == ScheduledMessage.chain_message_id)
        .where(ChainMessage.funnel_id == funnel_id, ScheduledMessage.status == "sent")
        .group_by(ScheduledMessage.chain_message_id))).all())
    clicks = dict((await db.execute(text("""
        SELECT (e.data->>'chain_message_id')::int, count(*) FROM lead_events e
        JOIN leads l ON l.id = e.lead_id
        WHERE e.type = 'button_click' AND l.funnel_id = :f GROUP BY 1"""), {"f": funnel_id})).all())
    blocked = dict((await db.execute(text("""
        SELECT sm.chain_message_id, count(*) FROM lead_events e
        JOIN leads l ON l.id = e.lead_id
        JOIN LATERAL (
            SELECT s.chain_message_id FROM scheduled_messages s
            WHERE s.lead_id = e.lead_id AND s.status = 'sent' AND s.sent_at <= e.at
            ORDER BY s.sent_at DESC LIMIT 1) sm ON true
        WHERE e.type = 'blocked' AND l.funnel_id = :f AND sm.chain_message_id IS NOT NULL
        GROUP BY 1"""), {"f": funnel_id})).all())
    return {mid: {"sent": sent.get(mid, 0), "clicks": clicks.get(mid, 0), "blocked_after": blocked.get(mid, 0)}
            for mid in set(sent) | set(clicks) | set(blocked)}


def out(m: ChainMessage, stats: dict | None = None) -> dict:
    d = {k: getattr(m, k) for k in ["id", "flow_node_id"] + EDITABLE}
    d.update(updated_at=iso(m.updated_at), updated_by=m.updated_by,
             stats=stats or {"sent": 0, "clicks": 0, "blocked_after": 0},
             warnings=honesty_warnings(m.text) + honesty_warnings(m.title))
    return d


@router.get("/funnels/{fid}/chain")
async def chain(fid: int, db: AsyncSession = Depends(get_db), _=Depends(CONTENT)):
    rows = (await db.execute(select(ChainMessage).where(ChainMessage.funnel_id == fid,
                                                        ChainMessage.flow_node_id.is_(None))
                             .order_by(ChainMessage.sort, ChainMessage.id))).scalars().all()
    st = await stats_for(db, fid)
    return [out(m, st.get(m.id)) for m in rows]


async def flow_node_of(db: AsyncSession, fid: int, node_id: int | None) -> FlowNode | None:
    if node_id is None:
        return None
    node = await db.get(FlowNode, node_id)
    flow = await db.get(Flow, node.flow_id) if node else None
    if not flow or flow.funnel_id != fid or node.type not in ("message", "chain"):
        raise HTTPException(400, "Sxema bloki topilmadi")
    return node


async def replan(db: AsyncSession, m: ChainMessage) -> None:
    if m.flow_node_id:
        await flow_engine.replan_node(db, m.flow_node_id)
    else:
        await replan_message(db, m)


@router.post("/funnels/{fid}/chain")
async def create(fid: int, body: ChainIn, db: AsyncSession = Depends(get_db), me: AdminUser = Depends(CONTENT)):
    await funnel_or_404(db, fid)
    node = await flow_node_of(db, fid, body.flow_node_id)
    if node and node.type == "message":
        raise HTTPException(400, "«Xabar» blokida bitta xabar bo'ladi — uni tahrirlang")
    validate(body, node.type if node else None)
    m = ChainMessage(funnel_id=fid, **{**body.model_dump(), "buttons": ensure_button_ids(body.buttons)},
                     updated_by=me.name)
    db.add(m)
    await db.flush()
    db.add(ChainHistory(message_id=m.id, user_name=me.name, changes={"created": [None, body.title]}))
    await replan(db, m)
    await db.commit()
    return out(m)


@router.put("/chain/{mid}")
async def update(mid: int, body: ChainIn, db: AsyncSession = Depends(get_db), me: AdminUser = Depends(CONTENT)):
    m = await db.get(ChainMessage, mid)
    if not m:
        raise HTTPException(404, "Xabar topilmadi")
    node = await db.get(FlowNode, m.flow_node_id) if m.flow_node_id else None
    validate(body, node.type if node else None)
    new = body.model_dump(exclude={"flow_node_id"})
    new["buttons"] = ensure_button_ids(new["buttons"])
    changes = {k: [getattr(m, k), v] for k, v in new.items() if getattr(m, k) != v}
    for k, v in new.items():
        setattr(m, k, v)
    if changes:
        m.updated_by = me.name
        m.updated_at = now_utc()
        db.add(ChainHistory(message_id=m.id, user_name=me.name, changes=changes))
    # matn o'zgarishi yuborish paytida o'qiladi; vaqt o'zgarsa — faqat yuborilmagan rejalar qayta hisoblanadi
    if TIMING & set(changes):
        await replan(db, m)
    if node and node.type == "message" and "buttons" in changes:
        await drop_stale_edges(db, node, m.buttons)
    await db.commit()
    return out(m)


async def drop_stale_edges(db: AsyncSession, node: FlowNode, buttons: list) -> None:
    """Xabardan tugma olib tashlansa — uning chizig'i ham o'chadi."""
    from app.api.admin.flows import prune_edges  # aylana importdan qochish
    await prune_edges(db, node, buttons)


@router.delete("/chain/{mid}")
async def remove(mid: int, db: AsyncSession = Depends(get_db), _=Depends(CONTENT)):
    m = await db.get(ChainMessage, mid)
    if m:
        await db.execute(ScheduledMessage.__table__.update()
                         .where(ScheduledMessage.chain_message_id == mid, ScheduledMessage.status == "pending")
                         .values(status="cancelled", reason="xabar o'chirildi"))
        await db.delete(m)
        await db.commit()
    return {"ok": True}


@router.post("/chain/{mid}/duplicate")
async def duplicate(mid: int, db: AsyncSession = Depends(get_db), me: AdminUser = Depends(CONTENT)):
    m = await db.get(ChainMessage, mid)
    if not m:
        raise HTTPException(404, "Xabar topilmadi")
    node = await db.get(FlowNode, m.flow_node_id) if m.flow_node_id else None
    if node and node.type == "message":
        raise HTTPException(400, "«Xabar» blokini sxemada nusxalang")
    copy = ChainMessage(funnel_id=m.funnel_id, **{k: getattr(m, k) for k in EDITABLE}, updated_by=me.name,
                        flow_node_id=m.flow_node_id)
    copy.title = f"{m.title} (nusxa)"
    copy.status = "draft"
    db.add(copy)
    await db.commit()
    return out(copy)


@router.post("/chain/{mid}/test")
async def test_send(mid: int, db: AsyncSession = Depends(get_db), me: AdminUser = Depends(CONTENT)):
    m = await db.get(ChainMessage, mid)
    if not m:
        raise HTTPException(404, "Xabar topilmadi")
    if not me.tg_user_id:
        raise HTTPException(400, "Sozlamalarda Telegram ID ingizni kiriting")
    media = []
    if m.media_ids:
        media = list((await db.execute(select(Media).where(Media.id.in_(m.media_ids)))).scalars())
    vars_ = variables(None, None, m.trigger_day)
    vars_.update(ism=me.name, efir_sanasi="23-oktabr, payshanba", efir_vaqti="20:00",
                 deadline=fmt_datetime(now_utc()))
    p = Payload(m.kind, m.text, media, m.buttons or [], m.trigger_day)
    try:
        await send_payload(get_bot(), db, me.tg_user_id, p, "[TEST] " + fill(m.text, vars_) if m.text else "",
                           keyboard(m.buttons or []))
    except Exception as e:
        raise HTTPException(400, f"Yuborib bo'lmadi: {e}. Botga /start bosganmisiz?")
    return {"ok": True}


@router.get("/chain/{mid}/history")
async def history(mid: int, db: AsyncSession = Depends(get_db), _=Depends(CONTENT)):
    rows = (await db.execute(select(ChainHistory).where(ChainHistory.message_id == mid)
                             .order_by(ChainHistory.id.desc()))).scalars()
    return [{"at": iso(h.at), "user": h.user_name, "changes": h.changes} for h in rows]


class SimulateIn(BaseModel):
    registered_at: str
    day1_at: str


TRIGGER_LABEL = {
    "after_registration": "ro'yxatdan {o} keyin", "before_day": "{d}-kundan {o} oldin",
    "at_day_start": "{d}-kun boshlanishida +{o}", "after_day_end": "{d}-kun tugagach +{o}",
    "before_deadline": "deadline tugashidan {o} oldin", "left_live": "{d}-kun efiridan chiqib ketgach {o}",
    "on_button": "tugma bosilganda", "stuck": "to'xtab qolganda ({o})", "flow": "sxemada",
}


def segment_label(m: ChainMessage) -> str:
    label = SEGMENTS[m.segment]
    if m.segment in WATCH_SEGMENTS:
        label = f"{m.segment_day or m.trigger_day or 1}-kun: " + label.replace("X", str(m.segment_minute or "X"))
    return label


def fmt_offset(minutes: int) -> str:
    if minutes % 1440 == 0 and minutes:
        return f"{minutes // 1440} kun"
    if minutes % 60 == 0 and minutes:
        return f"{minutes // 60} soat"
    return f"{minutes} daq"


@router.post("/funnels/{fid}/chain/simulate")
async def simulate(fid: int, body: SimulateIn, db: AsyncSession = Depends(get_db), _=Depends(CONTENT)):
    f: Funnel = await funnel_or_404(db, fid)
    reg, day1 = parse_iso(body.registered_at), parse_iso(body.day1_at)
    if not reg or not day1 or day1 <= reg:
        raise HTTPException(400, "Ro'yxat vaqti 1-kundan oldin bo'lishi kerak")
    msgs = (await db.execute(select(ChainMessage).where(ChainMessage.funnel_id == fid,
                                                        ChainMessage.flow_node_id.is_(None),
                                                        ChainMessage.status == "active")
                             .order_by(ChainMessage.sort, ChainMessage.id))).scalars().all()
    by_id = {m.id: m for m in msgs}
    d2 = day2_for(day1)
    deadline = d2 + timedelta(seconds=f.day2_duration_sec) + timedelta(hours=f.deadline_hours)
    s = SessionTimes(reg, day1, d2, f.day1_duration_sec, f.day2_duration_sec, deadline)
    rows = []
    for p in plan_chain([chain_item(m) for m in msgs], s, reg, quiet_of(f)):
        m = by_id[p.item.id]
        reason = p.reason
        if p.send_at and m.segment != "all":
            reason = ((reason + "; ") if reason else "") + f"faqat: {segment_label(m)}"
        rows.append({
            "message_id": m.id, "title": m.title,
            "trigger": TRIGGER_LABEL[m.trigger_type].format(d=m.trigger_day, o=fmt_offset(m.offset_minutes)),
            "send_at": iso(p.send_at), "status": p.status, "reason": reason,
        })
    return rows
