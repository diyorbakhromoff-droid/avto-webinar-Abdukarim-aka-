"""Halollik qoidalari (TZ 11-bo'lim): yozuvni jonli deb ko'rsatmaslik."""
import re

BANNED = ["jonli", "live", "hozir efirda", "oxirgi 3 joy"]
_PATTERNS = [re.compile(rf"(?<![\w']){re.escape(w)}(?![\w'])", re.IGNORECASE) for w in BANNED]


def honesty_warnings(text: str) -> list[str]:
    found = [w for w, p in zip(BANNED, _PATTERNS) if p.search(text or "")]
    if not found:
        return []
    words = ", ".join(f"«{w}»" for w in found)
    return [f"Matnda {words} bor. Yozib olingan efirni jonli deb ko'rsatmang — «efir», «webinar» deng."]
