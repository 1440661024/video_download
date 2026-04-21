from contextlib import asynccontextmanager
from threading import Thread
import logging

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.db.session import init_db
from app.routers.auth import router as auth_router
from app.routers.billing import router as billing_router
from app.routers.summary_stream import router as summary_router
from app.routers.video import router as video_router

logger = logging.getLogger(__name__)


def _warmup_asr_model() -> None:
    try:
        from app.routers.summary_stream import document_summary_service

        document_summary_service.transcript_service.asr_service._get_model()
        logger.info("ASR model warmup completed")
    except Exception as exc:
        logger.warning("ASR model warmup skipped: %s", exc)


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    Thread(target=_warmup_asr_model, daemon=True).start()
    yield


app = FastAPI(
    title="Universal Video Downloader API",
    version="0.1.0",
    summary="Lightweight FastAPI backend powered by yt-dlp.",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Content-Disposition", "Content-Type", "Content-Length"],
)


@app.exception_handler(HTTPException)
async def http_exception_handler(_: Request, exc: HTTPException):
    if isinstance(exc.detail, dict) and "success" in exc.detail:
        return JSONResponse(status_code=exc.status_code, content=exc.detail)
    return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})


@app.get("/api/health")
def health_check():
    return {"success": True, "data": {"status": "ok"}}


app.include_router(auth_router)
app.include_router(billing_router)
app.include_router(video_router)
app.include_router(summary_router)
