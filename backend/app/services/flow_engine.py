"""Progrev sxemasini bajarish: hodisa → bo'lim boshlanadi → lid bloklar bo'ylab yuradi.

Telegram'ga bu yerdan to'g'ridan-to'g'ri hech narsa yuborilmaydi: xabarlar va "yangi vaqt tanlash" kabi amallar
scheduled_messages navbatiga qo'yiladi (tezlik chegarasi, 429/403 ishlovi worker'da).

Lid voqealari (lead_events) worker tomonidan ketma-ket o'qiladi (flow_done=false) — shuning uchun bot va API
kodiga sxema haqida bilish shart emas.
"""
import logging
from datetime import datetime, timedelta

from sqlalchemy import exists, func, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import SessionLocal
from app.domain import flow_rules as R
from app.models import (
    ChainMessage, ContactLog, Flow, FlowChainEntry, FlowEdge, FlowNode, FlowRun, FlowVisit, Funnel, Lead,
    LeadEvent, LeadSession, Payment, Question, ScheduledMessage,
)
from app.services.leads import active_session, event, quiet_of, snapshot
from app.services.sessions import chain_item, dedupe_key, make_cold, session_times
from app.timeutil import in_quiet_hours, now_utc, shift_out_of_quiet

log = logging.getLogger(__name__)

MAX_STEPS = 60          # kutishsiz shuncha blokdan o'tsa — cheksiz halqa deb to'xtatiladi
LIVE = ("active", "waiting")
TIMEOUT_PORT = {"button": "timeout", "time": "next", "chain": "next", "event": "expired"}


# ─────────────────────────── yordamchilar ───────────────────────────

async def node_messages(db: AsyncSession, node_id: int) -> list[ChainMessage]:
    return list((await db.execute(select(ChainMessage).where(ChainMessage.flow_node_id == node_id)
                                  .order_by(ChainMessage.sort, ChainMessage.id))).scalars().all())


def _ctx_set(run: FlowRun, **kw) -> None:
    c = dict(run.ctx or {})
    c.update(kw)
    run.ctx = c


def _shift_quiet(t: datetime, f: Funnel) -> datetime:
    q = quiet_of(f)
    return shift_out_of_quiet(t, q.start, q.end) if in_quiet_hours(t, q.start, q.end) else t


async def _visit_open(db: AsyncSession, run: FlowRun, node: FlowNode, now: datetime) -> None:
    db.add(FlowVisit(run_id=run.id, lead_id=run.lead_id, node_id=node.id, entered_at=now))
    await db.flush()


async def _visit_close(db: AsyncSession, run: FlowRun, port: str | None, now: datetime) -> None:
    await db.execute(update(FlowVisit).where(FlowVisit.run_id == run.id, FlowVisit.left_at.is_(None))
                     .values(port=port, left_at=now))


async def _cancel_pending(db: AsyncSession, run: FlowRun, reason: str) -> None:
    await db.execute(update(ScheduledMessage)
                     .where(ScheduledMessage.flow_run_id == run.id, ScheduledMessage.status == "pending")
                     .values(status="cancelled", reason=reason[:200]))
    await db.execute(update(FlowChainEntry).where(FlowChainEntry.run_id == run.id).values(active=False))


async def finish(db: AsyncSession, run: FlowRun, status: str, reason: str, now: datetime) -> None:
    await _visit_close(db, run, None, now)
    run.status = status
    run.ended_reason = reason[:200]
    run.waiting_for = None
    run.wait_event = None
    run.wait_until = None
    run.updated_at = now


async def stop_run(db: AsyncSession, run: FlowRun, reason: str, now: datetime) -> None:
    """Lid bu yo'ldan chiqadi: rejalashtirilgan, hali yuborilmagan xabarlari bekor qilinadi."""
    await _cancel_pending(db, run, reason)
    await finish(db, run, "stopped", reason, now)


async def stop_runs(db: AsyncSession, lead_id: int, flow_id: int, reason: str, now: datetime,
                    except_run_id: int | None = None) -> None:
    runs = (await db.execute(select(FlowRun).where(
        FlowRun.lead_id == lead_id, FlowRun.flow_id == flow_id, FlowRun.status.in_(LIVE))
        .with_for_update())).scalars().all()
    for r in runs:
        if r.id != except_run_id:
            await stop_run(db, r, reason, now)


# ─────────────────────────── boshlash va yurish ───────────────────────────

async def start_flow(db: AsyncSession, lead: Lead, start: FlowNode, now: datetime, ctx: dict | None = None
                     ) -> FlowRun | None:
    flow = await db.get(Flow, start.flow_id)
    if flow is None or flow.status != "active":
        return None
    await stop_runs(db, lead.id, flow.id, "bo'lim qaytadan boshlandi", now)
    s = await active_session(db, lead.id)
    run = FlowRun(lead_id=lead.id, flow_id=flow.id, node_id=start.id, status="active", ctx=dict(ctx or {}),
                  session_id=s.id if s else None, started_at=now, updated_at=now)
    db.add(run)
    await db.flush()
    await _visit_open(db, run, start, now)
    await advance(db, run, "next", now)
    return run


async def advance(db: AsyncSession, run: FlowRun, port: str, now: datetime) -> None:
    """Lid joriy blokdan `port` chiqishi orqali keyingi blokka o'tadi."""
    await _visit_close(db, run, port, now)
    edge = (await db.execute(select(FlowEdge).where(
        FlowEdge.from_node_id == run.node_id, FlowEdge.from_port == port))).scalar_one_or_none() \
        if run.node_id else None
    if edge is None:
        await finish(db, run, "done", "yo'l tugadi", now)
        return
    await _enter(db, run, await db.get(FlowNode, edge.to_node_id), edge.to_item or 0, now)


async def _enter(db: AsyncSession, run: FlowRun, node: FlowNode | None, item: int, now: datetime) -> None:
    lead = await db.get(Lead, run.lead_id)
    steps = 0
    while True:
        steps += 1
        if steps > MAX_STEPS:
            await stop_run(db, run, "cheksiz aylanish: halqada kutish bloki yo'q", now)
            return
        if node is None:
            await finish(db, run, "stopped", "blok o'chirilgan", now)
            return
        flow = await db.get(Flow, node.flow_id)
        if flow.status != "active":
            await finish(db, run, "stopped", f"«{flow.name}» bo'limi qoralamada", now)
            return
        if run.flow_id != node.flow_id:
            # boshqa bo'limga o'tdi: u yerdagi eski yo'li to'xtaydi
            await stop_runs(db, lead.id, node.flow_id, "boshqa bo'limdan o'tib kelindi", now, except_run_id=run.id)
            run.flow_id = node.flow_id
        run.node_id = node.id
        run.status = "active"
        run.waiting_for = run.wait_event = None
        run.wait_until = None
        run.updated_at = now
        visits = dict((run.ctx or {}).get("visits", {}))
        visits[str(node.id)] = visits.get(str(node.id), 0) + 1
        _ctx_set(run, visits=visits)
        await _visit_open(db, run, node, now)

        res = await _execute(db, run, lead, node, item, now, visits[str(node.id)])
        if res is None:
            return
        kind, value, item = res
        if kind == "goto":
            await _visit_close(db, run, "goto", now)
            node = value
            continue
        await _visit_close(db, run, value, now)
        edge = (await db.execute(select(FlowEdge).where(
            FlowEdge.from_node_id == node.id, FlowEdge.from_port == value))).scalar_one_or_none()
        if edge is None:
            await finish(db, run, "done", "yo'l tugadi", now)
            return
        node = await db.get(FlowNode, edge.to_node_id)
        item = edge.to_item or 0


def _port(p: str):
    return "port", p, 0


async def _execute(db: AsyncSession, run: FlowRun, lead: Lead, node: FlowNode, item: int, now: datetime,
                   visit: int):
    """Blokni bajaradi. Qaytaradi: ("port", p, 0) — darhol davom; ("goto", node, item); None — kutadi/tugadi."""
    cfg = node.config or {}
    f = await db.get(Funnel, lead.funnel_id)
    match node.type:
        case "start":
            return _port("next")

        case "message":
            msgs = await node_messages(db, node.id)
            m = msgs[0] if msgs else None
            ports = R.ports("message", cfg, m.buttons if m else [])
            skip = (run.ctx or {}).get("skip_next")
            if skip:
                _ctx_set(run, skip_next=False)
            if m is None or m.status != "active" or skip:
                for p in ("next", "timeout"):
                    if p in ports:
                        return _port(p)
                await finish(db, run, "done", "xabar o'tkazib yuborildi", now)
                return None
            send_at = _shift_quiet(now, f)
            await db.execute(insert(ScheduledMessage).values(
                lead_id=lead.id, chain_message_id=m.id, flow_run_id=run.id, flow_node_id=node.id,
                dedupe_key=f"r{run.id}:n{node.id}:v{visit}", send_at=send_at, status="pending",
            ).on_conflict_do_nothing())
            if "next" in ports:
                return _port("next")
            run.status, run.waiting_for = "waiting", "button"
            t = cfg.get("timeout_minutes")
            run.wait_until = send_at + timedelta(minutes=t) if t else None
            return None

        case "wait":
            if cfg.get("mode") == "event":
                run.status, run.waiting_for, run.wait_event = "waiting", "event", cfg.get("event")
                run.wait_until = now + timedelta(minutes=cfg.get("max_minutes") or 60)
                _ctx_set(run, wait_from=now.isoformat())
                return None
            t, late = R.wait_target(cfg, now, now, await _anchors(db, lead, f), quiet_of(f))
            if late and cfg.get("late") != "send":
                _ctx_set(run, skip_next=True)
            if t <= now:
                return _port("next")
            run.status, run.waiting_for, run.wait_until = "waiting", "time", t
            _ctx_set(run, wait_from=now.isoformat())
            return None

        case "condition":
            return _port(await evaluate(db, lead, cfg, now))

        case "action":
            await _action(db, run, lead, node, cfg, now, visit, f)
            return _port("next")

        case "goto":
            target = await db.get(FlowNode, cfg.get("target_node_id")) if cfg.get("target_node_id") else None
            tf = await db.get(Flow, target.flow_id) if target else None
            if target is None or tf.funnel_id != f.id or target.type in ("start", "note"):
                await finish(db, run, "stopped", "o'tish manzili topilmadi", now)
                return None
            return "goto", target, cfg.get("item") or 0

        case "chain":
            s = await active_session(db, lead.id)
            earlier = (await db.execute(select(func.count()).select_from(FlowChainEntry).where(
                FlowChainEntry.lead_id == lead.id, FlowChainEntry.node_id == node.id,
                FlowChainEntry.session_id == s.id if s else FlowChainEntry.session_id.is_(None)))).scalar()
            entry = FlowChainEntry(run_id=run.id, lead_id=lead.id, node_id=node.id, start_index=max(0, item),
                                   entered_at=now, session_id=s.id if s else None, active=True)
            db.add(entry)
            await db.flush()
            # shu sessiyada qayta kirildi (masalan, halqa) — xabarlar qayta yuboriladi
            entry.key_suffix = f":e{entry.id}" if earlier else ""
            last = await plan_entry(db, lead, entry, now, s, f)
            if last is None or last <= now:
                return _port("next")
            run.status, run.waiting_for, run.wait_until = "waiting", "chain", last + timedelta(minutes=1)
            return None

        case "stop":
            if cfg.get("tag"):
                _tag(lead, cfg["tag"], True)
            await finish(db, run, "done", "to'xtatish bloki", now)
            return None

    await finish(db, run, "stopped", f"bajarilmaydigan blok: {node.type}", now)
    return None


async def _anchors(db: AsyncSession, lead: Lead, f: Funnel) -> R.Anchors:
    s = await active_session(db, lead.id)
    return R.anchors_of(session_times(lead, s, f) if s else None, f.day2_offer_sec)


def _tag(lead: Lead, tag: str, on: bool) -> None:
    tags = set(lead.tags or [])
    (tags.add if on else tags.discard)(tag)
    lead.tags = sorted(tags)


async def _action(db: AsyncSession, run: FlowRun, lead: Lead, node: FlowNode, cfg: dict, now: datetime,
                  visit: int, f: Funnel) -> None:
    a = cfg.get("action")
    if a in ("reschedule", "ask"):
        # Telegram'ga worker yuboradi (navbat orqali)
        await db.execute(insert(ScheduledMessage).values(
            lead_id=lead.id, flow_run_id=run.id, flow_node_id=node.id, dedupe_key=f"r{run.id}:n{node.id}:v{visit}",
            send_at=_shift_quiet(now, f), status="pending",
        ).on_conflict_do_nothing())
    elif a in ("tag_add", "tag_remove"):
        _tag(lead, cfg.get("value") or "", a == "tag_add")
    elif a == "cold":
        if not lead.cold:
            await make_cold(db, lead, now)
    elif a == "manager_task":
        db.add(ContactLog(lead_id=lead.id, manager_name="Sxema", result="callback", callback_at=now,
                          note=cfg.get("value") or node.title or "Sxemadan vazifa"))
    event(db, lead, "flow_action", action=a, value=cfg.get("value"), node=node.title)


async def evaluate(db: AsyncSession, lead: Lead, cfg: dict, now: datetime) -> str:
    check = cfg.get("check")
    yn = lambda b: "yes" if b else "no"  # noqa: E731
    if check in ("watch", "joined"):
        w = (await snapshot(db, lead)).watch.get(cfg.get("day") or 1)
        joined, pos = (w.joined, w.max_position_sec) if w else (False, 0)
        return R.watch_branch(cfg.get("branches", []), joined, pos) if check == "watch" else yn(joined)
    if check == "reached_offer":
        return yn(lead.reached_offer_at is not None)
    if check == "wrote_admin":
        since = now - timedelta(minutes=cfg.get("minutes") or 120)
        return yn((await db.execute(select(exists().where(
            Question.lead_id == lead.id, Question.created_at >= since)))).scalar())
    if check == "clicked_buy":
        return yn(lead.clicked_buy_at is not None)
    if check == "receipt":
        return yn((await db.execute(select(exists().where(
            Payment.lead_id == lead.id, Payment.status.in_(("pending", "approved")))))).scalar())
    if check == "payment":
        return lead.payment_status if lead.payment_status in R.PAYMENT_PORTS else "none"
    if check == "tag":
        return yn(cfg.get("value") in (lead.tags or []))
    if check == "source":
        return yn((lead.source or "") == cfg.get("value"))
    return "no"


async def plan_entry(db: AsyncSession, lead: Lead, entry: FlowChainEntry, now: datetime,
                     s: LeadSession | None = None, f: Funnel | None = None, revive: bool = True) -> datetime | None:
    """Zanjir xabarlarini (start_index dan) shu lid uchun rejalashtiradi. Yuborilganlar qayta yuborilmaydi.
    Kalitlar oddiy zanjirnikiday — shuning uchun "Kunlar bo'yicha"dan ko'chirilgan xabarlar takrorlanmaydi.
    revive=False — bekor qilingan rejalar (masalan, "1-kunni ko'rmadi") qayta tiklanmaydi."""
    f = f or await db.get(Funnel, lead.funnel_id)
    if s is None and entry.session_id:
        s = await db.get(LeadSession, entry.session_id)
    msgs = (await node_messages(db, entry.node_id))[entry.start_index:]
    msgs = [m for m in msgs if m.status == "active"]
    times = session_times(lead, s, f) if s else None
    last = None
    for p in R.plan_items([chain_item(m) for m in msgs], times, entry.entered_at, now, quiet_of(f)):
        if p.session_bound and s is None:
            continue
        key = dedupe_key(p.item.id, s.id if s else 0, p.session_bound) + (entry.key_suffix or "")
        if p.send_at is None:
            await db.execute(update(ScheduledMessage).where(
                ScheduledMessage.lead_id == lead.id, ScheduledMessage.dedupe_key == key,
                ScheduledMessage.status == "pending").values(status="cancelled", reason=p.reason))
            continue
        stmt = insert(ScheduledMessage).values(
            lead_id=lead.id, chain_message_id=p.item.id, flow_run_id=entry.run_id, flow_node_id=entry.node_id,
            session_id=s.id if p.session_bound and s else None, dedupe_key=key, session_bound=p.session_bound,
            send_at=p.send_at, status="pending",
        )
        await db.execute(stmt.on_conflict_do_update(
            index_elements=["lead_id", "dedupe_key"],
            set_={"send_at": stmt.excluded.send_at, "status": "pending", "reason": None,
                  "flow_run_id": stmt.excluded.flow_run_id, "flow_node_id": stmt.excluded.flow_node_id},
            where=ScheduledMessage.status.in_(("pending", "cancelled") if revive else ("pending",)),
        ))
        last = p.send_at if last is None else max(last, p.send_at)
    return last


# ─────────────────────────── hodisalar ───────────────────────────

async def handle_event(db: AsyncSession, e: LeadEvent, now: datetime) -> None:
    lead = await db.get(Lead, e.lead_id)
    if lead is None:
        return
    data = e.data or {}
    if e.type in ("session_changed", "session_chosen") or e.type == "rescheduled":
        await replan_lead(db, lead, now)
    if e.type == "returned":
        await _stop_left_live(db, lead, data.get("day"), now)
    mapped = R.map_event(e.type, data)
    if mapped is None:
        return
    ev, day = mapped
    await _resume_event_waits(db, lead, ev, e.at or now, now)
    if lead.blocked or lead.unsubscribed:
        return
    starts = (await db.execute(
        select(FlowNode).join(Flow, Flow.id == FlowNode.flow_id)
        .where(Flow.funnel_id == lead.funnel_id, Flow.status == "active", FlowNode.type == "start")
        .order_by(Flow.sort, Flow.id, FlowNode.id))).scalars().all()
    started: set[int] = set()
    for node in starts:
        cfg = node.config or {}
        if cfg.get("event") != ev or node.flow_id in started:
            continue
        if ev in R.DAY_EVENTS and cfg.get("day") not in (None, day):
            continue
        started.add(node.flow_id)
        await start_flow(db, lead, node, now, {"start_event": ev, "start_day": day, "event_id": e.id})


async def _resume_event_waits(db: AsyncSession, lead: Lead, ev: str, at: datetime, now: datetime) -> None:
    runs = (await db.execute(select(FlowRun).where(
        FlowRun.lead_id == lead.id, FlowRun.status == "waiting", FlowRun.waiting_for == "event",
        FlowRun.wait_event == ev).with_for_update())).scalars().all()
    for run in runs:
        since = (run.ctx or {}).get("wait_from")
        if since and datetime.fromisoformat(since) > at:
            continue
        await advance(db, run, "done", now)


async def _stop_left_live(db: AsyncSession, lead: Lead, day: int | None, now: datetime) -> None:
    """Lid efirga qaytdi — "efirdan chiqib ketdi" bilan boshlangan yo'llar to'xtaydi."""
    runs = (await db.execute(select(FlowRun).where(
        FlowRun.lead_id == lead.id, FlowRun.status.in_(LIVE)).with_for_update())).scalars().all()
    for run in runs:
        c = run.ctx or {}
        if c.get("start_event") == "left_live" and (day is None or c.get("start_day") in (None, day)):
            await stop_run(db, run, "efirga qaytdi", now)


async def replan_lead(db: AsyncSession, lead: Lead, now: datetime) -> None:
    """Efir vaqti o'zgardi: zanjirlardagi xabarlar va webinar vaqtiga bog'langan kutishlar qayta hisoblanadi."""
    s = await active_session(db, lead.id)
    f = await db.get(Funnel, lead.funnel_id)
    if s:
        entries = (await db.execute(select(FlowChainEntry).where(
            FlowChainEntry.lead_id == lead.id, FlowChainEntry.active.is_(True),
            FlowChainEntry.session_id == s.id))).scalars().all()
        for entry in entries:
            last = await plan_entry(db, lead, entry, now, s, f)
            run = await db.get(FlowRun, entry.run_id)
            if run and run.status == "waiting" and run.waiting_for == "chain" and run.node_id == entry.node_id:
                run.wait_until = last + timedelta(minutes=1) if last and last > now else now
    runs = (await db.execute(select(FlowRun).where(
        FlowRun.lead_id == lead.id, FlowRun.status == "waiting", FlowRun.waiting_for == "time"))).scalars().all()
    anchors = R.anchors_of(session_times(lead, s, f) if s else None, f.day2_offer_sec)
    for run in runs:
        node = await db.get(FlowNode, run.node_id) if run.node_id else None
        if node and node.type == "wait" and (node.config or {}).get("mode") == "anchor":
            t, _ = R.wait_target(node.config, now, now, anchors, quiet_of(f))
            run.wait_until = t


async def process_events(limit: int = 300) -> int:
    """Worker: yangi lid voqealarini sxemaga uzatadi."""
    now = now_utc()
    async with SessionLocal() as db:
        rows = (await db.execute(select(LeadEvent).where(LeadEvent.flow_done.is_(False))
                                 .order_by(LeadEvent.id).limit(limit).with_for_update(skip_locked=True))
                ).scalars().all()
        for e in rows:
            e.flow_done = True
            try:
                async with db.begin_nested():
                    await handle_event(db, e, now)
            except Exception:
                log.exception("Sxema voqeani ishlay olmadi (event=%s)", e.id)
        await db.commit()
        return len(rows)


async def tick(now: datetime | None = None, limit: int = 300) -> int:
    """Worker: kutish vaqti tugagan lidlarni keyingi blokka o'tkazadi."""
    now = now or now_utc()
    async with SessionLocal() as db:
        ids = (await db.execute(select(FlowRun.id).where(
            FlowRun.status == "waiting", FlowRun.wait_until <= now).order_by(FlowRun.wait_until).limit(limit))
        ).scalars().all()
    for rid in ids:
        async with SessionLocal() as db:
            run = await db.get(FlowRun, rid, with_for_update=True)
            if not run or run.status != "waiting" or not run.wait_until or run.wait_until > now:
                continue
            try:
                await advance(db, run, TIMEOUT_PORT.get(run.waiting_for or "", "next"), now)
                await db.commit()
            except Exception:
                await db.rollback()
                log.exception("Sxema: lidni keyingi blokka o'tkazib bo'lmadi (run=%s)", rid)
    return len(ids)


# ─────────────────────────── tugmalar ───────────────────────────

async def on_button(db: AsyncSession, tg_user_id: int, sid: int, row: int, col: int,
                    now: datetime | None = None) -> str:
    """Xabardagi «keyingi blok» tugmasi bosildi. Qaytaradi: ok | old | inactive | invalid."""
    now = now or now_utc()
    sm = await db.get(ScheduledMessage, sid)
    if not sm or not sm.chain_message_id or not sm.flow_run_id:
        return "invalid"
    lead = await db.get(Lead, sm.lead_id)
    if lead is None or lead.tg_user_id != tg_user_id:
        return "invalid"
    msg = await db.get(ChainMessage, sm.chain_message_id)
    try:
        b = msg.buttons[row][col]
    except (IndexError, TypeError, AttributeError):
        return "invalid"
    if b.get("type") != "next" or not b.get("id") or not msg.flow_node_id:
        return "invalid"
    event(db, lead, "button_click", chain_message_id=msg.id, flow=True)
    run = await db.get(FlowRun, sm.flow_run_id, with_for_update=True)
    node = await db.get(FlowNode, msg.flow_node_id)
    if run is None or node is None or run.status == "stopped":
        return "inactive"
    clicks = list((run.ctx or {}).get("clicks", []))
    if sid in clicks:
        return "old"
    here = run.status == "waiting" and run.node_id == node.id
    if not here:
        # lid avvalroq boshqa yo'lga ketgan; zanjir xabarlarini kutayotgan bo'lsa — bu yo'lni buzmaymiz
        if run.status == "active" or (run.status == "waiting" and run.waiting_for == "chain"):
            return "inactive"
        await _visit_close(db, run, "boshqa tugma", now)
        if run.flow_id != node.flow_id:
            run.flow_id = node.flow_id
        await stop_runs(db, lead.id, node.flow_id, "eski xabardagi tugma bosildi", now, except_run_id=run.id)
        run.node_id = node.id
        run.status = "active"
        await _visit_open(db, run, node, now)
    _ctx_set(run, clicks=clicks[-50:] + [sid])
    await advance(db, run, f"b:{b['id']}", now)
    return "ok"


async def replan_node(db: AsyncSession, node_id: int, now: datetime | None = None) -> None:
    """Zanjir xabari qo'shildi yoki vaqti o'zgardi — shu zanjirga kirgan (efiri hali tugamagan) lidlar uchun."""
    now = now or now_utc()
    rows = (await db.execute(
        select(FlowChainEntry, Lead, LeadSession).join(Lead, Lead.id == FlowChainEntry.lead_id)
        .outerjoin(LeadSession, LeadSession.id == FlowChainEntry.session_id)
        .where(FlowChainEntry.node_id == node_id, FlowChainEntry.active.is_(True), Lead.blocked.is_(False),
               (LeadSession.day2_at >= now - timedelta(days=3))
               | (LeadSession.id.is_(None) & (FlowChainEntry.entered_at >= now - timedelta(days=7)))))).all()
    for entry, lead, s in rows:
        await plan_entry(db, lead, entry, now, s)


async def on_message_skipped(db: AsyncSession, sm: ScheduledMessage, reason: str) -> None:
    """Sxemadagi xabar lidga yuborilmadi (to'lagan, bloklagan ...) — shu yo'l to'xtaydi."""
    if not sm.flow_run_id:
        return
    run = await db.get(FlowRun, sm.flow_run_id, with_for_update=True)
    if run and run.status in LIVE:
        await stop_run(db, run, f"xabar yuborilmadi: {reason}", now_utc())
