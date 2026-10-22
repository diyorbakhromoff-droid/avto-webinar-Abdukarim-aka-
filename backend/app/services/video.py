"""Bunny Stream: imzolangan, vaqtinchalik HLS havola.

Bunny CDN token authentication (katalog tokeni) — HLS segmentlari ham shu token bilan ochiladi:
  token = base64url(sha256(key + signature_path + expires + "token_path=<path>"))
  url   = https://<host>/bcdn_token=<token>&expires=<exp>&token_path=<path>/<path>playlist.m3u8
Ishga tushirishdan oldin Bunny panelida Token Authentication yoqilgan bo'lishi kerak.
"""
import base64
import hashlib
import time
from urllib.parse import quote

from app.config import get_settings


def sign_directory_url(host: str, key: str, path_allowed: str, file_path: str, expires: int) -> str:
    params = f"token_path={path_allowed}"
    raw = hashlib.sha256(f"{key}{path_allowed}{expires}{params}".encode()).digest()
    token = base64.b64encode(raw).decode().replace("+", "-").replace("/", "_").replace("=", "")
    return (f"https://{host}/bcdn_token={token}&expires={expires}"
            f"&token_path={quote(path_allowed, safe='')}{file_path}")


def hls_url(video_id: str, now: float | None = None) -> str:
    s = get_settings()
    if video_id.startswith("http"):
        return video_id  # to'g'ridan-to'g'ri havola (sinov uchun)
    path = f"/{video_id}/"
    if not s.bunny_token_key:
        return f"https://{s.bunny_cdn_host}{path}playlist.m3u8"
    expires = int((now or time.time()) + s.video_url_ttl_sec)
    return sign_directory_url(s.bunny_cdn_host, s.bunny_token_key, path, f"{path}playlist.m3u8", expires)
