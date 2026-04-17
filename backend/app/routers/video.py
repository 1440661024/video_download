from urllib.parse import urlparse

import httpx
from fastapi import APIRouter
from fastapi.responses import FileResponse, JSONResponse, Response
from starlette.background import BackgroundTask

from app.schemas import ApiResponse, DirectLinkPayload, DownloadLinkRequest, VideoParseRequest
from app.services.video_service import VideoService, VideoServiceError


router = APIRouter(prefix="/api/video", tags=["video"])
service = VideoService()


@router.post("/parse", response_model=ApiResponse)
def parse_video(payload: VideoParseRequest) -> ApiResponse:
    try:
        meta = service.parse_video(str(payload.url))
        return ApiResponse(success=True, data=meta.model_dump())
    except VideoServiceError as exc:
        return ApiResponse(
            success=False,
            error={"code": exc.code, "message": exc.message, "detail": exc.detail},
        )


@router.post("/download-link", response_model=ApiResponse)
def download_link(payload: DownloadLinkRequest) -> ApiResponse:
    try:
        data = DirectLinkPayload(**service.get_direct_link(str(payload.url), payload.format_id))
        return ApiResponse(success=True, data=data.model_dump())
    except VideoServiceError as exc:
        return ApiResponse(
            success=False,
            error={"code": exc.code, "message": exc.message, "detail": exc.detail},
        )


@router.get("/thumbnail")
async def proxy_thumbnail(url: str, source_url: str | None = None):
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/136.0.0.0 Safari/537.36"
        ),
    }
    if source_url:
        parsed = urlparse(source_url)
        if parsed.scheme and parsed.netloc:
            headers["Referer"] = f"{parsed.scheme}://{parsed.netloc}/"

    try:
        async with httpx.AsyncClient(follow_redirects=True, timeout=20.0) as client:
            response = await client.get(url, headers=headers)
            response.raise_for_status()
    except httpx.HTTPError as exc:
        return JSONResponse(
            status_code=400,
            content=ApiResponse(
                success=False,
                error={
                    "code": "THUMBNAIL_FETCH_FAILED",
                    "message": "缩略图加载失败，请稍后重试。",
                    "detail": str(exc),
                },
            ).model_dump(),
        )

    media_type = response.headers.get("content-type", "image/jpeg")
    return Response(content=response.content, media_type=media_type)


@router.get("/download")
def download_video(url: str, format_id: str):
    normalized_format_id = format_id.replace(" ", "+")
    try:
        file_path, file_name = service.download_to_temp(url, normalized_format_id)
    except VideoServiceError as exc:
        return JSONResponse(
            status_code=400,
            content=ApiResponse(
                success=False,
                error={"code": exc.code, "message": exc.message, "detail": exc.detail},
            ).model_dump(),
        )

    return FileResponse(
        path=file_path,
        filename=file_name,
        media_type="application/octet-stream",
        background=BackgroundTask(service.cleanup_file, file_path),
    )
