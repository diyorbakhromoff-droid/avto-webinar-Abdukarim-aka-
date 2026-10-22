"""Segmentlar (TZ 2-bo'lim) — yuborish paytida tekshiriladi."""
from dataclasses import dataclass

SEGMENTS = {
    "all": "Hammaga",
    "day1_attended": "1-kunga kelganlar",
    "day1_missed": "1-kunga kelmaganlar",
    "day2_attended": "2-kunga kelganlar",
    "day2_missed": "2-kunga kelmaganlar",
    "reached_offer": "Oferta momentigacha ko'rganlar",
    "left_before_offer": "Ofertagacha chiqib ketganlar",
    "receipt_sent": "Chek yuborganlar",
    "deposit_paid": "Boshlang'ich to'laganlar",
    "full_paid": "To'liq to'laganlar",
    "not_paid": "To'lamaganlar",
}

PAID_SEGMENTS = {"deposit_paid", "full_paid"}


@dataclass(frozen=True)
class LeadSnapshot:
    payment_status: str = "none"         # none | deposit | full
    has_pending_receipt: bool = False
    day1_watched: bool | None = None     # None — 1-kun hali tugamagan
    day2_joined: bool | None = None      # None — 2-kun hali tugamagan
    reached_offer: bool = False
    blocked: bool = False
    unsubscribed: bool = False
    cold: bool = False


def matches(segment: str, s: LeadSnapshot) -> bool:
    match segment:
        case "all":
            return True
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


def chain_allowed(segment: str, s: LeadSnapshot) -> tuple[bool, str | None]:
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
    if not matches(segment, s):
        return False, "segmentga mos emas"
    return True, None


def broadcast_allowed(segment: str, s: LeadSnapshot) -> bool:
    if s.blocked or s.unsubscribed:
        return False
    if segment == "cold":
        return s.cold
    return matches(segment, s)
