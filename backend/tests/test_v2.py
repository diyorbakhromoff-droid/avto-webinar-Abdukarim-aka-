"""Ko'rish segmentlari, efirdan chiqib ketish, deadline oldidan eslatma, 5 daqiqalik statistika, efir chati."""
from datetime import datetime, timedelta

from httpx import ASGITransport, AsyncClient
import pytest
from sqlalchemy import select

from app.domain.planning import ChainItem, SessionTimes, plan_chain
from app.domain.segments import DayWatch, LeadSnapshot, chain_allowed, matches
from app.models import AdminUser, Attendance, ChainMessage, LeadSession, Question, ScheduledMessage
from app.security.auth import create_token
from app.security.initdata import sign
from app.services.sessions import detect_left_live, mark_returned
from app.services.stats import StatsFilter, watch_curve
from app.timeutil import now_utc
from app.worker import sender
from tests.test_flows import TUE, make_funnel, make_lead, tash

H2 = 122 * 60  # 2 soatlik video


def snap(joined=True, max_min=0, dur=H2, day=1):
    return LeadSnapshot(watch={day: DayWatch(joined, max_min * 60, dur)})


# ── segmentlar ──

def test_watch_segments():
    assert matches("not_joined", snap(joined=False), 1)
    assert not matches("not_joined", snap(max_min=5), 1)
    assert matches("reached_min", snap(max_min=40), 1, 40)
    assert not matches("reached_min", snap(max_min=39), 1, 40)
    assert matches("left_before_min", snap(max_min=30), 1, 40)
    assert not matches("left_before_min", snap(joined=False), 1, 40)  # kirmagan — "chiqib ketgan" emas
    assert matches("watched_full", snap(max_min=118), 1)
    assert matches("not_full", snap(max_min=60), 1)
    assert not matches("not_full", snap(max_min=118), 1)
    # boshqa kunning ma'lumoti aralashmaydi
    assert matches("not_joined", snap(max_min=50, day=1), 2)


def test_paid_lead_still_skips_watch_messages():
    s = LeadSnapshot(payment_status="full", watch={1: DayWatch(True, 600, H2)})
    assert chain_allowed("left_before_min", s, 1, 40) == (False, "to'lagan")


# ── rejalashtirish ──

def test_before_deadline_and_left_live_planning():
    reg = tash(TUE, 9)
    d1 = tash(TUE, 20)
    deadline = d1 + timedelta(days=1, seconds=H2, hours=24)
    s = SessionTimes(reg, d1, d1 + timedelta(days=1), H2, H2, deadline)
    items = [ChainItem(1, "Deadline 3 soat", "before_deadline", None, 180, True),
             ChainItem(2, "Chiqib ketdi", "left_live", 1, 3, True)]
    plan = {p.item.id: p for p in plan_chain(items, s, reg)}
    assert plan[1].send_at == deadline - timedelta(hours=3)
    assert plan[2].status == "event"
    # deadline o'tib ketgan bo'lsa — yuborilmaydi
    late = plan_chain(items[:1], s, deadline - timedelta(hours=1))[0]
    assert late.status == "skipped"


# ── integratsiya ──

async def add_chain(db, f, **kw) -> ChainMessage:
    m = ChainMessage(funnel_id=f.id, title=kw.pop("title", "x"), text=kw.pop("text", "{ism}"), **kw)
    db.add(m)
    await db.commit()
    return m


async def live_session(db, lead, started_min_ago: int) -> LeadSession:
    now = now_utc()
    s = LeadSession(lead_id=lead.id, day1_at=now - timedelta(minutes=started_min_ago),
                    day2_at=now - timedelta(minutes=started_min_ago) + timedelta(days=1))
    db.add(s)
    await db.commit()
    return s


async def test_left_before_minute_message_goes_only_to_those_who_left(db, bot):
    f = await make_funnel(db, day1_duration_sec=H2)
    m = await add_chain(db, f, title="40 gacha chiqqanlar", trigger_type="after_day_end", trigger_day=1,
                        segment="left_before_min", segment_day=1, segment_minute=40)
    left, stayed = await make_lead(db, f, tash(TUE, 9), tg=1), await make_lead(db, f, tash(TUE, 9), tg=2)
    for lead, max_min in ((left, 25), (stayed, 90)):
        s = await live_session(db, lead, 200)
        db.add(Attendance(session_id=s.id, lead_id=lead.id, day=1, day_at=s.day1_at, max_position_sec=max_min * 60,
                          watched_sec=max_min * 60))
        db.add(ScheduledMessage(lead_id=lead.id, chain_message_id=m.id, session_id=s.id, dedupe_key=f"t{lead.id}",
                                send_at=now_utc(), status="sending"))
    await db.commit()
    rows = (await db.execute(select(ScheduledMessage).order_by(ScheduledMessage.lead_id))).scalars().all()
    for sm in rows:
        await sender.send_one(bot, sender.RateLimiter(1000), sm.id)
    for sm in rows:
        await db.refresh(sm)
    assert [r.status for r in rows] == ["sent", "skipped"]


async def test_left_live_detected_and_cancelled_on_return(db):
    f = await make_funnel(db, day1_duration_sec=H2)
    m = await add_chain(db, f, title="Qayting", trigger_type="left_live", trigger_day=1, offset_minutes=3)
    lead = await make_lead(db, f, tash(TUE, 9))
    s = await live_session(db, lead, 30)
    a = Attendance(session_id=s.id, lead_id=lead.id, day=1, day_at=s.day1_at, max_position_sec=25 * 60,
                   last_heartbeat_at=now_utc() - timedelta(minutes=5))
    db.add(a)
    await db.commit()
    assert await detect_left_live(db) == 1
    await db.refresh(a)
    sm = (await db.execute(select(ScheduledMessage).where(ScheduledMessage.chain_message_id == m.id))).scalar_one()
    assert a.left_at is not None and sm.status == "pending"
    assert sm.send_at >= a.left_at + timedelta(minutes=3) - timedelta(seconds=1)
    assert await detect_left_live(db) == 0  # ikkinchi marta qayta yozilmaydi
    await mark_returned(db, a)
    await db.commit()
    await db.refresh(sm)
    assert sm.status == "cancelled" and a.left_at is None


async def test_left_at_end_of_video_is_not_left(db):
    f = await make_funnel(db, day1_duration_sec=H2)
    lead = await make_lead(db, f, tash(TUE, 9))
    s = await live_session(db, lead, 121)
    db.add(Attendance(session_id=s.id, lead_id=lead.id, day=1, day_at=s.day1_at, max_position_sec=H2 - 60,
                      last_heartbeat_at=now_utc() - timedelta(minutes=4)))
    await db.commit()
    assert await detect_left_live(db) == 0


async def test_watch_curve_every_5_minutes(db):
    f = await make_funnel(db, day1_duration_sec=30 * 60)
    s = await live_session(db, await make_lead(db, f, tash(TUE, 9), tg=10), 100)
    # 4 kishi: 0-dan 30 gacha, 0-dan 12 gacha, 0-dan 12 gacha, 10-dan (kech kirgan) 30 gacha
    for i, (j, mx) in enumerate(((0, 30), (0, 12), (0, 12), (10, 30))):
        lead = await make_lead(db, f, tash(TUE, 9), tg=100 + i)
        db.add(Attendance(session_id=s.id, lead_id=lead.id, day=1, day_at=s.day1_at + timedelta(seconds=i),
                          join_position_sec=j * 60, max_position_sec=mx * 60))
    await db.commit()
    c = await watch_curve(db, StatsFilter(f.id), f, 1, 5)
    by = {b["minute"]: b for b in c["buckets"]}
    assert c["joined"] == 4 and c["full"] == 2
    assert [by[m]["viewers"] for m in (0, 5, 10, 15, 20, 25, 30)] == [3, 3, 4, 2, 2, 2, 2]
    assert by[15]["left"] == 2
    assert c["top_drops"][0] == {"from_minute": 10, "to_minute": 15, "left": 2}


@pytest.fixture
async def client():
    from app.main import app
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


async def test_live_chat_separate_from_questions(db, client, bot, monkeypatch):
    monkeypatch.setattr("app.services.tg._bot", bot)
    f = await make_funnel(db, day1_duration_sec=H2)
    lead = await make_lead(db, f, tash(TUE, 9), tg=4242)
    s = await live_session(db, lead, 34)
    db.add(Attendance(session_id=s.id, lead_id=lead.id, day=1, day_at=s.day1_at, last_heartbeat_at=now_utc()))
    await db.commit()
    init = sign({"auth_date": str(int(datetime.now().timestamp())), "user": '{"id":4242,"first_name":"Madina"}'},
                "123456:TEST-TOKEN")
    h = {"Authorization": f"tma {init}"}
    assert (await client.post("/api/app/question", headers=h, json={"text": "Ovozni qanday mashq qilaman?"})).status_code == 200
    db.add(Question(lead_id=lead.id, text="Kurs qachon boshlanadi?", source="bot"))
    content = AdminUser(login="k", name="Kamola", role="content", password_hash="x")
    sales = AdminUser(login="n", name="Nodira", role="sales", password_hash="x")
    db.add_all([content, sales])
    await db.commit()

    q = (await db.execute(select(Question).where(Question.source == "miniapp"))).scalar_one()
    assert (q.day, q.session_id) == (1, s.id) and 33 * 60 <= q.video_sec <= 35 * 60

    st = (await client.get("/api/app/state", headers=h)).json()
    assert st["live"]["my_messages"][0]["text"] == "Ovozni qanday mashq qilaman?"

    hs = {"Authorization": f"Bearer {create_token(sales)}"}
    hc = {"Authorization": f"Bearer {create_token(content)}"}
    chat = (await client.get(f"/api/admin/chat?funnel_id={f.id}", headers=hs)).json()
    assert len(chat) == 1 and chat[0]["day"] == 1 and chat[0]["lead_phone"]
    assert (await client.get(f"/api/admin/chat?funnel_id={f.id}", headers=hc)).json()[0]["lead_phone"] is None
    questions = (await client.get(f"/api/admin/questions?funnel_id={f.id}", headers=hs)).json()
    assert [x["text"] for x in questions] == ["Kurs qachon boshlanadi?"]
    sessions = (await client.get(f"/api/admin/chat/sessions?funnel_id={f.id}", headers=hc)).json()
    assert sessions[0]["count"] == 1 and sessions[0]["unanswered"] == 1

    r = await client.post(f"/api/admin/chat/{q.id}/reply", headers=hc, json={"text": "Har kuni 10 daqiqa"})
    assert r.status_code == 200 and r.json()["answer"] == "Har kuni 10 daqiqa"
    assert any("Har kuni 10 daqiqa" in (t or "") for t in bot.texts())


async def test_chain_validation_for_minute_segments(db, client):
    f = await make_funnel(db)
    su = AdminUser(login="boss", name="Boss", role="super_admin", password_hash="x")
    db.add(su)
    await db.commit()
    h = {"Authorization": f"Bearer {create_token(su)}"}
    body = {"title": "t", "text": "salom", "trigger_type": "after_day_end", "trigger_day": 1,
            "segment": "left_before_min", "segment_day": 1}
    r = await client.post(f"/api/admin/funnels/{f.id}/chain", headers=h, json=body)
    assert r.status_code == 400 and "daqiqa" in r.json()["detail"]
    r = await client.post(f"/api/admin/funnels/{f.id}/chain", headers=h, json={**body, "segment_minute": 40})
    assert r.status_code == 200 and r.json()["segment_minute"] == 40
    r = await client.post(f"/api/admin/funnels/{f.id}/chain", headers=h,
                          json={"title": "d", "text": "x", "trigger_type": "before_deadline", "offset_minutes": 180,
                                "segment": "not_paid"})
    assert r.status_code == 200
    ws = (await client.get(f"/api/admin/funnels/{f.id}/watch-stats?day=1&step=5", headers=h)).json()
    assert ws["joined"] == 0 and ws["step"] == 5
