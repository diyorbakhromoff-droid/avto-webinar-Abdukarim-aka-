"""Progrev zanjirini lid uchun rejalashtirish (TZ 6-bo'lim). Sof funksiyalar.

Qoidalar:
1. Sessiya tanlanganda zanjirning barcha xabarlari aniq vaqt bilan rejalashtiriladi.
2. Siqish: "ro'yxatdan keyin" xabari 1-kundan 30 daqiqa oldingacha sig'masa —
   majburiy emas: o'tkazib yuboriladi; majburiy: qolgan vaqtga teng oraliqlarda,
   kamida 20 daqiqa farq bilan yuboriladi.
4. Tungi tinchlik: oraliqqa tushgan xabar oraliq tugashiga suriladi.
Segment rejalashtirishda emas, yuborish paytida tekshiriladi (5-qoida).
6. Aniq sana-vaqt (at_datetime): har bir lidga bir marta, aynan shu vaqtda; o'tib ketgan bo'lsa — yuborilmaydi.
7. Kechikish: worker to'xtab qolib, xabar vaqti o'tib ketgan bo'lsa, noto'g'ri vaqtda yuborilmaydi (stale_reason).
"""
from dataclasses import dataclass
from datetime import datetime, time, timedelta

from app.timeutil import in_quiet_hours, shift_out_of_quiet

COMPRESS_MARGIN = timedelta(minutes=30)
COMPRESS_MIN_GAP = timedelta(minutes=20)
# "Efir boshlandi" kabi xabarlar katta sessiyada hammaga 2 daqiqada yetishi uchun 1 daqiqa oldin boshlanadi
DAY_START_LEAD = timedelta(minutes=1)
# yuborish paytida: shuncha kechikkan xabar endi yuborilmaydi (masalan, server to'xtab qolgan bo'lsa)
MAX_LATE = timedelta(hours=6)
EXACT_MAX_LATE = timedelta(hours=1)     # aniq vaqtli xabarlar (sana-soat, ommaviy xabar)


@dataclass(frozen=True)
class ChainItem:
    id: int
    title: str
    trigger_type: str          # after_registration | before_day | at_day_start | after_day_end | before_deadline
                               # | left_live | on_button | stuck
    trigger_day: int | None
    offset_minutes: int
    required: bool
    sort: int = 0
    fixed_at: datetime | None = None   # at_datetime


@dataclass(frozen=True)
class SessionTimes:
    registered_at: datetime
    day1_at: datetime
    day2_at: datetime
    day1_duration_sec: int
    day2_duration_sec: int
    deadline_at: datetime | None = None   # lidning shaxsiy deadline'i

    def day_start(self, day: int) -> datetime:
        return self.day1_at if day == 1 else self.day2_at

    def day_end(self, day: int) -> datetime:
        dur = self.day1_duration_sec if day == 1 else self.day2_duration_sec
        return self.day_start(day) + timedelta(seconds=dur)


@dataclass(frozen=True)
class QuietHours:
    start: time = time(23, 0)
    end: time = time(8, 0)


@dataclass
class PlannedMessage:
    item: ChainItem
    send_at: datetime | None
    status: str                # scheduled | compressed | quiet_shifted | skipped | event
    reason: str | None = None
    session_bound: bool = True


SESSION_TRIGGERS = {"before_day", "at_day_start", "after_day_end", "before_deadline"}
FIXED_TRIGGERS = {"at_datetime"}
EVENT_TRIGGERS = {"on_button", "stuck", "left_live"}


def plan_chain(items: list[ChainItem], s: SessionTimes, now: datetime,
               quiet: QuietHours = QuietHours()) -> list[PlannedMessage]:
    out: list[PlannedMessage] = []
    compress_deadline = s.day1_at - COMPRESS_MARGIN

    after_reg = sorted((i for i in items if i.trigger_type == "after_registration"),
                       key=lambda i: (i.offset_minutes, i.sort))
    fitting: list[PlannedMessage] = []
    overflow: list[ChainItem] = []
    for item in after_reg:
        t = s.registered_at + timedelta(minutes=item.offset_minutes)
        status, reason = "scheduled", None
        if in_quiet_hours(t, quiet.start, quiet.end):
            t = shift_out_of_quiet(t, quiet.start, quiet.end)
            status, reason = "quiet_shifted", f"tungi tinchlik: {quiet.end.strftime('%H:%M')} ga surildi"
        if t <= compress_deadline:
            fitting.append(PlannedMessage(item, max(t, now), status, reason, session_bound=False))
        elif item.required:
            overflow.append(item)
        else:
            out.append(PlannedMessage(item, None, "skipped", "vaqt yetmaydi (majburiy emas)", session_bound=False))
    out.extend(fitting)

    if overflow:
        last_fit = max((p.send_at for p in fitting if p.send_at), default=now)
        prev = max(now, last_fit)
        window = compress_deadline - prev
        step = max(COMPRESS_MIN_GAP, window / len(overflow)) if window > timedelta(0) else COMPRESS_MIN_GAP
        for idx, item in enumerate(overflow, start=1):
            t = prev + step * idx
            if t >= s.day1_at - timedelta(minutes=5):
                out.append(PlannedMessage(item, None, "skipped", "1-kungacha joy qolmadi", session_bound=True))
            else:
                # siqilgan xabarlar sessiya vaqtiga bog'liq: vaqt o'zgarsa qayta hisoblanadi
                out.append(PlannedMessage(item, t, "compressed",
                                          f"siqildi: {int(step.total_seconds() // 60)} daqiqa oraliq",
                                          session_bound=True))

    for item in items:
        if item.trigger_type in SESSION_TRIGGERS:
            out.append(_plan_session_item(item, s, now, quiet))
        elif item.trigger_type in FIXED_TRIGGERS:
            out.append(plan_fixed(item, now))
        elif item.trigger_type in EVENT_TRIGGERS:
            out.append(PlannedMessage(item, None, "event", "voqea bo'yicha yuboriladi", session_bound=False))

    order = {i.id: n for n, i in enumerate(items)}
    out.sort(key=lambda p: (p.send_at is None, p.send_at or now, order.get(p.item.id, 0)))
    return out


def _plan_session_item(item: ChainItem, s: SessionTimes, now: datetime, quiet: QuietHours) -> PlannedMessage:
    day = item.trigger_day or 1
    offset = timedelta(minutes=item.offset_minutes)
    if item.trigger_type == "before_deadline":
        if s.deadline_at is None:
            return PlannedMessage(item, None, "skipped", "deadline belgilanmagan")
        t = s.deadline_at - offset
        if t < now:
            return PlannedMessage(item, None, "skipped", "vaqti o'tib ketgan")
        if in_quiet_hours(t, quiet.start, quiet.end):
            shifted = shift_out_of_quiet(t, quiet.start, quiet.end)
            if shifted >= s.deadline_at:
                # tunda tugaydigan deadline — eslatmani tinchlik boshlanishidan oldinroq yuboramiz
                return PlannedMessage(item, None, "skipped", "tungi tinchlikka tushdi")
            return PlannedMessage(item, shifted, "quiet_shifted", "tungi tinchlik: surildi")
        return PlannedMessage(item, t, "scheduled")
    if item.trigger_type == "before_day":
        anchor = s.day_start(day)
        t = anchor - offset
        if t < now:
            return PlannedMessage(item, None, "skipped", "vaqti o'tib ketgan")
        if in_quiet_hours(t, quiet.start, quiet.end):
            shifted = shift_out_of_quiet(t, quiet.start, quiet.end)
            if shifted >= anchor:
                return PlannedMessage(item, None, "skipped", "tungi tinchlikka tushdi")
            return PlannedMessage(item, shifted, "quiet_shifted", "tungi tinchlik: surildi")
        return PlannedMessage(item, t, "scheduled")
    if item.trigger_type == "at_day_start":
        t = s.day_start(day) + offset
        if item.offset_minutes == 0:
            t -= DAY_START_LEAD
        if t < now - timedelta(minutes=2):
            return PlannedMessage(item, None, "skipped", "vaqti o'tib ketgan")
        return PlannedMessage(item, max(t, now), "scheduled")
    # after_day_end
    t = s.day_end(day) + offset
    if in_quiet_hours(t, quiet.start, quiet.end):
        return PlannedMessage(item, shift_out_of_quiet(t, quiet.start, quiet.end), "quiet_shifted",
                              "tungi tinchlik: surildi")
    return PlannedMessage(item, t, "scheduled")


def plan_fixed(item: ChainItem, now: datetime) -> PlannedMessage:
    """Aniq sana-vaqt: sessiyaga bog'liq emas (efir vaqti o'zgarsa ham o'zgarmaydi), tungi tinchlik qo'llanmaydi —
    vaqtni admin aniq tanlagan."""
    if item.fixed_at is None:
        return PlannedMessage(item, None, "skipped", "sana belgilanmagan", session_bound=False)
    if item.fixed_at < now - timedelta(minutes=2):
        return PlannedMessage(item, None, "skipped", "vaqti o'tib ketgan", session_bound=False)
    return PlannedMessage(item, max(item.fixed_at, now), "scheduled", session_bound=False)


def stale_reason(trigger_type: str, send_at: datetime, now: datetime, *, day_start: datetime | None = None,
                 day_end: datetime | None = None, deadline: datetime | None = None) -> str | None:
    """Yuborish paytidagi tekshiruv: xabar endi ma'nosiz bo'lsa — sababi, aks holda None.
    Masalan, "efirga 30 daqiqa qoldi" eslatmasi efir boshlangandan keyin bormaydi."""
    if trigger_type == "before_day" and day_start and now >= day_start:
        return "efir boshlanib bo'lgan — eslatma kechikdi"
    if trigger_type == "at_day_start" and day_end and now >= day_end:
        return "efir tugagan"
    if trigger_type == "before_deadline" and deadline and now >= deadline:
        return "deadline tugagan"
    limit = EXACT_MAX_LATE if trigger_type in FIXED_TRIGGERS | {"broadcast"} else MAX_LATE
    late = now - send_at
    if late > limit:
        return f"vaqti o'tib ketgan ({int(late.total_seconds() // 60)} daq kechikdi)"
    return None


def plan_stuck(item: ChainItem, step_entered_at: datetime, quiet: QuietHours = QuietHours()) -> datetime:
    """'Qadamda X vaqt to'xtab qolganda' xabari vaqti."""
    t = step_entered_at + timedelta(minutes=item.offset_minutes)
    return shift_out_of_quiet(t, quiet.start, quiet.end)
