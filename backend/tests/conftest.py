import os

os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://avtowebinar:avtowebinar@localhost:5432/avtowebinar_test")
os.environ.setdefault("BOT_TOKEN", "123456:TEST-TOKEN")
os.environ.setdefault("BOT_USERNAME", "avtowebinar_test_bot")
os.environ.setdefault("JWT_SECRET", "test-secret")
os.environ.setdefault("STORAGE_DIR", "/tmp/avtowebinar-test-storage")
os.environ.setdefault("MINIAPP_URL", "https://app.test")

from types import SimpleNamespace  # noqa: E402

import pytest  # noqa: E402
import pytest_asyncio  # noqa: E402
from sqlalchemy import text  # noqa: E402

from app.db import SessionLocal, engine  # noqa: E402
from app.models import Base  # noqa: E402


def pytest_collection_modifyitems(items):
    for item in items:
        if pytest_asyncio.is_async_test(item):
            item.add_marker(pytest.mark.asyncio(loop_scope="session"), append=False)


@pytest_asyncio.fixture(scope="session", autouse=True)
async def schema():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    yield
    await engine.dispose()


@pytest_asyncio.fixture
async def db():
    async with SessionLocal() as session:
        yield session
    async with engine.begin() as conn:
        tables = ", ".join(t.name for t in Base.metadata.sorted_tables)
        await conn.execute(text(f"TRUNCATE {tables} RESTART IDENTITY CASCADE"))


class FakeBot:
    """Telegram chaqiruvlarini yozib boradi."""

    def __init__(self):
        self.calls = []
        self._id = 0

    def _msg(self, chat_id):
        self._id += 1
        return SimpleNamespace(message_id=self._id, chat=SimpleNamespace(id=chat_id), photo=None, video=None,
                               video_note=None, voice=None, audio=None, document=None, animation=None)

    def __getattr__(self, name):
        async def call(*args, **kwargs):
            self.calls.append((name, args, kwargs))
            if name == "create_chat_invite_link":
                return SimpleNamespace(invite_link="https://t.me/+invite")
            chat = kwargs.get("chat_id", args[0] if args else 0)
            return self._msg(chat)
        return call

    def texts(self, method="send_message"):
        return [(a[1] if len(a) > 1 else k.get("text")) for n, a, k in self.calls if n == method]


@pytest.fixture
def bot():
    return FakeBot()
