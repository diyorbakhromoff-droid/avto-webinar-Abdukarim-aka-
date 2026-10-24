"""Voronkalar, sozlamalar, rekvizitlar, tariflar, izohlar, media."""
import csv
import io
import os
import re
import uuid
from datetime import date

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.common import audit, funnel_or_404
from app.bot import texts
from app.config import get_settings
from app.db import get_db
from app.domain.media_rules import kind_from_mime, validate_upload
from app.domain.slots import late_entry_warning
from app.models import AdminUser, ChainMessage, Funnel, LiveComment, Media, Tariff
from app.security.auth import ANY, CONTENT, SUPER, current_user
from app.services.payments import safe_notify_admins
from app.services.tg import get_bot

router = APIRouter(prefix="/api/admin", tags=["admin"])

SLUG_RE = re.compile(r"^[A-Za-z0-9-]{1,32}$")
SOURCE_RE = re.compile(r"^[A-Za-z0-9_-]*$")
HHMM_RE = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")

SETTINGS_FIELDS = [
    "course_title", "webinar_title", "topic", "speaker_name", "speaker_title", "speaker_photo_url", "logo_url",
    "theme_primary", "theme_background", "bg_image_url", "welcome_text", "lead_magnet_media_id",
    "lead_magnet_caption", "slot_times", "weekdays", "excluded_dates", "min_hours_before", "options_count",
    "late_entry_minutes", "reschedule_limit", "day1_watch_threshold", "quiet_start", "quiet_end",
    "day1_video_id", "day1_duration_sec", "day1_soft_offer_sec", "day2_video_id", "day2_duration_sec",
    "day2_offer_sec", "between_summary", "offer_course_title", "bonuses", "deadline_hours", "after_deadline",
    "channel_id", "stuck_no_phone_min", "stuck_no_session_min", "stuck_no_receipt_min",
]
REQUISITE_FIELDS = ["card_number", "card_holder", "payme_url", "click_url"]


def funnel_out(f: Funnel) -> dict:
    return {"id": f.id, "slug": f.slug, "name": f.name, "bot_username": get_settings().bot_username}


def settings_out(f: Funnel) -> dict:
    out = {k: getattr(f, k) for k in SETTINGS_FIELDS}
    out["excluded_dates"] = [d.isoformat() for d in (f.excluded_dates or [])]
    return out


@router.get("/funnels")
async def funnels(db: AsyncSession = Depends(get_db), _=Depends(current_user)):
    return [funnel_out(f) for f in (await db.execute(select(Funnel).order_by(Funnel.id))).scalars()]


class FunnelIn(BaseModel):
    slug: str
    name: str


@router.post("/funnels")
async def create_funnel(body: FunnelIn, db: AsyncSession = Depends(get_db), me: AdminUser = Depends(CONTENT)):
    if not SLUG_RE.match(body.slug):
        raise HTTPException(400, "Slug: faqat lotin harf, raqam va '-' (32 belgigacha)")
    if (await db.execute(select(Funnel.id).where(Funnel.slug == body.slug))).first():
        raise HTTPException(400, "Bu slug band")
    f = Funnel(slug=body.slug, name=body.name)
    db.add(f)
    audit(db, me.name, "funnel_created", body.slug)
    await db.commit()
    return funnel_out(f)


@router.post("/funnels/{fid}/copy")
async def copy_funnel(fid: int, body: FunnelIn, db: AsyncSession = Depends(get_db), me: AdminUser = Depends(CONTENT)):
    src = await funnel_or_404(db, fid)
    if not SLUG_RE.match(body.slug) or (await db.execute(select(Funnel.id).where(Funnel.slug == body.slug))).first():
        raise HTTPException(400, "Slug noto'g'ri yoki band")
    f = Funnel(slug=body.slug, name=body.name)
    for k in SETTINGS_FIELDS + REQUISITE_FIELDS:
        setattr(f, k, getattr(src, k))
    db.add(f)
    await db.flush()
    for t in (await db.execute(select(Tariff).where(Tariff.funnel_id == src.id))).scalars():
        db.add(Tariff(funnel_id=f.id, name=t.name, description=t.description, special_price=t.special_price,
                      regular_price=t.regular_price, deposit_enabled=t.deposit_enabled,
                      deposit_amount=t.deposit_amount, sort=t.sort))
    for m in (await db.execute(select(ChainMessage).where(ChainMessage.funnel_id == src.id))).scalars():
        db.add(ChainMessage(funnel_id=f.id, **{c: getattr(m, c) for c in (
            "title", "kind", "text", "media_ids", "buttons", "trigger_type", "trigger_day", "offset_minutes",
            "stuck_step", "button_key", "segment", "segment_day", "segment_minute", "required", "status", "sort",
            "system_key")},
            updated_by=me.name))
    for c in (await db.execute(select(LiveComment).where(LiveComment.funnel_id == src.id))).scalars():
        db.add(LiveComment(funnel_id=f.id, day=c.day, t=c.t, author=c.author, text=c.text))
    audit(db, me.name, "funnel_copied", f"{src.slug} -> {body.slug}")
    await db.commit()
    return funnel_out(f)


@router.get("/funnels/{fid}/deeplink")
async def deeplink(fid: int, source: str = "", db: AsyncSession = Depends(get_db), _=Depends(current_user)):
    f = await funnel_or_404(db, fid)
    payload = f"{f.slug}_{source}" if source else f.slug
    if not SOURCE_RE.match(source) or len(payload) > 64:
        raise HTTPException(400, "Manba: faqat lotin harf, raqam, _ va - ; jami 64 belgigacha")
    return {"url": f"https://t.me/{get_settings().bot_username}?start={payload}"}


@router.get("/funnels/{fid}/settings")
async def get_settings_(fid: int, db: AsyncSession = Depends(get_db), _=Depends(ANY)):
    return settings_out(await funnel_or_404(db, fid))


def _validate(data: dict) -> None:
    for t in data.get("slot_times", []):
        if not HHMM_RE.match(t):
            raise HTTPException(400, f"Vaqt noto'g'ri: {t}")
    for k in ("quiet_start", "quiet_end"):
        if k in data and not HHMM_RE.match(data[k]):
            raise HTTPException(400, f"Vaqt noto'g'ri: {data[k]}")
    if any(d not in range(7) for d in data.get("weekdays", [])):
        raise HTTPException(400, "Hafta kuni 0–6 bo'lishi kerak")
    if "after_deadline" in data and data["after_deadline"] not in ("regular_price", "closed"):
        raise HTTPException(400, "after_deadline: regular_price yoki closed")
    if "day1_watch_threshold" in data and not 0 < data["day1_watch_threshold"] <= 1:
        raise HTTPException(400, "Ko'rish chegarasi 0 va 1 orasida")
    if "options_count" in data and data["options_count"] < 1:
        raise HTTPException(400, "K kamida 1")


@router.put("/funnels/{fid}/settings")
async def put_settings(fid: int, body: dict, db: AsyncSession = Depends(get_db), me: AdminUser = Depends(CONTENT)):
    f = await funnel_or_404(db, fid)
    data = {k: v for k, v in body.items() if k in SETTINGS_FIELDS}
    _validate(data)
    if "excluded_dates" in data:
        data["excluded_dates"] = sorted({date.fromisoformat(d) for d in data["excluded_dates"]})
    if "slot_times" in data:
        data["slot_times"] = sorted(set(data["slot_times"]))
    for k, v in data.items():
        setattr(f, k, v)
    audit(db, me.name, "settings_updated", f"{f.slug}: {', '.join(sorted(data))}")
    await db.commit()
    warnings = []
    if w := late_entry_warning(f.late_entry_minutes, f.day1_duration_sec):
        warnings.append(w)
    if f.day2_duration_sec and f.day2_offer_sec >= f.day2_duration_sec:
        warnings.append("Oferta timecode 2-kun videosi davomiyligidan katta.")
    if not f.day1_video_id or not f.day2_video_id:
        warnings.append("1-kun yoki 2-kun videosi kiritilmagan.")
    return {**settings_out(f), "warnings": warnings}


@router.get("/funnels/{fid}/requisites")
async def get_requisites(fid: int, db: AsyncSession = Depends(get_db), _=Depends(SUPER)):
    f = await funnel_or_404(db, fid)
    return {k: getattr(f, k) for k in REQUISITE_FIELDS}


class RequisitesIn(BaseModel):
    card_number: str = ""
    card_holder: str = ""
    payme_url: str = ""
    click_url: str = ""


@router.put("/funnels/{fid}/requisites")
async def put_requisites(fid: int, body: RequisitesIn, db: AsyncSession = Depends(get_db),
                         me: AdminUser = Depends(SUPER)):
    f = await funnel_or_404(db, fid)
    changed = [k for k in REQUISITE_FIELDS if getattr(f, k) != getattr(body, k)]
    for k in REQUISITE_FIELDS:
        setattr(f, k, getattr(body, k).strip())
    if changed:
        audit(db, me.name, "requisites_changed", f"{f.slug}: {', '.join(changed)}")
    await db.commit()
    if changed:
        await safe_notify_admins(get_bot(), db, texts.REQUISITES_CHANGED.format(funnel=f.name, who=me.name),
                                 exclude_id=me.id)
    return {k: getattr(f, k) for k in REQUISITE_FIELDS}


# ── tariflar ──

class TariffIn(BaseModel):
    name: str
    description: str = ""
    special_price: int
    regular_price: int
    deposit_enabled: bool = True
    deposit_amount: int = 100_000
    sort: int = 0


def tariff_out(t: Tariff) -> dict:
    return {k: getattr(t, k) for k in ("id", "name", "description", "special_price", "regular_price",
                                        "deposit_enabled", "deposit_amount", "sort")}


@router.get("/funnels/{fid}/tariffs")
async def tariffs(fid: int, db: AsyncSession = Depends(get_db), _=Depends(ANY)):
    rows = (await db.execute(select(Tariff).where(Tariff.funnel_id == fid).order_by(Tariff.sort, Tariff.id))).scalars()
    return [tariff_out(t) for t in rows]


@router.post("/funnels/{fid}/tariffs")
async def add_tariff(fid: int, body: TariffIn, db: AsyncSession = Depends(get_db), me: AdminUser = Depends(CONTENT)):
    await funnel_or_404(db, fid)
    t = Tariff(funnel_id=fid, **body.model_dump())
    db.add(t)
    audit(db, me.name, "tariff_created", body.name)
    await db.commit()
    return tariff_out(t)


@router.put("/tariffs/{tid}")
async def put_tariff(tid: int, body: TariffIn, db: AsyncSession = Depends(get_db), me: AdminUser = Depends(CONTENT)):
    t = await db.get(Tariff, tid)
    if not t:
        raise HTTPException(404, "Tarif topilmadi")
    for k, v in body.model_dump().items():
        setattr(t, k, v)
    audit(db, me.name, "tariff_updated", body.name)
    await db.commit()
    return tariff_out(t)


@router.delete("/tariffs/{tid}")
async def del_tariff(tid: int, db: AsyncSession = Depends(get_db), me: AdminUser = Depends(CONTENT)):
    t = await db.get(Tariff, tid)
    if t:
        audit(db, me.name, "tariff_deleted", t.name)
        await db.delete(t)
        await db.commit()
    return {"ok": True}


# ── asl efir izohlari ──

def comment_out(c: LiveComment) -> dict:
    return {"id": c.id, "day": c.day, "t": c.t, "author": c.author, "text": c.text}


class CommentIn(BaseModel):
    day: int
    t: int
    author: str
    text: str


@router.get("/funnels/{fid}/comments")
async def comments(fid: int, day: int | None = None, db: AsyncSession = Depends(get_db), _=Depends(CONTENT)):
    q = select(LiveComment).where(LiveComment.funnel_id == fid)
    if day:
        q = q.where(LiveComment.day == day)
    return [comment_out(c) for c in (await db.execute(q.order_by(LiveComment.day, LiveComment.t))).scalars()]


@router.post("/funnels/{fid}/comments")
async def add_comment(fid: int, body: CommentIn, db: AsyncSession = Depends(get_db), _=Depends(CONTENT)):
    c = LiveComment(funnel_id=fid, **body.model_dump())
    db.add(c)
    await db.commit()
    return comment_out(c)


@router.delete("/comments/{cid}")
async def del_comment(cid: int, db: AsyncSession = Depends(get_db), _=Depends(CONTENT)):
    await db.execute(delete(LiveComment).where(LiveComment.id == cid))
    await db.commit()
    return {"ok": True}


def parse_timecode(value: str) -> int:
    parts = [int(p) for p in value.strip().split(":")]
    sec = 0
    for p in parts:
        sec = sec * 60 + p
    return sec


@router.post("/funnels/{fid}/comments/import")
async def import_comments(fid: int, day: int = Form(...), file: UploadFile = File(...),
                          db: AsyncSession = Depends(get_db), _=Depends(CONTENT)):
    raw = (await file.read()).decode("utf-8-sig")
    n = 0
    for row in csv.reader(io.StringIO(raw)):
        if len(row) < 3 or not row[0].strip() or not row[0].strip()[0].isdigit():
            continue  # sarlavha yoki bo'sh qator
        try:
            t = parse_timecode(row[0])
        except ValueError:
            continue
        db.add(LiveComment(funnel_id=fid, day=day, t=t, author=row[1].strip()[:100], text=",".join(row[2:]).strip()))
        n += 1
    await db.commit()
    return {"imported": n}


# ── media ──

def media_out(m: Media, warnings: list[str] | None = None) -> dict:
    return {"id": m.id, "kind": m.kind, "filename": m.filename, "size": m.size,
            "url": f"/api/admin/media/{m.id}/file", "warnings": warnings or []}


@router.post("/media")
async def upload_media(file: UploadFile = File(...), kind: str | None = Form(default=None),
                       db: AsyncSession = Depends(get_db), _=Depends(CONTENT)):
    data = await file.read()
    k = kind or kind_from_mime(file.content_type or "", file.filename or "")
    d = os.path.join(get_settings().storage_dir, "media")
    os.makedirs(d, exist_ok=True)
    ext = os.path.splitext(file.filename or "")[1][:10]
    path = os.path.join(d, f"{uuid.uuid4().hex}{ext}")
    with open(path, "wb") as fh:
        fh.write(data)
    m = Media(kind=k, filename=file.filename or "fayl", mime=file.content_type or "", size=len(data), path=path)
    db.add(m)
    await db.commit()
    return media_out(m, validate_upload(k, len(data)))


@router.get("/media/{mid}")
async def media_info(mid: int, db: AsyncSession = Depends(get_db), _=Depends(current_user)):
    m = await db.get(Media, mid)
    if not m:
        raise HTTPException(404, "Fayl topilmadi")
    return media_out(m)


@router.get("/media/{mid}/file")
async def media_file(mid: int, db: AsyncSession = Depends(get_db)):
    """Progrev media fayllari (marketing kontenti) — <img> da ko'rsatish uchun tokensiz.
    Cheklar boshqa endpointda va faqat sotuv/super admin uchun."""
    m = await db.get(Media, mid)
    if not m or not os.path.isfile(m.path):
        raise HTTPException(404, "Fayl topilmadi")
    return FileResponse(m.path, media_type=m.mime or None, filename=m.filename)
