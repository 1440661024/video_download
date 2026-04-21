from __future__ import annotations

import json
from hashlib import sha256
from pathlib import Path
from threading import Lock

from pydantic import ValidationError

from app.config import TEMP_SUMMARY_DIR
from app.schemas_summary import VideoSummaryResponse
from app.services.transcript_models import TranscriptBundle, TranscriptSegment


class SummaryCacheStore:
    CACHE_VERSION = "v2"

    def __init__(self, *, base_dir: Path | None = None) -> None:
        self.base_dir = base_dir or TEMP_SUMMARY_DIR
        self.summary_dir = self.base_dir / "summaries"
        self.transcript_dir = self.base_dir / "transcripts"
        self.text_dir = self.base_dir / "text_payloads"
        self.summary_dir.mkdir(parents=True, exist_ok=True)
        self.transcript_dir.mkdir(parents=True, exist_ok=True)
        self.text_dir.mkdir(parents=True, exist_ok=True)
        self._summary_lock = Lock()
        self._transcript_lock = Lock()
        self._text_lock = Lock()
        self._summary_memory: dict[str, VideoSummaryResponse] = {}
        self._transcript_memory: dict[str, TranscriptBundle] = {}
        self._text_memory: dict[str, str] = {}

    def load_summary(
        self,
        *,
        url: str,
        focus_mode: str,
        preferred_language: str | None,
        model: str,
    ) -> VideoSummaryResponse | None:
        key = self._summary_key(url=url, focus_mode=focus_mode, preferred_language=preferred_language, model=model)
        cached = self._summary_memory.get(key)
        if cached is not None:
            return cached

        path = self.summary_dir / f"{key}.json"
        if not path.exists():
            return None

        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
            summary = VideoSummaryResponse.model_validate(payload)
        except (OSError, json.JSONDecodeError, ValidationError):
            return None

        self._summary_memory[key] = summary
        return summary

    def save_summary(
        self,
        *,
        url: str,
        focus_mode: str,
        preferred_language: str | None,
        model: str,
        summary: VideoSummaryResponse,
    ) -> None:
        key = self._summary_key(url=url, focus_mode=focus_mode, preferred_language=preferred_language, model=model)
        path = self.summary_dir / f"{key}.json"
        payload = json.dumps(summary.model_dump(mode="json"), ensure_ascii=False, indent=2)
        with self._summary_lock:
            path.write_text(payload, encoding="utf-8")
            self._summary_memory[key] = summary

    def load_transcript(self, *, url: str, preferred_language: str | None) -> TranscriptBundle | None:
        key = self._transcript_key(url=url, preferred_language=preferred_language)
        cached = self._transcript_memory.get(key)
        if cached is not None:
            if cached.source_type == "metadata":
                return None
            return cached

        path = self.transcript_dir / f"{key}.json"
        if not path.exists():
            return None

        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
            bundle = TranscriptBundle(
                source_type=str(payload["source_type"]),
                language=payload.get("language"),
                segments=[
                    TranscriptSegment(
                        start_seconds=item.get("start_seconds"),
                        end_seconds=item.get("end_seconds"),
                        text=str(item.get("text") or "").strip(),
                    )
                    for item in payload.get("segments") or []
                    if str(item.get("text") or "").strip()
                ],
                fallback_used=bool(payload.get("fallback_used", False)),
            )
        except (KeyError, OSError, json.JSONDecodeError, TypeError, ValueError):
            return None

        if bundle.source_type == "metadata":
            return None

        self._transcript_memory[key] = bundle
        return bundle

    def save_transcript(self, *, url: str, preferred_language: str | None, bundle: TranscriptBundle) -> None:
        if bundle.source_type == "metadata":
            return

        key = self._transcript_key(url=url, preferred_language=preferred_language)
        path = self.transcript_dir / f"{key}.json"
        payload = {
            "source_type": bundle.source_type,
            "language": bundle.language,
            "fallback_used": bundle.fallback_used,
            "segments": [
                {
                    "start_seconds": segment.start_seconds,
                    "end_seconds": segment.end_seconds,
                    "text": segment.text,
                }
                for segment in bundle.segments
            ],
        }
        with self._transcript_lock:
            path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
            self._transcript_memory[key] = bundle

    def load_text(self, *, kind: str, url: str, preferred_language: str | None, model: str) -> str | None:
        key = self._text_key(kind=kind, url=url, preferred_language=preferred_language, model=model)
        cached = self._text_memory.get(key)
        if cached is not None:
            return cached

        path = self.text_dir / f"{key}.txt"
        if not path.exists():
            return None

        try:
            text = path.read_text(encoding="utf-8")
        except OSError:
            return None

        self._text_memory[key] = text
        return text

    def save_text(self, *, kind: str, url: str, preferred_language: str | None, model: str, text: str) -> None:
        key = self._text_key(kind=kind, url=url, preferred_language=preferred_language, model=model)
        path = self.text_dir / f"{key}.txt"
        with self._text_lock:
            path.write_text(text, encoding="utf-8")
            self._text_memory[key] = text

    def _summary_key(self, *, url: str, focus_mode: str, preferred_language: str | None, model: str) -> str:
        return self._hash_key("summary", url, focus_mode, preferred_language or "", model)

    def _transcript_key(self, *, url: str, preferred_language: str | None) -> str:
        return self._hash_key("transcript", url, preferred_language or "")

    def _text_key(self, *, kind: str, url: str, preferred_language: str | None, model: str) -> str:
        return self._hash_key("text", kind, url, preferred_language or "", model)

    def _hash_key(self, *parts: str) -> str:
        joined = "::".join((self.CACHE_VERSION, *parts))
        return sha256(joined.encode("utf-8")).hexdigest()
