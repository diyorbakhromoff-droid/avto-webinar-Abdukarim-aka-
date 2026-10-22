"""Bitta aiogram Bot obyekti — API, bot va worker jarayonlarida ishlatiladi."""
from aiogram import Bot
from aiogram.client.default import DefaultBotProperties
from aiogram.enums import ParseMode

from app.config import get_settings

_bot: Bot | None = None


def get_bot() -> Bot:
    global _bot
    if _bot is None:
        _bot = Bot(get_settings().bot_token, default=DefaultBotProperties(parse_mode=ParseMode.HTML))
    return _bot
