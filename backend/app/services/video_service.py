from __future__ import annotations

import base64
import json
import re
import shutil
import uuid
from collections import defaultdict
from hashlib import sha256
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse

import httpx
from yt_dlp import DownloadError, YoutubeDL

from app.config import FFMPEG_LOCATION, MAX_DIRECT_LINK_SIZE, TEMP_DOWNLOAD_DIR
from app.schemas import DownloadStrategy, VideoFormatOption, VideoMeta


class VideoServiceError(Exception):
    def __init__(self, code: str, message: str, detail: Any | None = None) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.detail = detail


def format_bytes(size: int | None) -> str:
    if not size:
        return "大小未知"

    units = ["B", "KB", "MB", "GB", "TB"]
    value = float(size)
    for unit in units:
        if value < 1024 or unit == units[-1]:
            return f"{value:.1f}{unit}" if unit != "B" else f"{int(value)}B"
        value /= 1024
    return f"{size}B"


def normalize_duration(seconds: int | float | None) -> int | None:
    if seconds is None:
        return None
    try:
        return max(0, int(round(float(seconds))))
    except (TypeError, ValueError):
        return None


def normalize_filesize(size: int | float | None) -> int | None:
    if size is None:
        return None
    try:
        return max(0, int(size))
    except (TypeError, ValueError):
        return None


def format_duration(seconds: int | float | None) -> str:
    seconds_int = normalize_duration(seconds)
    if seconds_int is None:
        return "时长未知"
    hours, remainder = divmod(seconds_int, 3600)
    minutes, secs = divmod(remainder, 60)
    if hours:
        return f"{hours:d}:{minutes:02d}:{secs:02d}"
    return f"{minutes:d}:{secs:02d}"


def sanitize_filename(name: str) -> str:
    normalized = re.sub(r"[\r\n\t]+", " ", name)
    normalized = re.sub(r"\s+", " ", normalized).strip()
    safe = re.sub(r'[\\/:*?"<>|]+', "-", normalized).strip(" .")
    return safe[:80] or "video"


def normalize_height(fmt: dict[str, Any]) -> int:
    height = fmt.get("height")
    if height:
        try:
            return int(height)
        except (TypeError, ValueError):
            return 0

    note = str(fmt.get("format_note") or fmt.get("resolution") or "")
    matched = re.search(r"(\d{3,4})[pP]", note)
    if matched:
        return int(matched.group(1))

    matched = re.search(r"x(\d{3,4})", note)
    if matched:
        return int(matched.group(1))
    return 0


def quality_label(height: int) -> str:
    if height >= 2160:
        return "4K 超清"
    if height >= 1440:
        return "2K 超清"
    if height >= 1080:
        return "1080P 高清"
    if height >= 720:
        return "720P 准高清"
    if height >= 480:
        return "480P 标清"
    if height >= 360:
        return "360P 流畅"
    if height > 0:
        return f"{height}P"
    return "默认清晰度"


def is_audio_only(fmt: dict[str, Any]) -> bool:
    return fmt.get("vcodec") in (None, "none") and fmt.get("acodec") not in (None, "none")


def is_video_only(fmt: dict[str, Any]) -> bool:
    return fmt.get("vcodec") not in (None, "none") and fmt.get("acodec") in (None, "none")


class DouyinResolver:
    API_URL = "https://www.iesdouyin.com/web/api/v2/aweme/iteminfo/"
    MOBILE_SHARE_HEADERS = {
        "User-Agent": (
            "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) "
            "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 "
            "Mobile/15E148 Safari/604.1"
        ),
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        "Referer": "https://www.douyin.com/",
    }
    DOWNLOAD_HEADERS = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/136.0.0.0 Safari/537.36"
        ),
        "Referer": "https://www.douyin.com/",
    }

    def supports(self, url: str) -> bool:
        hostname = (urlparse(url).hostname or "").lower()
        return "douyin.com" in hostname or "iesdouyin.com" in hostname

    def parse_video(self, url: str) -> VideoMeta:
        resolved = self._resolve_video(url)
        strategy = self._proxy_strategy("抖音视频默认走服务端代理下载，避免直链过期或防盗链导致失败。")
        quality_rank = resolved["quality_rank"]
        option = VideoFormatOption(
            format_id="douyin-main",
            ext="mp4",
            resolution=resolved["resolution"],
            label=quality_label(quality_rank),
            quality_rank=quality_rank,
            download_mode="proxy",
            is_complete_media=True,
            filesize=resolved["filesize"],
            filesize_human=format_bytes(resolved["filesize"]),
            fps=None,
            vcodec=None,
            acodec=None,
            protocol="https",
            has_direct_url=False,
            note="抖音无水印成片",
            recommended=True,
        )
        return VideoMeta(
            source_url=url,
            title=resolved["title"],
            thumbnail=resolved["thumbnail"],
            duration_seconds=resolved["duration_seconds"],
            duration_human=format_duration(resolved["duration_seconds"]),
            uploader=resolved["uploader"],
            extractor="Douyin",
            webpage_url=resolved["webpage_url"],
            can_use_direct_link=False,
            recommended_strategy=strategy,
            formats=[option],
            copyright_notice="请仅下载你有权保存的内容，避免侵犯版权或违反平台规则。",
        )

    def extract_summary_info(self, url: str) -> dict[str, Any]:
        resolved = self._resolve_video(url)
        return {
            "id": self._extract_video_id(resolved["webpage_url"]),
            "title": resolved["title"],
            "description": "",
            "duration": resolved["duration_seconds"],
            "uploader": resolved["uploader"],
            "channel": resolved["uploader"],
            "thumbnail": resolved["thumbnail"],
            "webpage_url": resolved["webpage_url"],
            "extractor": "Douyin",
            "extractor_key": "Douyin",
            "subtitles": {},
            "automatic_captions": {},
            "_summary_media_url": resolved["download_url"],
        }

    def get_direct_link(self, url: str, format_id: str) -> dict[str, Any]:
        if format_id != "douyin-main":
            raise VideoServiceError(
                code="FORMAT_NOT_FOUND",
                message="未找到对应的抖音下载选项，请重新解析后再试。",
            )
        return {
            "url": None,
            "strategy": self._proxy_strategy("抖音下载默认由服务端代理处理，避免浏览器直链失效。"),
            "expires_hint": "抖音媒体链接时效较短，下载时会自动转为服务端代理输出。",
            "warning": "当前不会把抖音底层直链直接暴露给前端。",
        }

    def download_to_temp(self, url: str, format_id: str) -> tuple[Path, str]:
        if format_id != "douyin-main":
            raise VideoServiceError(
                code="FORMAT_NOT_FOUND",
                message="未找到对应的抖音下载选项，请重新解析后再试。",
            )

        resolved = self._resolve_video(url)
        job_dir = TEMP_DOWNLOAD_DIR / uuid.uuid4().hex
        job_dir.mkdir(parents=True, exist_ok=True)
        file_name = f"{sanitize_filename(resolved['title'])}.mp4"
        target_path = job_dir / file_name

        try:
            with httpx.Client(
                follow_redirects=True,
                timeout=httpx.Timeout(20.0, read=120.0),
                headers=self.DOWNLOAD_HEADERS,
            ) as client:
                with client.stream("GET", resolved["download_url"]) as response:
                    response.raise_for_status()
                    content_type = response.headers.get("content-type", "").lower()
                    if "video" not in content_type and "octet-stream" not in content_type:
                        raise VideoServiceError(
                            code="DOWNLOAD_FAILED",
                            message="抖音返回的内容不是可下载视频，可能触发了平台限制。",
                            detail=content_type or "unknown content-type",
                        )
                    with target_path.open("wb") as file_obj:
                        for chunk in response.iter_bytes():
                            if chunk:
                                file_obj.write(chunk)
        except VideoServiceError:
            shutil.rmtree(job_dir, ignore_errors=True)
            raise
        except httpx.HTTPError as exc:
            shutil.rmtree(job_dir, ignore_errors=True)
            raise VideoServiceError(
                code="DOWNLOAD_FAILED",
                message="抖音视频下载失败，请稍后重试。",
                detail=str(exc),
            ) from exc

        return target_path, file_name

    def _proxy_strategy(self, reason: str) -> DownloadStrategy:
        return DownloadStrategy(mode="proxy", reason=reason, label="服务端代理")

    def _resolve_video(self, url: str) -> dict[str, Any]:
        with httpx.Client(
            follow_redirects=True,
            timeout=20.0,
            headers=self.MOBILE_SHARE_HEADERS,
        ) as client:
            resolved_url = self._resolve_redirect_url(client, url)
            video_id = self._extract_video_id(resolved_url)
            item_info = self._fetch_item_info(client, video_id, resolved_url)
            download_url = self._select_download_url(item_info)
            filesize = self._probe_filesize(download_url)
            width = self._coerce_int((item_info.get("video") or {}).get("width"))
            height = self._coerce_int((item_info.get("video") or {}).get("height"))
            quality_rank = min(value for value in (width, height) if value > 0) if width and height else max(width, height)
            return {
                "title": item_info.get("desc") or f"douyin_{video_id}",
                "thumbnail": self._select_thumbnail(item_info),
                "duration_seconds": self._normalize_douyin_duration((item_info.get("video") or {}).get("duration")),
                "uploader": (item_info.get("author") or {}).get("nickname"),
                "webpage_url": resolved_url,
                "download_url": download_url,
                "resolution": f"{width or '?'}x{height or '?'}",
                "quality_rank": quality_rank or 720,
                "filesize": filesize,
            }

    def _resolve_redirect_url(self, client: httpx.Client, share_url: str) -> str:
        response = client.get(share_url)
        response.raise_for_status()
        return str(response.url)

    def _extract_video_id(self, resolved_url: str) -> str:
        parsed = urlparse(resolved_url)
        matched = re.search(r"/video/(\d+)", parsed.path)
        if matched:
            return matched.group(1)
        query_video_id = parse_qs(parsed.query).get("modal_id")
        if query_video_id:
            return query_video_id[0]
        raise VideoServiceError(
            code="VIDEO_EXTRACT_FAILED",
            message="未能从抖音链接中提取视频 ID。",
            detail=resolved_url,
        )

    def _fetch_item_info(self, client: httpx.Client, video_id: str, resolved_url: str) -> dict[str, Any]:
        public_item = self._fetch_public_api_item(client, video_id)
        if public_item:
            return public_item
        html = self._fetch_share_page_html(client, video_id, resolved_url)
        router_data = self._extract_router_data_json(html)
        item_info = self._extract_item_info_from_router_data(router_data)
        if not item_info:
            raise VideoServiceError(
                code="VIDEO_EXTRACT_FAILED",
                message="抖音分享页解析失败，暂时无法生成下载信息。",
            )
        return item_info

    def _fetch_public_api_item(self, client: httpx.Client, video_id: str) -> dict[str, Any] | None:
        try:
            response = client.get(self.API_URL, params={"item_ids": video_id})
            response.raise_for_status()
        except httpx.HTTPError:
            return None
        if not response.content:
            return None
        try:
            data = response.json()
        except ValueError:
            return None
        if data.get("status_code") not in (0, None):
            return None
        item_list = data.get("item_list") or []
        return item_list[0] if item_list else None

    def _fetch_share_page_html(self, client: httpx.Client, video_id: str, resolved_url: str) -> str:
        parsed = urlparse(resolved_url)
        share_url = (
            resolved_url
            if parsed.netloc and "iesdouyin.com" in parsed.netloc
            else f"https://www.iesdouyin.com/share/video/{video_id}/"
        )
        response = client.get(share_url)
        response.raise_for_status()
        html = response.text or ""
        if self._is_waf_challenge_page(html) and self._solve_waf_cookie(client, html, share_url):
            response = client.get(share_url)
            response.raise_for_status()
            html = response.text or ""
        return html

    def _probe_filesize(self, download_url: str) -> int | None:
        try:
            with httpx.Client(
                follow_redirects=True,
                timeout=15.0,
                headers=self.DOWNLOAD_HEADERS,
            ) as client:
                response = client.head(download_url)
                response.raise_for_status()
                return normalize_filesize(response.headers.get("content-length"))
        except (httpx.HTTPError, TypeError, ValueError):
            return None

    def _select_download_url(self, item_info: dict[str, Any]) -> str:
        play_urls = ((item_info.get("video") or {}).get("play_addr") or {}).get("url_list") or []
        if not play_urls:
            raise VideoServiceError(
                code="NO_FORMATS",
                message="当前抖音链接未返回可下载视频地址。",
            )
        return str(play_urls[0]).replace("playwm", "play")

    def _select_thumbnail(self, item_info: dict[str, Any]) -> str | None:
        video_meta = item_info.get("video") or {}
        for key in ("cover", "origin_cover", "dynamic_cover"):
            url_list = (video_meta.get(key) or {}).get("url_list") or []
            if url_list:
                return str(url_list[0])
        return None

    @staticmethod
    def _normalize_douyin_duration(duration_raw: Any) -> int | None:
        duration = normalize_duration(duration_raw)
        if duration is None:
            return None
        if duration > 1000:
            return max(1, int(round(duration / 1000)))
        return duration

    @staticmethod
    def _coerce_int(value: Any) -> int:
        try:
            return int(value)
        except (TypeError, ValueError):
            return 0

    @staticmethod
    def _is_waf_challenge_page(html: str) -> bool:
        return "Please wait..." in html and "wci=" in html and "cs=" in html

    def _solve_waf_cookie(self, client: httpx.Client, html: str, page_url: str) -> bool:
        matched = re.search(r'wci="([^"]+)"\s*,\s*cs="([^"]+)"', html)
        if not matched:
            return False
        cookie_name, challenge_blob = matched.groups()
        try:
            challenge_data = json.loads(self._decode_urlsafe_b64(challenge_blob).decode("utf-8"))
            prefix = self._decode_urlsafe_b64(challenge_data["v"]["a"])
            expected_digest = self._decode_urlsafe_b64(challenge_data["v"]["c"]).hex()
        except (KeyError, TypeError, ValueError):
            return False

        solved_value = None
        for candidate in range(1_000_001):
            if sha256(prefix + str(candidate).encode("utf-8")).hexdigest() == expected_digest:
                solved_value = candidate
                break
        if solved_value is None:
            return False

        challenge_data["d"] = base64.b64encode(str(solved_value).encode("utf-8")).decode("utf-8")
        cookie_value = base64.b64encode(
            json.dumps(challenge_data, separators=(",", ":")).encode("utf-8")
        ).decode("utf-8")
        client.cookies.set(
            cookie_name,
            cookie_value,
            domain=urlparse(page_url).hostname or "www.iesdouyin.com",
            path="/",
        )
        return True

    @staticmethod
    def _decode_urlsafe_b64(value: str) -> bytes:
        normalized = value.replace("-", "+").replace("_", "/")
        normalized += "=" * (-len(normalized) % 4)
        return base64.b64decode(normalized)

    @staticmethod
    def _extract_router_data_json(html: str) -> dict[str, Any]:
        marker = "window._ROUTER_DATA = "
        start = html.find(marker)
        if start < 0:
            return {}
        index = start + len(marker)
        while index < len(html) and html[index].isspace():
            index += 1
        if index >= len(html) or html[index] != "{":
            return {}

        depth = 0
        in_string = False
        escaped = False
        for cursor in range(index, len(html)):
            char = html[cursor]
            if in_string:
                if escaped:
                    escaped = False
                elif char == "\\":
                    escaped = True
                elif char == '"':
                    in_string = False
                continue
            if char == '"':
                in_string = True
            elif char == "{":
                depth += 1
            elif char == "}":
                depth -= 1
                if depth == 0:
                    try:
                        return json.loads(html[index : cursor + 1])
                    except ValueError:
                        return {}
        return {}

    @staticmethod
    def _extract_item_info_from_router_data(router_data: dict[str, Any]) -> dict[str, Any]:
        loader_data = router_data.get("loaderData") or {}
        if not isinstance(loader_data, dict):
            return {}
        for node in loader_data.values():
            if not isinstance(node, dict):
                continue
            video_info_res = node.get("videoInfoRes") or {}
            item_list = video_info_res.get("item_list") or []
            if item_list and isinstance(item_list[0], dict):
                return item_list[0]
        return {}


class VideoService:
    def __init__(self) -> None:
        self.base_opts = {
            "quiet": True,
            "no_warnings": True,
            "noplaylist": True,
        }
        self.douyin = DouyinResolver()

    def _ydl(self, extra: dict[str, Any] | None = None) -> YoutubeDL:
        opts = {
            **self.base_opts,
            "ffmpeg_location": str(FFMPEG_LOCATION),
            **(extra or {}),
        }
        return YoutubeDL(opts)

    def extract_info(self, url: str) -> dict[str, Any]:
        if self.douyin.supports(url):
            return self.douyin.extract_summary_info(url)
        try:
            with self._ydl() as ydl:
                info = ydl.extract_info(url, download=False)
        except DownloadError as exc:
            raise VideoServiceError(
                code="VIDEO_EXTRACT_FAILED",
                message="视频解析失败，请检查链接是否公开可访问。",
                detail=str(exc),
            ) from exc
        except Exception as exc:
            raise VideoServiceError(
                code="INTERNAL_ERROR",
                message="解析过程中发生未知错误。",
                detail=str(exc),
            ) from exc

        if "entries" in info and info["entries"]:
            first_entry = next((entry for entry in info["entries"] if entry), None)
            if not first_entry:
                raise VideoServiceError(
                    code="EMPTY_PLAYLIST",
                    message="当前链接未返回可下载的视频条目。",
                )
            info = first_entry

        return info

    def build_strategy(self, format_info: dict[str, Any] | None) -> DownloadStrategy:
        if not format_info:
            return DownloadStrategy(mode="proxy", reason="未找到目标格式，默认回退服务端代理。", label="服务端代理")

        protocol = str(format_info.get("protocol") or "")
        filesize = normalize_filesize(format_info.get("filesize") or format_info.get("filesize_approx"))
        has_url = bool(format_info.get("url"))
        is_simple_protocol = protocol.startswith("http")
        suspicious_protocol = any(key in protocol for key in ("m3u8", "dash", "ism"))

        if has_url and is_simple_protocol and not suspicious_protocol:
            if filesize and filesize > MAX_DIRECT_LINK_SIZE:
                return DownloadStrategy(mode="proxy", reason="文件较大，优先走服务端流式下载以减少浏览器失败概率。", label="服务端代理")
            return DownloadStrategy(mode="direct", reason="检测到稳定媒体直链，优先直链下载以节省服务端资源。", label="直链下载")

        return DownloadStrategy(mode="proxy", reason="直链不可用、存在防盗链或需要合并音视频，自动回退服务端代理。", label="服务端代理")

    def _is_displayable_complete_format(self, fmt: dict[str, Any]) -> bool:
        ext = str(fmt.get("ext") or "")
        protocol = str(fmt.get("protocol") or "")
        if ext == "mhtml" or protocol == "mhtml":
            return False
        if fmt.get("format_note") == "storyboard":
            return False
        vcodec = fmt.get("vcodec")
        acodec = fmt.get("acodec")
        if vcodec not in (None, "none") and acodec not in (None, "none"):
            return True
        if bool(fmt.get("url")) and protocol.startswith("http") and ext == "mp4":
            return not is_audio_only(fmt) and not is_video_only(fmt)
        return False

    def _best_audio_format(self, info: dict[str, Any]) -> dict[str, Any] | None:
        audio_formats = [fmt for fmt in info.get("formats", []) if is_audio_only(fmt)]
        if not audio_formats:
            return None
        return max(audio_formats, key=lambda fmt: (normalize_filesize(fmt.get("filesize") or fmt.get("filesize_approx")) or 0, 1 if str(fmt.get("ext") or "").lower() == "m4a" else 0))

    def _format_priority(self, fmt: dict[str, Any]) -> tuple[int, int, int, int, int]:
        strategy = self.build_strategy(fmt)
        is_complete = 1 if self._is_displayable_complete_format(fmt) else 0
        is_direct = 1 if strategy.mode == "direct" else 0
        is_mp4 = 1 if str(fmt.get("ext") or "").lower() == "mp4" else 0
        filesize = normalize_filesize(fmt.get("filesize") or fmt.get("filesize_approx")) or 0
        height = normalize_height(fmt)
        return (is_complete, is_direct, is_mp4, height, filesize)

    def _compact_format_options(self, info: dict[str, Any]) -> list[VideoFormatOption]:
        grouped: dict[int, list[dict[str, Any]]] = defaultdict(list)
        best_audio = self._best_audio_format(info)

        for fmt in info.get("formats", []):
            if not fmt.get("format_id"):
                continue
            height = normalize_height(fmt)
            if height <= 0:
                continue

            if self._is_displayable_complete_format(fmt):
                grouped[height].append({"kind": "complete", "format": fmt, "selector": str(fmt.get("format_id"))})
                continue

            if is_video_only(fmt) and best_audio:
                grouped[height].append({"kind": "merge", "format": fmt, "audio_format": best_audio, "selector": f"{fmt.get('format_id')}+{best_audio.get('format_id')}"})

        if not grouped:
            raise VideoServiceError(code="NO_COMPLETE_MEDIA", message="当前链接暂不支持生成可下载成片，请更换链接后重试。")

        selected_formats: list[dict[str, Any]] = []
        for _, candidates in grouped.items():
            best = max(candidates, key=lambda item: self._format_priority(item["format"]))
            selected_formats.append(best)

        selected_formats.sort(key=lambda item: (normalize_height(item["format"]), normalize_filesize(item["format"].get("filesize") or item["format"].get("filesize_approx")) or 0), reverse=True)

        best_format_id = str(selected_formats[0]["selector"])
        options: list[VideoFormatOption] = []
        for item in selected_formats:
            fmt = item["format"]
            resolution = f"{fmt.get('width', '?')}x{fmt.get('height', '?')}" if fmt.get("width") or fmt.get("height") else f"{normalize_height(fmt)}P"
            filesize = normalize_filesize(fmt.get("filesize") or fmt.get("filesize_approx"))
            strategy = self.build_strategy(fmt)
            if item["kind"] == "merge":
                strategy = DownloadStrategy(mode="proxy", reason="当前清晰度需要自动合并音视频，下载时将由服务端处理后输出成片。", label="服务端代理")
            height = normalize_height(fmt)
            options.append(VideoFormatOption(
                format_id=str(item["selector"]),
                ext=str(fmt.get("ext") or "unknown"),
                resolution=resolution,
                label=quality_label(height),
                quality_rank=height,
                download_mode=strategy.mode,
                is_complete_media=True,
                filesize=filesize,
                filesize_human=format_bytes(filesize),
                fps=fmt.get("fps"),
                vcodec=fmt.get("vcodec"),
                acodec=fmt.get("acodec"),
                protocol=fmt.get("protocol"),
                has_direct_url=strategy.mode == "direct",
                note="自动合并音视频后下载" if item["kind"] == "merge" else str(fmt.get("format_note") or fmt.get("format") or quality_label(height)),
                recommended=str(item["selector"]) == best_format_id,
            ))

        return options

    def parse_video(self, url: str) -> VideoMeta:
        if self.douyin.supports(url):
            return self.douyin.parse_video(url)

        info = self.extract_info(url)
        formats = self._compact_format_options(info)
        if not formats:
            raise VideoServiceError(code="NO_FORMATS", message="当前视频未返回可下载格式，可能受平台限制。")

        best_format = formats[0]
        strategy = self.build_strategy(next((fmt for fmt in info.get("formats", []) if str(fmt.get("format_id")) == best_format.format_id), None))
        duration_seconds = normalize_duration(info.get("duration"))
        return VideoMeta(
            source_url=url,
            title=info.get("title") or "未命名视频",
            thumbnail=info.get("thumbnail"),
            duration_seconds=duration_seconds,
            duration_human=format_duration(duration_seconds),
            uploader=info.get("uploader") or info.get("channel"),
            extractor=info.get("extractor_key") or info.get("extractor"),
            webpage_url=info.get("webpage_url"),
            can_use_direct_link=any(fmt.has_direct_url for fmt in formats),
            recommended_strategy=strategy,
            formats=formats,
            copyright_notice="请仅下载你有权保存的内容，避免侵犯版权或违反平台规则。",
        )

    def resolve_format(self, url: str, format_id: str) -> tuple[dict[str, Any], dict[str, Any]]:
        info = self.extract_info(url)
        if "+" in format_id:
            video_id, audio_id = format_id.split("+", 1)
            video_format = next((fmt for fmt in info.get("formats", []) if str(fmt.get("format_id")) == video_id), None)
            audio_format = next((fmt for fmt in info.get("formats", []) if str(fmt.get("format_id")) == audio_id), None)
            if not video_format or not audio_format:
                raise VideoServiceError(code="FORMAT_NOT_FOUND", message="未找到对应的清晰度/格式，请重新解析后再下载。")
            merged_format = dict(video_format)
            merged_format["format_id"] = format_id
            merged_format["acodec"] = audio_format.get("acodec")
            merged_format["filesize"] = (normalize_filesize(video_format.get("filesize") or video_format.get("filesize_approx")) or 0) + (normalize_filesize(audio_format.get("filesize") or audio_format.get("filesize_approx")) or 0)
            merged_format["requested_selector"] = format_id
            return info, merged_format

        format_info = next((fmt for fmt in info.get("formats", []) if str(fmt.get("format_id")) == format_id), None)
        if not format_info:
            raise VideoServiceError(code="FORMAT_NOT_FOUND", message="未找到对应的清晰度/格式，请重新解析后再下载。")
        return info, format_info

    def get_direct_link(self, url: str, format_id: str) -> dict[str, Any]:
        if self.douyin.supports(url):
            return self.douyin.get_direct_link(url, format_id)

        _, format_info = self.resolve_format(url, format_id)
        if "+" in format_id:
            strategy = DownloadStrategy(mode="proxy", reason="当前清晰度需要自动合并音视频，下载时将由服务端处理后输出 MP4 成片。", label="服务端代理")
            return {"url": None, "strategy": strategy, "expires_hint": "该清晰度将由服务端合并后下载，无需直链。", "warning": "该选项会自动合并音视频，最终下载结果为 MP4 成片。"}

        strategy = self.build_strategy(format_info)
        direct_url = format_info.get("url") if strategy.mode == "direct" else None
        warning = None if direct_url else "该格式直链不稳定，建议使用服务端代理下载。"
        return {"url": direct_url, "strategy": strategy, "expires_hint": "媒体直链可能短时间失效，请尽快下载。", "warning": warning}

    def _build_selector(self, format_info: dict[str, Any]) -> str:
        requested_selector = format_info.get("requested_selector")
        if requested_selector:
            return str(requested_selector)
        format_id = str(format_info.get("format_id"))
        has_video = format_info.get("vcodec") not in (None, "none")
        has_audio = format_info.get("acodec") not in (None, "none")
        if has_video and not has_audio:
            return f"{format_id}+bestaudio/best"
        return format_id

    def download_to_temp(self, url: str, format_id: str) -> tuple[Path, str]:
        if self.douyin.supports(url):
            return self.douyin.download_to_temp(url, format_id)

        info, format_info = self.resolve_format(url, format_id)
        job_dir = TEMP_DOWNLOAD_DIR / uuid.uuid4().hex
        job_dir.mkdir(parents=True, exist_ok=True)
        base_name = sanitize_filename(info.get("title") or "video")
        selector = self._build_selector(format_info)
        outtmpl = str(job_dir / f"{base_name}.%(ext)s")

        try:
            with self._ydl({"format": selector, "outtmpl": outtmpl, "merge_output_format": "mp4", "noprogress": True}) as ydl:
                ydl.download([url])
        except DownloadError as exc:
            shutil.rmtree(job_dir, ignore_errors=True)
            raise VideoServiceError(code="DOWNLOAD_FAILED", message="服务端代理下载失败，请稍后重试或切换其他格式。", detail=str(exc)) from exc

        files = [path for path in job_dir.iterdir() if path.is_file()]
        if not files:
            shutil.rmtree(job_dir, ignore_errors=True)
            raise VideoServiceError(code="DOWNLOAD_EMPTY", message="下载任务未生成文件，请更换格式后重试。")

        file_path = max(files, key=lambda item: item.stat().st_size)
        return file_path, file_path.name

    def cleanup_file(self, file_path: Path) -> None:
        shutil.rmtree(file_path.parent, ignore_errors=True)
