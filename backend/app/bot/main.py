"""Botni long polling rejimida ishga tushirish: python -m app.bot.main"""
import asyncio
import logging
from typing import Any, Awaitable, Callable

from aiogram import BaseMiddleware, Dispatcher
from aiogram.exceptions import TelegramForbiddenError
from aiogram.fsm.storage.redis import RedisStorage
from aiogram.types import BotCommand, TelegramObject

from app.bot.handlers import router
from app.config import get_settings
from app.db import SessionLocal
from app.services.tg import get_bot


class DbMiddleware(BaseMiddleware):
    async def __call__(self, handler: Callable[[TelegramObject, dict[str, Any]], Awaitable[Any]],
                       event: TelegramObject, data: dict[str, Any]) -> Any:
        async with SessionLocal() as session:
            data["db"] = session
            try:
                return await handler(event, data)
            except TelegramForbiddenError:
                logging.info("Foydalanuvchi botni bloklagan")


async def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    bot = get_bot()
    dp = Dispatcher(storage=RedisStorage.from_url(get_settings().redis_url))
    dp.update.outer_middleware(DbMiddleware())
    dp.include_router(router)
    await bot.set_my_commands([BotCommand(command="start", description="Boshlash")])
    await dp.start_polling(bot, allowed_updates=dp.resolve_used_update_types())


if __name__ == "__main__":
    asyncio.run(main())
