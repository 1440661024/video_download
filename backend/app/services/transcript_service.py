from __future__ import annotations

import json
import logging
import re
import xml.etree.ElementTree as ET
from typing import Any
from urllib.parse import urlparse

import httpx

from app.services.asr_service import AsrTranscriptionError, AudioTranscriptionService
from app.services.summary_cache import SummaryCacheStore
from app.services.text_normalizer import normalize_text
from app.services.transcript_models import TranscriptBundle, TranscriptSegment


logger = logging.getLogger(__name__)


class TranscriptService:
    _TRACK_EXT_PRIORITY = ("json3", "vtt", "srv3", "srv1", "ttml", "xml", "json")

    def __init__(
        self,
        *,
        asr_service: AudioTranscriptionService | None = None,
        cache_store: SummaryCacheStore | None = None,
    ) -> None:
        self.asr_service = asr_service or AudioTranscriptionService()
        self.cache_store = cache_store or SummaryCacheStore()

    def build_bundle(
        self,
        info: dict[str, Any],
        preferred_language: str | None,
        source_url: str | None = None,
    ) -> TranscriptBundle:
        logger.info("build_bundle: subtitles=%s, auto_captions=%s, _summary_media_url=%s, source_url=%s",
                    bool(info.get("subtitles")), bool(info.get("automatic_captions")),
                    info.get("_summary_media_url", ""), source_url)
        if source_url:
            cached_bundle = self.cache_store.load_transcript(
                url=source_url,
                preferred_language=preferred_language,
            )
            if cached_bundle is not None:
                return cached_bundle

        subtitle_bundle = self._build_from_tracks(
            info.get("subtitles") or {},
            preferred_language,
            source_type="human_subtitles",
        )
        if subtitle_bundle:
            return self._persist_bundle(source_url, preferred_language, subtitle_bundle)

        auto_bundle = self._build_from_tracks(
            info.get("automatic_captions") or {},
            preferred_language,
            source_type="auto_subtitles",
        )
        if auto_bundle:
            return self._persist_bundle(source_url, preferred_language, auto_bundle)

        bilibili_bundle = self._build_from_bilibili_api(info, preferred_language)
        if bilibili_bundle:
            return self._persist_bundle(source_url, preferred_language, bilibili_bundle)

        asr_source_url = str(info.get("_summary_media_url") or source_url or "").strip()
        if asr_source_url:
            logger.info("build_bundle: attempting ASR with url=%s", asr_source_url)
            try:
                asr_bundle = self._build_from_asr(asr_source_url, preferred_language)
            except AsrTranscriptionError as exc:
                logger.warning("build_bundle: ASR failed with code=%s message=%s", exc.code, exc.message)
                raise
            if asr_bundle:
                logger.info("build_bundle: ASR succeeded, segments=%d", asr_bundle.segment_count)
                return self._persist_bundle(source_url, preferred_language, asr_bundle)
            logger.warning("build_bundle: ASR returned None, falling back to metadata")
        else:
            logger.warning("build_bundle: no ASR source URL available")

        metadata_bundle = self._build_from_metadata(info, preferred_language)
        if metadata_bundle:
            logger.info("build_bundle: using metadata fallback, segments=%d", metadata_bundle.segment_count)
            return self._persist_bundle(source_url, preferred_language, metadata_bundle)

        logger.warning("build_bundle: no metadata available, returning empty bundle")
        return self._persist_bundle(
            source_url,
            preferred_language,
            TranscriptBundle(
                source_type="metadata",
                language=preferred_language,
                segments=[],
                fallback_used=True,
            ),
        )

    def _persist_bundle(
        self,
        source_url: str | None,
        preferred_language: str | None,
        bundle: TranscriptBundle,
    ) -> TranscriptBundle:
        if source_url:
            self.cache_store.save_transcript(
                url=source_url,
                preferred_language=preferred_language,
                bundle=bundle,
            )
        return bundle

    def _build_from_tracks(
        self,
        tracks_by_language: dict[str, list[dict[str, Any]]],
        preferred_language: str | None,
        source_type: str,
    ) -> TranscriptBundle | None:
        language_code = self._pick_language(tracks_by_language, preferred_language)
        if not language_code:
            return None

        track = self._pick_track(tracks_by_language[language_code])
        if not track or not track.get("url"):
            return None

        try:
            raw_text = self._fetch_track(str(track["url"]))
            segments = self._normalize_segments(
                self._parse_track(raw_text, str(track.get("ext") or "")),
                preferred_language,
            )
            if not segments:
                return None

            return TranscriptBundle(
                source_type=source_type,
                language=language_code,
                segments=segments,
                fallback_used=False,
            )
        except httpx.HTTPError as exc:
            # 字幕获取失败（如 429 限流），返回 None 以便回退到其他方式
            logger.warning("Failed to fetch %s track for language %s: %s", source_type, language_code, exc)
            return None

    def _build_from_bilibili_api(
        self,
        info: dict[str, Any],
        preferred_language: str | None,
    ) -> TranscriptBundle | None:
        webpage_url = str(info.get("webpage_url") or "")
        hostname = (urlparse(webpage_url).hostname or "").lower()
        if "bilibili.com" not in hostname:
            return None

        bvid = str(info.get("display_id") or info.get("id") or "").strip()
        if not bvid:
            return None

        try:
            headers = {
                "User-Agent": "Mozilla/5.0",
                "Referer": webpage_url or "https://www.bilibili.com/",
            }
            response = httpx.get(
                "https://api.bilibili.com/x/web-interface/view",
                params={"bvid": bvid},
                headers=headers,
                timeout=30.0,
            )
            response.raise_for_status()
            payload = response.json().get("data") or {}
            subtitle_list = ((payload.get("subtitle") or {}).get("list") or [])
            subtitle = self._pick_bilibili_subtitle(subtitle_list, preferred_language)
            subtitle_url = str(subtitle.get("subtitle_url") or "").strip() if subtitle else ""
            if not subtitle_url:
                return None

            raw_text = self._fetch_track(self._normalize_bilibili_subtitle_url(subtitle_url))
            segments = self._normalize_segments(self._parse_bilibili_json(raw_text), preferred_language)
            if not segments:
                return None

            return TranscriptBundle(
                source_type="human_subtitles",
                language=str(subtitle.get("lan") or preferred_language or "zh"),
                segments=segments,
                fallback_used=False,
            )
        except (httpx.HTTPError, json.JSONDecodeError, KeyError) as exc:
            # Bilibili API 失败，返回 None 以便回退到其他方式
            logger.warning("Failed to fetch Bilibili subtitles for bvid %s: %s", bvid, exc)
            return None

    def _build_from_asr(self, source_url: str, preferred_language: str | None) -> TranscriptBundle | None:
        try:
            segments_payload, detected_language = self.asr_service.transcribe_url(source_url, preferred_language)
        except AsrTranscriptionError:
            logger.exception("ASR fallback failed for source_url=%s", source_url)
            raise

        segments = [
            TranscriptSegment(
                start_seconds=segment.get("start_seconds"),
                end_seconds=segment.get("end_seconds"),
                text=normalize_text(str(segment.get("text") or "").strip(), preferred_language),
            )
            for segment in segments_payload
            if str(segment.get("text") or "").strip()
        ]
        if not segments:
            return None

        return TranscriptBundle(
            source_type="speech_to_text",
            language=detected_language or preferred_language,
            segments=segments,
            fallback_used=True,
        )

    def _build_from_metadata(
        self,
        info: dict[str, Any],
        preferred_language: str | None,
    ) -> TranscriptBundle | None:
        segments: list[TranscriptSegment] = []
        title = normalize_text(str(info.get("title") or "").strip(), preferred_language)
        description = normalize_text(str(info.get("description") or "").strip(), preferred_language)
        chapters = info.get("chapters") or []

        if title:
            segments.append(TranscriptSegment(start_seconds=0, end_seconds=None, text=f"标题：{title}"))

        if description:
            description_parts = [part.strip() for part in re.split(r"\n{2,}", description) if part.strip()]
            for part in description_parts:
                segments.append(TranscriptSegment(start_seconds=None, end_seconds=None, text=part))

        for chapter in chapters:
            chapter_title = normalize_text(str(chapter.get("title") or "").strip(), preferred_language)
            if not chapter_title:
                continue
            segments.append(
                TranscriptSegment(
                    start_seconds=self._coerce_seconds(chapter.get("start_time")),
                    end_seconds=self._coerce_seconds(chapter.get("end_time")),
                    text=f"章节：{chapter_title}",
                )
            )

        if not segments:
            return None

        return TranscriptBundle(
            source_type="metadata",
            language=preferred_language,
            segments=segments,
            fallback_used=True,
        )

    def _pick_language(
        self,
        tracks_by_language: dict[str, list[dict[str, Any]]],
        preferred_language: str | None,
    ) -> str | None:
        if not tracks_by_language:
            return None
        candidates = self._language_candidates(preferred_language)
        available = list(tracks_by_language.keys())

        for candidate in candidates:
            if candidate in tracks_by_language:
                return candidate
        for candidate in candidates:
            for available_language in available:
                if available_language.lower().startswith(candidate.lower()):
                    return available_language
        return available[0]

    def _pick_track(self, tracks: list[dict[str, Any]]) -> dict[str, Any] | None:
        if not tracks:
            return None

        def priority(track: dict[str, Any]) -> tuple[int, int]:
            ext = str(track.get("ext") or "").lower()
            try:
                ext_priority = self._TRACK_EXT_PRIORITY.index(ext)
            except ValueError:
                ext_priority = len(self._TRACK_EXT_PRIORITY)
            return (ext_priority, 0 if track.get("url") else 1)

        return min(tracks, key=priority)

    def _fetch_track(self, url: str) -> str:
        with httpx.Client(follow_redirects=True, timeout=30.0) as client:
            response = client.get(url)
            response.raise_for_status()
            return response.text

    def _parse_track(self, raw_text: str, ext: str) -> list[TranscriptSegment]:
        ext = ext.lower()
        if ext == "json3":
            return self._parse_json3(raw_text)
        if ext in {"srv1", "srv3", "ttml", "xml"}:
            return self._parse_xml_transcript(raw_text)
        return self._parse_vtt(raw_text)

    def _parse_json3(self, raw_text: str) -> list[TranscriptSegment]:
        try:
            payload = json.loads(raw_text)
        except json.JSONDecodeError:
            return []

        segments: list[TranscriptSegment] = []
        for event in payload.get("events") or []:
            texts = [seg.get("utf8", "") for seg in event.get("segs") or []]
            content = "".join(texts).strip()
            if not content:
                continue
            start_ms = event.get("tStartMs") or 0
            duration_ms = event.get("dDurationMs") or 0
            segments.append(
                TranscriptSegment(
                    start_seconds=self._coerce_seconds(start_ms / 1000),
                    end_seconds=self._coerce_seconds((start_ms + duration_ms) / 1000),
                    text=content,
                )
            )
        return segments

    def _parse_xml_transcript(self, raw_text: str) -> list[TranscriptSegment]:
        try:
            root = ET.fromstring(raw_text)
        except ET.ParseError:
            return []

        segments: list[TranscriptSegment] = []
        for node in root.iter():
            if node.tag.endswith("p") or node.tag.endswith("text"):
                text = "".join(node.itertext()).strip()
                if not text:
                    continue
                start_value = node.attrib.get("t") or node.attrib.get("begin") or node.attrib.get("start")
                segments.append(
                    TranscriptSegment(
                        start_seconds=self._coerce_seconds(start_value, milliseconds=node.attrib.get("t") is not None),
                        end_seconds=None,
                        text=text,
                    )
                )
        return segments

    def _parse_vtt(self, raw_text: str) -> list[TranscriptSegment]:
        lines = raw_text.splitlines()
        segments: list[TranscriptSegment] = []
        current_start: int | None = None
        current_end: int | None = None
        buffer: list[str] = []

        def flush() -> None:
            nonlocal buffer
            text = " ".join(part.strip() for part in buffer if part.strip()).strip()
            if text:
                segments.append(
                    TranscriptSegment(start_seconds=current_start, end_seconds=current_end, text=text)
                )
            buffer = []

        for line in lines:
            stripped = line.strip()
            if not stripped:
                flush()
                current_start = None
                current_end = None
                continue
            if stripped == "WEBVTT" or stripped.startswith("NOTE") or stripped.isdigit():
                continue
            if "-->" in stripped:
                flush()
                start_text, end_text = stripped.split("-->", 1)
                current_start = self._parse_timestamp(start_text.strip())
                current_end = self._parse_timestamp(end_text.strip().split(" ", 1)[0])
                continue
            buffer.append(stripped)

        flush()
        return segments

    def _parse_bilibili_json(self, raw_text: str) -> list[TranscriptSegment]:
        try:
            payload = json.loads(raw_text)
        except json.JSONDecodeError:
            return []
        segments: list[TranscriptSegment] = []
        for body in payload.get("body") or []:
            content = str(body.get("content") or "").strip()
            if not content:
                continue
            segments.append(
                TranscriptSegment(
                    start_seconds=self._coerce_seconds(body.get("from")),
                    end_seconds=self._coerce_seconds(body.get("to")),
                    text=content,
                )
            )
        return segments

    def _pick_bilibili_subtitle(
        self,
        subtitles: list[dict[str, Any]],
        preferred_language: str | None,
    ) -> dict[str, Any] | None:
        if not subtitles:
            return None
        candidates = self._language_candidates(preferred_language)
        for candidate in candidates:
            for subtitle in subtitles:
                lan = str(subtitle.get("lan") or "").lower()
                if lan == candidate.lower() or lan.startswith(candidate.lower()):
                    return subtitle
        return subtitles[0]

    def _normalize_segments(
        self,
        segments: list[TranscriptSegment],
        preferred_language: str | None,
    ) -> list[TranscriptSegment]:
        return [
            TranscriptSegment(
                start_seconds=segment.start_seconds,
                end_seconds=segment.end_seconds,
                text=normalize_text(segment.text.strip(), preferred_language),
            )
            for segment in segments
            if segment.text.strip()
        ]

    def _normalize_bilibili_subtitle_url(self, subtitle_url: str) -> str:
        if subtitle_url.startswith("//"):
            return f"https:{subtitle_url}"
        return subtitle_url

    def _parse_timestamp(self, value: str) -> int | None:
        match = re.match(r"(?:(\d+):)?(\d+):(\d+)(?:\.(\d+))?", value)
        if not match:
            return None
        hours = int(match.group(1) or 0)
        minutes = int(match.group(2))
        seconds = int(match.group(3))
        return hours * 3600 + minutes * 60 + seconds

    def _language_candidates(self, preferred_language: str | None) -> list[str]:
        if not preferred_language:
            return ["zh-CN", "zh-Hans", "zh", "en", "en-US"]

        normalized = preferred_language.strip()
        base = normalized.split("-", 1)[0]
        candidates = [normalized]
        if base and base != normalized:
            candidates.append(base)
        if base == "zh":
            candidates.extend(["zh-CN", "zh-Hans"])
        if base == "en":
            candidates.extend(["en-US", "en-GB"])
        return list(dict.fromkeys(candidate for candidate in candidates if candidate))

    def _coerce_seconds(self, value: Any, milliseconds: bool = False) -> int | None:
        if value in (None, ""):
            return None
        try:
            numeric = float(value)
        except (TypeError, ValueError):
            return None
        if milliseconds:
            numeric /= 1000
        return max(0, int(round(numeric)))
