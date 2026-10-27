"""Sotuv doskasi: bosqichlar, avtomatik o'tishlar, avtovoronka yo'li, API."""
from datetime import timedelta

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select

from app.domain.pipeline import DayInfo, PathInput, funnel_path, stage_after_contact, stage_after_receipt
from app.models import AdminUser, ContactLog, LeadEvent, LeadSession, Tariff
from app.security.auth import create_token
from app.services import payments as pay
from app.timeutil import now_utc
from tests.test_flows import TUE, make_funnel, make_lead, tash


# ─────────────────────────── sof qoidalar ───────────────────────────

def test_contact_results_move_stage():
    assert stage_after_contact("new", "no_answer") == "contacted"
    assert stage_after_contact("waiting_payment", "no_answer") == "waiting_payment"
    assert stage_after_contact("contacted", "callback") == "callback"
    assert stage_after_contact("callback", "sold") == "won"
    assert stage_after_contact("won", "callback") == "won"  # qolgan to'lov uchun qo'ng'iroq
    assert stage_after_contact("won", "refused") == "lost"
    assert stage_after_receipt("lost") == "waiting_payment"
    assert stage_after_receipt("won") == "won"


def test_funnel_path_marks_done_missed_and_planned():
    reg = tash(TUE, 9)
    d1 = tash(TUE, 20)
    p = PathInput(
        registered_at=reg, source="ig", phone_at=reg + timedelta(minutes=1), session_at=reg + timedelta(minutes=2),
        day1=DayInfo(at=d1, evaluated=True, watched_min=20, duration_min=74, ok=False, joined_at=d1),
        day2=DayInfo(at=d1 + timedelta(days=1), evaluated=False, watched_min=None, duration_min=82),
        reached_offer_at=None, clicked_buy_at=None, receipt_at=None, receipt_status=None, paid_at=None,
        payment_status="none")
    by = {s.key: s for s in funnel_path(p)}
    assert [s.key for s in funnel_path(p)] == ["start", "phone", "session", "day1", "day2", "offer", "buy",
                                               "receipt", "paid"]
    assert by["start"].detail == "manba: ig"
    assert by["day1"].state == "missed" and by["day1"].detail == "20 / 74 daq ko'rdi"
    assert by["day2"].state == "wait" and by["day2"].detail == "rejada"
    assert by["paid"].state == "wait"
    p.now = d1 + timedelta(days=1, hours=2)  # 2-kun o'tdi, worker hali baholamagan
    assert {s.key: s for s in funnel_path(p)}["day2"].state == "missed"
    p.now = None

    p.day2 = DayInfo(at=d1 + timedelta(days=1), evaluated=True, watched_min=30, duration_min=82)
    p.payment_status, p.paid_at = "deposit", d1 + timedelta(days=1, hours=2)
    by = {s.key: s for s in funnel_path(p)}
    assert by["day2"].state == "done"
    assert by["offer"].state == "missed"
    assert by["paid"].state == "done" and by["paid"].detail == "boshlang'ich"


# ─────────────────────────── avtomatik o'tishlar ───────────────────────────

async def test_receipt_and_approval_move_stage(db, bot):
    f = await make_funnel(db)
    lead = await make_lead(db, f, tash(TUE, 9))
    tariff = (await db.execute(select(Tariff))).scalar_one()
    p = await pay.create_receipt(db, lead, tariff_id=tariff.id, method="card", kind="deposit", amount=100_000,
                                 data=b"r1", mime="image/jpeg", ext=".jpg")
    assert lead.stage == "waiting_payment"
    await pay.reject(bot, db, p.id, "Summa mos emas", "Nodira")
    await db.refresh(lead)
    assert lead.stage == "waiting_payment"  # chek rad etilsa ham lid to'lov kutilayotganlar orasida
    p2 = await pay.create_receipt(db, lead, tariff_id=tariff.id, method="card", kind="deposit", amount=100_000,
                                  data=b"r2", mime="image/jpeg", ext=".jpg")
    await pay.approve(bot, db, p2.id, "Nodira")
    await db.refresh(lead)
    assert lead.stage == "won"
    events = (await db.execute(select(LeadEvent.data).where(LeadEvent.lead_id == lead.id,
                                                             LeadEvent.type == "stage"))).scalars().all()
    assert [e["stage"] for e in events] == ["waiting_payment", "won"]


# ─────────────────────────── API ───────────────────────────

@pytest.fixture
async def client():
    from app.main import app
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


async def sales_headers(db) -> tuple[AdminUser, dict]:
    u = AdminUser(login="nodira", name="Nodira", role="sales", password_hash="x")
    db.add(u)
    await db.commit()
    return u, {"Authorization": f"Bearer {create_token(u)}"}


async def test_pipeline_columns_and_moves(db, client):
    f = await make_funnel(db)
    a = await make_lead(db, f, tash(TUE, 9), tg=1)
    b = await make_lead(db, f, tash(TUE, 10), tg=2)
    c = await make_lead(db, f, tash(TUE, 11), tg=3)
    u, h = await sales_headers(db)

    board = (await client.get(f"/api/admin/pipeline?funnel_id={f.id}", headers=h)).json()["stages"]
    assert [s["key"] for s in board] == ["new", "contacted", "callback", "waiting_payment", "won", "lost"]
    assert board[0]["count"] == 3 and len(board[0]["items"]) == 3
    assert board[0]["items"][0]["step_label"] == "Sessiya tanlamadi"

    # aloqa natijasi bosqichni o'zgartiradi
    r = await client.post(f"/api/admin/leads/{a.id}/contact", headers=h, json={"result": "no_answer", "note": ""})
    assert r.json()["stage"] == "contacted"
    # qayta qo'ng'iroq ustuniga — faqat vaqt bilan
    r = await client.post(f"/api/admin/leads/{b.id}/stage", headers=h, json={"stage": "callback"})
    assert r.status_code == 400
    soon = now_utc() + timedelta(hours=2)
    r = await client.post(f"/api/admin/leads/{b.id}/stage", headers=h,
                          json={"stage": "callback", "callback_at": soon.isoformat(), "note": "kechqurun"})
    assert r.json()["stage"] == "callback"
    r = await client.post(f"/api/admin/leads/{c.id}/stage", headers=h, json={"stage": "lost", "note": "qimmat"})
    assert r.json()["stage"] == "lost"
    assert (await client.post(f"/api/admin/leads/{c.id}/stage", headers=h, json={"stage": "x"})).status_code == 400

    board = {s["key"]: s for s in (await client.get(f"/api/admin/pipeline?funnel_id={f.id}", headers=h)).json()["stages"]}
    assert board["new"]["count"] == 0
    assert [x["id"] for x in board["contacted"]["items"]] == [a.id]
    cb = board["callback"]["items"][0]
    assert cb["id"] == b.id and cb["callback_at"] and cb["note"] == "kechqurun"
    assert board["lost"]["items"][0]["note"] == "qimmat"

    # sotildi deb surilganda qayta qo'ng'iroq eslatmasi endi kelmaydi
    await client.post(f"/api/admin/leads/{b.id}/stage", headers=h, json={"stage": "won"})
    log = (await db.execute(select(ContactLog).where(ContactLog.lead_id == b.id))).scalar_one()
    await db.refresh(log)
    assert log.reminded

    # bitta ustunning keyingi sahifasi va filtr
    more = (await client.get(f"/api/admin/pipeline?funnel_id={f.id}&stage=won&offset=0", headers=h)).json()
    assert [x["id"] for x in more["items"]] == [b.id]
    mine = (await client.get(f"/api/admin/pipeline?funnel_id={f.id}&manager_id={u.id}", headers=h)).json()
    assert sum(s["count"] for s in mine["stages"]) == 0


async def test_lead_card_has_path_and_stage(db, client):
    f = await make_funnel(db)
    lead = await make_lead(db, f, tash(TUE, 9))
    db.add(LeadSession(lead_id=lead.id, day1_at=tash(TUE, 20), day2_at=tash(TUE, 20) + timedelta(days=1)))
    await db.commit()
    _, h = await sales_headers(db)
    card = (await client.get(f"/api/admin/leads/{lead.id}", headers=h)).json()
    assert card["stage"] == "new" and card["stage_label"] == "Yangi"
    states = {p["key"]: p["state"] for p in card["path"]}
    assert states["phone"] == "done" and states["session"] == "done" and states["paid"] == "wait"
