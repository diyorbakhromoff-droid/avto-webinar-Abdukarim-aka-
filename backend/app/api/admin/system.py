"""Kirish, foydalanuvchilar va rollar, umumiy sozlamalar, audit."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.common import audit, iso
from app.config import get_settings
from app.db import get_db
from app.models import AdminUser, AuditLog, ChainMessage, KeyValue, Lead, ScheduledMessage
from app.security.auth import ANY, ROLES, SUPER, create_token, current_user, hash_password, verify_password
from app.services import test_send as ts
from app.services.tg import get_bot

router = APIRouter(prefix="/api/admin", tags=["admin"])


def user_out(u: AdminUser) -> dict:
    return {"id": u.id, "name": u.name, "login": u.login, "role": u.role, "tg_user_id": u.tg_user_id,
            "active": u.active}


class LoginIn(BaseModel):
    login: str
    password: str


@router.post("/auth/login")
async def login(body: LoginIn, db: AsyncSession = Depends(get_db)):
    u = (await db.execute(select(AdminUser).where(AdminUser.login == body.login))).scalar_one_or_none()
    if not u or not u.active or not verify_password(body.password, u.password_hash):
        raise HTTPException(401, "Login yoki parol noto'g'ri")
    return {"token": create_token(u), "user": user_out(u)}


@router.get("/me")
async def me(user: AdminUser = Depends(current_user)):
    return user_out(user)


class UserIn(BaseModel):
    name: str | None = None
    login: str | None = None
    role: str | None = None
    tg_user_id: int | None = None
    active: bool | None = None
    password: str | None = Field(default=None, min_length=8)


@router.get("/users")
async def users(db: AsyncSession = Depends(get_db), _=Depends(SUPER)):
    return [user_out(u) for u in (await db.execute(select(AdminUser).order_by(AdminUser.id))).scalars()]


@router.post("/users")
async def create_user(body: UserIn, db: AsyncSession = Depends(get_db), me: AdminUser = Depends(SUPER)):
    if not body.login or not body.password or body.role not in ROLES:
        raise HTTPException(400, "Login, parol (kamida 8 belgi) va rol majburiy")
    if (await db.execute(select(AdminUser).where(AdminUser.login == body.login))).first():
        raise HTTPException(400, "Bu login band")
    u = AdminUser(login=body.login, name=body.name or body.login, role=body.role, tg_user_id=body.tg_user_id,
                  password_hash=hash_password(body.password), active=True if body.active is None else body.active)
    db.add(u)
    audit(db, me.name, "user_created", f"{u.login} ({u.role})")
    await db.commit()
    return user_out(u)


@router.put("/users/{uid}")
async def update_user(uid: int, body: UserIn, db: AsyncSession = Depends(get_db), me: AdminUser = Depends(SUPER)):
    u = await db.get(AdminUser, uid)
    if not u:
        raise HTTPException(404, "Foydalanuvchi topilmadi")
    data = body.model_dump(exclude_unset=True)
    if "role" in data and data["role"] not in ROLES:
        raise HTTPException(400, "Noto'g'ri rol")
    if u.id == me.id and (data.get("active") is False or data.get("role", "super_admin") != "super_admin"):
        raise HTTPException(400, "O'zingizni o'chira yoki rolingizni pasaytira olmaysiz")
    if pw := data.pop("password", None):
        u.password_hash = hash_password(pw)
    for k, v in data.items():
        setattr(u, k, v)
    audit(db, me.name, "user_updated", f"{u.login}: {', '.join(sorted(body.model_fields_set))}")
    await db.commit()
    return user_out(u)


@router.get("/managers")
async def managers(db: AsyncSession = Depends(get_db), _=Depends(current_user)):
    """Lid biriktirish va filtrlar uchun: faol sotuv menejerlari va super adminlar."""
    rows = (await db.execute(select(AdminUser).where(
        AdminUser.active.is_(True), AdminUser.role.in_(("sales", "super_admin"))).order_by(AdminUser.name))).scalars()
    return [{"id": u.id, "name": u.name} for u in rows]


class GlobalSettingsIn(BaseModel):
    admin_group_chat_id: int | None = None
    test_chat_id: int | None = None


async def _kv(db: AsyncSession, key: str):
    kv = await db.get(KeyValue, key)
    return kv.value if kv else None


async def _set_kv(db: AsyncSession, key: str, value) -> None:
    kv = await db.get(KeyValue, key)
    if kv:
        kv.value = value
    else:
        db.add(KeyValue(key=key, value=value))


@router.get("/settings")
async def get_global(db: AsyncSession = Depends(get_db), _=Depends(SUPER)):
    return {"admin_group_chat_id": await _kv(db, "admin_group_chat_id"),
            "test_chat_id": await _kv(db, ts.TEST_CHAT_KEY), "test_chat_title": await _kv(db, "test_chat_title"),
            "bot_username": get_settings().bot_username}


@router.put("/settings")
async def put_global(body: GlobalSettingsIn, db: AsyncSession = Depends(get_db), me: AdminUser = Depends(SUPER)):
    """Faqat yuborilgan maydonlar o'zgaradi. Test chati saqlashdan oldin tekshiriladi (bot unga yoza oladimi)."""
    data = body.model_dump(exclude_unset=True)
    if "admin_group_chat_id" in data:
        await _set_kv(db, "admin_group_chat_id", data["admin_group_chat_id"])
    if "test_chat_id" in data:
        title = None
        if cid := data["test_chat_id"]:
            try:
                cid, title = await ts.verify_chat(get_bot(), cid)
            except ts.TestSendError as e:
                raise HTTPException(400, str(e)) from None
            except Exception as e:  # noqa: BLE001
                raise HTTPException(400, ts.explain(e)) from None
        await _set_kv(db, ts.TEST_CHAT_KEY, cid)
        await _set_kv(db, "test_chat_title", title)
    audit(db, me.name, "settings_updated", ", ".join(f"{k}={v}" for k, v in data.items()))
    await db.commit()
    return await get_global(db)


@router.get("/test-targets")
async def test_targets(db: AsyncSession = Depends(get_db), me: AdminUser = Depends(ANY)):
    """Test xabari qayerga yuborilishi mumkin: faqat o'zingizga yoki test chatiga."""
    chat_id = await ts.test_chat_id(db)
    return {"me": {"ready": bool(me.tg_user_id)},
            "chat": {"ready": bool(chat_id), "title": await _kv(db, "test_chat_title") if chat_id else None}}


@router.get("/audit")
async def audit_log(db: AsyncSession = Depends(get_db), _=Depends(SUPER)):
    rows = (await db.execute(select(AuditLog).order_by(AuditLog.id.desc()).limit(300))).scalars()
    return [{"at": iso(a.at), "user": a.user_name, "action": a.action, "details": a.details} for a in rows]


@router.get("/failed-messages")
async def failed_messages(db: AsyncSession = Depends(get_db), _=Depends(SUPER)):
    rows = (await db.execute(
        select(ScheduledMessage, Lead.first_name, ChainMessage.title)
        .join(Lead, Lead.id == ScheduledMessage.lead_id)
        .outerjoin(ChainMessage, ChainMessage.id == ScheduledMessage.chain_message_id)
        .where(ScheduledMessage.status == "failed", ScheduledMessage.reason.not_like("403%"))
        .order_by(ScheduledMessage.send_at.desc()).limit(200))).all()
    return [{"id": sm.id, "lead_name": name, "title": title or "Ommaviy xabar", "error": sm.reason or "",
             "at": iso(sm.send_at)} for sm, name, title in rows]
