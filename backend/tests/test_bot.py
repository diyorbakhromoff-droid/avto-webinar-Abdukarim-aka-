"""Bot handlerlari: aiogram Dispatcher orqali to'liq oqim (Telegram so'rovlari soxta sessiyada)."""
from datetime import datetime, timezone
from typing import Any

import pytest
from aiogram import Bot, Dispatcher
from aiogram.client.session.base import BaseSession
from aiogram.fsm.storage.memory import MemoryStorage
from aiogram.methods import GetFile, TelegramMethod
from aiogram.types import (
    CallbackQuery, Chat, Contact, Document, File, Message, PhotoSize, Update, User,
)
from sqlalchemy import select

from app.bot.handlers import router
from app.bot.main import DbMiddleware
from app.models import AdminUser, KeyValue, Lead, LeadSession, Payment
from tests.test_flows import make_funnel

USER = User(id=4242, is_bot=False, first_name="Madina", username="madina_k")
ADMIN = User(id=777, is_bot=False, first_name="Nodira")
STRANGER = User(id=999, is_bot=False, first_name="Begona")
GROUP = Chat(id=-1001, type="supergroup", title="Cheklar")


class RecordingSession(BaseSession):
    def __init__(self):
        super().__init__()
        self.requests: list[TelegramMethod] = []
        self._id = 100

    async def close(self) -> None:
        pass

    async def make_request(self, bot: Bot, method: TelegramMethod[Any], timeout: int | None = None) -> Any:
        self.requests.append(method)
        name = type(method).__name__
        if isinstance(method, GetFile):
            return File(file_id=method.file_id, file_unique_id="u", file_path="receipts/1.jpg")
        if name.startswith("Send"):
            self._id += 1
            chat_id = getattr(method, "chat_id", 0)
            return Message(message_id=self._id, date=datetime.now(timezone.utc),
                           chat=Chat(id=chat_id, type="private" if chat_id > 0 else "supergroup"),
                           text=getattr(method, "text", None))
        if name == "CreateChatInviteLink":
            from aiogram.types import ChatInviteLink
            return ChatInviteLink(invite_link="https://t.me/+x", creator=USER, creates_join_request=False,
                                  is_primary=False, is_revoked=False)
        return True

    async def stream_content(self, url, headers=None, timeout=30, chunk_size=65536, raise_for_status=True):
        yield b"fake-receipt-image"

    def sent(self, name="SendMessage", chat_id=None) -> list:
        return [r for r in self.requests if type(r).__name__ == name
                and (chat_id is None or getattr(r, "chat_id", None) == chat_id)]


# router faqat bitta dispatcherga ulanadi — testlar uchun bitta dispatcher
_dp = Dispatcher(storage=MemoryStorage())
_dp.update.outer_middleware(DbMiddleware())
_dp.include_router(router)


@pytest.fixture
def tg(monkeypatch):
    session = RecordingSession()
    bot = Bot("123456:TEST-TOKEN", session=session)
    _dp.fsm.storage = MemoryStorage()
    monkeypatch.setattr("app.services.tg._bot", bot)
    return bot, _dp, session


_uid = 0


def _next() -> int:
    global _uid
    _uid += 1
    return _uid


def msg(user: User, chat: Chat | None = None, **kw) -> Update:
    chat = chat or Chat(id=user.id, type="private")
    return Update(update_id=_next(), message=Message(message_id=_next(), date=datetime.now(timezone.utc),
                                                     chat=chat, from_user=user, **kw))


def cb(user: User, data: str, chat: Chat | None = None) -> Update:
    chat = chat or Chat(id=user.id, type="private")
    m = Message(message_id=_next(), date=datetime.now(timezone.utc), chat=chat, text="x")
    return Update(update_id=_next(), callback_query=CallbackQuery(id=str(_next()), from_user=user,
                                                                 chat_instance="ci", message=m, data=data))


def buttons(method) -> list[str]:
    kb = method.reply_markup
    if kb is None or not hasattr(kb, "inline_keyboard"):
        return []
    return [b.callback_data or b.url or "" for row in kb.inline_keyboard for b in row]


async def test_full_bot_flow(db, tg):
    bot, dp, s = tg
    f = await make_funnel(db, card_number="8600 1111 2222 3333", card_holder="Ism Familiya")
    db.add(AdminUser(login="nodira", name="Nodira", role="sales", password_hash="x", tg_user_id=ADMIN.id))
    db.add(KeyValue(key="admin_group_chat_id", value=GROUP.id))
    await db.commit()

    await dp.feed_update(bot, msg(USER, text="/start arab_ig_reels3"))
    lead = (await db.execute(select(Lead).where(Lead.tg_user_id == USER.id))).scalar_one()
    assert lead.source == "ig_reels3" and lead.step == "started"
    assert any("telefon" in (m.text or "").lower() for m in s.sent())

    # boshqa birovning kontakti qabul qilinmaydi, o'ziniki — qabul qilinadi
    await dp.feed_update(bot, msg(USER, contact=Contact(phone_number="+998901112233", first_name="X", user_id=1)))
    await db.refresh(lead)
    assert lead.phone is None
    await dp.feed_update(bot, msg(USER, contact=Contact(phone_number="998901234567", first_name="M",
                                                        user_id=USER.id)))
    await db.refresh(lead)
    assert lead.phone == "+998 90 123 45 67" and lead.step == "phone"
    slot_msg = [m for m in s.sent() if any(b.startswith("slot1:") for b in buttons(m))][-1]
    first_slot = [b for b in buttons(slot_msg) if b.startswith("slot1:")][0]

    await dp.feed_update(bot, cb(USER, first_slot))
    sess = (await db.execute(select(LeadSession).where(LeadSession.lead_id == lead.id))).scalar_one()
    assert int(sess.day1_at.timestamp()) == int(first_slot.split(":")[1])
    assert any("band qilindi" in (m.text or "") for m in s.sent())

    # to'lov: tarif -> usul -> summa -> rekvizitlar -> chek
    await dp.feed_update(bot, cb(USER, "buy:"))
    await db.refresh(lead)
    assert lead.step == "clicked_buy"
    tariff_btn = [b for m in s.sent() for b in buttons(m) if b.startswith("tariff:")][0]
    await dp.feed_update(bot, cb(USER, tariff_btn))
    tid = tariff_btn.split(":")[1]
    await dp.feed_update(bot, cb(USER, f"method:{tid}:card"))
    assert any(b == f"amount:{tid}:card:deposit" for m in s.sent() for b in buttons(m))
    await dp.feed_update(bot, cb(USER, f"amount:{tid}:card:deposit"))
    assert any("8600 1111 2222 3333" in (m.text or "") for m in s.sent())

    await dp.feed_update(bot, msg(USER, photo=[PhotoSize(file_id="ph1", file_unique_id="u1", width=10, height=10)]))
    p = (await db.execute(select(Payment))).scalar_one()
    assert (p.kind, p.amount, p.method, p.status) == ("deposit", 100_000, "card", "pending")
    group_post = s.sent("SendPhoto", GROUP.id)
    assert group_post and buttons(group_post[0]) == [f"pay_ok:{p.id}", f"pay_no:{p.id}"]

    # ro'yxatda yo'q odam tasdiqlay olmaydi
    await dp.feed_update(bot, cb(STRANGER, f"pay_ok:{p.id}", GROUP))
    await db.refresh(p)
    assert p.status == "pending"
    await dp.feed_update(bot, cb(ADMIN, f"pay_ok:{p.id}", GROUP))
    await db.refresh(p)
    await db.refresh(lead)
    assert p.status == "approved" and p.decided_by == "Nodira"
    assert lead.payment_status == "deposit"
    edits = [r for r in s.requests if type(r).__name__ == "EditMessageCaption"]
    assert edits and "Tasdiqlandi — Nodira" in edits[-1].caption


async def test_pdf_receipt_and_unsubscribe(db, tg):
    bot, dp, s = tg
    await make_funnel(db)
    await dp.feed_update(bot, msg(USER, text="/start arab"))
    await dp.feed_update(bot, msg(USER, text="90 123 45 67"))
    lead = (await db.execute(select(Lead).where(Lead.tg_user_id == USER.id))).scalar_one()
    assert lead.phone == "+998 90 123 45 67"
    await dp.feed_update(bot, msg(USER, text="Xabarlarni to'xtatish"))
    await db.refresh(lead)
    assert lead.unsubscribed
    # tarif tanlanmagan holda yuborilgan hujjat — avval tarif so'raladi
    await dp.feed_update(bot, msg(USER, document=Document(file_id="d1", file_unique_id="du",
                                                          mime_type="application/pdf", file_name="chek.pdf")))
    assert (await db.execute(select(Payment))).first() is None
