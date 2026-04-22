from __future__ import annotations

import httpx
import logging
import mimetypes
import shutil
import subprocess
import time
import uuid
from dataclasses import dataclass
from pathlib import Path
from threading import Lock
from typing import Any
from urllib.parse import urlparse

from faster_whisper import WhisperModel
from yt_dlp import DownloadError, YoutubeDL
import opencc

from app.config import (
    ASR_BEAM_SIZE,
    ASR_COMPUTE_TYPE,
    ASR_DEVICE,
    ASR_MODEL_SIZE,
    TEMP_DOWNLOAD_DIR,
    resolve_ffmpeg_executable,
)


logger = logging.getLogger(__name__)

# 繁体转简体转换器
_t2s_converter = opencc.OpenCC('t2s')
_AUDIO_CACHE_TTL_SECONDS = 15 * 60


@dataclass
class _CachedAudioDownload:
    path: Path
    created_at: float


class AsrTranscriptionError(Exception):
    def __init__(self, code: str, message: str, detail: Any | None = None) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.detail = detail


class AudioTranscriptionService:
    def __init__(
        self,
        *,
        beam_size: int | None = None,
        model_size: str | None = None,
        device: str | None = None,
        compute_type: str | None = None,
    ) -> None:
        self.beam_size = max(1, beam_size or ASR_BEAM_SIZE)
        self.model_size = model_size or ASR_MODEL_SIZE
        self.device = device or ASR_DEVICE
        self.compute_type = compute_type or ASR_COMPUTE_TYPE
        self._model: WhisperModel | None = None
        self._download_cache: dict[str, _CachedAudioDownload] = {}
        self._download_cache_lock = Lock()

    def transcribe_url(self, url: str, preferred_language: str | None) -> tuple[list[dict[str, object]], str | None]:
        try:
            audio_path = self._take_cached_audio(url) or self._download_audio(url)
        except DownloadError as exc:
            logger.exception("ASR audio download failed for url=%s", url)
            raise AsrTranscriptionError(
                code="ASR_AUDIO_DOWNLOAD_FAILED",
                message="音频提取失败，暂时无法进行语音识别。",
                detail=str(exc),
            ) from exc

        try:
            return self._transcribe_with_fallbacks(audio_path=audio_path, preferred_language=preferred_language)
        finally:
            shutil.rmtree(audio_path.parent, ignore_errors=True)

    def transcribe_url_preview(
        self,
        url: str,
        preferred_language: str | None,
        *,
        preview_seconds: int = 30,  # 从 45 秒减少到 30 秒
        max_segments: int = 5,      # 从 8 段减少到 5 段
        max_chars: int = 200,       # 从 260 字符减少到 200 字符
    ) -> tuple[list[dict[str, object]], str | None]:
        audio_path: Path | None = None
        try:
            audio_path = self._get_or_cache_audio(url)
        except DownloadError as exc:
            logger.exception("ASR preview audio download failed for url=%s", url)
            raise AsrTranscriptionError(
                code="ASR_AUDIO_DOWNLOAD_FAILED",
                message="音频提取失败，暂时无法进行语音识别。",
                detail=str(exc),
            ) from exc

        try:
            preview_path = self._extract_preview_wav(audio_path, preview_seconds=preview_seconds) or audio_path
            payload, detected_language = self._transcribe_file(
                source_path=preview_path,
                vad_filter=False,
                language=self._normalize_language(preferred_language),
            )
            if not payload:
                raise AsrTranscriptionError(
                    code="ASR_EMPTY_RESULT",
                    message="语音识别未返回有效文本。",
                )

            preview_payload: list[dict[str, object]] = []
            char_count = 0
            for segment in payload:
                text = str(segment.get("text") or "").strip()
                if not text:
                    continue
                projected = char_count + len(text)
                if preview_payload and projected > max_chars:
                    break
                preview_payload.append(segment)
                char_count = projected
                if len(preview_payload) >= max_segments:
                    break

            if not preview_payload:
                raise AsrTranscriptionError(
                    code="ASR_EMPTY_RESULT",
                    message="语音识别未返回有效文本。",
                )

            return preview_payload, detected_language
        finally:
            if audio_path is not None and not self._is_cached_audio(url, audio_path):
                shutil.rmtree(audio_path.parent, ignore_errors=True)

    def _transcribe_with_fallbacks(
        self,
        *,
        audio_path: Path,
        preferred_language: str | None,
    ) -> tuple[list[dict[str, object]], str | None]:
        normalized_language = self._normalize_language(preferred_language)
        
        # 优化：减少重试次数，优先使用最快的方式
        attempts: list[tuple[Path, bool, str | None, str]] = [
            (audio_path, False, normalized_language, "original-no-vad"),  # 最快：不使用 VAD
            (audio_path, False, None, "original-auto-language"),  # 次快：自动检测语言
        ]

        # 只在前两次都失败时才尝试 WAV 转换（更慢）
        last_error: Exception | None = None
        for source_path, vad_filter, language, label in attempts:
            try:
                payload, detected_language = self._transcribe_file(
                    source_path=source_path,
                    vad_filter=vad_filter,
                    language=language,
                )
            except Exception as exc:
                logger.warning("ASR attempt failed: %s (%s): %s", source_path.name, label, exc)
                last_error = exc
                continue

            if payload:
                logger.info("ASR succeeded via %s with %s segments", label, len(payload))
                return payload, detected_language

            logger.warning("ASR returned empty result for %s (%s)", source_path.name, label)

        # 最后尝试 WAV 转换（作为兜底）
        wav_path = self._extract_pcm_wav(audio_path)
        if wav_path is not None:
            try:
                payload, detected_language = self._transcribe_file(
                    source_path=wav_path,
                    vad_filter=False,
                    language=normalized_language,
                )
                if payload:
                    logger.info("ASR succeeded via wav-fallback with %s segments", len(payload))
                    return payload, detected_language
            except Exception as exc:
                logger.warning("WAV fallback also failed: %s", exc)
                last_error = exc

        raise AsrTranscriptionError(
            code="ASR_EMPTY_RESULT",
            message="语音识别未返回有效文本。",
            detail=str(last_error) if last_error else None,
        )

    def _transcribe_file(
        self,
        *,
        source_path: Path,
        vad_filter: bool,
        language: str | None,
    ) -> tuple[list[dict[str, object]], str | None]:
        try:
            model = self._get_model()
            segments, info = model.transcribe(
                str(source_path),
                beam_size=self.beam_size,
                vad_filter=vad_filter,
                language=language,
                condition_on_previous_text=False,
            )
        except Exception as exc:
            raise AsrTranscriptionError(
                code="ASR_TRANSCRIPTION_FAILED",
                message="语音识别失败，暂时无法生成转写文本。",
                detail=str(exc),
            ) from exc

        payload = [
            {
                "start_seconds": max(0, int(round(segment.start))),
                "end_seconds": max(0, int(round(segment.end))),
                "text": self._normalize_chinese_text(segment.text.strip()),
            }
            for segment in segments
            if segment.text and segment.text.strip()
        ]
        return payload, getattr(info, "language", None)

    def _normalize_chinese_text(self, text: str) -> str:
        """将繁体中文转换为简体中文"""
        if not text:
            return text
        try:
            # 使用 OpenCC 转换繁体到简体
            return _t2s_converter.convert(text)
        except Exception:
            # 如果转换失败，返回原文
            return text

    def _extract_pcm_wav(self, source_path: Path) -> Path | None:
        return self._extract_wav(source_path=source_path, target_path=source_path.with_suffix(".wav"))

    def _extract_preview_wav(self, source_path: Path, *, preview_seconds: int) -> Path | None:
        return self._extract_wav(
            source_path=source_path,
            target_path=source_path.with_name(f"{source_path.stem}-preview.wav"),
            preview_seconds=preview_seconds,
        )

    def _extract_wav(
        self,
        *,
        source_path: Path,
        target_path: Path,
        preview_seconds: int | None = None,
    ) -> Path | None:
        ffmpeg_bin = resolve_ffmpeg_executable()
        if ffmpeg_bin is None:
            logger.warning("ffmpeg not found in FFMPEG_LOCATION or PATH, skipping wav fallback")
            return None

        command = [
            str(ffmpeg_bin),
            "-y",
            "-i",
            str(source_path),
        ]
        if preview_seconds is not None:
            command.extend(["-t", str(max(1, preview_seconds))])
        command.extend([
            "-vn",
            "-ac",
            "1",
            "-ar",
            "16000",
            "-acodec",
            "pcm_s16le",
            str(target_path),
        ])
        try:
            result = subprocess.run(command, capture_output=True, text=True, check=False)
        except OSError as exc:
            logger.warning("ffmpeg wav fallback failed to start: %s", exc)
            return None

        if result.returncode != 0 or not target_path.exists() or target_path.stat().st_size <= 44:
            logger.warning("ffmpeg wav fallback failed: %s", result.stderr.strip() or result.stdout.strip())
            return None

        return target_path

    def _get_model(self) -> WhisperModel:
        if self._model is None:
            logger.info(
                "Loading ASR model size=%s device=%s compute=%s beam=%s",
                self.model_size,
                self.device,
                self.compute_type,
                self.beam_size,
            )
            self._model = WhisperModel(
                self.model_size,
                device=self.device,
                compute_type=self.compute_type,
            )
        return self._model

    def _download_audio(self, url: str) -> Path:
        job_dir = TEMP_DOWNLOAD_DIR / f"asr_{uuid.uuid4().hex}"
        job_dir.mkdir(parents=True, exist_ok=True)

        # Try yt-dlp first (works for YouTube, Bilibili, etc.)
        outtmpl = str(job_dir / "audio.%(ext)s")
        try:
            with YoutubeDL(
                {
                    "quiet": True,
                    "no_warnings": True,
                    "noplaylist": True,
                    "format": "bestaudio/best",
                    "outtmpl": outtmpl,
                    "http_headers": self._build_request_headers(url),
                    "extractor_args": {
                        "youtube": {
                            "player_client": ["android", "web"],
                            "player_skip": ["webpage", "configs"],
                        }
                    },
                }
            ) as ydl:
                ydl.download([url])

            files = [path for path in job_dir.iterdir() if path.is_file()]
            if files:
                return max(files, key=lambda item: item.stat().st_size)
        except DownloadError:
            logger.info("yt-dlp download failed, trying direct httpx download for url=%s", url)
        except Exception as exc:
            logger.info("yt-dlp download error: %s, trying direct httpx download", exc)

        # Fallback: direct HTTP download (for CDN URLs like Douyin)
        try:
            audio_path = self._download_audio_direct(url, job_dir)
            if audio_path is not None:
                return audio_path
        except Exception as exc:
            logger.warning("Direct httpx download also failed: %s", exc)

        shutil.rmtree(job_dir, ignore_errors=True)
        raise DownloadError("audio download failed")

    def _get_or_cache_audio(self, url: str) -> Path:
        cached_path = self._peek_cached_audio(url)
        if cached_path is not None:
            return cached_path

        audio_path = self._download_audio(url)
        self._store_cached_audio(url, audio_path)
        return audio_path

    def _peek_cached_audio(self, url: str) -> Path | None:
        self._prune_download_cache()
        with self._download_cache_lock:
            cached = self._download_cache.get(url)
            if cached is None:
                return None
            if not cached.path.exists():
                self._download_cache.pop(url, None)
                return None
            return cached.path

    def _take_cached_audio(self, url: str) -> Path | None:
        self._prune_download_cache()
        with self._download_cache_lock:
            cached = self._download_cache.pop(url, None)
            if cached is None or not cached.path.exists():
                return None
            return cached.path

    def _store_cached_audio(self, url: str, audio_path: Path) -> None:
        self._prune_download_cache()
        stale_path: Path | None = None
        with self._download_cache_lock:
            previous = self._download_cache.get(url)
            if previous is not None and previous.path != audio_path:
                stale_path = previous.path
            self._download_cache[url] = _CachedAudioDownload(path=audio_path, created_at=time.time())
        if stale_path is not None:
            shutil.rmtree(stale_path.parent, ignore_errors=True)

    def _is_cached_audio(self, url: str, audio_path: Path) -> bool:
        with self._download_cache_lock:
            cached = self._download_cache.get(url)
            return cached is not None and cached.path == audio_path

    def _prune_download_cache(self) -> None:
        now = time.time()
        stale_paths: list[Path] = []
        with self._download_cache_lock:
            expired_keys = [
                key
                for key, cached in self._download_cache.items()
                if not cached.path.exists() or now - cached.created_at > _AUDIO_CACHE_TTL_SECONDS
            ]
            for key in expired_keys:
                cached = self._download_cache.pop(key, None)
                if cached is not None:
                    stale_paths.append(cached.path)
        for stale_path in stale_paths:
            shutil.rmtree(stale_path.parent, ignore_errors=True)

    def _download_audio_direct(self, url: str, job_dir: Path) -> Path | None:
        headers = self._build_download_headers(url)
        try:
            with httpx.stream("GET", url, headers=headers, follow_redirects=True, timeout=60.0) as response:
                response.raise_for_status()
                content_type = response.headers.get("content-type", "")
                ext = _guess_ext_from_content_type(content_type) or _guess_ext_from_url(url) or ".mp4"
                audio_path = job_dir / f"audio{ext}"
                with open(audio_path, "wb") as f:
                    for chunk in response.iter_bytes(chunk_size=65536):
                        f.write(chunk)
            if audio_path.exists() and audio_path.stat().st_size > 1024:
                logger.info("Direct download succeeded, size=%d", audio_path.stat().st_size)
                return audio_path
        except httpx.HTTPError as exc:
            logger.warning("Direct download HTTP error: %s", exc)
        return None

    def _build_download_headers(self, url: str) -> dict[str, str]:
        """Build headers for direct HTTP download with correct Referer for Douyin CDN."""
        return {
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/136.0.0.0 Safari/537.36"
            ),
            "Referer": self._build_referer(url),
        }

    def _build_request_headers(self, url: str) -> dict[str, str]:
        return {
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/136.0.0.0 Safari/537.36"
            ),
            "Referer": self._build_referer(url),
        }

    def _build_referer(self, url: str) -> str:
        parsed = urlparse(url)
        scheme = parsed.scheme or "https"
        hostname = (parsed.hostname or "").lower()
        if self._is_douyin_media_host(hostname):
            return "https://www.douyin.com/"
        return f"{scheme}://{hostname}/" if hostname else "https://www.douyin.com/"

    def _is_douyin_media_host(self, hostname: str) -> bool:
        if not hostname:
            return False
        return hostname in {
            "www.douyin.com",
            "www.iesdouyin.com",
            "aweme.snssdk.com",
        } or "douyinvod.com" in hostname

    def _normalize_language(self, preferred_language: str | None) -> str | None:
        if not preferred_language:
            return None
        preferred = preferred_language.lower()
        if preferred.startswith("zh"):
            return "zh"
        if preferred.startswith("en"):
            return "en"
        return preferred.split("-", 1)[0]


_AUDIO_MIME_MAP = {
    "audio/mpeg": ".mp3",
    "audio/mp4": ".m4a",
    "audio/x-m4a": ".m4a",
    "audio/wav": ".wav",
    "audio/x-wav": ".wav",
    "audio/webm": ".webm",
    "audio/ogg": ".ogg",
    "audio/aac": ".aac",
    "audio/x-aac": ".aac",
    "video/mp4": ".mp4",
    "video/webm": ".webm",
}


def _guess_ext_from_content_type(content_type: str) -> str | None:
    ct = (content_type or "").split(";")[0].strip().lower()
    return _AUDIO_MIME_MAP.get(ct) or mimetypes.guess_extension(ct)


def _guess_ext_from_url(url: str) -> str | None:
    path = urlparse(url).path
    if not path:
        return None
    from urllib.parse import unquote
    path = unquote(path)
    dot = path.rfind(".")
    if dot < 0 or dot < len(path) - 6:
        return None
    ext = path[dot:]
    if ext in {".mp4", ".m4a", ".mp3", ".wav", ".webm", ".ogg", ".aac", ".flac", ".wma"}:
        return ext
    return None
