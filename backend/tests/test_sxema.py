"""Progrev sxemasi: shoxlanish, tugmalar, "bosmasa", kutish, zanjirning N-xabaridan kirish, ko'chirish, API."""
from datetime import timedelta

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import func, select

from app.domain import flow_rules as R
from app.domain.planning import ChainItem, QuietHours, SessionTimes
from app.models import (
    AdminUser, Attendance, ChainMessage, Flow, FlowEdge, FlowNode, FlowRun, FlowVisit, Lead, LeadEvent, LeadSession,
    ScheduledMessage,
)
from app.security.auth import create_token
from app.services import flow_engine
from app.services.sessions import plan_for_session
from app.timeutil import now_utc
from app.worker import sender
from tests.test_flows import TUE, make_funnel, make_lead, tash


# ─────────────────────────── sof qoidalar ───────────────────────────

def test_ports_follow_buttons_and_branches():
    buttons = [[{"type": "next", "text": "Ha", "id": "a1"}, {"type": "url", "text": "Sayt", "url": "https://x.uz"}],
               [{"type": "next", "text": "Yo'q", "id": "b2"}]]
    assert R.ports("message", {"timeout_minutes": 60}, buttons) == ["b:a1", "b:b2", "timeout"]
    assert R.ports("message", {"timeout_minutes": None}, []) == ["next"]
    cfg = R.normalize_config("condition", {"check": "watch", "day": 1, "branches": R.watch_branches(120)})
    assert R.ports("condition", cfg) == [b["id"] for b in cfg["branches"]] + ["else"]
    assert R.ports("condition", {"check": "payment"}) == ["none", "deposit", "full"]
    assert R.ports("wait", {"mode": "event"}) == ["done", "expired"]
    assert R.ports("goto", {}) == []


def test_config_validation():
    with pytest.raises(R.FlowConfigError):
        R.normalize_config("start", {"event": "left_live"})            # kun kerak
    with pytest.raises(R.FlowConfigError):
        R.normalize_config("condition", {"check": "watch", "day": 1, "branches": [
            {"label": "x", "kind": "range", "from_min": 40, "to_min": 30}]})
    with pytest.raises(R.FlowConfigError):
        R.normalize_config("action", {"action": "tag_add", "value": " "})
    assert R.normalize_config("start", {"event": "phone", "day": 2}) == {"event": "phone"}
    ids = R.ensure_button_ids([[{"type": "next", "text": "A"}, {"type": "next", "text": "B", "id": "same"}],
                               [{"type": "next", "text": "C", "id": "same"}, {"type": "url", "text": "U", "id": "x"}]])
    flat = [b for r in ids for b in r]
    assert len({b["id"] for b in flat[:3]}) == 3 and "id" not in flat[3]


def test_watch_branch_order():
    br = [{"id": "n", "kind": "not_joined"}, {"id": "a", "kind": "range", "from_min": 0, "to_min": 37},
          {"id": "b", "kind": "range", "from_min": 37, "to_min": None}]
    assert R.watch_branch(br, False, 0) == "n"
    assert R.watch_branch(br, True, 36 * 60) == "a"
    assert R.watch_branch(br, True, 37 * 60) == "b"
    assert R.watch_branch(br[1:2], True, 50 * 60) == "else"


def test_wait_target():
    now = tash(TUE, 12)
    s = SessionTimes(tash(TUE, 9), tash(TUE, 20), tash(TUE, 20) + timedelta(days=1), 3600, 3600,
                     tash(TUE, 20) + timedelta(days=2))
    a = R.anchors_of(s, 1800)
    t, late = R.wait_target({"mode": "anchor", "anchor": "day1_start", "minutes": 15, "direction": "before"},
                            now, now, a)
    assert t == tash(TUE, 19, 45) and not late
    t, late = R.wait_target({"mode": "anchor", "anchor": "day1_start", "minutes": 0, "direction": "before"},
                            now, now + timedelta(hours=9), a)
    assert late
    assert R.wait_target({"mode": "anchor", "anchor": "day1_start"}, now, now, R.Anchors())[1] is True
    t, _ = R.wait_target({"mode": "anchor", "anchor": "offer", "minutes": 5, "direction": "after"}, now, now, a)
    assert t == s.day2_at + timedelta(minutes=35)
    # tungi tinchlikka tushsa — 08:00 ga suriladi
    t, _ = R.wait_target({"mode": "duration", "minutes": 12 * 60, "quiet": True}, now, now, a, QuietHours())
    assert t == tash(TUE, 8) + timedelta(days=1)
    t, _ = R.wait_target({"mode": "clock", "clock": "10:00", "quiet": True}, now, now, a)
    assert t == tash(TUE, 10) + timedelta(days=1)


def test_plan_items_entered_after_day1_no_compression():
    day1 = tash(TUE, 9)
    s = SessionTimes(day1 - timedelta(days=1), day1, day1 + timedelta(days=1), 3600, 3600)
    entered = day1 + timedelta(hours=2)
    items = [ChainItem(1, "kirgach", "after_registration", None, 30, False),
             ChainItem(2, "2-kun oldidan", "before_day", 2, 60, False),
             ChainItem(3, "1-kun oldidan", "before_day", 1, 60, False)]
    plan = {p.item.id: p for p in R.plan_items(items, s, entered, entered)}
    assert plan[1].send_at == entered + timedelta(minutes=30) and plan[1].session_bound is False
    assert plan[2].send_at == day1 + timedelta(days=1, hours=-1)
    assert plan[3].status == "skipped"
    plan = {p.item.id: p for p in R.plan_items(items, None, entered, entered)}
    assert plan[2].status == "skipped" and plan[1].send_at is not None


# ─────────────────────────── integratsiya ───────────────────────────

class G:
    """Sinov sxemasi: 1-kun tugadi → videoni qancha ko'rdi? → xabar (2 tugma + bosmasa) / zanjirning 2-xabari."""


async def build_after_day1(db, f, *, timeout=180) -> G:
    g = G()
    g.flow = Flow(funnel_id=f.id, name="1-kundan keyin", status="active")
    db.add(g.flow)
    await db.flush()

    def node(type_, cfg, title=""):
        n = FlowNode(flow_id=g.flow.id, type=type_, title=title or type_, config=R.normalize_config(type_, cfg))
        db.add(n)
        return n

    g.branches = [{"id": "nj", "label": "Kirmadi", "kind": "not_joined"},
                  {"id": "half", "label": "Yarmigacha", "kind": "range", "from_min": 0, "to_min": 37},
                  {"id": "more", "label": "Ko'proq", "kind": "range", "from_min": 37, "to_min": None}]
    g.start = node("start", {"event": "day_end", "day": 1})
    g.cond = node("condition", {"check": "watch", "day": 1, "branches": g.branches})
    g.m1 = node("message", {"timeout_minutes": timeout}, "Efirga kira olmadingiz")
    g.act = node("action", {"action": "reschedule"})
    g.stop = node("stop", {"tag": "qiziqmaydi"})
    g.m2 = node("message", {}, "Joyingiz saqlanmoqda")
    g.chain = node("chain", {}, "2-kun zanjiri")
    await db.flush()
    g.goto = node("goto", {"target_node_id": g.chain.id, "item": 1})
    await db.flush()
    g.msg1 = ChainMessage(funnel_id=f.id, flow_node_id=g.m1.id, title="M1", text="{ism}, kira olmadingiz",
                          trigger_type="flow", buttons=[[{"type": "next", "text": "Vaqt tanlayman", "id": "aaa111"}],
                                                        [{"type": "next", "text": "Qiziq emas", "id": "bbb222"}]])
    g.msg2 = ChainMessage(funnel_id=f.id, flow_node_id=g.m2.id, title="M2", text="Joyingiz bor", trigger_type="flow")
    g.items = [
        ChainMessage(funnel_id=f.id, flow_node_id=g.chain.id, title="Z0", text="z0", trigger_type="after_registration",
                     offset_minutes=10, sort=0),
        ChainMessage(funnel_id=f.id, flow_node_id=g.chain.id, title="Z1", text="z1", trigger_type="before_day",
                     trigger_day=2, offset_minutes=120, sort=1),
        ChainMessage(funnel_id=f.id, flow_node_id=g.chain.id, title="Z2", text="z2", trigger_type="at_day_start",
                     trigger_day=2, offset_minutes=0, sort=2),
    ]
    db.add_all([g.msg1, g.msg2, *g.items])
    for a, port, b in ((g.start, "next", g.cond), (g.cond, "nj", g.m1), (g.cond, "more", g.goto),
                       (g.m1, "b:aaa111", g.act), (g.m1, "b:bbb222", g.stop), (g.m1, "timeout", g.m2)):
        db.add(FlowEdge(flow_id=g.flow.id, from_node_id=a.id, from_port=port, to_node_id=b.id))
    await db.commit()
    return g


async def lead_after_day1(db, f, tg: int, watched_min: int | None) -> tuple[Lead, LeadSession]:
    """1-kuni 3 soat oldin bo'lgan lid; watched_min=None — efirga kirmagan."""
    now = now_utc()
    lead = await make_lead(db, f, now - timedelta(days=1), tg=tg)
    s = LeadSession(lead_id=lead.id, day1_at=now - timedelta(hours=3), day2_at=now + timedelta(hours=21),
                    day1_evaluated=True, day1_watched=bool(watched_min and watched_min >= 56))
    db.add(s)
    await db.flush()
    if watched_min is not None:
        db.add(Attendance(session_id=s.id, lead_id=lead.id, day=1, day_at=s.day1_at,
                          max_position_sec=watched_min * 60, watched_sec=watched_min * 60))
    await db.commit()
    return lead, s


async def emit(db, lead: Lead, type_: str, **data) -> None:
    db.add(LeadEvent(lead_id=lead.id, type=type_, data=data))
    await db.commit()
    await flow_engine.process_events()


async def run_of(db, lead: Lead) -> FlowRun:
    return (await db.execute(select(FlowRun).where(FlowRun.lead_id == lead.id).order_by(FlowRun.id.desc())
                             .limit(1).execution_options(populate_existing=True))).scalar_one()


async def queued(db, lead: Lead) -> list[ScheduledMessage]:
    return list((await db.execute(select(ScheduledMessage).where(ScheduledMessage.lead_id == lead.id)
                                  .order_by(ScheduledMessage.id).execution_options(populate_existing=True))
                 ).scalars().all())


async def test_not_joined_gets_message_and_button_moves_on(db):
    f = await make_funnel(db)
    g = await build_after_day1(db, f)
    lead, _ = await lead_after_day1(db, f, 501, None)
    await emit(db, lead, "day_result", day=1, ok=False)

    run = await run_of(db, lead)
    assert (run.status, run.waiting_for, run.node_id) == ("waiting", "button", g.m1.id)
    assert run.wait_until is not None
    sm = (await queued(db, lead))[0]
    assert (sm.chain_message_id, sm.flow_run_id, sm.flow_node_id) == (g.msg1.id, run.id, g.m1.id)

    assert await flow_engine.on_button(db, 999, sm.id, 1, 0) == "invalid"   # boshqa odam
    assert await flow_engine.on_button(db, lead.tg_user_id, sm.id, 1, 0) == "ok"
    await db.commit()
    await db.refresh(run)
    await db.refresh(lead)
    assert run.status == "done" and lead.tags == ["qiziqmaydi"]
    assert await flow_engine.on_button(db, lead.tg_user_id, sm.id, 1, 0) == "old"
    ports = dict((await db.execute(select(FlowVisit.node_id, FlowVisit.port).where(FlowVisit.run_id == run.id))).all())
    assert ports[g.cond.id] == "nj" and ports[g.m1.id] == "b:bbb222"


async def test_first_button_queues_reschedule_action(db, bot):
    f = await make_funnel(db)
    g = await build_after_day1(db, f)
    lead, _ = await lead_after_day1(db, f, 502, None)
    await emit(db, lead, "day_result", day=1, ok=False)
    sm = (await queued(db, lead))[0]
    assert await flow_engine.on_button(db, lead.tg_user_id, sm.id, 0, 0) == "ok"
    await db.commit()
    action = (await queued(db, lead))[-1]
    assert action.flow_node_id == g.act.id and action.chain_message_id is None
    action.status = "sending"
    await db.commit()
    await sender.send_one(bot, sender.RateLimiter(1000), action.id)
    await db.refresh(action)
    assert action.status == "sent"
    assert any("tanlang" in (t or "").lower() or "vaqt" in (t or "").lower() for t in bot.texts())


async def test_no_click_goes_to_timeout_branch(db):
    f = await make_funnel(db)
    g = await build_after_day1(db, f, timeout=180)
    lead, _ = await lead_after_day1(db, f, 503, None)
    await emit(db, lead, "day_result", day=1, ok=False)
    assert await flow_engine.tick(now_utc() + timedelta(minutes=100)) == 0
    assert await flow_engine.tick(now_utc() + timedelta(minutes=181)) == 1
    msgs = await queued(db, lead)
    assert [m.chain_message_id for m in msgs] == [g.msg1.id, g.msg2.id]
    assert (await run_of(db, lead)).status == "done"


async def test_watched_more_enters_chain_from_second_message(db):
    f = await make_funnel(db)
    g = await build_after_day1(db, f)
    lead, s = await lead_after_day1(db, f, 504, 50)
    half, _ = await lead_after_day1(db, f, 505, 20)
    await emit(db, lead, "day_result", day=1, ok=False)
    await emit(db, half, "day_result", day=1, ok=False)

    run = await run_of(db, lead)
    assert (run.status, run.waiting_for, run.node_id) == ("waiting", "chain", g.chain.id)
    rows = {m.chain_message_id: m for m in await queued(db, lead)}
    assert set(rows) == {g.items[1].id, g.items[2].id}               # 1-xabar (Z0) yuborilmaydi
    assert rows[g.items[1].id].send_at == s.day2_at - timedelta(minutes=120)
    assert rows[g.items[1].id].dedupe_key == f"c{g.items[1].id}:s{s.id}"
    assert run.wait_until == s.day2_at - timedelta(minutes=1) + timedelta(minutes=1)
    # yarmigacha ko'rgan shoxchaga hech narsa ulanmagan — yo'l tugaydi
    assert (await run_of(db, half)).status == "done" and await queued(db, half) == []

    # efir vaqti o'zgardi — zanjir xabarlari ko'chadi
    s.day2_at = s.day2_at + timedelta(hours=2)
    await db.commit()
    await emit(db, lead, "rescheduled", day=2)
    rows = {m.chain_message_id: m for m in await queued(db, lead)}
    assert rows[g.items[1].id].send_at == s.day2_at - timedelta(minutes=120)
    assert len(rows) == 2


async def test_paid_lead_message_skipped_stops_run(db, bot):
    f = await make_funnel(db)
    await build_after_day1(db, f)
    lead, _ = await lead_after_day1(db, f, 506, None)
    await emit(db, lead, "day_result", day=1, ok=False)
    lead.payment_status = "full"
    sm = (await queued(db, lead))[0]
    sm.status = "sending"
    await db.commit()
    await sender.send_one(bot, sender.RateLimiter(1000), sm.id)
    await db.refresh(sm)
    assert sm.status == "skipped"
    assert (await run_of(db, lead)).status == "stopped"


async def test_next_buttons_render_as_flow_callbacks(db, bot):
    f = await make_funnel(db)
    await build_after_day1(db, f)
    lead, _ = await lead_after_day1(db, f, 507, None)
    await emit(db, lead, "day_result", day=1, ok=False)
    sm = (await queued(db, lead))[0]
    sm.status = "sending"
    await db.commit()
    await sender.send_one(bot, sender.RateLimiter(1000), sm.id)
    markup = [k for n, a, k in bot.calls if n == "send_message"][-1]["reply_markup"]
    datas = [b.callback_data for row in markup.inline_keyboard for b in row]
    assert datas == [f"fl:{sm.id}:0:0", f"fl:{sm.id}:1:0"]


async def test_wait_until_event_and_expiry(db):
    f = await make_funnel(db)
    fl = Flow(funnel_id=f.id, name="Savol", status="active")
    db.add(fl)
    await db.flush()
    start = FlowNode(flow_id=fl.id, type="start", config={"event": "phone"})
    wait = FlowNode(flow_id=fl.id, type="wait", config=R.normalize_config(
        "wait", {"mode": "event", "event": "question", "max_minutes": 60}))
    yes = FlowNode(flow_id=fl.id, type="action", config={"action": "tag_add", "value": "yozdi"})
    no = FlowNode(flow_id=fl.id, type="action", config={"action": "tag_add", "value": "yozmadi"})
    db.add_all([start, wait, yes, no])
    await db.flush()
    db.add_all([FlowEdge(flow_id=fl.id, from_node_id=start.id, from_port="next", to_node_id=wait.id),
                FlowEdge(flow_id=fl.id, from_node_id=wait.id, from_port="done", to_node_id=yes.id),
                FlowEdge(flow_id=fl.id, from_node_id=wait.id, from_port="expired", to_node_id=no.id)])
    await db.commit()
    a = await make_lead(db, f, now_utc(), tg=601)
    b = await make_lead(db, f, now_utc(), tg=602)
    await emit(db, a, "phone")
    await emit(db, b, "phone")
    assert (await run_of(db, a)).waiting_for == "event"
    await emit(db, a, "question")
    await flow_engine.tick(now_utc() + timedelta(minutes=61))
    await db.refresh(a)
    await db.refresh(b)
    assert a.tags == ["yozdi"] and b.tags == ["yozmadi"]


async def test_loop_without_wait_is_stopped_and_cancelled(db):
    f = await make_funnel(db)
    fl = Flow(funnel_id=f.id, name="Halqa", status="active")
    db.add(fl)
    await db.flush()
    start = FlowNode(flow_id=fl.id, type="start", config={"event": "phone"})
    msg = FlowNode(flow_id=fl.id, type="message", config={})
    db.add_all([start, msg])
    await db.flush()
    back = FlowNode(flow_id=fl.id, type="goto", config={"target_node_id": msg.id, "item": 0})
    db.add(back)
    await db.flush()
    db.add(ChainMessage(funnel_id=f.id, flow_node_id=msg.id, title="x", text="x", trigger_type="flow"))
    db.add_all([FlowEdge(flow_id=fl.id, from_node_id=start.id, from_port="next", to_node_id=msg.id),
                FlowEdge(flow_id=fl.id, from_node_id=msg.id, from_port="next", to_node_id=back.id)])
    await db.commit()
    lead = await make_lead(db, f, now_utc(), tg=701)
    await emit(db, lead, "phone")
    run = await run_of(db, lead)
    assert run.status == "stopped" and "cheksiz" in run.ended_reason
    assert all(m.status == "cancelled" for m in await queued(db, lead))


async def test_left_live_flow_stops_when_lead_returns(db):
    f = await make_funnel(db)
    fl = Flow(funnel_id=f.id, name="Chiqib ketganlar", status="active")
    db.add(fl)
    await db.flush()
    start = FlowNode(flow_id=fl.id, type="start", config={"event": "left_live", "day": 1})
    wait = FlowNode(flow_id=fl.id, type="wait", config={"mode": "duration", "minutes": 3, "quiet": False})
    msg = FlowNode(flow_id=fl.id, type="message", config={})
    db.add_all([start, wait, msg])
    await db.flush()
    db.add(ChainMessage(funnel_id=f.id, flow_node_id=msg.id, title="Qayting", text="Qayting", trigger_type="flow"))
    db.add_all([FlowEdge(flow_id=fl.id, from_node_id=start.id, from_port="next", to_node_id=wait.id),
                FlowEdge(flow_id=fl.id, from_node_id=wait.id, from_port="next", to_node_id=msg.id)])
    await db.commit()
    lead = await make_lead(db, f, now_utc(), tg=801)
    await emit(db, lead, "left_live", day=2)          # boshqa kun — boshlanmaydi
    assert (await db.execute(select(func.count()).select_from(FlowRun))).scalar() == 0
    await emit(db, lead, "left_live", day=1)
    assert (await run_of(db, lead)).waiting_for == "time"
    await emit(db, lead, "returned", day=1)
    run = await run_of(db, lead)
    assert run.status == "stopped" and run.ended_reason == "efirga qaytdi"
    assert await flow_engine.tick(now_utc() + timedelta(minutes=5)) == 0


async def test_draft_flow_does_not_start(db):
    f = await make_funnel(db)
    g = await build_after_day1(db, f)
    g.flow.status = "draft"
    await db.commit()
    lead, _ = await lead_after_day1(db, f, 901, None)
    await emit(db, lead, "day_result", day=1, ok=False)
    assert (await db.execute(select(func.count()).select_from(FlowRun))).scalar() == 0


# ─────────────────────────── API ───────────────────────────

@pytest.fixture
async def client():
    from app.main import app
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


async def admin_headers(db) -> dict:
    su = AdminUser(login="boss", name="Boss", role="super_admin", password_hash="x", tg_user_id=55)
    db.add(su)
    await db.commit()
    return {"Authorization": f"Bearer {create_token(su)}"}


async def test_api_build_graph_and_validation(db, client):
    f = await make_funnel(db)
    h = await admin_headers(db)
    fl = (await client.post(f"/api/admin/funnels/{f.id}/flows", headers=h, json={"name": "Sinov"})).json()
    g = (await client.get(f"/api/admin/flows/{fl['id']}", headers=h)).json()
    start = g["nodes"][0]
    assert start["type"] == "start" and fl["status"] == "draft"

    msg = (await client.post(f"/api/admin/flows/{fl['id']}/nodes", headers=h,
                             json={"type": "message", "x": 300, "y": 100})).json()
    assert msg["ports"] == ["next"] and msg["messages"][0]["trigger_type"] == "flow"
    assert "Xabar matni yo'q" in msg["warnings"]
    cond = (await client.post(f"/api/admin/flows/{fl['id']}/nodes", headers=h, json={"type": "condition"})).json()
    assert len(cond["ports"]) == 4  # 3 shoxcha + boshqa

    # xabar matni va «keyingi blok» tugmasi — id server beradi
    m = msg["messages"][0]
    body = {**{k: m[k] for k in ("title", "kind", "media_ids", "trigger_type", "trigger_day", "offset_minutes",
                                 "stuck_step", "button_key", "segment", "segment_day", "segment_minute",
                                 "required", "sort")},
            "text": "Salom {ism}", "status": "active", "buttons": [[{"type": "next", "text": "Ha"}]]}
    saved = (await client.put(f"/api/admin/chain/{m['id']}", headers=h, json=body)).json()
    bid = saved["buttons"][0][0]["id"]
    assert bid

    r = await client.post(f"/api/admin/flows/{fl['id']}/edges", headers=h, json={
        "from_node_id": msg["id"], "from_port": "next", "to_node_id": cond["id"]})
    assert r.status_code == 400                                      # tugma bor — "next" chiqishi yo'q
    e = (await client.post(f"/api/admin/flows/{fl['id']}/edges", headers=h, json={
        "from_node_id": msg["id"], "from_port": f"b:{bid}", "to_node_id": cond["id"]})).json()
    r = await client.post(f"/api/admin/flows/{fl['id']}/edges", headers=h, json={
        "from_node_id": cond["id"], "from_port": "else", "to_node_id": start["id"]})
    assert r.status_code == 400                                      # boshlanishga ulab bo'lmaydi
    assert (await client.post(f"/api/admin/flows/{fl['id']}/edges", headers=h, json={
        "from_node_id": start["id"], "from_port": "next", "to_node_id": msg["id"]})).status_code == 200

    # tugma olib tashlansa — uning chizig'i ham o'chadi
    saved = (await client.put(f"/api/admin/chain/{m['id']}", headers=h, json={**body, "buttons": []})).json()
    g = (await client.get(f"/api/admin/flows/{fl['id']}", headers=h)).json()
    assert e["id"] not in [x["id"] for x in g["edges"]] and len(g["edges"]) == 1

    # oddiy zanjirda «keyingi blok» tugmasi bo'lmaydi; ro'yxatda sxema xabarlari ko'rinmaydi
    classic = (await client.get(f"/api/admin/funnels/{f.id}/chain", headers=h)).json()
    assert all(x["flow_node_id"] is None for x in classic)
    r = await client.put(f"/api/admin/chain/{classic[0]['id']}", headers=h, json={
        **{k: classic[0][k] for k in body if k in classic[0]}, "buttons": [[{"type": "next", "text": "X"}]]})
    assert r.status_code == 400

    assert (await client.put(f"/api/admin/flows/{fl['id']}", headers=h, json={"status": "active"})).status_code == 200
    targets = (await client.get(f"/api/admin/funnels/{f.id}/flow-targets", headers=h)).json()
    assert {t["type"] for t in targets} == {"message", "condition"}


async def test_api_example_and_copy(db, client):
    f = await make_funnel(db)
    h = await admin_headers(db)
    ex = (await client.post(f"/api/admin/funnels/{f.id}/flows/example", headers=h)).json()
    assert ex["status"] == "draft" and ex["nodes"] > 10
    g = (await client.get(f"/api/admin/flows/{ex['id']}", headers=h)).json()
    types = {n["type"] for n in g["nodes"]}
    assert {"start", "condition", "message", "action", "goto", "stop", "note"} <= types
    ids = {n["id"] for n in g["nodes"]}
    assert all(e["from_node_id"] in ids and e["to_node_id"] in ids for e in g["edges"])
    for n in g["nodes"]:
        out = {e["from_port"] for e in g["edges"] if e["from_node_id"] == n["id"]}
        assert out <= set(n["ports"]), n["title"]

    copy = (await client.post(f"/api/admin/funnels/{f.id}/copy", headers=h,
                              json={"slug": "nusxa", "name": "Nusxa"})).json()
    flows = (await client.get(f"/api/admin/funnels/{copy['id']}/flows", headers=h)).json()
    assert [x["nodes"] for x in flows] == [ex["nodes"]]
    copied = (await client.get(f"/api/admin/funnels/{copy['id']}/chain", headers=h)).json()
    original = (await client.get(f"/api/admin/funnels/{f.id}/chain", headers=h)).json()
    assert len(copied) == len(original)


async def test_import_column_keeps_pending_messages(db, client):
    f = await make_funnel(db)
    h = await admin_headers(db)
    now = now_utc()
    lead = await make_lead(db, f, now - timedelta(hours=1), tg=1201)
    s = LeadSession(lead_id=lead.id, day1_at=now + timedelta(days=1), day2_at=now + timedelta(days=2))
    db.add(s)
    await db.flush()
    await plan_for_session(db, lead, s, f)
    await db.commit()
    before = {(m.dedupe_key, m.send_at) for m in await queued(db, lead) if m.status == "pending"}

    r = (await client.post(f"/api/admin/funnels/{f.id}/flows/import", headers=h, json={"phase": "day1"})).json()
    assert r["moved_messages"] == 2 and r["moved_leads"] == 1 and r["status"] == "active"
    after = {(m.dedupe_key, m.send_at) for m in await queued(db, lead) if m.status == "pending"}
    assert after == before                                            # takrorlanmadi, yo'qolmadi
    classic = (await client.get(f"/api/admin/funnels/{f.id}/chain", headers=h)).json()
    assert {"2 soat", "Boshlandi"}.isdisjoint({m["title"] for m in classic})

    # vaqt o'zgarsa — ko'chirilgan xabarlar ham ko'chadi
    s.day1_at, s.day2_at = s.day1_at + timedelta(hours=3), s.day2_at + timedelta(hours=3)
    await db.commit()
    await emit(db, lead, "session_changed")
    moved = {m.dedupe_key: m.send_at for m in await queued(db, lead) if m.status == "pending"}
    two_h = next(m for m in (await db.execute(select(ChainMessage).where(ChainMessage.title == "2 soat"))).scalars())
    assert moved[f"c{two_h.id}:s{s.id}"] == s.day1_at - timedelta(minutes=120)

    # yangi lid sessiya tanlasa — sxema orqali rejalashtiriladi
    new = await make_lead(db, f, now, tg=1202)
    s2 = LeadSession(lead_id=new.id, day1_at=now + timedelta(days=1), day2_at=now + timedelta(days=2))
    db.add(s2)
    await db.commit()
    await emit(db, new, "session_chosen")
    keys = {m.dedupe_key for m in await queued(db, new)}
    assert f"c{two_h.id}:s{s2.id}" in keys


async def test_flow_stats_count_visits(db, client):
    f = await make_funnel(db)
    h = await admin_headers(db)
    g = await build_after_day1(db, f)
    for tg, w in ((1301, None), (1302, None), (1303, 50)):
        lead, _ = await lead_after_day1(db, f, tg, w)
        await emit(db, lead, "day_result", day=1, ok=False)
    st = (await client.get(f"/api/admin/flows/{g.flow.id}?days=7", headers=h)).json()["stats"]
    assert st[str(g.cond.id)]["entered"] == 3 and st[str(g.cond.id)]["ports"] == {"nj": 2, "more": 1}
    assert st[str(g.m1.id)]["here"] == 2
    lc = (await client.get(f"/api/admin/leads/{(await db.execute(select(Lead.id).where(Lead.tg_user_id == 1301))).scalar()}",
                           headers=h)).json()
    assert lc["flow_runs"][0]["node_title"] == "Efirga kira olmadingiz" and lc["flow_runs"][0]["status"] == "waiting"
