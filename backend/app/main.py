from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers.video import router as video_router


app = FastAPI(
    title="Universal Video Downloader API",
    version="0.1.0",
    summary="Lightweight FastAPI backend powered by yt-dlp.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Content-Disposition", "Content-Type", "Content-Length"],
)


@app.get("/api/health")
def health_check():
    return {"success": True, "data": {"status": "ok"}}


app.include_router(video_router)
