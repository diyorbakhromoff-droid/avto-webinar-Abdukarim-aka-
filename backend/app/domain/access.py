"""Mini App holati (TZ 7-bo'lim) — sof funksiya."""
from dataclasses import dataclass
from datetime import datetime, timedelta


@dataclass(frozen=True)
class DayAttendance:
    joined: bool = False
    watched_sec: int = 0
    reached_offer: bool = False


@dataclass(frozen=True)
class AccessInput:
    now: datetime
    day1_at: datetime
    day2_at: datetime
    day1_duration_sec: int
    day2_duration_sec: int
    late_entry_minutes: int
    day1_threshold: float
    day1: DayAttendance
    day2: DayAttendance


@dataclass(frozen=True)
class AccessResult:
    state: str               # waiting | live | between | missed | closed | ended
    day: int | None = None   # live / missed / closed uchun
    position_sec: int | None = None
    started_at: datetime | None = None


def day1_watched(inp: AccessInput) -> bool:
    return inp.day1.watched_sec >= inp.day1_threshold * inp.day1_duration_sec


def compute_state(inp: AccessInput) -> AccessResult:
    now = inp.now
    late = timedelta(minutes=inp.late_entry_minutes)
    d1_end = inp.day1_at + timedelta(seconds=inp.day1_duration_sec)
    d2_end = inp.day2_at + timedelta(seconds=inp.day2_duration_sec)

    if now < inp.day1_at:
        return AccessResult("waiting")

    if now < d1_end:
        if inp.day1.joined or now < inp.day1_at + late:
            return AccessResult("live", 1, int((now - inp.day1_at).total_seconds()), inp.day1_at)
        return AccessResult("closed", 1, started_at=inp.day1_at)

    if not day1_watched(inp):
        return AccessResult("missed", 1, started_at=inp.day1_at)

    if now < inp.day2_at:
        return AccessResult("between")

    if now < d2_end:
        if inp.day2.joined or now < inp.day2_at + late:
            return AccessResult("live", 2, int((now - inp.day2_at).total_seconds()), inp.day2_at)
        return AccessResult("closed", 2, started_at=inp.day2_at)

    if not inp.day2.joined:
        return AccessResult("missed", 2, started_at=inp.day2_at)
    return AccessResult("ended")


def can_open_live(inp: AccessInput, day: int) -> bool:
    res = compute_state(inp)
    return res.state == "live" and res.day == day
