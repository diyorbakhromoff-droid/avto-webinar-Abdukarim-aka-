"""Telegram cheklovlari (Bot API)."""
TEXT_LIMIT = 4096
CAPTION_LIMIT = 1024
ALBUM_MIN, ALBUM_MAX = 2, 10

# Bot API orqali yuklash chegaralari (bayt)
UPLOAD_LIMITS = {
    "photo": 10 * 1024 * 1024,
    "video": 50 * 1024 * 1024,
    "video_note": 50 * 1024 * 1024,
    "voice": 50 * 1024 * 1024,
    "audio": 50 * 1024 * 1024,
    "document": 50 * 1024 * 1024,
}


def kind_from_mime(mime: str, filename: str) -> str:
    mime = (mime or "").lower()
    if mime.startswith("image/") and not mime.endswith("gif"):
        return "photo"
    if mime.startswith("video/"):
        return "video"
    if mime in ("audio/ogg", "audio/opus") or filename.lower().endswith(".ogg"):
        return "voice"
    if mime.startswith("audio/"):
        return "audio"
    return "document"


def validate_upload(kind: str, size: int) -> list[str]:
    warnings = []
    limit = UPLOAD_LIMITS.get(kind)
    if limit and size > limit:
        warnings.append(f"Fayl hajmi {size // (1024 * 1024)} MB — Telegram chegarasi {limit // (1024 * 1024)} MB.")
    if kind == "video_note":
        warnings.append("Video-doira kvadrat bo'lishi va 1 daqiqadan oshmasligi kerak.")
    return warnings


def validate_message(kind: str, text: str, media_count: int, buttons: list) -> list[str]:
    errors = []
    has_media = kind != "text"
    limit = CAPTION_LIMIT if has_media and kind != "album" else TEXT_LIMIT
    if kind == "album":
        limit = CAPTION_LIMIT
        if not (ALBUM_MIN <= media_count <= ALBUM_MAX):
            errors.append("Albomda 2–10 ta media bo'lishi kerak.")
    if len(text or "") > limit:
        errors.append(f"Matn {len(text)} belgi — chegara {limit}.")
    if has_media and kind != "album" and media_count != 1:
        errors.append("Bu turdagi xabarga bitta media biriktiring.")
    if len(buttons or []) > 3:
        errors.append("Tugmalar 1–3 qator bo'lishi kerak.")
    if kind == "video_note" and (text or "").strip():
        errors.append("Video-doiraga matn qo'shib bo'lmaydi — matnni alohida xabar qiling.")
    return errors
