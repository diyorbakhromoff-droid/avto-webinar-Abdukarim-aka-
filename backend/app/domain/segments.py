"""Segmentlar — "kimga yuboriladi". Yuborish paytida tekshiriladi."""
from dataclasses import dataclass, field

# Oddiy tilda: admin panelda shu nomlar ko'rinadi
SEGMENTS = {
    "all": "Hammaga",
    # video ko'rish bo'yicha (segment_day — qaysi kun videosi)
    "not_joined": "Efirga kirmaganlar",
    "reached_min": "Videoning X-daqiqasigacha ko'rganlar",
    "left_before_min": "X-daqiqaga yetmay chiqib ketganlar",
    "watched_full": "Videoni oxirigacha ko'rganlar",
    "not_full": "Kirgan, lekin oxirigacha ko'rmaganlar",
    # kun natijasi (75% chegarasi)
    "day1_attended": "1-kunni ko'rganlar (≥75%)",
    "day1_missed": "1-kunni ko'rmaganlar",
    "day2_attended": "2-kunga kelganlar",
    "day2_missed": "2-kunga kelmaganlar",
    "reached_offer": "Ofertagacha ko'rganlar",
    "left_before_offer": "Ofertagacha chiqib ketganlar",
    # to'lov
    "receipt_sent": "Chek yuborganlar",
    "deposit_paid": "Boshlang'ich to'laganlar",
    "full_paid": "To'liq to'laganlar",
    "not_paid": "To'lamaganlar",
}

WATCH_SEGMENTS = {"not_joined", "reached_min", "left_before_min", "watched_full", "not_full"}
MINUTE_SEGMENTS = {"reached_min", "left_before_min"}
PAID_SEGMENTS = {"deposit_paid", "full_paid"}
FULL_SHARE = 0.95  # "oxirigacha" — videoning 95% nuqtasiga yetgan


@dataclass(frozen=True)
class DayWatch:
    joined: bool = False
    max_position_sec: int = 0
    duration_sec: int = 0


@dataclass(frozen=True)
class LeadSnapshot:
    payment_status: str = "none"         # none | deposit | full
    has_pending_receipt: bool = False
    day1_watched: bool | None = None     # None — 1-kun hali baholanmagan
    day2_joined: bool | None = None      # None — 2-kun hali baholanmagan
    reached_offer: bool = False
    blocked: bool = False
    unsubscribed: bool = False
    cold: bool = False
    watch: dict[int, DayWatch] = field(default_factory=dict)


def _watch(s: LeadSnapshot, day: int | None) -> DayWatch:
    return s.watch.get(day or 1, DayWatch())


def matches(segment: str, s: LeadSnapshot, day: int | None = None, minute: int | None = None) -> bool:
    w = _watch(s, day)
    match segment:
        case "all":
            return True
        case "not_joined":
            return not w.joined
        case "reached_min":
            return w.joined and w.max_position_sec >= (minute or 0) * 60
        case "left_before_min":
            return w.joined and w.max_position_sec < (minute or 0) * 60
        case "watched_full":
            return w.joined and w.duration_sec > 0 and w.max_position_sec >= FULL_SHARE * w.duration_sec
        case "not_full":
            return w.joined and (w.duration_sec == 0 or w.max_position_sec < FULL_SHARE * w.duration_sec)
        case "day1_attended":
            return s.day1_watched is True
        case "day1_missed":
            return s.day1_watched is False
        case "day2_attended":
            return s.day2_joined is True
        case "day2_missed":
            return s.day2_joined is False
        case "reached_offer":
            return s.reached_offer
        case "left_before_offer":
            return s.day2_joined is True and not s.reached_offer
        case "receipt_sent":
            return s.has_pending_receipt
        case "deposit_paid":
            return s.payment_status == "deposit"
        case "full_paid":
            return s.payment_status == "full"
        case "not_paid":
            return s.payment_status == "none"
    return False


def chain_allowed(segment: str, s: LeadSnapshot, day: int | None = None,
                  minute: int | None = None) -> tuple[bool, str | None]:
    """Avtomatik (zanjir) xabar shu lidga ketadimi. (ruxsat, sabab)."""
    if s.blocked:
        return False, "botni bloklagan"
    if s.unsubscribed:
        return False, "xabarlarni to'xtatgan"
    if s.cold:
        return False, "sovuq lid — faqat ommaviy xabarlar"
    if s.payment_status != "none" and segment not in PAID_SEGMENTS:
        # to'lagan lidga sotuv va deadline xabarlari bormaydi
        return False, "to'lagan"
    if not matches(segment, s, day, minute):
        return False, "segmentga mos emas"
    return True, None


def flow_allowed(s: LeadSnapshot, paid_ok: bool = False) -> tuple[bool, str | None]:
    """Sxemadagi "Xabar" bloki. Kimga yuborilishini sxemaning o'zi (shart bloklari) hal qiladi."""
    if s.blocked:
        return False, "botni bloklagan"
    if s.unsubscribed:
        return False, "xabarlarni to'xtatgan"
    if s.cold:
        return False, "sovuq lid — faqat ommaviy xabarlar"
    if s.payment_status != "none" and not paid_ok:
        return False, "to'lagan"
    return True, None


def broadcast_allowed(segment: str, s: LeadSnapshot) -> bool:
    if s.blocked or s.unsubscribed:
        return False
    if segment == "cold":
        return s.cold
    return matches(segment, s)
