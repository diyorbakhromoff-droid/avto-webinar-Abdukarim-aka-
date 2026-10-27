"""Test xabari (faqat admin / test chati) va xabarlar vaqtini boshqarish (oraliq, aniq sana, kechikish)."""
from datetime import timedelta

import pytest
from aiogram.exceptions import TelegramBadRequest, TelegramForbiddenError
from aiogram.methods import SendMessage
from httpx import ASGITransport, AsyncClient
from sqlalchemy import func, select

from app.domain.planning import ChainItem, SessionTimes, plan_chain, stale_reason
from app.models import (
    AdminUser, AuditLog, Broadcast, ChainMessage, KeyValue, LeadEvent, LeadSession, ScheduledMessage,
)
from app.security.auth import create_token
from app.services import test_send
from app.services.sessions import plan_for_session
from app.timeutil import now_utc
from app.worker import jobs, sender
from tests.test_flows import TUE, make_funnel, make_lead, tash

BUTTONS = [[{"type": "url", "text": "Sayt", "url": "https://example.uz"}, {"type": "pay", "text": "Yozilish"}],
           [{"type": "webapp", "text": "Efirga kirish"}, {"type": "reschedule", "text": "Vaqtni o'zgartirish"}]]


@pytest.fixture
async def client():
    from app.main import app
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


@pytest.fixture
def tg(bot, monkeypatch):
    for mod in ("app.api.admin.chain", "app.api.admin.ops", "app.api.admin.system"):
        monkeypatch.setattr(f"{mod}.get_bot", lambda: bot)
    return bot


async def admin(db, role="content", tg_id=777) -> tuple[AdminUser, dict]:
    u = AdminUser(login=f"u{tg_id}", name="Kamola", role=role, password_hash="x", tg_user_id=tg_id)
    db.add(u)
    await db.commit()
    return u, {"Authorization": f"Bearer {create_token(u)}"}


def markup_of(call) -> list:
    return [b for row in call[2]["reply_markup"].inline_keyboard for b in row]


# ─────────────────────────── 1. test xabari ───────────────────────────

async def test_test_message_goes_only_to_admin(db, client, tg):
    f = await make_funnel(db)
    lead = await make_lead(db, f, tash(TUE, 9))
    m = ChainMessage(funnel_id=f.id, title="Taklif", text="<b>Salom {ism}</b> 🎉 efir {efir_vaqti} da",
                     trigger_type="after_registration", offset_minutes=10, buttons=BUTTONS)
    db.add(m)
    await db.commit()
    _, h = await admin(db)
    r = await client.post(f"/api/admin/chain/{m.id}/test", headers=h, json={"target": "me", "sample_name": "Aziza"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["target"] == "Sizning Telegramingiz" and body["variables"]["ism"] == "Aziza"
    sends = [c for c in tg.calls if c[0] == "send_message"]
    assert [c[1][0] for c in sends] == [777, 777]                  # sarlavha + xabarning o'zi, faqat adminga
    assert "TEST" in sends[0][1][1]
    text = sends[1][1][1]
    assert text.startswith("<b>Salom Aziza</b> 🎉 efir ") and "[TEST]" not in text   # asl ko'rinishida
    buttons = markup_of(sends[1])
    assert buttons[0].url == "https://example.uz"                 # havola asl manzilga (hisoblagichsiz)
    assert buttons[1].callback_data == "t:pay"                    # bosilsa lid uchun hech narsa bo'lmaydi
    assert buttons[2].web_app is not None                         # shaxsiy chatda Mini App ochiladi
    assert buttons[3].callback_data == "t:reschedule"
    # lidlar va navbat tegilmagan
    assert (await db.execute(select(func.count()).select_from(ScheduledMessage))).scalar() == 0
    assert not (await db.execute(select(LeadEvent).where(LeadEvent.lead_id == lead.id))).first()
    assert (await db.execute(select(AuditLog.action))).scalars().all() == ["test_sent"]


async def test_test_chat_target_and_clear_errors(db, client, tg):
    await make_funnel(db)
    m = (await db.execute(select(ChainMessage).where(ChainMessage.title == "Spiker"))).scalar_one()
    m.buttons = BUTTONS
    await db.commit()
    _, h = await admin(db)
    r = await client.post(f"/api/admin/chain/{m.id}/test", headers=h, json={"target": "chat"})
    assert r.status_code == 400 and "Test chati sozlanmagan" in r.json()["detail"]
    r = await client.post(f"/api/admin/chain/{m.id}/test", headers=h, json={"target": "-100999"})
    assert r.status_code == 400                                   # ixtiyoriy chat ID qabul qilinmaydi
    db.add(KeyValue(key="test_chat_id", value=-100500))
    await db.commit()
    r = await client.post(f"/api/admin/chain/{m.id}/test", headers=h, json={"target": "chat"})
    assert r.status_code == 200 and r.json()["target"] == "Test chati"
    assert any("Mini App" in n for n in r.json()["notes"])
    sends = [c for c in tg.calls if c[0] == "send_message"]
    assert {c[1][0] for c in sends} == {-100500}
    assert markup_of(sends[1])[2].callback_data == "t:webapp"     # guruhda Mini App tugmasi ishlamaydi

    async def blocked(*a, **k):
        raise TelegramForbiddenError(method=None, message="Forbidden: bot was kicked")
    tg.send_message = blocked
    r = await client.post(f"/api/admin/chain/{m.id}/test", headers=h, json={"target": "chat"})
    assert r.status_code == 400 and "botni guruhga qo'shing" in r.json()["detail"]

    _, h2 = await admin(db, tg_id=None)
    r = await client.post(f"/api/admin/chain/{m.id}/test", headers=h2, json={"target": "me"})
    assert r.status_code == 400 and "Telegram ID" in r.json()["detail"]


def test_telegram_errors_are_explained():
    bad = TelegramBadRequest(method=SendMessage(chat_id=1, text="x"), message="Bad Request: chat not found")
    assert "Chat topilmadi" in test_send.explain(bad)
    parse = TelegramBadRequest(method=SendMessage(chat_id=1, text="x"), message="Bad Request: can't parse entities")
    assert "formatlash" in test_send.explain(parse)


async def test_test_with_real_lead_data_and_unknown_variable(db, client, tg):
    f = await make_funnel(db)
    lead = await make_lead(db, f, tash(TUE, 9))
    db.add(LeadSession(lead_id=lead.id, day1_at=tash(TUE, 20), day2_at=tash(TUE, 20) + timedelta(days=1)))
    await db.commit()
    _, h = await admin(db, role="sales")
    r = await client.post("/api/admin/broadcasts/test", headers=h, json={
        "text": "{ism}, efir {efir_vaqti} da. {promo}", "target": "me", "funnel_id": f.id, "lead_id": lead.id})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["variables"]["ism"] == "Madina" and body["variables"]["efir_vaqti"] == "20:00"
    assert any("{promo}" in n for n in body["notes"])
    assert [c for c in tg.calls if c[0] == "send_message"][1][1][1] == "Madina, efir 20:00 da. {promo}"


async def test_test_button_handler_only_explains(db):
    from app.bot.handlers import test_button
    answers = []

    class Call:
        data = "t:pay"

        async def answer(self, text=None, show_alert=False):
            answers.append((text, show_alert))
    await test_button(Call())
    assert answers and "tariflar" in answers[0][0] and answers[0][1]


# ─────────────────────────── 2. vaqtlar ───────────────────────────

def times(reg, day1):
    return SessionTimes(reg, day1, day1 + timedelta(days=1), 74 * 60, 82 * 60, day1 + timedelta(days=2))


def test_exact_datetime_planning():
    reg, day1 = tash(TUE, 9), tash(TUE, 20)
    at = tash(TUE, 17, 30)
    item = ChainItem(1, "Aniq", "at_datetime", None, 0, False, fixed_at=at)
    p = plan_chain([item], times(reg, day1), reg)[0]
    assert p.send_at == at and not p.session_bound           # efir vaqti o'zgarsa ham o'zgarmaydi
    assert plan_chain([item], times(reg, day1 + timedelta(days=1)), reg)[0].send_at == at
    late = plan_chain([item], times(reg, day1), at + timedelta(minutes=10))[0]
    assert late.status == "skipped" and late.send_at is None  # o'tib ketgan vaqt — yuborilmaydi


def test_stale_reason_rules():
    now = tash(TUE, 20, 5)
    start = tash(TUE, 20)
    assert stale_reason("before_day", tash(TUE, 19, 30), now, day_start=start)       # efir boshlangan
    assert stale_reason("before_day", tash(TUE, 19, 30), tash(TUE, 19, 50), day_start=start) is None
    assert stale_reason("at_day_start", start, now, day_start=start, day_end=start + timedelta(hours=1)) is None
    assert stale_reason("after_registration", now - timedelta(hours=7), now)         # 6 soatdan ko'p kechikdi
    assert stale_reason("after_registration", now - timedelta(hours=2), now) is None
    assert stale_reason("at_datetime", now - timedelta(hours=2), now)                # aniq vaqt: 1 soat


async def test_each_lead_follows_own_session(db):
    """Eslatmalar har bir lidning tanlagan seansiga nisbatan; bir lidning o'zgarishi boshqasiga ta'sir qilmaydi."""
    f = await make_funnel(db)
    for off in (180, 60, 30):
        db.add(ChainMessage(funnel_id=f.id, title=f"{off} daq qoldi", text="x", trigger_type="before_day",
                            trigger_day=1, offset_minutes=off))
    await db.commit()
    a = await make_lead(db, f, tash(TUE, 8), tg=1)
    b = await make_lead(db, f, tash(TUE, 9), tg=2)
    sa = LeadSession(lead_id=a.id, day1_at=tash(TUE, 14), day2_at=tash(TUE, 14) + timedelta(days=1))
    sb = LeadSession(lead_id=b.id, day1_at=tash(TUE, 20), day2_at=tash(TUE, 20) + timedelta(days=1))
    db.add_all([sa, sb])
    await db.flush()
    now = tash(TUE, 9, 30)
    await plan_for_session(db, a, sa, f, now=now)
    await plan_for_session(db, b, sb, f, now=now)
    await db.commit()

    async def reminders(lead):
        rows = (await db.execute(select(ChainMessage.title, ScheduledMessage.send_at).join(
            ChainMessage, ChainMessage.id == ScheduledMessage.chain_message_id).where(
            ScheduledMessage.lead_id == lead.id, ScheduledMessage.status == "pending",
            ChainMessage.title.like("%daq qoldi")))).all()
        return dict(rows)
    assert await reminders(a) == {"180 daq qoldi": tash(TUE, 11), "60 daq qoldi": tash(TUE, 13),
                                  "30 daq qoldi": tash(TUE, 13, 30)}
    assert await reminders(b) == {"180 daq qoldi": tash(TUE, 17), "60 daq qoldi": tash(TUE, 19),
                                  "30 daq qoldi": tash(TUE, 19, 30)}
    sa.day1_at = tash(TUE, 16)
    await plan_for_session(db, a, sa, f, now=now)
    await db.commit()
    assert (await reminders(a))["30 daq qoldi"] == tash(TUE, 15, 30)
    assert (await reminders(b))["30 daq qoldi"] == tash(TUE, 19, 30)


async def test_timing_patch_with_presets_and_shift(db, client):
    f = await make_funnel(db)
    for title, off in (("A", 0), ("B", 15), ("C", 45)):
        db.add(ChainMessage(funnel_id=f.id, title=title, text="x", trigger_type="after_registration",
                            offset_minutes=off))
    await db.commit()
    lead = await make_lead(db, f, now_utc() - timedelta(minutes=5))
    day1 = now_utc() + timedelta(days=2)
    s = LeadSession(lead_id=lead.id, day1_at=day1, day2_at=day1 + timedelta(days=1))
    db.add(s)
    await db.flush()
    await plan_for_session(db, lead, s, f)
    await db.commit()
    _, h = await admin(db)
    by = {m.title: m for m in (await db.execute(select(ChainMessage))).scalars()}

    r = await client.patch(f"/api/admin/chain/{by['B'].id}/timing", headers=h, json={
        "trigger_type": "after_registration", "offset_minutes": 30, "shift_following": True})
    assert r.status_code == 200 and r.json()["shifted"] == 2      # C va "Spiker" (240) — B dan keyingilar
    for m in by.values():
        await db.refresh(m)
    assert (by["A"].offset_minutes, by["B"].offset_minutes, by["C"].offset_minutes) == (0, 30, 60)  # oraliq saqlandi
    assert by["Spiker"].offset_minutes == 255 and by["2 soat"].offset_minutes == 120   # boshqa guruh tegilmadi
    sm = (await db.execute(select(ScheduledMessage).where(ScheduledMessage.chain_message_id == by["B"].id,
                                                          ScheduledMessage.status == "pending"))).scalar_one()
    assert sm.send_at == lead.phone_at + timedelta(minutes=30)    # navbat ham yangi vaqtga ko'chdi

    # aniq sana-vaqt: o'tib ketgan vaqt qabul qilinmaydi, kelajakdagisi saqlanadi
    past = (now_utc() - timedelta(hours=1)).isoformat()
    r = await client.patch(f"/api/admin/chain/{by['C'].id}/timing", headers=h,
                           json={"trigger_type": "at_datetime", "fixed_at": past})
    assert r.status_code == 400
    at = (now_utc() + timedelta(hours=3)).replace(microsecond=0)
    r = await client.patch(f"/api/admin/chain/{by['C'].id}/timing", headers=h,
                           json={"trigger_type": "at_datetime", "fixed_at": at.isoformat()})
    assert r.status_code == 200, r.text
    sm = (await db.execute(select(ScheduledMessage).where(ScheduledMessage.chain_message_id == by["C"].id,
                                                          ScheduledMessage.status == "pending"))).scalar_one()
    assert sm.send_at == at

    page = (await client.get(f"/api/admin/funnels/{f.id}/timing", headers=h)).json()
    rows = {m["title"]: m for m in page["messages"]}
    assert rows["B"]["rule"] == "ro'yxatdan 30 daq keyin" and rows["B"]["pending"] == 1
    assert rows["C"]["planned_at"] and rows["C"]["trigger_type"] == "at_datetime"
    assert page["sample"]["day1_options"]

    # bitta lidning bitta xabarini bekor qilish
    q = (await client.get(f"/api/admin/chain/{by['C'].id}/queue", headers=h)).json()
    assert q["total"] == 1
    r = await client.post(f"/api/admin/scheduled/{q['items'][0]['id']}/cancel", headers=h)
    assert r.status_code == 200
    assert (await client.post(f"/api/admin/scheduled/{q['items'][0]['id']}/cancel", headers=h)).status_code == 400


async def test_sender_skips_stale_reminder_and_restart_keeps_queue(db, bot):
    f = await make_funnel(db)
    lead = await make_lead(db, f, tash(TUE, 9))
    start = now_utc() - timedelta(minutes=10)                     # efir 10 daqiqa oldin boshlangan
    s = LeadSession(lead_id=lead.id, day1_at=start, day2_at=start + timedelta(days=1))
    db.add(s)
    await db.flush()
    m = (await db.execute(select(ChainMessage).where(ChainMessage.title == "2 soat"))).scalar_one()
    stale = ScheduledMessage(lead_id=lead.id, chain_message_id=m.id, session_id=s.id, dedupe_key="x1",
                             send_at=start - timedelta(hours=2), status="sending")
    spiker = (await db.execute(select(ChainMessage).where(ChainMessage.title == "Spiker"))).scalar_one()
    fresh = ScheduledMessage(lead_id=lead.id, chain_message_id=spiker.id, dedupe_key=f"c{spiker.id}",
                             send_at=now_utc() - timedelta(minutes=1), status="sending")
    db.add_all([stale, fresh])
    await db.commit()

    assert await sender.recover_after_restart() == 2              # worker o'chib-yondi: navbat joyida
    for sm in (stale, fresh):
        await db.refresh(sm)
        assert sm.status == "pending"
        sm.status = "sending"
    await db.commit()
    for sm in (stale, fresh):
        await sender.send_one(bot, sender.RateLimiter(1000), sm.id)
        await db.refresh(sm)
    assert stale.status == "skipped" and "efir boshlanib" in stale.reason
    assert fresh.status == "sent" and bot.texts() == ["Spiker: Madina"]
    # qayta rejalashtirish yuborilganini takrorlamaydi
    await plan_for_session(db, lead, s, f)
    await db.commit()
    n = (await db.execute(select(func.count()).select_from(ScheduledMessage).where(
        ScheduledMessage.chain_message_id == spiker.id))).scalar()
    assert n == 1


async def test_broadcast_reschedule_cancel_and_expire(db, client):
    f = await make_funnel(db)
    await make_lead(db, f, tash(TUE, 9))
    _, h = await admin(db)
    at = (now_utc() + timedelta(days=1)).isoformat()
    b = (await client.post(f"/api/admin/funnels/{f.id}/broadcasts", headers=h,
                           json={"segment": "all", "text": "Salom", "send_at": at})).json()
    past = (now_utc() - timedelta(hours=2)).isoformat()
    assert (await client.put(f"/api/admin/broadcasts/{b['id']}", headers=h, json={"send_at": past})).status_code == 400
    r = await client.post(f"/api/admin/broadcasts/{b['id']}/cancel", headers=h)
    assert r.json()["status"] == "cancelled"
    await jobs.expand_broadcasts()
    assert (await db.execute(select(func.count()).select_from(ScheduledMessage))).scalar() == 0

    # server to'xtab qolgan: aniq vaqti 3 soat oldin o'tgan xabar kech yuborilmaydi
    old = Broadcast(funnel_id=f.id, segment="all", text="Kech", send_at=now_utc() - timedelta(hours=3))
    db.add(old)
    await db.commit()
    await jobs.expand_broadcasts()
    await db.refresh(old)
    assert old.status == "expired"
    assert (await db.execute(select(func.count()).select_from(ScheduledMessage))).scalar() == 0


# ─────────────────────────── test guruhini ulash ───────────────────────────

async def test_test_chat_follows_supergroup_migration(db, client, tg):
    from types import SimpleNamespace

    from aiogram.exceptions import TelegramMigrateToChat
    from aiogram.methods import GetChat
    _, h = await admin(db, role="super_admin")
    seen = []

    async def get_chat(chat_id):
        seen.append(chat_id)
        if chat_id == -4354067159:   # oddiy guruh superguruhga aylangan
            raise TelegramMigrateToChat(method=GetChat(chat_id=chat_id), message="migrated",
                                        migrate_to_chat_id=-1004354067159)
        return SimpleNamespace(id=chat_id, title="Sotuv test", full_name=None)
    tg.get_chat = get_chat
    r = await client.put("/api/admin/settings", headers=h, json={"test_chat_id": -4354067159})
    assert r.status_code == 200, r.text
    assert r.json()["test_chat_id"] == -1004354067159 and r.json()["test_chat_title"] == "Sotuv test"
    assert seen == [-4354067159, -1004354067159]
    assert [c[1][0] for c in tg.calls if c[0] == "send_message"] == [-1004354067159]   # tasdiq yangi guruhga
    # admin guruhi sozlamasi tegilmadi
    assert r.json()["admin_group_chat_id"] is None

    async def missing(chat_id):
        raise TelegramBadRequest(method=GetChat(chat_id=chat_id), message="Bad Request: chat not found")
    tg.get_chat = missing
    r = await client.put("/api/admin/settings", headers=h, json={"test_chat_id": -555})
    assert r.status_code == 400 and "/chatid" in r.json()["detail"]


async def test_bot_announces_group_id_and_tracks_migration(db, bot):
    from types import SimpleNamespace

    from app.bot.handlers import added_to_group, group_migrated
    await added_to_group(SimpleNamespace(chat=SimpleNamespace(id=-100777)), bot)
    assert "-100777" in bot.texts()[0]
    db.add_all([KeyValue(key="test_chat_id", value=-4354067159), KeyValue(key="admin_group_chat_id", value=-999)])
    await db.commit()
    msg = SimpleNamespace(chat=SimpleNamespace(id=-4354067159), migrate_to_chat_id=-1004354067159)
    await group_migrated(msg, db, bot)
    kv = await db.get(KeyValue, "test_chat_id")
    await db.refresh(kv)
    assert kv.value == -1004354067159
    other = await db.get(KeyValue, "admin_group_chat_id")
    await db.refresh(other)
    assert other.value == -999
