"""Progrev sxemasi (bloklar va chiziqlar): sof qoidalar — bloklar sozlamasi, chiqishlar (portlar), vaqtlar.

Blok turlari:
  start      — boshlanish: qaysi hodisada lid shu bo'limga kiradi (config.event, config.day)
  message    — xabar (matni chain_messages da). "Keyingi blok" tugmalari va "bosmasa" chiqishi bor
  wait       — kutish: ma'lum vaqt, webinar vaqtiga bog'lab, aniq soatgacha yoki biror ish qilguncha
  condition  — shart: video ko'rish, efirga kirish, adminga yozish, to'lov, teg, manba ...
  action     — amal: yangi vaqt tanlash, savol so'rash, teg, sovuq lid, menejerga vazifa
  goto       — o'tish: istalgan bo'limning istalgan blokiga (zanjir bo'lsa — N-xabaridan)
  chain      — zanjir: o'z vaqtiga bog'langan xabarlar ketma-ketligi (istalgan xabaridan kirish mumkin)
  stop       — to'xtatish
  note       — izoh (bajarilmaydi)
"""
import secrets
from dataclasses import dataclass, replace
from datetime import datetime, timedelta

from app.domain.planning import (
    SESSION_TRIGGERS, ChainItem, PlannedMessage, QuietHours, SessionTimes, _plan_session_item, plan_chain,
)
from app.timeutil import TZ, in_quiet_hours, parse_hhmm, shift_out_of_quiet

NODE_TYPES = ("start", "message", "wait", "condition", "action", "goto", "chain", "stop", "note")

START_EVENTS = {
    "start": "Botga /start bosdi",
    "phone": "Telefon raqam berdi",
    "session_chosen": "Efir vaqtini tanladi",
    "joined": "Efirga kirdi",
    "left_live": "Efirdan chiqib ketdi",
    "day_end": "Efir kuni tugadi",
    "reached_offer": "Ofertagacha ko'rdi",
    "clicked_buy": "«Kursga yozilish»ni bosdi",
    "receipt": "Chek yubordi",
    "payment_approved": "To'lov tasdiqlandi",
    "payment_rejected": "Chek rad etildi",
    "question": "Adminga yozdi",
}
DAY_EVENTS = {"joined", "left_live", "day_end"}
WAIT_EVENTS = {"joined", "question", "receipt", "clicked_buy", "payment_approved"}

ANCHORS = ("day1_start", "day1_end", "day2_start", "day2_end", "offer", "deadline")
WAIT_MODES = ("duration", "anchor", "clock", "event")
CHECKS = ("watch", "joined", "reached_offer", "wrote_admin", "clicked_buy", "receipt", "payment", "tag", "source")
DAY_CHECKS = {"watch", "joined"}
VALUE_CHECKS = {"tag", "source"}
ACTIONS = ("reschedule", "ask", "tag_add", "tag_remove", "cold", "manager_task")
VALUE_ACTIONS = {"tag_add", "tag_remove"}
PAYMENT_PORTS = ["none", "deposit", "full"]

LATE_GRACE = timedelta(minutes=2)
MAX_MINUTES = 60 * 24 * 60   # 60 kun
MAX_BRANCHES = 8


class FlowConfigError(ValueError):
    pass


def new_id() -> str:
    return secrets.token_hex(3)


# ─────────────────────────── LeadEvent → sxema hodisasi ───────────────────────────

def map_event(type_: str, data: dict) -> tuple[str, int | None] | None:
    """Lid voqeasini sxema hodisasiga aylantiradi: (hodisa, kun)."""
    day = data.get("day")
    match type_:
        case "start" | "phone" | "session_chosen" | "reached_offer" | "clicked_buy" | "receipt" \
                | "payment_approved" | "payment_rejected" | "question":
            return type_, None
        case "rescheduled":
            # 1-kunni qayta tanlash — yangi sessiya; 2-kun ko'chishi faqat vaqtlarni qayta hisoblaydi
            return ("session_chosen", None) if day == 1 else None
        case "joined" | "left_live":
            return type_, day
        case "day_result":
            return "day_end", day
    return None


# ─────────────────────────── sozlamalar ───────────────────────────

def _int(v, name: str, lo: int = 0, hi: int = MAX_MINUTES) -> int:
    try:
        n = int(v)
    except (TypeError, ValueError):
        raise FlowConfigError(f"{name}: butun son kiriting") from None
    if n < lo or n > hi:
        raise FlowConfigError(f"{name}: {lo}…{hi} oralig'ida bo'lsin")
    return n


def _day(v) -> int:
    if v not in (1, 2):
        raise FlowConfigError("Kun: 1 yoki 2")
    return v


def watch_branches(day_minutes: int | None) -> list[dict]:
    """Standart: umuman kirmadi / yarmigacha / yarmidan ko'p."""
    half = max(1, (day_minutes or 120) // 2)
    return [
        {"id": new_id(), "label": "Umuman kirmadi", "kind": "not_joined"},
        {"id": new_id(), "label": "Yarmigacha ko'rdi", "kind": "range", "from_min": 0, "to_min": half},
        {"id": new_id(), "label": "Yarmidan ko'p", "kind": "range", "from_min": half, "to_min": None},
    ]


def default_config(type_: str, day1_minutes: int | None = None) -> dict:
    match type_:
        case "start":
            return {"event": "day_end", "day": 1}
        case "message":
            return {"timeout_minutes": None, "paid_ok": False}
        case "wait":
            return {"mode": "duration", "minutes": 60, "quiet": True, "late": "skip"}
        case "condition":
            return {"check": "watch", "day": 1, "branches": watch_branches(day1_minutes)}
        case "action":
            return {"action": "reschedule"}
        case "goto":
            return {"target_node_id": None, "item": 0}
        case "stop":
            return {"tag": ""}
        case "note":
            return {"text": ""}
    return {}


def normalize_config(type_: str, cfg: dict | None) -> dict:
    """Admin yuborgan sozlamani tekshiradi va keraksiz maydonlarni olib tashlaydi."""
    c = dict(cfg or {})
    match type_:
        case "start":
            ev = c.get("event")
            if ev not in START_EVENTS:
                raise FlowConfigError("Boshlanish hodisasini tanlang")
            out = {"event": ev}
            if ev in DAY_EVENTS:
                out["day"] = _day(c.get("day"))
            return out
        case "message":
            t = c.get("timeout_minutes")
            return {"timeout_minutes": _int(t, "Bosmasa vaqti", 1) if t not in (None, "", 0) else None,
                    "paid_ok": bool(c.get("paid_ok"))}
        case "wait":
            mode = c.get("mode")
            if mode not in WAIT_MODES:
                raise FlowConfigError("Kutish turini tanlang")
            out = {"mode": mode, "quiet": bool(c.get("quiet", True)),
                   "late": "send" if c.get("late") == "send" else "skip"}
            if mode == "duration":
                out["minutes"] = _int(c.get("minutes"), "Kutish vaqti", 1)
            elif mode == "anchor":
                if c.get("anchor") not in ANCHORS:
                    raise FlowConfigError("Webinarning qaysi vaqtiga bog'lanishini tanlang")
                out.update(anchor=c["anchor"], minutes=_int(c.get("minutes", 0), "Daqiqa"),
                           direction="before" if c.get("direction") == "before" else "after")
            elif mode == "clock":
                clock = str(c.get("clock") or "")
                try:
                    parse_hhmm(clock)
                except (ValueError, IndexError):
                    raise FlowConfigError("Soatni SS:DD ko'rinishida kiriting") from None
                out["clock"] = clock
            else:
                if c.get("event") not in WAIT_EVENTS:
                    raise FlowConfigError("Qaysi ishni kutishni tanlang")
                out.update(event=c["event"], max_minutes=_int(c.get("max_minutes"), "Eng ko'p kutish", 1))
            return out
        case "condition":
            check = c.get("check")
            if check not in CHECKS:
                raise FlowConfigError("Nimani tekshirishni tanlang")
            out = {"check": check}
            if check in DAY_CHECKS:
                out["day"] = _day(c.get("day"))
            if check == "watch":
                out["branches"] = _branches(c.get("branches"))
            if check == "wrote_admin":
                out["minutes"] = _int(c.get("minutes", 120), "Oxirgi necha daqiqa", 1)
            if check in VALUE_CHECKS:
                v = str(c.get("value") or "").strip()
                if not v:
                    raise FlowConfigError("Teg yoki manba nomini kiriting")
                out["value"] = v[:64]
            return out
        case "action":
            a = c.get("action")
            if a not in ACTIONS:
                raise FlowConfigError("Amalni tanlang")
            out = {"action": a}
            v = str(c.get("value") or "").strip()
            if a in VALUE_ACTIONS and not v:
                raise FlowConfigError("Teg nomini kiriting")
            if a in VALUE_ACTIONS or a == "manager_task":
                out["value"] = v[:200 if a == "manager_task" else 64]
            return out
        case "goto":
            t = c.get("target_node_id")
            return {"target_node_id": int(t) if t else None, "item": _int(c.get("item", 0), "Xabar raqami", 0, 500)}
        case "stop":
            return {"tag": str(c.get("tag") or "").strip()[:64]}
        case "note":
            return {"text": str(c.get("text") or "")[:2000]}
        case "chain":
            return {}
    raise FlowConfigError("Noto'g'ri blok turi")


def _branches(raw) -> list[dict]:
    if not isinstance(raw, list) or not raw:
        raise FlowConfigError("Kamida bitta shoxcha kerak")
    if len(raw) > MAX_BRANCHES:
        raise FlowConfigError(f"Shoxchalar {MAX_BRANCHES} tadan oshmasin")
    out, seen = [], set()
    for b in raw:
        bid = str(b.get("id") or new_id())[:12]
        if bid in seen or bid == "else":
            bid = new_id()
        seen.add(bid)
        label = str(b.get("label") or "").strip()[:60] or "Shoxcha"
        if b.get("kind") == "not_joined":
            out.append({"id": bid, "label": label, "kind": "not_joined"})
            continue
        lo = _int(b.get("from_min", 0), "Daqiqadan", 0, 600)
        hi = b.get("to_min")
        hi = None if hi in (None, "") else _int(hi, "Daqiqagacha", 1, 600)
        if hi is not None and hi <= lo:
            raise FlowConfigError(f"«{label}»: oxirgi daqiqa boshlanishidan katta bo'lsin")
        out.append({"id": bid, "label": label, "kind": "range", "from_min": lo, "to_min": hi})
    return out


def next_buttons(buttons: list[list[dict]] | None) -> list[dict]:
    return [b for row in (buttons or []) for b in row if b.get("type") == "next"]


def ensure_button_ids(buttons: list[list[dict]]) -> list[list[dict]]:
    """«Keyingi blok» tugmalariga doimiy id beradi — chiziqlar shu id ga ulanadi."""
    seen: set[str] = set()
    out = []
    for row in buttons or []:
        r = []
        for b in row:
            b = dict(b)
            if b.get("type") == "next":
                bid = str(b.get("id") or "")[:12]
                if not bid or bid in seen:
                    bid = new_id()
                b["id"] = bid
                seen.add(bid)
            else:
                b.pop("id", None)
            r.append(b)
        out.append(r)
    return out


def ports(type_: str, cfg: dict, buttons: list[list[dict]] | None = None) -> list[str]:
    """Blokning chiqishlari. Chiziq faqat shulardan boshlanadi."""
    match type_:
        case "start" | "action" | "chain":
            return ["next"]
        case "message":
            nb = next_buttons(buttons)
            if not nb:
                return ["next"]
            return [f"b:{b['id']}" for b in nb] + (["timeout"] if cfg.get("timeout_minutes") else [])
        case "wait":
            return ["done", "expired"] if cfg.get("mode") == "event" else ["next"]
        case "condition":
            check = cfg.get("check")
            if check == "watch":
                return [b["id"] for b in cfg.get("branches", [])] + ["else"]
            if check == "payment":
                return list(PAYMENT_PORTS)
            return ["yes", "no"]
    return []


# ─────────────────────────── shartlar ───────────────────────────

def watch_branch(branches: list[dict], joined: bool, max_position_sec: int) -> str:
    """Birinchi mos shoxcha; hech biri mos kelmasa — "else"."""
    for b in branches:
        if b.get("kind") == "not_joined":
            if not joined:
                return b["id"]
            continue
        if not joined:
            continue
        lo = (b.get("from_min") or 0) * 60
        hi = b.get("to_min")
        if max_position_sec >= lo and (hi is None or max_position_sec < hi * 60):
            return b["id"]
    return "else"


# ─────────────────────────── vaqtlar ───────────────────────────

@dataclass(frozen=True)
class Anchors:
    day1_start: datetime | None = None
    day1_end: datetime | None = None
    day2_start: datetime | None = None
    day2_end: datetime | None = None
    offer: datetime | None = None
    deadline: datetime | None = None


def anchors_of(s: SessionTimes | None, day2_offer_sec: int = 0) -> Anchors:
    if s is None:
        return Anchors()
    return Anchors(s.day1_at, s.day_end(1), s.day2_at, s.day_end(2),
                   s.day2_at + timedelta(seconds=day2_offer_sec or 0), s.deadline_at)


def wait_target(cfg: dict, start: datetime, now: datetime, anchors: Anchors,
                quiet: QuietHours = QuietHours()) -> tuple[datetime, bool]:
    """Kutish qachon tugaydi: (vaqt, kechikdimi). start — lid kutishga kirgan payt.
    Kechikkan: webinar vaqti allaqachon o'tib ketgan yoki sessiya yo'q."""
    mode = cfg.get("mode")
    late = False
    if mode == "duration":
        t = start + timedelta(minutes=cfg.get("minutes") or 0)
    elif mode == "anchor":
        base = getattr(anchors, cfg.get("anchor") or "", None)
        if base is None:
            return now, True
        delta = timedelta(minutes=cfg.get("minutes") or 0)
        t = base - delta if cfg.get("direction") == "before" else base + delta
        if t < now - LATE_GRACE:
            return now, True
    elif mode == "clock":
        hhmm = parse_hhmm(cfg.get("clock") or "10:00")
        loc = start.astimezone(TZ)
        t = loc.replace(hour=hhmm.hour, minute=hhmm.minute, second=0, microsecond=0)
        if t <= loc:
            t += timedelta(days=1)
    elif mode == "event":
        t = start + timedelta(minutes=cfg.get("max_minutes") or 0)
    else:
        return now, True
    if cfg.get("quiet", True) and mode != "event" and in_quiet_hours(t, quiet.start, quiet.end):
        t = shift_out_of_quiet(t, quiet.start, quiet.end)
    return t, late


def plan_items(items: list[ChainItem], s: SessionTimes | None, entered_at: datetime, now: datetime,
               quiet: QuietHours = QuietHours()) -> list[PlannedMessage]:
    """Zanjir xabarlarining vaqti. "Ro'yxatdan keyin" turi zanjirda — "zanjirga kirgandan keyin".
    1-kundan oldin kirilgan bo'lsa — oddiy zanjir qoidalari (siqish ham), keyin kirilgan bo'lsa siqishsiz."""
    if s is not None and entered_at < s.day1_at:
        return plan_chain(items, replace(s, registered_at=entered_at), now, quiet)
    out: list[PlannedMessage] = []
    for item in items:
        if item.trigger_type == "after_registration":
            t = entered_at + timedelta(minutes=item.offset_minutes)
            status, reason = "scheduled", None
            if in_quiet_hours(t, quiet.start, quiet.end):
                t = shift_out_of_quiet(t, quiet.start, quiet.end)
                status, reason = "quiet_shifted", "tungi tinchlik: surildi"
            out.append(PlannedMessage(item, max(t, now), status, reason, session_bound=False))
        elif item.trigger_type in SESSION_TRIGGERS:
            if s is None:
                out.append(PlannedMessage(item, None, "skipped", "efir vaqti tanlanmagan"))
            else:
                out.append(_plan_session_item(item, s, now, quiet))
        else:
            out.append(PlannedMessage(item, None, "skipped", "zanjirda bu turdagi vaqt ishlamaydi"))
    order = {i.id: n for n, i in enumerate(items)}
    out.sort(key=lambda p: (p.send_at is None, p.send_at or now, order.get(p.item.id, 0)))
    return out
