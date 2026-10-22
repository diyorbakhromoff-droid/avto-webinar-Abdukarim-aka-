from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AuditLog, Funnel


def iso(dt: datetime | None) -> str | None:
    if dt is None:
        return None
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def parse_iso(value: str | None) -> datetime | None:
    if not value:
        return None
    dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


async def funnel_or_404(db: AsyncSession, funnel_id: int) -> Funnel:
    f = await db.get(Funnel, funnel_id)
    if not f:
        raise HTTPException(404, "Voronka topilmadi")
    return f


def audit(db: AsyncSession, user_name: str, action: str, details: str = "") -> None:
    db.add(AuditLog(user_name=user_name, action=action, details=details))
