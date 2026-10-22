"""Sof mantiq testlari: slotlar, rejalashtirish, Mini App holati, segmentlar, initData, halollik."""
from datetime import date, datetime, time, timedelta, timezone

import pytest

from app.domain.access import AccessInput, DayAttendance, compute_state
from app.domain.honesty import honesty_warnings
from app.domain.planning import ChainItem, QuietHours, SessionTimes, plan_chain
from app.domain.segments import LeadSnapshot, broadcast_allowed, chain_allowed
from app.domain.slots import SlotConfig, can_change_day1, day1_options, day2_for
from app.security.initdata import InitDataError, sign, validate
from app.timeutil import TZ, local_to_utc, slot_label

TUE = date(2026, 10, 20)  # seshanba


def tash(d: date, hh: int, mm: int = 0) -> datetime:
    return local_to_utc(d, time(hh, mm))


# ── TZ 5-bo'lim: slot tanlash jadvali ──

@pytest.mark.parametrize("now, expected", [
    ((9, 30), ["Bugun 14:00", "Bugun 20:00"]),
    ((12, 0), ["Bugun 20:00", "Ertaga 14:00"]),
    ((18, 0), ["Ertaga 14:00", "Ertaga 20:00"]),
    ((23, 40), ["Ertaga 14:00", "Ertaga 20:00"]),
])
def test_day1_options_table(now, expected):
    n = tash(TUE, *now)
    opts = day1_options(SlotConfig(), n)
    assert [slot_label(n, o) for o in opts] == expected


def test_day2_is_exactly_24h_later():
    d1 = tash(TUE, 20)
    assert day2_for(d1) == tash(TUE + timedelta(days=1), 20)


def test_day1_requires_next_day_broadcast():
    # chorshanba efir yo'q -> seshanba 1-kun taklif qilinmaydi
    cfg = SlotConfig(excluded_dates=frozenset({TUE + timedelta(days=1)}))
    opts = day1_options(cfg, tash(TUE, 9))
    assert all(o.astimezone(TZ).date() != TUE for o in opts)
    assert all(o.astimezone(TZ).date() != TUE + timedelta(days=1) for o in opts)


def test_change_only_n_hours_before():
    cfg = SlotConfig(min_hours_before=3)
    d1 = tash(TUE, 20)
    assert can_change_day1(cfg, tash(TUE, 16, 59), d1)
    assert not can_change_day1(cfg, tash(TUE, 17, 1), d1)


# ── TZ 6-bo'lim: rejalashtirish ──

def items():
    return [
        ChainItem(1, "Spiker haqida (uzoq)", "after_registration", None, 240, required=False),
        ChainItem(2, "Kurs natijalari (majburiy)", "after_registration", None, 300, required=True),
        ChainItem(3, "Darhol", "after_registration", None, 0, required=False),
        ChainItem(4, "2 soat oldin", "before_day", 1, 120, required=True),
        ChainItem(5, "Boshlandi", "at_day_start", 1, 0, required=True),
        ChainItem(6, "Xulosa", "after_day_end", 1, 5, required=True),
        ChainItem(7, "Tugma", "on_button", None, 0, required=False),
    ]


def test_compression_three_hours_before():
    """1-kungacha 3 soat qolgan lidga majburiy bo'lmagan uzoq xabarlar ketmaydi, majburiylari ketadi."""
    reg = tash(TUE, 17)
    s = SessionTimes(reg, tash(TUE, 20), tash(TUE, 20) + timedelta(hours=24), 4440, 4920)
    plan = {p.item.id: p for p in plan_chain(items(), s, reg)}
    assert plan[1].status == "skipped"
    assert plan[2].status == "compressed"
    assert reg < plan[2].send_at <= tash(TUE, 19, 30)
    assert plan[3].send_at == reg
    assert plan[4].send_at == tash(TUE, 18)
    assert plan[5].send_at == tash(TUE, 20) - timedelta(minutes=1)  # katta sessiya uchun 1 daqiqa oldin
    assert plan[6].send_at == tash(TUE, 20) + timedelta(seconds=4440) + timedelta(minutes=5)
    assert plan[7].status == "event"


def test_compressed_messages_keep_20_min_gap():
    reg = tash(TUE, 18, 50)
    many = [ChainItem(i, f"m{i}", "after_registration", None, 600 + i, required=True) for i in range(1, 4)]
    s = SessionTimes(reg, tash(TUE, 20, 0), tash(TUE, 20) + timedelta(days=1), 3600, 3600)
    times = [p.send_at for p in plan_chain(many, s, reg) if p.send_at]
    for a, b in zip(times, times[1:]):
        assert b - a >= timedelta(minutes=20)
    assert all(t < tash(TUE, 20) for t in times)


def test_quiet_hours_shift_to_morning():
    reg = tash(TUE, 22, 30)
    s = SessionTimes(reg, tash(TUE + timedelta(days=1), 20), tash(TUE + timedelta(days=2), 20), 3600, 3600)
    item = ChainItem(1, "Spiker", "after_registration", None, 60, required=False)
    p = plan_chain([item], s, reg, QuietHours(time(23), time(8)))[0]
    assert p.status == "quiet_shifted"
    assert p.send_at == tash(TUE + timedelta(days=1), 8)


# ── TZ 7-bo'lim: Mini App holati ──

def access(now, joined1=False, watched1=0, joined2=False):
    d1 = tash(TUE, 20)
    return AccessInput(now=now, day1_at=d1, day2_at=d1 + timedelta(days=1), day1_duration_sec=74 * 60,
                       day2_duration_sec=82 * 60, late_entry_minutes=15, day1_threshold=0.75,
                       day1=DayAttendance(joined1, watched1), day2=DayAttendance(joined2))


def test_late_entry_10_minutes_starts_from_minute_10():
    r = compute_state(access(tash(TUE, 20, 10)))
    assert (r.state, r.day, r.position_sec) == ("live", 1, 600)


def test_entry_closed_after_l_minutes():
    assert compute_state(access(tash(TUE, 20, 16))).state == "closed"
    # oldin kirgan lid qayta ochsa — joriy daqiqadan davom etadi
    r = compute_state(access(tash(TUE, 20, 40), joined1=True))
    assert (r.state, r.position_sec) == ("live", 2400)


def test_between_requires_75_percent():
    after = tash(TUE, 21, 30)
    assert compute_state(access(after, True, int(74 * 60 * 0.75))).state == "between"
    r = compute_state(access(after, True, int(74 * 60 * 0.70)))
    assert (r.state, r.day) == ("missed", 1)


def test_day2_and_ended():
    d2 = tash(TUE + timedelta(days=1), 20, 5)
    r = compute_state(access(d2, True, 74 * 60))
    assert (r.state, r.day) == ("live", 2)
    end = tash(TUE + timedelta(days=1), 22)
    assert compute_state(access(end, True, 74 * 60, joined2=True)).state == "ended"
    r = compute_state(access(end, True, 74 * 60, joined2=False))
    assert (r.state, r.day) == ("missed", 2)


# ── segmentlar ──

def test_paid_lead_gets_no_sales_messages():
    paid = LeadSnapshot(payment_status="deposit")
    assert chain_allowed("not_paid", paid)[0] is False
    assert chain_allowed("all", paid)[0] is False
    assert chain_allowed("deposit_paid", paid)[0] is True


def test_cold_and_blocked():
    cold = LeadSnapshot(cold=True)
    assert chain_allowed("all", cold)[0] is False
    assert broadcast_allowed("cold", cold)
    assert not broadcast_allowed("all", LeadSnapshot(blocked=True))
    assert not chain_allowed("all", LeadSnapshot(unsubscribed=True))[0]


# ── initData ──

def test_initdata_valid_and_tampered():
    token = "123456:ABC"
    fields = {"auth_date": "1700000000", "query_id": "q1", "user": '{"id":42,"first_name":"Madina"}'}
    data = sign(fields, token)
    u = validate(data, token, max_age_sec=0)
    assert u.id == 42 and u.first_name == "Madina"
    with pytest.raises(InitDataError):
        validate(data.replace("Madina", "Sevara"), token, max_age_sec=0)
    with pytest.raises(InitDataError):
        validate(data, "other:token", max_age_sec=0)
    with pytest.raises(InitDataError):
        validate(data, token, max_age_sec=3600, now=1700000000 + 7200)


# ── halollik ──

def test_honesty_warnings():
    assert honesty_warnings("Bugun jonli efir!")
    assert honesty_warnings("LIVE webinar")
    assert not honesty_warnings("Bugun efir bo'ladi, webinarga kiring")
    assert not honesty_warnings("deliver")  # so'z ichidagi "live" ogohlantirmaydi


def test_timezone_is_utc_plus_5():
    assert tash(TUE, 20).astimezone(timezone.utc).hour == 15
