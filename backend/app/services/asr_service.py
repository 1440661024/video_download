from __future__ import annotations

import logging
import shutil
import subprocess
import uuid
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from faster_whisper import WhisperModel
from yt_dlp import DownloadError, YoutubeDL

from app.config import ASR_BEAM_SIZE, ASR_COMPUTE_TYPE, ASR_DEVICE, ASR_MODEL_SIZE, FFMPEG_LOCATION, TEMP_DOWNLOAD_DIR


logger = logging.getLogger(__name__)


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

    def transcribe_url(self, url: str, preferred_language: str | None) -> tuple[list[dict[str, object]], str | None]:
        try:
            audio_path = self._download_audio(url)
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
        preview_seconds: int = 45,
        max_segments: int = 8,
        max_chars: int = 260,
    ) -> tuple[list[dict[str, object]], str | None]:
        try:
            audio_path = self._download_audio(url)
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
            shutil.rmtree(audio_path.parent, ignore_errors=True)

    def _transcribe_with_fallbacks(
        self,
        *,
        audio_path: Path,
        preferred_language: str | None,
    ) -> tuple[list[dict[str, object]], str | None]:
        normalized_language = self._normalize_language(preferred_language)
        attempts: list[tuple[Path, bool, str | None, str]] = [
            (audio_path, True, normalized_language, "original-with-vad"),
            (audio_path, False, normalized_language, "original-no-vad"),
            (audio_path, False, None, "original-auto-language"),
        ]

        wav_path = self._extract_pcm_wav(audio_path)
        if wav_path is not None:
            attempts.extend(
                [
                    (wav_path, False, normalized_language, "wav-no-vad"),
                    (wav_path, False, None, "wav-auto-language"),
                ]
            )

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
                "text": segment.text.strip(),
            }
            for segment in segments
            if segment.text and segment.text.strip()
        ]
        return payload, getattr(info, "language", None)

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
        ffmpeg_bin = FFMPEG_LOCATION / "ffmpeg.exe"
        if not ffmpeg_bin.exists():
            logger.warning("ffmpeg not found at %s, skipping wav fallback", ffmpeg_bin)
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
                }
            ) as ydl:
                ydl.download([url])
        except DownloadError:
            shutil.rmtree(job_dir, ignore_errors=True)
            raise

        files = [path for path in job_dir.iterdir() if path.is_file()]
        if not files:
            shutil.rmtree(job_dir, ignore_errors=True)
            raise DownloadError("audio download failed")
        return max(files, key=lambda item: item.stat().st_size)

    def _build_request_headers(self, url: str) -> dict[str, str]:
        parsed = urlparse(url)
        scheme = parsed.scheme or "https"
        hostname = (parsed.hostname or "").lower()
        referer = f"{scheme}://{hostname}/" if hostname else "https://www.douyin.com/"
        return {
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/136.0.0.0 Safari/537.36"
            ),
            "Referer": referer,
        }

    def _normalize_language(self, preferred_language: str | None) -> str | None:
        if not preferred_language:
            return None
        preferred = preferred_language.lower()
        if preferred.startswith("zh"):
            return "zh"
        if preferred.startswith("en"):
            return "en"
        return preferred.split("-", 1)[0]
