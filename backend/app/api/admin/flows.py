"""Progrev sxemasi: bo'limlar, bloklar, chiziqlar, statistika, namuna va "Kunlar bo'yicha"dan ko'chirish."""
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.admin.chain import CHAIN_ITEM_TRIGGERS, out as message_out, stats_for
from app.api.common import audit, funnel_or_404, iso
from app.db import get_db
from app.domain import flow_rules as R
from app.models import (
    AdminUser, ChainMessage, Flow, FlowChainEntry, FlowEdge, FlowNode, FlowRun, FlowVisit, Funnel, Lead,
    LeadSession,
)
from app.security.auth import CONTENT
from app.services import flow_engine
from app.timeutil import now_utc

router = APIRouter(prefix="/api/admin", tags=["admin"])

PHASES = {
    "reg": "Ro'yxatdan keyin", "day1": "1-kun eslatmalari", "between": "Kunlar orasi",
    "day2": "2-kun zanjiri", "after": "2-kundan keyin",
}
NODE_TITLES = {
    "start": "Boshlanish", "message": "Yangi xabar", "wait": "Kutish", "condition": "Shart", "action": "Amal",
    "goto": "O'tish", "chain": "Zanjir", "stop": "To'xtatish", "note": "Izoh",
}


# ─────────────────────────── chiqish formatlari ───────────────────────────

def flow_out(f: Flow, counts: dict | None = None) -> dict:
    c = counts or {}
    return {"id": f.id, "funnel_id": f.funnel_id, "name": f.name, "status": f.status, "sort": f.sort,
            "updated_at": iso(f.updated_at), "updated_by": f.updated_by,
            "nodes": c.get("nodes", 0), "active_leads": c.get("active", 0)}


def node_warnings(n: FlowNode, msgs: list[ChainMessage]) -> list[str]:
    cfg = n.config or {}
    w = []
    if n.type == "message":
        m = msgs[0] if msgs else None
        if m is None or (not (m.text or "").strip() and not m.media_ids):
            w.append("Xabar matni yo'q")
        elif m.status != "active":
            w.append("Xabar qoralamada — o'tkazib yuboriladi")
    if n.type == "chain" and not any(m.status == "active" for m in msgs):
        w.append("Zanjirda faol xabar yo'q")
    if n.type == "goto" and not cfg.get("target_node_id"):
        w.append("Qayerga o'tishi tanlanmagan")
    return w


def node_out(n: FlowNode, msgs: list[ChainMessage], stats: dict | None = None) -> dict:
    buttons = msgs[0].buttons if n.type == "message" and msgs else []
    return {"id": n.id, "flow_id": n.flow_id, "type": n.type, "title": n.title, "x": n.x, "y": n.y,
            "config": n.config or {}, "ports": R.ports(n.type, n.config or {}, buttons),
            "messages": [message_out(m, (stats or {}).get(m.id)) for m in msgs],
            "warnings": node_warnings(n, msgs)}


def edge_out(e: FlowEdge) -> dict:
    return {"id": e.id, "flow_id": e.flow_id, "from_node_id": e.from_node_id, "from_port": e.from_port,
            "to_node_id": e.to_node_id, "to_item": e.to_item}


async def _flow(db: AsyncSession, flow_id: int) -> Flow:
    f = await db.get(Flow, flow_id)
    if not f:
        raise HTTPException(404, "Bo'lim topilmadi")
    return f


async def _node(db: AsyncSession, node_id: int) -> tuple[FlowNode, Flow]:
    n = await db.get(FlowNode, node_id)
    if not n:
        raise HTTPException(404, "Blok topilmadi")
    return n, await db.get(Flow, n.flow_id)


async def _messages_by_node(db: AsyncSession, node_ids: list[int]) -> dict[int, list[ChainMessage]]:
    out: dict[int, list[ChainMessage]] = {i: [] for i in node_ids}
    if node_ids:
        rows = (await db.execute(select(ChainMessage).where(ChainMessage.flow_node_id.in_(node_ids))
                                 .order_by(ChainMessage.sort, ChainMessage.id))).scalars()
        for m in rows:
            out[m.flow_node_id].append(m)
    return out


def _touch(f: Flow, me: AdminUser) -> None:
    f.updated_at = now_utc()
    f.updated_by = me.name


# ─────────────────────────── bo'limlar ───────────────────────────

@router.get("/funnels/{fid}/flows")
async def flows(fid: int, db: AsyncSession = Depends(get_db), _=Depends(CONTENT)):
    rows = (await db.execute(select(Flow).where(Flow.funnel_id == fid).order_by(Flow.sort, Flow.id))).scalars().all()
    ids = [f.id for f in rows]
    nodes = dict((await db.execute(select(FlowNode.flow_id, func.count()).where(FlowNode.flow_id.in_(ids))
                                   .group_by(FlowNode.flow_id))).all()) if ids else {}
    active = dict((await db.execute(select(FlowRun.flow_id, func.count()).where(
        FlowRun.flow_id.in_(ids), FlowRun.status.in_(flow_engine.LIVE)).group_by(FlowRun.flow_id))).all()) \
        if ids else {}
    return [flow_out(f, {"nodes": nodes.get(f.id, 0), "active": active.get(f.id, 0)}) for f in rows]


class FlowIn(BaseModel):
    name: str = Field(min_length=1, max_length=100)


class FlowPatch(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=100)
    status: str | None = None
    sort: int | None = None


async def _new_flow(db: AsyncSession, fid: int, name: str, me: AdminUser, status: str = "draft") -> Flow:
    sort = (await db.execute(select(func.coalesce(func.max(Flow.sort), 0)).where(Flow.funnel_id == fid))).scalar()
    f = Flow(funnel_id=fid, name=name.strip(), status=status, sort=sort + 1, updated_by=me.name)
    db.add(f)
    await db.flush()
    return f


@router.post("/funnels/{fid}/flows")
async def create_flow(fid: int, body: FlowIn, db: AsyncSession = Depends(get_db), me: AdminUser = Depends(CONTENT)):
    await funnel_or_404(db, fid)
    f = await _new_flow(db, fid, body.name, me)
    db.add(FlowNode(flow_id=f.id, type="start", title="Boshlanish", x=40, y=160, config=R.default_config("start")))
    audit(db, me.name, "flow_created", body.name)
    await db.commit()
    return flow_out(f, {"nodes": 1})


@router.put("/flows/{flow_id}")
async def update_flow(flow_id: int, body: FlowPatch, db: AsyncSession = Depends(get_db),
                      me: AdminUser = Depends(CONTENT)):
    f = await _flow(db, flow_id)
    if body.status is not None and body.status not in ("active", "draft"):
        raise HTTPException(400, "Holat: active yoki draft")
    if body.name is not None:
        f.name = body.name.strip()
    if body.sort is not None:
        f.sort = body.sort
    if body.status is not None and body.status != f.status:
        if body.status == "active":
            starts = (await db.execute(select(func.count()).select_from(FlowNode).where(
                FlowNode.flow_id == f.id, FlowNode.type == "start"))).scalar()
            if not starts:
                raise HTTPException(400, "Bo'limda «Boshlanish» bloki yo'q — lidlar unga qanday kiradi?")
        else:
            await _stop_flow_runs(db, f.id, "bo'lim qoralamaga o'tkazildi")
        f.status = body.status
        audit(db, me.name, "flow_status", f"{f.name}: {body.status}")
    _touch(f, me)
    await db.commit()
    return flow_out(f)


async def _stop_flow_runs(db: AsyncSession, flow_id: int, reason: str, node_id: int | None = None) -> None:
    q = select(FlowRun).where(FlowRun.flow_id == flow_id, FlowRun.status.in_(flow_engine.LIVE))
    if node_id is not None:
        q = q.where(FlowRun.node_id == node_id)
    now = now_utc()
    for run in (await db.execute(q.with_for_update())).scalars().all():
        await flow_engine.stop_run(db, run, reason, now)


@router.delete("/flows/{flow_id}")
async def delete_flow(flow_id: int, db: AsyncSession = Depends(get_db), me: AdminUser = Depends(CONTENT)):
    f = await _flow(db, flow_id)
    await _stop_flow_runs(db, f.id, "bo'lim o'chirildi")
    audit(db, me.name, "flow_deleted", f.name)
    await db.delete(f)
    await db.commit()
    return {"ok": True}


# ─────────────────────────── sxema ───────────────────────────

@router.get("/flows/{flow_id}")
async def graph(flow_id: int, days: int = 7, db: AsyncSession = Depends(get_db), _=Depends(CONTENT)):
    f = await _flow(db, flow_id)
    nodes = (await db.execute(select(FlowNode).where(FlowNode.flow_id == f.id).order_by(FlowNode.id))).scalars().all()
    msgs = await _messages_by_node(db, [n.id for n in nodes])
    edges = (await db.execute(select(FlowEdge).where(FlowEdge.flow_id == f.id))).scalars().all()
    mstats = await stats_for(db, f.funnel_id)
    return {"flow": flow_out(f), "nodes": [node_out(n, msgs[n.id], mstats) for n in nodes],
            "edges": [edge_out(e) for e in edges], "stats": await node_stats(db, f.id, days), "days": days}


async def node_stats(db: AsyncSession, flow_id: int, days: int) -> dict[int, dict]:
    since = now_utc() - timedelta(days=max(1, min(days, 365)))
    rows = (await db.execute(
        select(FlowVisit.node_id, FlowVisit.port, func.count())
        .join(FlowNode, FlowNode.id == FlowVisit.node_id)
        .where(FlowNode.flow_id == flow_id, FlowVisit.entered_at >= since)
        .group_by(FlowVisit.node_id, FlowVisit.port))).all()
    here = dict((await db.execute(
        select(FlowRun.node_id, func.count()).where(FlowRun.flow_id == flow_id, FlowRun.status == "waiting")
        .group_by(FlowRun.node_id))).all())
    out: dict[int, dict] = {}
    for node_id, port, n in rows:
        s = out.setdefault(node_id, {"entered": 0, "here": here.get(node_id, 0), "ports": {}})
        s["entered"] += n
        if port:
            s["ports"][port] = s["ports"].get(port, 0) + n
    for node_id, n in here.items():
        if node_id is not None:
            out.setdefault(node_id, {"entered": 0, "here": n, "ports": {}})
    return out


class NodeIn(BaseModel):
    type: str
    x: int = 0
    y: int = 0
    title: str | None = None
    config: dict | None = None


def _norm(type_: str, cfg: dict | None) -> dict:
    try:
        return R.normalize_config(type_, cfg)
    except R.FlowConfigError as e:
        raise HTTPException(400, str(e)) from None


@router.post("/flows/{flow_id}/nodes")
async def create_node(flow_id: int, body: NodeIn, db: AsyncSession = Depends(get_db),
                      me: AdminUser = Depends(CONTENT)):
    f = await _flow(db, flow_id)
    if body.type not in R.NODE_TYPES:
        raise HTTPException(400, "Noto'g'ri blok turi")
    funnel = await db.get(Funnel, f.funnel_id)
    cfg = _norm(body.type, body.config if body.config is not None
                else R.default_config(body.type, funnel.day1_duration_sec // 60 or None))
    n = FlowNode(flow_id=f.id, type=body.type, title=(body.title or NODE_TITLES[body.type])[:200],
                 x=body.x, y=body.y, config=cfg)
    db.add(n)
    await db.flush()
    if body.type == "message":
        db.add(ChainMessage(funnel_id=f.funnel_id, flow_node_id=n.id, title=n.title, kind="text", text="",
                            trigger_type="flow", status="draft", updated_by=me.name))
    _touch(f, me)
    await db.commit()
    return node_out(n, (await _messages_by_node(db, [n.id]))[n.id])


class NodePatch(BaseModel):
    title: str | None = Field(None, max_length=200)
    x: int | None = None
    y: int | None = None
    config: dict | None = None


async def prune_edges(db: AsyncSession, node: FlowNode, buttons: list | None = None) -> None:
    """Blokda endi yo'q chiqishlarga ulangan chiziqlarni o'chiradi."""
    if buttons is None and node.type == "message":
        msgs = await flow_engine.node_messages(db, node.id)
        buttons = msgs[0].buttons if msgs else []
    ports = R.ports(node.type, node.config or {}, buttons or [])
    await db.execute(delete(FlowEdge).where(FlowEdge.from_node_id == node.id, FlowEdge.from_port.not_in(ports)))


@router.put("/flow-nodes/{node_id}")
async def update_node(node_id: int, body: NodePatch, db: AsyncSession = Depends(get_db),
                      me: AdminUser = Depends(CONTENT)):
    n, f = await _node(db, node_id)
    if body.title is not None:
        n.title = body.title.strip() or NODE_TITLES[n.type]
        if n.type == "message":
            for m in await flow_engine.node_messages(db, n.id):
                m.title = n.title
    if body.x is not None:
        n.x = body.x
    if body.y is not None:
        n.y = body.y
    if body.config is not None:
        cfg = _norm(n.type, body.config)
        if n.type == "goto" and cfg.get("target_node_id"):
            target = await db.get(FlowNode, cfg["target_node_id"])
            tf = await db.get(Flow, target.flow_id) if target else None
            if not tf or tf.funnel_id != f.funnel_id or target.type in ("start", "note") or target.id == n.id:
                raise HTTPException(400, "O'tish manzili noto'g'ri")
        n.config = cfg
        await prune_edges(db, n)
    n.updated_at = now_utc()
    if body.config is not None or body.title is not None:
        _touch(f, me)
    await db.commit()
    return node_out(n, (await _messages_by_node(db, [n.id]))[n.id])


@router.post("/flow-nodes/{node_id}/duplicate")
async def duplicate_node(node_id: int, db: AsyncSession = Depends(get_db), me: AdminUser = Depends(CONTENT)):
    n, f = await _node(db, node_id)
    copy = FlowNode(flow_id=n.flow_id, type=n.type, title=f"{n.title} (nusxa)"[:200], x=n.x + 40, y=n.y + 40,
                    config=dict(n.config or {}))
    db.add(copy)
    await db.flush()
    for m in await flow_engine.node_messages(db, n.id):
        db.add(ChainMessage(funnel_id=m.funnel_id, flow_node_id=copy.id, **{k: getattr(m, k) for k in (
            "kind", "text", "media_ids", "buttons", "trigger_type", "trigger_day", "offset_minutes", "segment",
            "segment_day", "segment_minute", "required", "sort")},
            title=copy.title if n.type == "message" else m.title, status="draft", updated_by=me.name))
    _touch(f, me)
    await db.commit()
    return node_out(copy, (await _messages_by_node(db, [copy.id]))[copy.id])


@router.delete("/flow-nodes/{node_id}")
async def delete_node(node_id: int, db: AsyncSession = Depends(get_db), me: AdminUser = Depends(CONTENT)):
    n, f = await _node(db, node_id)
    await _stop_flow_runs(db, f.id, "blok o'chirildi", node_id=n.id)
    await db.delete(n)
    _touch(f, me)
    await db.commit()
    return {"ok": True}


class EdgeIn(BaseModel):
    from_node_id: int
    from_port: str = Field(min_length=1, max_length=24)
    to_node_id: int
    to_item: int = 0


@router.post("/flows/{flow_id}/edges")
async def create_edge(flow_id: int, body: EdgeIn, db: AsyncSession = Depends(get_db),
                      me: AdminUser = Depends(CONTENT)):
    f = await _flow(db, flow_id)
    src, dst = await db.get(FlowNode, body.from_node_id), await db.get(FlowNode, body.to_node_id)
    if not src or not dst or src.flow_id != f.id or dst.flow_id != f.id:
        raise HTTPException(400, "Bloklar shu bo'limda emas — boshqa bo'limga «O'tish» bloki bilan o'ting")
    if dst.type in ("start", "note"):
        raise HTTPException(400, "Bu blokka chiziq ulab bo'lmaydi")
    msgs = await flow_engine.node_messages(db, src.id) if src.type in ("message", "chain") else []
    ports = R.ports(src.type, src.config or {}, msgs[0].buttons if src.type == "message" and msgs else [])
    if body.from_port not in ports:
        raise HTTPException(400, "Bu chiqish blokda yo'q")
    to_item = 0
    if dst.type == "chain":
        count = len(await flow_engine.node_messages(db, dst.id))
        to_item = max(0, min(body.to_item, max(count - 1, 0)))
    e = (await db.execute(select(FlowEdge).where(FlowEdge.from_node_id == src.id,
                                                 FlowEdge.from_port == body.from_port))).scalar_one_or_none()
    if e is None:
        e = FlowEdge(flow_id=f.id, from_node_id=src.id, from_port=body.from_port)
        db.add(e)
    e.to_node_id, e.to_item = dst.id, to_item
    _touch(f, me)
    await db.commit()
    return edge_out(e)


@router.delete("/flow-edges/{edge_id}")
async def delete_edge(edge_id: int, db: AsyncSession = Depends(get_db), me: AdminUser = Depends(CONTENT)):
    e = await db.get(FlowEdge, edge_id)
    if e:
        f = await db.get(Flow, e.flow_id)
        await db.delete(e)
        _touch(f, me)
        await db.commit()
    return {"ok": True}


@router.get("/funnels/{fid}/flow-targets")
async def targets(fid: int, db: AsyncSession = Depends(get_db), _=Depends(CONTENT)):
    """«O'tish» bloki uchun: barcha bo'limlardagi bloklar (zanjirlar — xabarlari bilan)."""
    rows = (await db.execute(select(FlowNode, Flow).join(Flow, Flow.id == FlowNode.flow_id)
                             .where(Flow.funnel_id == fid, FlowNode.type.not_in(("start", "note")))
                             .order_by(Flow.sort, Flow.id, FlowNode.y, FlowNode.x))).all()
    msgs = await _messages_by_node(db, [n.id for n, _ in rows if n.type == "chain"])
    return [{"id": n.id, "flow_id": fl.id, "flow_name": fl.name, "type": n.type, "title": n.title,
             "items": [m.title for m in msgs.get(n.id, [])]} for n, fl in rows]


# ─────────────────────────── namuna va ko'chirish ───────────────────────────

def _btn(text: str) -> dict:
    return {"type": "next", "text": text, "id": R.new_id()}


@router.post("/funnels/{fid}/flows/example")
async def create_example(fid: int, db: AsyncSession = Depends(get_db), me: AdminUser = Depends(CONTENT)):
    """Dizayndagi "1-kundan keyin" bo'limi — qoralama holida, matnlarni o'zgartirib faollashtirasiz."""
    funnel = await funnel_or_404(db, fid)
    f = await _new_flow(db, fid, "1-kundan keyin (namuna)", me)
    half = max(1, (funnel.day1_duration_sec // 60 or 120) // 2)
    nodes: dict[str, FlowNode] = {}

    async def node(key, type_, title, x, y, cfg=None, text=None, buttons=None, kind="text"):
        n = FlowNode(flow_id=f.id, type=type_, title=title, x=x, y=y,
                     config=R.normalize_config(type_, cfg if cfg is not None else R.default_config(type_)))
        db.add(n)
        await db.flush()
        if type_ == "message":
            db.add(ChainMessage(funnel_id=fid, flow_node_id=n.id, title=title, kind=kind, text=text or "",
                                buttons=[[b] for b in (buttons or [])], trigger_type="flow", status="active",
                                updated_by=me.name))
        nodes[key] = n
        return n

    br = R.watch_branches(funnel.day1_duration_sec // 60 or None)
    br[1]["label"], br[2]["label"] = f"{half}-daqiqagacha ko'rdi", f"{half}-daqiqadan ko'p"
    await node("start", "start", "1-kun efiri tugadi", 40, 330, {"event": "day_end", "day": 1})
    await node("watch", "condition", "Videoni qancha ko'rdi?", 330, 300, {"check": "watch", "day": 1, "branches": br})
    b_time, b_no = _btn("Vaqt tanlayman"), _btn("Qiziq emas")
    await node("m1", "message", "Efirga kira olmadingiz", 660, 40, {"timeout_minutes": 180},
               "{ism}, kechagi darsni ko'ra olmadingiz. Yozuv yana bir marta ochiladi — o'zingizga qulay "
               "vaqtni tanlang.", [b_time, b_no])
    await node("resched", "action", "Yangi vaqt tanlash", 1000, 0, {"action": "reschedule"})
    await node("not_int", "stop", "Teg: qiziqmaydi", 1000, 110, {"tag": "qiziqmaydi"})
    b_time2 = _btn("Vaqt tanlayman")
    await node("m2", "message", "Joyingiz saqlanmoqda", 1000, 220, {"timeout_minutes": 1440},
               "{ism}, joyingiz hali saqlanmoqda. Qaysi vaqt qulay — tanlang.", [b_time2])
    await node("resched2", "action", "Yangi vaqt tanlash", 1340, 220, {"action": "reschedule"})
    await node("cold", "action", "Sovuq lidlarga o'tkazish", 1340, 330, {"action": "cold"})
    b_go = _btn("Ha, 2-kunga boraman")
    await node("m3", "message", "Eng kuchli qismi oldinda", 660, 420, {"timeout_minutes": 180},
               "{ism}, darsning eng muhim qismi oldinda edi. 2-kunda uni qisqacha takrorlaymiz.", [b_go])
    await node("goto2", "goto", "2-kun zanjiriga", 1000, 470, {"target_node_id": None, "item": 0})
    await node("note", "note", "Izoh", 1000, 570, {"text": "«Kunlar bo'yicha»dagi «2-kun» ustunini sxemaga "
                                                         "ko'chiring va «2-kun zanjiriga» blokida uni tanlang."})
    b_q = _btn("Savolim bor")
    await node("m4", "message", "1-kun xulosasi", 660, 740, {"timeout_minutes": 120},
               "{ism}, bugun qatnashganingiz uchun rahmat! Savolingiz bo'lsa, shu yerda yozing.", [b_q])
    await node("ask", "action", "Savol so'rash", 1000, 740, {"action": "ask"})
    await node("wrote", "condition", "Adminga yozdimi?", 1000, 850, {"check": "wrote_admin", "minutes": 120})
    await node("task", "action", "Menejerga vazifa: qo'ng'iroq", 1340, 840,
               {"action": "manager_task", "value": "1-kunni ko'rgan, savol yozgan — qo'ng'iroq qiling"})
    await node("m5", "message", "Savolingiz bormi?", 1340, 950, {},
               "Uyalmang — jamoamiz har bir savolga shaxsan javob beradi. Menyudagi «Savol berish» tugmasini bosing.")

    def edge(a, port, b):
        db.add(FlowEdge(flow_id=f.id, from_node_id=nodes[a].id, from_port=port, to_node_id=nodes[b].id))

    edge("start", "next", "watch")
    edge("watch", br[0]["id"], "m1")
    edge("watch", br[1]["id"], "m3")
    edge("watch", br[2]["id"], "m4")
    edge("m1", f"b:{b_time['id']}", "resched")
    edge("m1", f"b:{b_no['id']}", "not_int")
    edge("m1", "timeout", "m2")
    edge("m2", f"b:{b_time2['id']}", "resched2")
    edge("m2", "timeout", "cold")
    edge("m3", f"b:{b_go['id']}", "goto2")
    edge("m4", f"b:{b_q['id']}", "ask")
    edge("m4", "timeout", "wrote")
    edge("wrote", "yes", "task")
    edge("wrote", "no", "m5")
    audit(db, me.name, "flow_example", f.name)
    await db.commit()
    return flow_out(f, {"nodes": len(nodes)})


def time_key(m: ChainMessage, deadline_min: int) -> int:
    """Admin paneldagi "Kunlar bo'yicha" tartibi (lib/chain.ts: timeKey)."""
    o = m.offset_minutes
    return {"before_day": -o, "before_deadline": deadline_min - o}.get(m.trigger_type, o)


def phase_of(m: ChainMessage) -> str | None:
    t, d = m.trigger_type, m.trigger_day
    if t == "after_registration":
        return "reg"
    if t in ("before_day", "at_day_start"):
        return "day2" if d == 2 else "day1"
    if t == "after_day_end":
        return "after" if d == 2 else "between"
    if t == "before_deadline":
        return "after"
    return None


class ImportIn(BaseModel):
    phase: str


@router.post("/funnels/{fid}/flows/import")
async def import_phase(fid: int, body: ImportIn, db: AsyncSession = Depends(get_db),
                       me: AdminUser = Depends(CONTENT)):
    """"Kunlar bo'yicha" ustunini sxemaga ko'chiradi: Boshlanish (efir vaqtini tanladi) → Zanjir.
    Hozir sessiyasi bor lidlar ham zanjirga qo'yiladi — ularning xabarlari takrorlanmaydi va yo'qolmaydi."""
    funnel = await funnel_or_404(db, fid)
    if body.phase not in PHASES:
        raise HTTPException(400, "Noto'g'ri ustun")
    msgs = (await db.execute(select(ChainMessage).where(
        ChainMessage.funnel_id == fid, ChainMessage.flow_node_id.is_(None),
        ChainMessage.trigger_type.in_(CHAIN_ITEM_TRIGGERS)))).scalars().all()
    msgs = [m for m in msgs if phase_of(m) == body.phase]
    if not msgs:
        raise HTTPException(400, "Bu ustunda ko'chiriladigan xabar yo'q")
    deadline_min = funnel.deadline_hours * 60
    msgs.sort(key=lambda m: (time_key(m, deadline_min), m.sort, m.id))
    now = now_utc()
    f = await _new_flow(db, fid, PHASES[body.phase], me, status="active")
    start = FlowNode(flow_id=f.id, type="start", title="Efir vaqtini tanladi", x=40, y=160,
                     config={"event": "session_chosen"})
    chain = FlowNode(flow_id=f.id, type="chain", title=PHASES[body.phase], x=360, y=120, config={})
    db.add_all([start, chain])
    await db.flush()
    db.add(FlowEdge(flow_id=f.id, from_node_id=start.id, from_port="next", to_node_id=chain.id))
    for i, m in enumerate(msgs):
        m.flow_node_id, m.sort, m.updated_by, m.updated_at = chain.id, i, me.name, now

    # sessiyasi davom etayotgan lidlar: zanjirga kirgan deb hisoblanadi (rejalari shu yerdan boshqariladi)
    rows = (await db.execute(
        select(Lead, LeadSession).join(LeadSession, LeadSession.lead_id == Lead.id)
        .where(Lead.funnel_id == fid, LeadSession.status == "active", Lead.blocked.is_(False),
               Lead.cold.is_(False),
               LeadSession.day2_at >= now - timedelta(seconds=funnel.day2_duration_sec) - timedelta(days=2))
    )).all()
    moved = 0
    for lead, s in rows:
        run = FlowRun(lead_id=lead.id, flow_id=f.id, node_id=chain.id, status="waiting", waiting_for="chain",
                      session_id=s.id, ctx={"start_event": "session_chosen", "imported": True},
                      started_at=now, updated_at=now)
        db.add(run)
        await db.flush()
        db.add(FlowVisit(run_id=run.id, lead_id=lead.id, node_id=chain.id, entered_at=now))
        entry = FlowChainEntry(run_id=run.id, lead_id=lead.id, node_id=chain.id, start_index=0,
                               entered_at=lead.phone_at or lead.created_at, session_id=s.id, active=True)
        db.add(entry)
        await db.flush()
        last = await flow_engine.plan_entry(db, lead, entry, now, s, funnel, revive=False)
        run.wait_until = last + timedelta(minutes=1) if last and last > now else now
        moved += 1
    audit(db, me.name, "flow_import", f"{PHASES[body.phase]}: {len(msgs)} xabar, {moved} lid")
    await db.commit()
    return {**flow_out(f, {"nodes": 2, "active": moved}), "moved_messages": len(msgs), "moved_leads": moved}


async def copy_flows(db: AsyncSession, src_fid: int, dst_fid: int, user: str) -> None:
    """Voronka nusxalanganda sxema ham ko'chadi (bo'limlar qoralama holida)."""
    flows_ = (await db.execute(select(Flow).where(Flow.funnel_id == src_fid))).scalars().all()
    id_map: dict[int, int] = {}
    new_nodes: list[FlowNode] = []
    for fl in flows_:
        nf = Flow(funnel_id=dst_fid, name=fl.name, status="draft", sort=fl.sort, updated_by=user)
        db.add(nf)
        await db.flush()
        nodes = (await db.execute(select(FlowNode).where(FlowNode.flow_id == fl.id))).scalars().all()
        msgs = await _messages_by_node(db, [n.id for n in nodes])
        for n in nodes:
            nn = FlowNode(flow_id=nf.id, type=n.type, title=n.title, x=n.x, y=n.y, config=dict(n.config or {}))
            db.add(nn)
            await db.flush()
            id_map[n.id] = nn.id
            new_nodes.append(nn)
            for m in msgs[n.id]:
                db.add(ChainMessage(funnel_id=dst_fid, flow_node_id=nn.id, **{k: getattr(m, k) for k in (
                    "title", "kind", "text", "media_ids", "buttons", "trigger_type", "trigger_day",
                    "offset_minutes", "segment", "segment_day", "segment_minute", "required", "status", "sort")},
                    updated_by=user))
        for e in (await db.execute(select(FlowEdge).where(FlowEdge.flow_id == fl.id))).scalars():
            db.add(FlowEdge(flow_id=nf.id, from_node_id=id_map[e.from_node_id], from_port=e.from_port,
                            to_node_id=id_map[e.to_node_id], to_item=e.to_item))
    for nn in new_nodes:
        if nn.type == "goto" and (nn.config or {}).get("target_node_id"):
            nn.config = {**nn.config, "target_node_id": id_map.get(nn.config["target_node_id"])}
