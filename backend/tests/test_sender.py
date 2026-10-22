"""Xabarlar navbati: segment yuborish paytida tekshiriladi, 403 — bloklash, 429 — keyinroq."""
from datetime import timedelta

from aiogram.exceptions import TelegramForbiddenError, TelegramRetryAfter
from sqlalchemy import select

from app.models import ChainMessage, Lead, ScheduledMessage
from app.timeutil import now_utc
from app.worker import sender
from tests.test_flows import TUE, make_funnel, make_lead, tash


async def queue(db, lead, title) -> ScheduledMessage:
    m = (await db.execute(select(ChainMessage).where(ChainMessage.title == title))).scalar_one()
    sm = ScheduledMessage(lead_id=lead.id, chain_message_id=m.id, dedupe_key=f"t{m.id}", send_at=now_utc(),
                          status="sending")
    db.add(sm)
    await db.commit()
    return sm


async def run(db, bot, sm):
    await sender.send_one(bot, sender.RateLimiter(1000), sm.id)
    await db.refresh(sm)
    return sm


async def test_sends_with_variables(db, bot):
    f = await make_funnel(db)
    lead = await make_lead(db, f, tash(TUE, 9))
    sm = await run(db, bot, await queue(db, lead, "Spiker"))
    assert sm.status == "sent"
    assert bot.texts() == ["Spiker: Madina"]


async def test_paid_lead_skips_deadline_message(db, bot):
    f = await make_funnel(db)
    lead = await make_lead(db, f, tash(TUE, 9))
    lead.payment_status = "full"
    await db.commit()
    sm = await run(db, bot, await queue(db, lead, "Deadline"))
    assert sm.status == "skipped" and sm.reason == "to'lagan"
    assert bot.calls == []


async def test_blocked_lead_on_403(db, bot):
    f = await make_funnel(db)
    lead = await make_lead(db, f, tash(TUE, 9))
    other = await queue(db, lead, "2 soat")
    other.status = "pending"
    await db.commit()

    async def forbidden(*a, **k):
        raise TelegramForbiddenError(method=None, message="Forbidden: bot was blocked by the user")
    bot.send_message = forbidden
    sm = await run(db, bot, await queue(db, lead, "Spiker"))
    await db.refresh(lead)
    await db.refresh(other)
    assert sm.status == "failed" and lead.blocked
    assert other.status == "cancelled"


async def test_retry_after_postpones(db, bot):
    f = await make_funnel(db)
    lead = await make_lead(db, f, tash(TUE, 9))

    async def flood(*a, **k):
        raise TelegramRetryAfter(method=None, message="Too Many Requests", retry_after=7)
    bot.send_message = flood
    sm = await run(db, bot, await queue(db, lead, "Spiker"))
    assert sm.status == "pending"
    assert sm.send_at >= now_utc() + timedelta(seconds=6)
    lead2 = await db.get(Lead, lead.id)
    assert not lead2.blocked
