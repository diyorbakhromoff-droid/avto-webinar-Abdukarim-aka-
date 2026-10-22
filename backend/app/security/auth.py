"""Admin panel autentifikatsiyasi: login/parol -> JWT, rollar backendda tekshiriladi."""
from datetime import timedelta

import bcrypt
import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.db import get_db
from app.models import AdminUser
from app.timeutil import now_utc

bearer = HTTPBearer(auto_error=False)

ROLES = ("super_admin", "content", "sales")


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(password: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode(), hashed.encode())
    except ValueError:
        return False


def create_token(user: AdminUser) -> str:
    s = get_settings()
    payload = {"sub": str(user.id), "role": user.role, "exp": now_utc() + timedelta(hours=s.jwt_ttl_hours)}
    return jwt.encode(payload, s.jwt_secret, algorithm="HS256")


async def current_user(creds: HTTPAuthorizationCredentials | None = Depends(bearer),
                       db: AsyncSession = Depends(get_db)) -> AdminUser:
    if not creds:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Kirish talab qilinadi")
    try:
        payload = jwt.decode(creds.credentials, get_settings().jwt_secret, algorithms=["HS256"])
    except jwt.PyJWTError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Sessiya tugagan, qayta kiring")
    user = await db.get(AdminUser, int(payload["sub"]))
    if not user or not user.active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Foydalanuvchi faol emas")
    return user


def require(*roles: str):
    """Rol tekshiruvi: super_admin hamma joyga kiradi."""
    async def dep(user: AdminUser = Depends(current_user)) -> AdminUser:
        if user.role != "super_admin" and user.role not in roles:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Bu bo'lim sizning rolingiz uchun yopiq")
        return user
    return dep


SUPER = require()                     # faqat super_admin
CONTENT = require("content")
SALES = require("sales")
ANY = require("content", "sales")
