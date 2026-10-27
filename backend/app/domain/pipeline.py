"""Sotuv doskasi (amoCRM kabi): menejer bosqichlari va lidning avtovoronka yo'li.

Bosqich — sotuvchining ishi (qo'ng'iroq qildim, qayta qo'ng'iroq, rad etdi).
Qadam (Lead.step) — botdagi avtovoronka holati. Ikkalasi alohida yuradi.
"""
from dataclasses import dataclass
from datetime import datetime, timedelta

STAGES = {
    "new": "Yangi",
    "contacted": "Bog'lanildi",
    "callback": "Qayta qo'ng'iroq",
    "waiting_payment": "To'lov kutilmoqda",
    "won": "Sotildi",
    "lost": "Rad etdi",
}


def stage_after_contact(stage: str, result: str) -> str:
    """Aloqa natijasi lidni qaysi bosqichga o'tkazadi.

    Sotilgan lid faqat «rad etdi» bilan chiqadi — qolgan to'lov uchun qo'ng'iroq uni doskadan tushirmaydi.
    "Javob bermadi" faqat yangi lidni "bog'lanildi"ga o'tkazadi (to'lov kutilayotgan lid joyida qoladi).
    """
    match result:
        case "sold":
            return "won"
        case "refused":
            return "lost"
        case "callback":
            return stage if stage == "won" else "callback"
        case "no_answer":
            return "contacted" if stage == "new" else stage
    return stage


def stage_after_receipt(stage: str) -> str:
    return stage if stage == "won" else "waiting_payment"


@dataclass
class PathStep:
    key: str
    label: str
    state: str  # done | missed | wait
    at: datetime | None = None
    detail: str = ""


@dataclass
class DayInfo:
    at: datetime                 # efir vaqti
    evaluated: bool              # kun yakunlangan
    watched_min: int | None      # None — kirmagan
    duration_min: int
    ok: bool | None = None       # 1-kun: yetarli ko'rdimi (75%)
    joined_at: datetime | None = None


@dataclass
class PathInput:
    registered_at: datetime
    source: str
    phone_at: datetime | None
    session_at: datetime | None          # vaqt tanlagan payt
    day1: DayInfo | None
    day2: DayInfo | None
    reached_offer_at: datetime | None
    clicked_buy_at: datetime | None
    receipt_at: datetime | None
    receipt_status: str | None           # oxirgi chek: pending | approved | rejected
    paid_at: datetime | None
    payment_status: str                  # none | deposit | full
    now: datetime | None = None          # efir o'tib, hali baholanmagan bo'lsa ham "kirmadi"


RECEIPT_UZ = {"pending": "tekshirilmoqda", "approved": "tasdiqlandi", "rejected": "rad etildi"}


def _day(key: str, label: str, d: DayInfo | None, now: datetime | None) -> PathStep:
    if d is None:
        return PathStep(key, label, "wait")
    if d.watched_min is not None:
        detail = f"{d.watched_min} / {d.duration_min} daq ko'rdi"
        return PathStep(key, label, "missed" if d.ok is False else "done", d.joined_at or d.at, detail)
    if d.evaluated or (now is not None and d.at + timedelta(minutes=d.duration_min) <= now):
        return PathStep(key, label, "missed", d.at, "kirmadi")
    return PathStep(key, label, "wait", d.at, "rejada")


def funnel_path(p: PathInput) -> list[PathStep]:
    """Avtovoronkadagi asosiy nuqtalar: nima qildi, nimani o'tkazib yubordi, nima hali oldinda."""
    steps = [
        PathStep("start", "Botga kirdi", "done", p.registered_at, f"manba: {p.source}" if p.source else ""),
        PathStep("phone", "Telefon berdi", "done" if p.phone_at else "wait", p.phone_at),
        PathStep("session", "Efir vaqtini tanladi", "done" if p.session_at else "wait", p.session_at),
        _day("day1", "1-kun efiri", p.day1, p.now),
        _day("day2", "2-kun efiri", p.day2, p.now),
    ]
    if p.reached_offer_at:
        steps.append(PathStep("offer", "Ofertagacha ko'rdi", "done", p.reached_offer_at))
    elif p.day2 and p.day2.watched_min is not None and p.day2.evaluated:
        steps.append(PathStep("offer", "Ofertagacha ko'rdi", "missed", None, "ofertagacha chiqib ketdi"))
    else:
        steps.append(PathStep("offer", "Ofertagacha ko'rdi", "wait"))
    steps.append(PathStep("buy", "«Kursga yozilish»ni bosdi", "done" if p.clicked_buy_at else "wait",
                          p.clicked_buy_at))
    steps.append(PathStep("receipt", "Chek yubordi", "done" if p.receipt_at else "wait", p.receipt_at,
                          RECEIPT_UZ.get(p.receipt_status or "", "")))
    if p.payment_status != "none":
        kind = "to'liq" if p.payment_status == "full" else "boshlang'ich"
        steps.append(PathStep("paid", "To'ladi", "done", p.paid_at, kind))
    else:
        steps.append(PathStep("paid", "To'ladi", "wait"))
    return steps
