"""Telegram Mini App initData imzosini tekshirish.

https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
secret_key = HMAC_SHA256(key="WebAppData", msg=bot_token)
hash       = hex(HMAC_SHA256(key=secret_key, msg=data_check_string))
"""
import hashlib
import hmac
import json
import time
from dataclasses import dataclass
from urllib.parse import parse_qsl, urlencode


class InitDataError(Exception):
    pass


@dataclass(frozen=True)
class WebAppUser:
    id: int
    first_name: str
    username: str | None


def _secret(bot_token: str) -> bytes:
    return hmac.new(b"WebAppData", bot_token.encode(), hashlib.sha256).digest()


def sign(fields: dict[str, str], bot_token: str) -> str:
    """Testlar va lokal ishlab chiqish uchun: initData satrini imzolaydi."""
    check = "\n".join(f"{k}={v}" for k, v in sorted(fields.items()))
    h = hmac.new(_secret(bot_token), check.encode(), hashlib.sha256).hexdigest()
    return urlencode({**fields, "hash": h})


def validate(init_data: str, bot_token: str, max_age_sec: int, now: float | None = None) -> WebAppUser:
    if not init_data:
        raise InitDataError("initData yo'q")
    pairs = dict(parse_qsl(init_data, keep_blank_values=True, strict_parsing=False))
    received = pairs.pop("hash", None)
    if not received:
        raise InitDataError("hash yo'q")
    check = "\n".join(f"{k}={v}" for k, v in sorted(pairs.items()))
    expected = hmac.new(_secret(bot_token), check.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, received):
        raise InitDataError("imzo noto'g'ri")
    auth_date = int(pairs.get("auth_date", "0"))
    if max_age_sec and (now or time.time()) - auth_date > max_age_sec:
        raise InitDataError("initData eskirgan")
    try:
        user = json.loads(pairs["user"])
        return WebAppUser(id=int(user["id"]), first_name=user.get("first_name", ""), username=user.get("username"))
    except (KeyError, ValueError) as e:
        raise InitDataError("user maydoni noto'g'ri") from e
