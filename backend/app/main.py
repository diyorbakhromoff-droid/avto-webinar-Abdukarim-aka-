"""FastAPI ilovasi: uvicorn app.main:app"""
import logging

from fastapi import Depends, FastAPI
from fastapi.responses import RedirectResponse
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api import miniapp
from app.api.admin import chain, flows, funnels, leads, ops, stats, system
from app.db import get_db
from app.models import Broadcast, ChainMessage, Lead, ScheduledMessage
from app.services.leads import event

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

app = FastAPI(title="Avtowebinar API", docs_url="/api/docs", openapi_url="/api/openapi.json")
for r in (miniapp.router, system.router, funnels.router, chain.router, flows.router, leads.router, ops.router,
          stats.router):
    app.include_router(r)


@app.get("/api/health")
async def health(db: AsyncSession = Depends(get_db)):
    await db.execute(text("SELECT 1"))
    return {"ok": True}


@app.get("/api/r/{sid}/{row}/{col}", include_in_schema=False)
async def track_redirect(sid: int, row: int, col: int, db: AsyncSession = Depends(get_db)):
    """Zanjirdagi URL tugmalarini bosishni hisoblab, asl manzilga yo'naltiradi."""
    sm = await db.get(ScheduledMessage, sid)
    url = None
    if sm:
        src = await db.get(ChainMessage, sm.chain_message_id) if sm.chain_message_id else \
            await db.get(Broadcast, sm.broadcast_id) if sm.broadcast_id else None
        try:
            url = src.buttons[row][col].get("url") if src else None
        except (IndexError, AttributeError):
            url = None
        if url and sm.chain_message_id:
            lead = await db.get(Lead, sm.lead_id)
            event(db, lead, "button_click", chain_message_id=sm.chain_message_id)
            await db.commit()
    return RedirectResponse(url or "https://t.me", status_code=302)
