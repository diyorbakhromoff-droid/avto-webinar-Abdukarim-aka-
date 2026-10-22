"""Slot tanlash mantiqi (TZ 5-bo'lim). Sof funksiyalar — bazaga bog'liq emas."""
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta

from app.timeutil import local_to_utc, parse_hhmm, to_local

DAY2_OFFSET = timedelta(hours=24)


@dataclass(frozen=True)
class SlotConfig:
    slot_times: tuple[time, ...] = (time(14, 0), time(20, 0))
    weekdays: frozenset[int] = frozenset(range(7))  # 0 = dushanba
    excluded_dates: frozenset[date] = field(default_factory=frozenset)
    min_hours_before: float = 3          # N
    options_count: int = 2               # K
    late_entry_minutes: int = 15         # L

    @classmethod
    def from_funnel(cls, funnel) -> "SlotConfig":
        return cls(
            slot_times=tuple(sorted(parse_hhmm(t) for t in funnel.slot_times)),
            weekdays=frozenset(funnel.weekdays),
            excluded_dates=frozenset(funnel.excluded_dates or []),
            min_hours_before=funnel.min_hours_before,
            options_count=funnel.options_count,
            late_entry_minutes=funnel.late_entry_minutes,
        )


def is_broadcast_day(cfg: SlotConfig, d: date) -> bool:
    return d.weekday() in cfg.weekdays and d not in cfg.excluded_dates


def _candidates(cfg: SlotConfig, now: datetime, horizon_days: int):
    start_day = to_local(now).date()
    for i in range(horizon_days):
        d = start_day + timedelta(days=i)
        if not is_broadcast_day(cfg, d):
            continue
        for t in cfg.slot_times:
            yield d, local_to_utc(d, t)


def day1_options(cfg: SlotConfig, now: datetime, horizon_days: int = 21) -> list[datetime]:
    """1-kun uchun eng yaqin K ta variant.

    - 1-kun hozirdan kamida N soat keyin bo'ladi (progrevga vaqt qolishi uchun);
    - keyingi kuni ham efir bo'lishi shart, chunki 2-kun aynan 24 soatdan keyin.
    """
    earliest = now + timedelta(hours=cfg.min_hours_before)
    result: list[datetime] = []
    for d, dt in _candidates(cfg, now, horizon_days):
        if dt < earliest:
            continue
        if not is_broadcast_day(cfg, d + timedelta(days=1)):
            continue
        result.append(dt)
        if len(result) >= cfg.options_count:
            break
    return result


def day2_for(day1_at: datetime) -> datetime:
    return day1_at + DAY2_OFFSET


def day2_reschedule_options(cfg: SlotConfig, now: datetime, horizon_days: int = 21) -> list[datetime]:
    """1-kunni ko'rib, 2-kunni ko'rmagan lid uchun faqat 2-kun variantlari."""
    earliest = now + timedelta(hours=cfg.min_hours_before)
    result = [dt for _, dt in _candidates(cfg, now, horizon_days) if dt >= earliest]
    return result[: cfg.options_count]


def can_change_day1(cfg: SlotConfig, now: datetime, day1_at: datetime) -> bool:
    """Lid 1-kun vaqtini kamida N soat oldin o'zgartira oladi."""
    return now <= day1_at - timedelta(hours=cfg.min_hours_before)


def late_entry_open(cfg: SlotConfig, now: datetime, day_start: datetime) -> bool:
    return day_start <= now < day_start + timedelta(minutes=cfg.late_entry_minutes)


def late_entry_warning(late_entry_minutes: int, day1_duration_sec: int) -> str | None:
    """L 1-kun videosining 25% idan oshsa, kech kirgan lid 75% ga yeta olmaydi."""
    if day1_duration_sec and late_entry_minutes * 60 > day1_duration_sec * 0.25:
        return ("Kech kirish (L) 1-kun videosining 25% idan katta: kech kirgan lid "
                "75% chegarasiga yeta olmaydi.")
    return None
