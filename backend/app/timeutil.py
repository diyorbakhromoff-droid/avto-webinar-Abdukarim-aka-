"""Vaqt yordamchilari. Bazada hammasi UTC, ekranda Asia/Tashkent."""
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

TZ = ZoneInfo("Asia/Tashkent")

MONTHS = ["yanvar", "fevral", "mart", "aprel", "may", "iyun", "iyul",
          "avgust", "sentabr", "oktabr", "noyabr", "dekabr"]
WEEKDAYS = ["dushanba", "seshanba", "chorshanba", "payshanba", "juma", "shanba", "yakshanba"]


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def to_local(dt: datetime) -> datetime:
    return dt.astimezone(TZ)


def local_to_utc(d: date, t: time) -> datetime:
    return datetime.combine(d, t, tzinfo=TZ).astimezone(timezone.utc)


def parse_hhmm(value: str) -> time:
    h, m = value.split(":")
    return time(int(h), int(m))


def fmt_time(dt: datetime) -> str:
    return to_local(dt).strftime("%H:%M")


def fmt_date(dt: datetime, with_weekday: bool = True) -> str:
    loc = to_local(dt)
    s = f"{loc.day}-{MONTHS[loc.month - 1]}"
    if with_weekday:
        s += f", {WEEKDAYS[loc.weekday()]}"
    return s


def fmt_datetime(dt: datetime) -> str:
    return f"{fmt_date(dt, with_weekday=False)}, {fmt_time(dt)}"


def day_word(now: datetime, dt: datetime) -> str:
    """'Bugun', 'Ertaga' yoki '25-oktabr'."""
    delta = (to_local(dt).date() - to_local(now).date()).days
    if delta == 0:
        return "Bugun"
    if delta == 1:
        return "Ertaga"
    return fmt_date(dt, with_weekday=False)


def slot_label(now: datetime, dt: datetime) -> str:
    """Tugma matni: 'Bugun 20:00', 'Ertaga 14:00'."""
    return f"{day_word(now, dt)} {fmt_time(dt)}"


def in_quiet_hours(dt: datetime, start: time, end: time) -> bool:
    t = to_local(dt).time()
    if start <= end:
        return start <= t < end
    return t >= start or t < end


def shift_out_of_quiet(dt: datetime, start: time, end: time) -> datetime:
    """Tungi tinchlikka tushgan vaqtni oraliq tugashiga (08:00) suradi."""
    if not in_quiet_hours(dt, start, end):
        return dt
    loc = to_local(dt)
    target_day = loc.date()
    if start > end and loc.time() >= start:
        target_day = target_day + timedelta(days=1)
    return local_to_utc(target_day, end)


def humanize_duration(delta: timedelta) -> str:
    minutes = int(delta.total_seconds() // 60)
    if minutes < 60:
        return f"{max(minutes, 0)} daqiqa"
    hours = minutes // 60
    if hours < 24:
        return f"{hours} soat"
    return f"{hours // 24} kun"
