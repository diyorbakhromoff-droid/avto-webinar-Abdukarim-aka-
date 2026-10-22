"""Kirish, foydalanuvchilar va rollar, umumiy sozlamalar, audit."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.common import audit, iso
from app.config import get_settings
from app.db import get_db
from app.models import AdminUser, AuditLog, ChainMessage, KeyValue, Lead, ScheduledMessage
from app.security.auth import ROLES, SUPER, create_token, current_user, hash_password, verify_password

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


class GlobalSettingsIn(BaseModel):
    admin_group_chat_id: int | None = None


@router.get("/settings")
async def get_global(db: AsyncSession = Depends(get_db), _=Depends(SUPER)):
    kv = await db.get(KeyValue, "admin_group_chat_id")
    return {"admin_group_chat_id": kv.value if kv else None, "bot_username": get_settings().bot_username}


@router.put("/settings")
async def put_global(body: GlobalSettingsIn, db: AsyncSession = Depends(get_db), me: AdminUser = Depends(SUPER)):
    kv = await db.get(KeyValue, "admin_group_chat_id")
    if kv:
        kv.value = body.admin_group_chat_id
    else:
        db.add(KeyValue(key="admin_group_chat_id", value=body.admin_group_chat_id))
    audit(db, me.name, "settings_updated", f"admin_group_chat_id={body.admin_group_chat_id}")
    await db.commit()
    return await get_global(db)


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
