"""Worker: xabarlar navbati va davriy vazifalar. python -m app.worker.main"""
import asyncio
import logging

from app.config import get_settings
from app.services.tg import get_bot
from app.worker import jobs
from app.worker.sender import run_sender

log = logging.getLogger("worker")


async def every(seconds: float, fn, *args) -> None:
    while True:
        try:
            await fn(*args)
        except Exception:
            log.exception("Davriy vazifada xato: %s", fn.__name__)
        await asyncio.sleep(seconds)


async def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    bot = get_bot()
    await asyncio.gather(
        run_sender(bot, get_settings().send_rate_per_sec),
        every(15, jobs.evaluate_days),
        every(30, jobs.left_live),
        every(3, jobs.flow_events),
        every(10, jobs.flow_tick),
        every(20, jobs.expand_broadcasts),
        every(60, jobs.manager_reminders, bot),
        every(600, jobs.daily, bot),
    )


if __name__ == "__main__":
    asyncio.run(main())
