from typing import Any, Literal

from pydantic import BaseModel, Field, HttpUrl


class ApiError(BaseModel):
    code: str
    message: str
    detail: Any | None = None


class ApiResponse(BaseModel):
    success: bool
    data: Any | None = None
    error: ApiError | None = None


class VideoParseRequest(BaseModel):
    url: HttpUrl


class DownloadLinkRequest(VideoParseRequest):
    format_id: str = Field(min_length=1, max_length=100)


class DownloadStrategy(BaseModel):
    mode: Literal["direct", "proxy"]
    reason: str
    label: str


class VideoFormatOption(BaseModel):
    format_id: str
    ext: str
    resolution: str
    label: str
    quality_rank: int
    download_mode: Literal["direct", "proxy"]
    is_complete_media: bool
    filesize: int | None = None
    filesize_human: str
    fps: float | None = None
    vcodec: str | None = None
    acodec: str | None = None
    protocol: str | None = None
    has_direct_url: bool
    note: str
    recommended: bool = False


class VideoMeta(BaseModel):
    source_url: HttpUrl
    title: str
    thumbnail: str | None = None
    duration_seconds: int | None = None
    duration_human: str
    uploader: str | None = None
    extractor: str | None = None
    webpage_url: str | None = None
    can_use_direct_link: bool
    recommended_strategy: DownloadStrategy
    formats: list[VideoFormatOption]
    copyright_notice: str


class DirectLinkPayload(BaseModel):
    url: str | None
    strategy: DownloadStrategy
    expires_hint: str | None = None
    warning: str | None = None
