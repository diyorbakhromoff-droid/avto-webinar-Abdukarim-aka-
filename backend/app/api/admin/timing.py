"""«Xabarlar vaqti»: zanjir xabarlari qachon ketishi, oraliqlar, navbatdagilar va bekor qilish.

Vaqt qoidasi xabarning o'zida (trigger + offset yoki aniq sana). Har bir lidning jadvali o'z ro'yxat va efir
vaqtidan hisoblanadi, shuning uchun bir lidning jadvali boshqasiga ta'sir qilmaydi. Barcha vaqtlar UTC da
saqlanadi, admin panelda Toshkent vaqtida ko'rsatiladi.
"""
import html
import logging
from collections import defaultdict, deque
from dataclasses import dataclass
from datetime import datetime, timedelta

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.admin.chain import ChainIn, fixed_of, fmt_offset, jsonable, segment_label, trigger_label, validate
from app.api.common import audit, funnel_or_404, iso, parse_iso
from app.db import get_db
from app.domain import slots
from app.domain.flow_rules import next_buttons, ports
from app.domain.planning import PlannedMessage, SessionTimes, plan_chain
from app.models import (
    AdminUser, Broadcast, ChainHistory, ChainMessage, Flow, FlowEdge, FlowNode, Funnel, Lead, LeadSession,
    ScheduledMessage,
)
from app.security.auth import ANY, CONTENT
from app.services import test_send as ts
from app.services.leads import active_session, quiet_of
from app.services.render import variables
from app.services.sessions import chain_item, replan_message
from app.timeutil import fmt_date, fmt_datetime, fmt_time, now_utc

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


@dataclass
class SamplePlan:
    reg: datetime
    day1: datetime
    day2: datetime
    deadline: datetime
    options: list[datetime]
    times: SessionTimes
    msgs: list[ChainMessage]
    plan: dict[int, PlannedMessage]


async def sample_plan(db: AsyncSession, f: Funnel, reg: datetime | None, day1: datetime | None) -> SamplePlan:
    """Namunaviy lid (ro'yxat vaqti + tanlagan efiri) uchun zanjirning aniq vaqtlari."""
    reg = reg or now_utc()
    options = slots.day1_options(slots.SlotConfig.from_funnel(f), reg)
    day1 = day1 or (options[0] if options else reg + timedelta(days=1))
    if day1 <= reg:
        raise HTTPException(400, "1-kun efiri ro'yxatdan keyin bo'lishi kerak")
    day2 = slots.day2_for(day1)
    deadline = day2 + timedelta(seconds=f.day2_duration_sec, hours=f.deadline_hours)
    msgs = await classic_messages(db, f.id)
    active = [m for m in msgs if m.status == "active"]
    times = SessionTimes(reg, day1, day2, f.day1_duration_sec, f.day2_duration_sec, deadline)
    plan = {p.item.id: p for p in plan_chain([chain_item(m) for m in active], times, reg, quiet_of(f))}
    return SamplePlan(reg, day1, day2, deadline, options, times, msgs, plan)


@router.get("/funnels/{fid}/timing")
async def timing(fid: int, registered_at: str | None = None, day1_at: str | None = None,
                 db: AsyncSession = Depends(get_db), _=Depends(CONTENT)):
    """Har bir xabar: vaqt qoidasi, namunaviy lid uchun aniq vaqti, navbatda kutayotganlar soni."""
    f = await funnel_or_404(db, fid)
    sp = await sample_plan(db, f, parse_iso(registered_at), parse_iso(day1_at))
    reg, day1, day2, deadline, options, times, msgs, plan = (
        sp.reg, sp.day1, sp.day2, sp.deadline, sp.options, sp.times, sp.msgs, sp.plan)
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


# ─────────────────────────── butun progrevni test chatiga ───────────────────────────

NODE_NAMES = {"start": "Boshlanish", "message": "Xabar", "wait": "Kutish", "condition": "Shart", "action": "Amal",
              "goto": "O'tish", "chain": "Zanjir"}
PORT_WORDS = {"next": "keyin", "timeout": "tugma bosilmasa", "done": "lid harakat qilsa", "expired": "kutish tugasa",
              "yes": "ha", "no": "yo'q", "else": "qolganlar", "none": "to'lamagan", "deposit": "boshlang'ich to'lagan",
              "full": "to'liq to'lagan"}


def _port_label(node: FlowNode, port: str, buttons: list) -> str:
    if port.startswith("b:"):
        b = next((x for x in next_buttons(buttons) if f"b:{x['id']}" == port), None)
        return f"«{b['text']}» tugmasi" if b else "tugma"
    branch = next((b for b in (node.config or {}).get("branches", []) if b.get("id") == port), None)
    return f"«{branch['label']}»" if branch else PORT_WORDS.get(port, port)


def _item(m: ChainMessage, when: str, vars_: dict) -> ts.SeqItem:
    return ts.SeqItem(m.title, when, segment_label(m) if not m.flow_node_id else "sxemaga kirgan lidlar",
                      m.kind, m.text, list(m.media_ids or []), m.buttons or [], vars_)


def chain_items(sp: SamplePlan, lead: Lead, s: LeadSession) -> list[ts.SeqItem]:
    """Kunlar bo'yicha zanjir: namuna lidga yuboriladigan vaqt tartibida, keyin lidning harakatiga bog'liqlari."""
    active = [m for m in sp.msgs if m.status == "active"]
    timed = sorted(((sp.plan[m.id].send_at, m) for m in active if m.id in sp.plan and sp.plan[m.id].send_at),
                   key=lambda x: (x[0], x[1].sort, x[1].id))
    items = [_item(m, f"{fmt_date(t)}, soat {fmt_time(t)} · {trigger_label(m)}", variables(lead, s, m.trigger_day, t))
             for t, m in timed]
    for m in active:
        p = sp.plan.get(m.id)
        if p is None or p.status == "event":
            items.append(_item(m, f"lidning harakatiga qarab · {trigger_label(m)}",
                               variables(lead, s, m.trigger_day, sp.day1)))
    for m in active:
        p = sp.plan.get(m.id)
        if p and p.status == "skipped":
            items.append(_item(m, f"bu namunada yuborilmaydi ({p.reason}) · {trigger_label(m)}",
                               variables(lead, s, m.trigger_day, sp.day1)))
    return items


async def flow_items(db: AsyncSession, f: Funnel, flow_id: int, lead: Lead, s: LeadSession) -> tuple[str, list]:
    """Sxema bo'limi: «Boshlanish» bloklaridan chiziqlar bo'ylab (tugma tartibida), har bir xabar qayerdan
    kelishi bilan."""
    flow = await db.get(Flow, flow_id)
    if not flow or flow.funnel_id != f.id:
        raise HTTPException(404, "Sxema bo'limi topilmadi")
    nodes = {n.id: n for n in (await db.execute(select(FlowNode).where(FlowNode.flow_id == flow.id))).scalars()}
    edges = (await db.execute(select(FlowEdge).where(FlowEdge.flow_id == flow.id))).scalars().all()
    msgs: dict[int, list[ChainMessage]] = defaultdict(list)
    if nodes:
        for m in (await db.execute(select(ChainMessage).where(ChainMessage.flow_node_id.in_(list(nodes)))
                                   .order_by(ChainMessage.sort, ChainMessage.id))).scalars():
            msgs[m.flow_node_id].append(m)
    out: dict[int, list[FlowEdge]] = defaultdict(list)
    for e in edges:
        out[e.from_node_id].append(e)
    name = lambda n: n.title or NODE_NAMES.get(n.type, n.type)  # noqa: E731
    by_pos = sorted(nodes.values(), key=lambda n: (n.y, n.x))
    queue = deque((n, "bo'lim boshlanishi") for n in by_pos if n.type == "start")
    seen: set[int] = set()
    items: list[ts.SeqItem] = []

    def add(n: FlowNode, via: str) -> None:
        if n.type == "message":
            for m in msgs.get(n.id, [])[:1]:
                items.append(_item(m, f"sxemada: {via}", variables(lead, s, None, s.day1_at)))
        elif n.type == "chain":
            for m in msgs.get(n.id, []):
                if m.status != "active":
                    continue
                rule = (f"zanjirga kirgach {fmt_offset(m.offset_minutes)}" if m.trigger_type == "after_registration"
                        else trigger_label(m))
                items.append(_item(m, f"sxemada: {via} · «{name(n)}» zanjiri: {rule}",
                                   variables(lead, s, m.trigger_day, s.day1_at)))

    while queue:
        n, via = queue.popleft()
        if n.id in seen:
            continue
        seen.add(n.id)
        add(n, via)
        buttons = msgs[n.id][0].buttons if n.type == "message" and msgs.get(n.id) else []
        order = {p: i for i, p in enumerate(ports(n.type, n.config or {}, buttons))}
        for e in sorted(out.get(n.id, []), key=lambda e: order.get(e.from_port, 99)):
            if e.to_node_id in nodes:
                queue.append((nodes[e.to_node_id], f"«{name(n)}» → {_port_label(n, e.from_port, buttons)}"))
    for n in by_pos:   # hech qayerdan ulanmagan bloklar — oxirida
        if n.id not in seen:
            add(n, "hech qaysi blokdan ulanmagan")
    return f"Sxema: «{flow.name}»", items


class ProgrevTestIn(BaseModel):
    target: str = "me"               # me | chat
    lead_id: int | None = None
    sample_name: str = ""
    registered_at: str | None = None
    day1_at: str | None = None
    flow_id: int | None = None       # berilsa — shu sxema bo'limi, aks holda kunlar bo'yicha zanjir


@router.post("/funnels/{fid}/test-progrev")
async def test_progrev(fid: int, body: ProgrevTestIn, tasks: BackgroundTasks, db: AsyncSession = Depends(get_db),
                       me: AdminUser = Depends(CONTENT)):
    """Butun progrevni (yoki sxema bo'limini) adminga / test chatiga ketma-ket yuboradi — lidlarga emas."""
    f = await funnel_or_404(db, fid)
    try:
        chat_id, target_label = await ts.resolve_target(db, me, body.target)
    except ts.TestSendError as e:
        raise HTTPException(400, str(e)) from None
    if ts.is_running(chat_id):
        raise HTTPException(409, "Oldingi test hali yuborilmoqda — tugashini kuting")
    reg, day1 = parse_iso(body.registered_at), parse_iso(body.day1_at)
    if body.lead_id:
        if me.role not in ("super_admin", "sales"):
            raise HTTPException(403, "Haqiqiy lid ma'lumoti bilan test faqat sotuv bo'limi va super admin uchun")
        lead = await db.get(Lead, body.lead_id)
        if not lead or lead.funnel_id != f.id:
            raise HTTPException(404, "Lid topilmadi")
        s = await active_session(db, lead.id)
        if s:
            reg, day1 = lead.phone_at or lead.created_at, s.day1_at
        source = f"lid: {lead.first_name or '—'} (#{lead.id})"
    sp = await sample_plan(db, f, reg, day1)
    if not body.lead_id:
        lead = Lead(first_name=body.sample_name.strip() or ts.SAMPLE_NAME, deadline_at=sp.deadline)
        s = None
        source = "namunaviy ma'lumot"
    s = s or LeadSession(day1_at=sp.day1, day2_at=sp.day2)
    if body.flow_id:
        label, items = await flow_items(db, f, body.flow_id, lead, s)
    else:
        label, items = "Progrev zanjiri (kunlar bo'yicha)", chain_items(sp, lead, s)
    if not items:
        raise HTTPException(400, "Yuboriladigan faol xabar yo'q")
    try:
        chat_id = await ts.start_sequence(db, chat_id, label, len(items))
    except ts.TestSendError as e:
        raise HTTPException(400, str(e)) from None
    eta = ts.sequence_eta(chat_id, items)
    tasks.add_task(ts.run_sequence, chat_id, label, items, me.name)
    audit(db, me.name, "test_progrev", f"{label}: {len(items)} ta xabar → {target_label} ({source})")
    await db.commit()
    notes = [f"{len(items)} ta xabar ketma-ket yuborilmoqda — taxminan {max(1, round(eta / 60))} daqiqa. "
             f"Oxirida «✅ Tugadi» xabari keladi."]
    if chat_id < 0:
        notes.append("Telegram bitta guruhga daqiqasiga ~20 ta xabar yuborishga ruxsat beradi — shuning uchun "
                     "xabarlar orasida ~3 soniya.")
        if any(b.get("type") == "webapp" for it in items for row in it.buttons for b in row):
            notes.append("Guruhda Mini App tugmasi ochilmaydi — bosilganda izoh chiqadi.")
    now = now_utc()
    return {"ok": True, "target": target_label, "sent_at": iso(now), "sent_at_label": fmt_datetime(now),
            "variables": {k: html.unescape(v) for k, v in items[0].variables.items()}, "data_source": source,
            "notes": notes,
            "count": len(items), "eta_sec": eta}
