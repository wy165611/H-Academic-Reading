from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from app.config import settings
from app.database import Base, SessionLocal, engine
from app.routers import (
    auth_router,
    files_router,
    folders_router,
    papers_router,
    reader_router,
    settings_router,
)
from app.services.llm_service import get_or_create_settings
from app.services.pdf_worker import start_worker, stop_worker


@asynccontextmanager
async def lifespan(_app: FastAPI):
    settings.ensure_dirs()
    Base.metadata.create_all(bind=engine)
    # Idempotent lightweight migration for existing PostgreSQL deployments
    with engine.begin() as conn:
        conn.execute(
            text(
                "ALTER TABLE papers ADD COLUMN IF NOT EXISTS reading_progress DOUBLE PRECISION NOT NULL DEFAULT 0"
            )
        )
        conn.execute(
            text("ALTER TABLE papers ADD COLUMN IF NOT EXISTS last_block_id VARCHAR(64)")
        )
        conn.execute(
            text(
                "ALTER TABLE papers ADD COLUMN IF NOT EXISTS last_page INTEGER NOT NULL DEFAULT 1"
            )
        )
        conn.execute(
            text(
                "ALTER TABLE papers ADD COLUMN IF NOT EXISTS last_lang_mode VARCHAR(16) NOT NULL DEFAULT 'zh'"
            )
        )
        conn.execute(
            text(
                "ALTER TABLE papers ADD COLUMN IF NOT EXISTS last_view_mode VARCHAR(16) NOT NULL DEFAULT 'stream'"
            )
        )
    db = SessionLocal()
    try:
        get_or_create_settings(db)
    finally:
        db.close()

    await start_worker()
    try:
        yield
    finally:
        await stop_worker()


app = FastAPI(
    title="H文献大师 · Scholaread Self-Hosted API",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router.router)
app.include_router(settings_router.router)
app.include_router(folders_router.router)
app.include_router(papers_router.router)
app.include_router(reader_router.router)
app.include_router(files_router.router)


@app.get("/api/health")
def health():
    return {"status": "ok", "service": "scholaread-api"}
