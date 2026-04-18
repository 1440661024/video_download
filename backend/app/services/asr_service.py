from __future__ import annotations

import logging
import shutil
import uuid
from pathlib import Path

from faster_whisper import WhisperModel
from yt_dlp import DownloadError, YoutubeDL

from app.config import ASR_COMPUTE_TYPE, ASR_DEVICE, ASR_MODEL_SIZE, TEMP_DOWNLOAD_DIR


logger = logging.getLogger(__name__)


class AudioTranscriptionService:
    def __init__(
        self,
        *,
        model_size: str | None = None,
        device: str | None = None,
        compute_type: str | None = None,
    ) -> None:
        self.model_size = model_size or ASR_MODEL_SIZE
        self.device = device or ASR_DEVICE
        self.compute_type = compute_type or ASR_COMPUTE_TYPE
        self._model: WhisperModel | None = None

    def transcribe_url(self, url: str, preferred_language: str | None) -> tuple[list[dict[str, object]], str | None]:
        audio_path = self._download_audio(url)
        try:
            model = self._get_model()
            segments, info = model.transcribe(
                str(audio_path),
                beam_size=5,
                vad_filter=True,
                language=self._normalize_language(preferred_language),
                condition_on_previous_text=False,
            )
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
        finally:
            shutil.rmtree(audio_path.parent, ignore_errors=True)

    def _get_model(self) -> WhisperModel:
        if self._model is None:
            logger.info(
                "Loading ASR model size=%s device=%s compute=%s",
                self.model_size,
                self.device,
                self.compute_type,
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

    def _normalize_language(self, preferred_language: str | None) -> str | None:
        if not preferred_language:
            return None
        preferred = preferred_language.lower()
        if preferred.startswith("zh"):
            return "zh"
        if preferred.startswith("en"):
            return "en"
        return preferred.split("-", 1)[0]
