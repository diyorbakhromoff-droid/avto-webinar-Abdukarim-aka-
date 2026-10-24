"""Statistika va dashboard hisob-kitoblari (TZ 10-bo'lim)."""
from dataclasses import dataclass
from datetime import date, datetime, timedelta

from sqlalchemy import Select, and_, exists, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    AdSpend, Attendance, ContactLog, Funnel, KeyValue, Lead, LeadSession, LeadStep, Payment, ScheduledMessage,
)
from app.timeutil import TZ, local_to_utc, now_utc


@dataclass
class StatsFilter:
    funnel_id: int
    date_from: date | None = None
    date_to: date | None = None
    source: str | None = None
    slot: str | None = None        # "20:00"
    weekday: int | None = None     # 0 = dushanba
    method: str | None = None
    manager_id: int | None = None


def lead_ids(flt: StatsFilter) -> Select:
    q = select(Lead.id).where(Lead.funnel_id == flt.funnel_id)
    if flt.date_from:
        q = q.where(Lead.created_at >= local_to_utc(flt.date_from, datetime.min.time()))
    if flt.date_to:
        q = q.where(Lead.created_at < local_to_utc(flt.date_to + timedelta(days=1), datetime.min.time()))
    if flt.source:
        q = q.where(Lead.source == flt.source)
    if flt.manager_id:
        q = q.where(Lead.manager_id == flt.manager_id)
    if flt.slot or flt.weekday is not None:
        local = func.timezone(str(TZ), LeadSession.day1_at)
        conds = [LeadSession.lead_id == Lead.id, LeadSession.status != "replaced"]
        if flt.slot:
            conds.append(func.to_char(local, "HH24:MI") == flt.slot)
        if flt.weekday is not None:
            conds.append(func.extract("isodow", local) == flt.weekday + 1)
        q = q.where(exists(select(LeadSession.id).where(*conds)))
    return q


def rate(a: int, b: int) -> float | None:
    return round(a / b, 4) if b else None


async def _count(db: AsyncSession, q) -> int:
    return (await db.execute(q)).scalar() or 0


async def funnel_numbers(db: AsyncSession, flt: StatsFilter) -> dict:
    ids = lead_ids(flt)
    in_ids = Lead.id.in_(ids)
    sess = lambda *c: exists(select(LeadSession.id).where(LeadSession.lead_id == Lead.id, *c))  # noqa: E731
    pay_q = select(Payment).where(Payment.lead_id.in_(ids))
    if flt.method:
        pay_q = pay_q.where(Payment.method == flt.method)
    pay = pay_q.subquery()

    n = {}
    n["start"] = await _count(db, select(func.count()).select_from(Lead).where(in_ids))
    n["phone"] = await _count(db, select(func.count()).select_from(Lead).where(in_ids, Lead.phone.is_not(None)))
    n["session"] = await _count(db, select(func.count()).select_from(Lead).where(in_ids, sess()))
    n["day1"] = await _count(db, select(func.count()).select_from(Lead).where(
        in_ids, sess(LeadSession.day1_watched.is_(True))))
    n["day2_joined"] = await _count(db, select(func.count()).select_from(Lead).where(
        in_ids, exists(select(Attendance.id).where(Attendance.lead_id == Lead.id, Attendance.day == 2))))
    n["offer"] = await _count(db, select(func.count()).select_from(Lead).where(
        in_ids, Lead.reached_offer_at.is_not(None)))
    n["clicked"] = await _count(db, select(func.count()).select_from(Lead).where(
        in_ids, Lead.clicked_buy_at.is_not(None)))
    n["receipt"] = await _count(db, select(func.count(func.distinct(pay.c.lead_id))))
    n["deposit"] = await _count(db, select(func.count(func.distinct(pay.c.lead_id))).where(
        pay.c.kind == "deposit", pay.c.status == "approved"))
    paid = [Payment.lead_id == Lead.id, Payment.status == "approved"]
    if flt.method:
        paid.append(Payment.method == flt.method)
    n["full"] = await _count(db, select(func.count()).select_from(Lead).where(
        in_ids, Lead.payment_status == "full", exists(select(Payment.id).where(*paid))))
    n["resched_offered"] = await _count(db, select(func.count()).select_from(Lead).where(
        in_ids, sess(and_(LeadSession.day1_evaluated.is_(True),
                          (LeadSession.day1_watched.is_(False)) | (LeadSession.day2_joined.is_(False))))))
    n["resched_ok"] = await _count(db, select(func.count()).select_from(Lead).where(
        in_ids, (Lead.day1_reschedules > 0) | (Lead.day2_reschedules > 0),
        sess(LeadSession.status != "replaced",
             (LeadSession.day1_watched.is_(True) & (Lead.day1_reschedules > 0))
             | (LeadSession.day2_joined.is_(True) & (Lead.day2_reschedules > 0)))))
    avg = (await db.execute(select(func.avg(func.extract("epoch", pay.c.decided_at - pay.c.submitted_at)))
                            .where(pay.c.decided_at.is_not(None)))).scalar()
    n["approve_min"] = round(avg / 60) if avg is not None else None
    n["revenue"] = await _count(db, select(func.coalesce(func.sum(pay.c.amount), 0)).where(
        pay.c.status == "approved", pay.c.refunded.is_(False)))

    spend_q = select(func.coalesce(func.sum(AdSpend.amount), 0)).where(AdSpend.funnel_id == flt.funnel_id)
    if flt.date_from:
        spend_q = spend_q.where(AdSpend.date >= flt.date_from)
    if flt.date_to:
        spend_q = spend_q.where(AdSpend.date <= flt.date_to)
    if flt.source:
        spend_q = spend_q.where(AdSpend.source == flt.source)
    n["spend"] = await _count(db, spend_q)
    return n


def metrics(n: dict) -> list[dict]:
    spend = n["spend"]

    def m(key, label, value, r=None, display=None):
        d = {"key": key, "label": label, "value": value, "rate": r}
        if display:
            d["display"] = display
        return d

    cpl = round(spend / n["phone"]) if spend and n["phone"] else None
    cps = round(spend / n["full"]) if spend and n["full"] else None
    romi = round((n["revenue"] - spend) / spend, 4) if spend else None
    return [
        m("start", "Start", n["start"]),
        m("phone", "Ro'yxat (telefon)", n["phone"], rate(n["phone"], n["start"])),
        m("session", "Sessiya tanlash", n["session"], rate(n["session"], n["phone"])),
        m("day1", "1-kunni ko'rish (≥ 75%)", n["day1"], rate(n["day1"], n["session"])),
        m("day2", "2-kunni ko'rish (oferta momentigacha)", n["offer"], rate(n["offer"], n["day1"])),
        m("offer_stay", "Oferta momentigacha qolish", n["offer"], rate(n["offer"], n["day2_joined"])),
        m("clicked", "Tugma bosish", n["clicked"], rate(n["clicked"], n["offer"])),
        m("receipt", "Chek yuborish", n["receipt"], rate(n["receipt"], n["clicked"])),
        m("deposit", "Boshlang'ich to'lov", n["deposit"], rate(n["deposit"], n["day1"])),
        m("full", "To'liq to'lov", n["full"], rate(n["full"], n["day1"])),
        m("resched", "Qayta tanlash samarasi", n["resched_ok"], rate(n["resched_ok"], n["resched_offered"])),
        m("approve_time", "Tasdiq vaqti (o'rtacha)", n["approve_min"], None,
          f"{n['approve_min']} daq" if n["approve_min"] is not None else None),
        m("revenue", "Tushum", n["revenue"]),
        m("spend", "Reklama xarajati", spend),
        m("cpl", "Bitta lid narxi", cpl),
        m("cps", "Bitta sotuv narxi", cps),
        m("romi", "ROMI", romi, None, f"{round(romi * 100)}%" if romi is not None else None),
    ]


async def _positions(db: AsyncSession, flt: StatsFilter, f: Funnel, day: int) -> list[tuple[int, int]]:
    """Har bir efirga kirish uchun (kirgan soniya, eng uzoq yetgan soniya). Pauza/o'tkazish yo'q —
    lid shu oraliqni ko'rgan."""
    start = local_to_utc(flt.date_from, datetime.min.time()) if flt.date_from else None
    end = local_to_utc(flt.date_to + timedelta(days=1), datetime.min.time()) if flt.date_to else None
    q = (select(Attendance.join_position_sec, Attendance.max_position_sec)
         .join(Lead, Lead.id == Attendance.lead_id)
         .where(Lead.funnel_id == f.id, Attendance.day == day, Attendance.lead_id.in_(lead_ids(flt))))
    if start:
        q = q.where(Attendance.joined_at >= start)
    if end:
        q = q.where(Attendance.joined_at < end)
    return [(j, m) for j, m in (await db.execute(q)).all()]


def _watching_at(rows: list[tuple[int, int]], sec: int) -> int:
    return sum(1 for j, m in rows if j <= sec <= m)


async def retention(db: AsyncSession, flt: StatsFilter, f: Funnel) -> list[dict]:
    """Har daqiqada efirni ko'rib turganlar ulushi (efirga kirganlarga nisbatan)."""
    out = []
    for day, dur, offer in ((1, f.day1_duration_sec, f.day1_soft_offer_sec), (2, f.day2_duration_sec, f.day2_offer_sec)):
        rows = await _positions(db, flt, f, day)
        joined = len(rows)
        points = [{"minute": m, "share": round(_watching_at(rows, m * 60) / joined, 4) if joined else 0}
                  for m in range(0, max(dur // 60, 1) + 1)]
        out.append({"day": day, "duration_min": dur // 60, "offer_min": offer // 60 if offer else None,
                    "points": points})
    return out


async def watch_curve(db: AsyncSession, flt: StatsFilter, f: Funnel, day: int, step: int = 5) -> dict:
    """Videoning har `step` daqiqasida nechta odam ko'rib turgani va qayerda ko'rish kamaygani."""
    dur = f.day1_duration_sec if day == 1 else f.day2_duration_sec
    offer = f.day1_soft_offer_sec if day == 1 else f.day2_offer_sec
    rows = await _positions(db, flt, f, day)
    joined = len(rows)
    buckets = []
    for m in list(range(0, dur // 60 + 1, step)) or [0]:
        viewers = _watching_at(rows, m * 60)
        share = round(viewers / joined, 4) if joined else 0
        # shu oraliqda chiqib ketganlar: oldingi nuqtada ko'rib, keyingisiga yetmaganlar
        left = sum(1 for j, mx in rows if j <= (m - step) * 60 <= mx < m * 60) if m else 0
        # drop — shu oraliqda chiqib ketganlar ulushi (kech kirganlar hisobiga manfiy bo'lmaydi)
        buckets.append({"minute": m, "viewers": viewers, "share": share,
                        "drop": round(left / joined, 4) if joined else 0, "left": left})
    top = sorted((b for b in buckets[1:] if b["left"] > 0), key=lambda b: b["left"], reverse=True)[:3]
    avg = round(sum(max(mx - j, 0) for j, mx in rows) / joined / 60) if joined else 0
    return {
        "day": day, "step": step, "duration_min": dur // 60, "offer_min": offer // 60 if offer else None,
        "joined": joined, "avg_watch_min": avg,
        "full": sum(1 for _, mx in rows if dur and mx >= 0.95 * dur),
        "buckets": buckets,
        "top_drops": [{"from_minute": b["minute"] - step, "to_minute": b["minute"], "left": b["left"]} for b in top],
    }


STEP_ROWS = [
    ("no_phone", "started", "Telefon bermadi", "stuck_no_phone_min"),
    ("no_session", "phone", "Sessiya tanlamadi", "stuck_no_session_min"),
    ("day1_missed", "day1_missed", "1-kunni ko'rmadi", None),
    ("day2_missed", "day2_missed", "2-kunni ko'rmadi", None),
    ("left_before_offer", "left_before_offer", "Ofertagacha chiqib ketdi", None),
    ("no_receipt", "clicked_buy", "Tugma bosdi, chek yubormadi", "stuck_no_receipt_min"),
    ("receipt_rejected", "receipt_rejected", "Chek rad etildi", None),
]


async def steps(db: AsyncSession, flt: StatsFilter, f: Funnel) -> list[dict]:
    """Har bir qadam: nechta lid to'xtadi, nechtasi bot eslatmasidan, nechtasi qo'ng'iroqdan keyin qaytdi."""
    out = []
    ids = lead_ids(flt)
    now = now_utc()
    for key, step, label, attr in STEP_ROWS:
        threshold = timedelta(minutes=getattr(f, attr)) if attr else timedelta(0)
        rows = (await db.execute(select(LeadStep).where(
            LeadStep.step == step, LeadStep.lead_id.in_(ids)))).scalars().all()
        stuck = [r for r in rows if (r.left_at or now) - r.entered_at >= threshold]
        by_bot = by_call = 0
        for r in stuck:
            if not r.left_at or r.next_step == "cold":
                continue
            called = await _count(db, select(func.count()).select_from(ContactLog).where(
                ContactLog.lead_id == r.lead_id, ContactLog.at >= r.entered_at, ContactLog.at <= r.left_at))
            if called:
                by_call += 1
                continue
            reminded = await _count(db, select(func.count()).select_from(ScheduledMessage).where(
                ScheduledMessage.lead_id == r.lead_id, ScheduledMessage.status == "sent",
                ScheduledMessage.sent_at >= r.entered_at, ScheduledMessage.sent_at <= r.left_at))
            if reminded:
                by_bot += 1
        out.append({"step": key, "label": label, "stuck": len(stuck), "returned_by_bot": by_bot,
                     "returned_by_call": by_call})
    return out


async def live_compare(db: AsyncSession, funnel_id: int, n: dict) -> list[dict]:
    kv = await db.get(KeyValue, f"live_results:{funnel_id}")
    live = kv.value if kv else {}
    cps = round(n["spend"] / n["full"]) if n["spend"] and n["full"] else None
    return [
        {"label": "1-kunni ko'rish", "auto": rate(n["day1"], n["session"]), "live": live.get("day1_watch_rate")},
        {"label": "To'liq to'lov / ko'rganlar", "auto": rate(n["full"], n["day1"]), "live": live.get("paid_rate")},
        {"label": "Bitta sotuv narxi", "auto": cps, "live": live.get("cost_per_sale")},
    ]


async def upcoming(db: AsyncSession, funnel_id: int, hours: int = 48) -> list[dict]:
    now = now_utc()
    until = now + timedelta(hours=hours)
    q1 = (await db.execute(
        select(LeadSession.day1_at, func.count()).join(Lead, Lead.id == LeadSession.lead_id)
        .where(Lead.funnel_id == funnel_id, LeadSession.status == "active", LeadSession.day1_evaluated.is_(False),
               LeadSession.day1_at >= now - timedelta(hours=2), LeadSession.day1_at <= until)
        .group_by(LeadSession.day1_at))).all()
    q2 = (await db.execute(
        select(LeadSession.day2_at, func.count()).join(Lead, Lead.id == LeadSession.lead_id)
        .where(Lead.funnel_id == funnel_id, LeadSession.status == "active", LeadSession.day1_watched.is_(True),
               LeadSession.day2_evaluated.is_(False),
               LeadSession.day2_at >= now - timedelta(hours=2), LeadSession.day2_at <= until)
        .group_by(LeadSession.day2_at))).all()
    slots: dict[datetime, dict] = {}
    for at, c in q1:
        slots.setdefault(at, {"day1_count": 0, "day2_count": 0})["day1_count"] = c
    for at, c in q2:
        slots.setdefault(at, {"day1_count": 0, "day2_count": 0})["day2_count"] = c
    return [{"at": at, **v} for at, v in sorted(slots.items())]
