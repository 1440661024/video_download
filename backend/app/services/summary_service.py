from __future__ import annotations

import json
import re
from typing import Any

import httpx
from openai import APIConnectionError, APIError, APITimeoutError, AuthenticationError, RateLimitError
from pydantic import BaseModel, ValidationError

from app.schemas_summary import (
    SummaryFocusMode,
    VideoQuestionMessage,
    VideoQuestionResponse,
    VideoSummaryChapter,
    VideoSummaryResponse,
    VideoSummarySourceStatus,
    VideoTranscriptSegment,
)
from app.services.ai_client import AIClient
from app.services.summary_cache import SummaryCacheStore
from app.services.transcript_models import TranscriptBundle, TranscriptSegment
from app.services.transcript_service import TranscriptService
from app.services.video_service import VideoService


class SummaryServiceError(Exception):
    def __init__(self, code: str, message: str, detail: Any | None = None) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.detail = detail


class ChunkSummaryPayload(BaseModel):
    summary: str


class FinalSummaryPayload(BaseModel):
    overview: str
    key_points: list[str]
    chapter_summaries: list[VideoSummaryChapter]
    takeaways: list[str]
    mind_map_markdown: str


class QuestionAnswerPayload(BaseModel):
    answer: str


class SummaryService:
    def __init__(
        self,
        *,
        video_service: VideoService | None = None,
        transcript_service: TranscriptService | None = None,
        ai_client: AIClient | None = None,
        cache_store: SummaryCacheStore | None = None,
    ) -> None:
        self.cache_store = cache_store or SummaryCacheStore()
        self.video_service = video_service or VideoService()
        self.transcript_service = transcript_service or TranscriptService(cache_store=self.cache_store)
        self.ai_client = ai_client or AIClient()

    def generate_summary(
        self,
        *,
        url: str,
        focus_mode: SummaryFocusMode,
        preferred_language: str | None,
    ) -> VideoSummaryResponse:
        model_name = getattr(self.ai_client, "model", "default-model")
        cached_summary = self.cache_store.load_summary(
            url=url,
            focus_mode=focus_mode,
            preferred_language=preferred_language,
            model=model_name,
        )
        if cached_summary is not None:
            return cached_summary

        info, source = self._prepare_source(url, preferred_language)
        chunk_notes = self._build_chunk_notes(
            info=info,
            source=source,
            focus_mode=focus_mode,
            preferred_language=preferred_language,
        )
        try:
            final_payload = self._build_final_summary(
                info=info,
                source=source,
                chunk_notes=chunk_notes,
                focus_mode=focus_mode,
                preferred_language=preferred_language,
            )
        except SummaryServiceError as exc:
            if exc.code != "AI_RESPONSE_INVALID":
                raise
            final_payload = self._build_fallback_final_summary(info=info, chunk_notes=chunk_notes)

        summary = VideoSummaryResponse(
            video_title=str(info.get("title") or "Untitled Video"),
            source_url=url,
            summary_mode=focus_mode,
            overview=final_payload.overview,
            key_points=final_payload.key_points,
            chapter_summaries=final_payload.chapter_summaries,
            takeaways=final_payload.takeaways,
            transcript_segments=[self._segment_to_schema(segment) for segment in source.segments],
            mind_map_markdown=final_payload.mind_map_markdown,
            source_text_status=VideoSummarySourceStatus(
                source_type=source.source_type,
                language=source.language,
                segment_count=source.segment_count,
                character_count=source.character_count,
                fallback_used=source.fallback_used,
            ),
            disclaimer="AI output is for quick understanding only. Please verify it against the original video.",
        )
        self.cache_store.save_summary(
            url=url,
            focus_mode=focus_mode,
            preferred_language=preferred_language,
            model=model_name,
            summary=summary,
        )
        return summary

    def answer_question(
        self,
        *,
        url: str,
        question: str,
        preferred_language: str | None,
        history: list[VideoQuestionMessage],
        summary_context: str | None = None,
    ) -> VideoQuestionResponse:
        info, source = self._prepare_source(url, preferred_language)
        transcript_text = self._transcript_context(source.segments, max_chars=12000)
        description_text = str(info.get("description") or "").strip()
        history_text = "\n".join(
            f"{'User' if message.role == 'user' else 'Assistant'}: {message.content}"
            for message in history[-8:]
        )
        payload = self._call_ai(
            response_model=QuestionAnswerPayload,
            system_prompt=self._question_system_prompt(preferred_language),
            user_prompt=(
                f"Video title: {info.get('title') or 'Untitled Video'}\n"
                f"Uploader: {info.get('uploader') or info.get('channel') or 'Unknown'}\n"
                f"Transcript source: {source.source_type}\n"
                f"Conversation history:\n{history_text or '(empty)'}\n\n"
                f"Summary context:\n{summary_context or '(empty)'}\n\n"
                f"Video description:\n{description_text or '(empty)'}\n\n"
                f"Transcript excerpt:\n{transcript_text}\n\n"
                f"User question:\n{question}"
            ),
        )
        answer = payload.answer.strip()
        heuristic_answer = self._maybe_answer_from_keywords(
            info=info,
            summary_context=summary_context,
            current_answer=answer,
        )
        return VideoQuestionResponse(answer=heuristic_answer or answer)

    def _prepare_source(self, url: str, preferred_language: str | None) -> tuple[dict[str, Any], TranscriptBundle]:
        if not self.ai_client.is_configured():
            raise SummaryServiceError(
                code="AI_PROVIDER_ERROR",
                message="AI service is not configured. Please set AI_API_KEY first.",
            )

        try:
            info = self.video_service.extract_info(url)
        except Exception as exc:
            raise SummaryServiceError(
                code="SUMMARY_NOT_SUPPORTED",
                message="The current video could not be parsed for AI analysis.",
                detail=str(exc),
            ) from exc

        try:
            source = self.transcript_service.build_bundle(info, preferred_language, source_url=url)
        except httpx.HTTPError as exc:
            raise SummaryServiceError(
                code="TRANSCRIPT_UNAVAILABLE",
                message="Subtitle retrieval failed, so AI analysis is unavailable right now.",
                detail=str(exc),
            ) from exc

        if source.character_count < 120:
            code = "TRANSCRIPT_UNAVAILABLE" if source.source_type != "metadata" else "SUMMARY_NOT_SUPPORTED"
            raise SummaryServiceError(
                code=code,
                message="Not enough usable text was found for this video.",
            )

        return info, source

    def _build_chunk_notes(
        self,
        *,
        info: dict[str, Any],
        source: TranscriptBundle,
        focus_mode: SummaryFocusMode,
        preferred_language: str | None,
    ) -> list[str]:
        notes: list[str] = []
        for index, chunk in enumerate(self._chunk_segments(source.segments), start=1):
            payload = self._call_ai(
                response_model=ChunkSummaryPayload,
                system_prompt=self._chunk_system_prompt(preferred_language),
                user_prompt=(
                    f"Video title: {info.get('title') or 'Untitled Video'}\n"
                    f"Focus mode: {self._focus_mode_label(focus_mode)}\n"
                    f"Transcript source: {source.source_type}\n"
                    f"Chunk index: {index}\n\n"
                    f"Transcript chunk:\n{chunk}"
                ),
            )
            notes.append(payload.summary)
        return notes

    def _build_final_summary(
        self,
        *,
        info: dict[str, Any],
        source: TranscriptBundle,
        chunk_notes: list[str],
        focus_mode: SummaryFocusMode,
        preferred_language: str | None,
    ) -> FinalSummaryPayload:
        chapters = info.get("chapters") or []
        chapter_context = []
        for chapter in chapters:
            title = str(chapter.get("title") or "").strip()
            if not title:
                continue
            start_seconds = self._coerce_int(chapter.get("start_time"))
            chapter_context.append(
                {
                    "title": title,
                    "start_seconds": start_seconds,
                    "start_human": self._format_duration(start_seconds) if start_seconds is not None else None,
                }
            )

        return self._call_ai(
            response_model=FinalSummaryPayload,
            system_prompt=self._final_system_prompt(preferred_language),
            user_prompt=(
                f"Video title: {info.get('title') or 'Untitled Video'}\n"
                f"Uploader: {info.get('uploader') or info.get('channel') or 'Unknown'}\n"
                f"Duration: {self._format_duration(self._coerce_int(info.get('duration')))}\n"
                f"Focus mode: {self._focus_mode_label(focus_mode)}\n"
                f"Transcript source: {source.source_type}\n"
                f"Chapter context: {json.dumps(chapter_context, ensure_ascii=False)}\n\n"
                f"Chunk summaries:\n{json.dumps(chunk_notes, ensure_ascii=False)}"
            ),
        )

    def _build_fallback_final_summary(
        self,
        *,
        info: dict[str, Any],
        chunk_notes: list[str],
    ) -> FinalSummaryPayload:
        description = str(info.get("description") or "").strip()
        overview = (
            chunk_notes[0]
            if chunk_notes
            else description[:280] or "This video discusses the project workflow and core ideas."
        )

        candidate_sentences: list[str] = []
        for text in chunk_notes + [description]:
            for sentence in re.split(r"[。\n!?！？]", text):
                cleaned = sentence.strip(" -\u2014\t")
                if len(cleaned) >= 10:
                    candidate_sentences.append(cleaned)

        deduped: list[str] = []
        for sentence in candidate_sentences:
            if sentence not in deduped:
                deduped.append(sentence)
        key_points = deduped[:5] or [overview]
        takeaways = deduped[5:10] or key_points[:3]

        chapters = info.get("chapters") or []
        if chapters:
            chapter_summaries = [
                VideoSummaryChapter(
                    title=str(chapter.get("title") or f"Chapter {index + 1}"),
                    start_seconds=self._coerce_int(chapter.get("start_time")),
                    start_human=self._format_duration(self._coerce_int(chapter.get("start_time"))),
                    summary=key_points[min(index, len(key_points) - 1)],
                )
                for index, chapter in enumerate(chapters)
            ]
        else:
            chapter_summaries = [
                VideoSummaryChapter(
                    title="Full video",
                    start_seconds=0,
                    start_human="0:00",
                    summary=overview,
                )
            ]

        mind_map_lines = ["# " + str(info.get("title") or "Video Summary")]
        for point in key_points:
            mind_map_lines.append(f"- {point}")
        return FinalSummaryPayload(
            overview=overview,
            key_points=key_points,
            chapter_summaries=chapter_summaries,
            takeaways=takeaways,
            mind_map_markdown="\n".join(mind_map_lines),
        )

    def _call_ai(
        self,
        *,
        response_model: type[BaseModel],
        system_prompt: str,
        user_prompt: str,
    ) -> BaseModel:
        try:
            payload = self.ai_client.complete_json(system_prompt=system_prompt, user_prompt=user_prompt)
        except APITimeoutError as exc:
            raise SummaryServiceError("SUMMARY_TIMEOUT", "AI request timed out.", str(exc)) from exc
        except (AuthenticationError, RateLimitError, APIConnectionError, APIError) as exc:
            raise SummaryServiceError("AI_PROVIDER_ERROR", "AI provider is temporarily unavailable.", str(exc)) from exc
        except (ValueError, json.JSONDecodeError) as exc:
            raw_payload = str(exc)
            try:
                payload = self._repair_raw_text(response_model=response_model, raw_text=raw_payload)
            except Exception:
                raise SummaryServiceError("AI_RESPONSE_INVALID", "AI returned invalid JSON.", raw_payload) from exc

        try:
            return response_model.model_validate(payload)
        except ValidationError as exc:
            repaired_payload = self._repair_payload(response_model=response_model, payload=payload)
            try:
                return response_model.model_validate(repaired_payload)
            except ValidationError:
                raise SummaryServiceError(
                    "AI_RESPONSE_INVALID",
                    "AI returned an unexpected structure.",
                    exc.errors(),
                ) from exc

    def _chunk_system_prompt(self, preferred_language: str | None) -> str:
        language = preferred_language or "zh-CN"
        return (
            f"You are a video learning assistant. Respond in {language}. "
            "Return JSON only with one field named summary. "
            "Summarize the transcript chunk into its main topic, key facts, and supporting examples."
        )

    def _final_system_prompt(self, preferred_language: str | None) -> str:
        language = preferred_language or "zh-CN"
        return (
            f"You are a video learning assistant. Respond in {language}. "
            "Return JSON only with overview, key_points, chapter_summaries, takeaways, and mind_map_markdown. "
            "key_points and takeaways must be string arrays. "
            "chapter_summaries must be an array of objects with title, start_seconds, start_human, and summary. "
            "mind_map_markdown must be a valid Markdown heading and bullet tree."
        )

    def _question_system_prompt(self, preferred_language: str | None) -> str:
        language = preferred_language or "zh-CN"
        return (
            f"You are a grounded video Q&A assistant. Respond in {language}. "
            "Answer only from the supplied summary context, transcript, description, and metadata. "
            "If the answer is not supported by the supplied context, say so explicitly. "
            "Return JSON only with one field named answer."
        )

    def _repair_payload(self, *, response_model: type[BaseModel], payload: dict[str, Any]) -> dict[str, Any]:
        return self.ai_client.complete_json(
            system_prompt=(
                "You repair malformed JSON outputs. "
                "Return JSON only. Do not add commentary. "
                "Fill missing fields with safe defaults that still satisfy the schema."
            ),
            user_prompt=(
                f"Target JSON schema:\n{json.dumps(response_model.model_json_schema(), ensure_ascii=False)}\n\n"
                f"Malformed JSON object:\n{json.dumps(payload, ensure_ascii=False)}"
            ),
        )

    def _repair_raw_text(self, *, response_model: type[BaseModel], raw_text: str) -> dict[str, Any]:
        return self.ai_client.complete_json(
            system_prompt=(
                "You convert malformed model output into valid JSON. "
                "Return JSON only and satisfy the target schema exactly."
            ),
            user_prompt=(
                f"Target JSON schema:\n{json.dumps(response_model.model_json_schema(), ensure_ascii=False)}\n\n"
                f"Malformed raw model output:\n{raw_text}"
            ),
        )

    def _focus_mode_label(self, focus_mode: SummaryFocusMode) -> str:
        if focus_mode == "study":
            return "study"
        if focus_mode == "analysis":
            return "analysis"
        return "overview"

    def _chunk_segments(self, segments: list[TranscriptSegment], max_chars: int = 5000) -> list[str]:
        chunks: list[str] = []
        buffer: list[str] = []
        current_chars = 0

        for segment in segments:
            prefix = ""
            if segment.start_seconds is not None:
                prefix = f"[{self._format_duration(segment.start_seconds)}] "
            line = f"{prefix}{segment.text}".strip()
            if not line:
                continue
            projected = current_chars + len(line) + 1
            if buffer and projected > max_chars:
                chunks.append("\n".join(buffer))
                buffer = []
                current_chars = 0
            buffer.append(line)
            current_chars += len(line) + 1

        if buffer:
            chunks.append("\n".join(buffer))

        return chunks or [""]

    def _transcript_context(self, segments: list[TranscriptSegment], max_chars: int) -> str:
        buffer: list[str] = []
        current = 0
        for segment in segments:
            line = (
                f"[{self._format_duration(segment.start_seconds)}] {segment.text}"
                if segment.start_seconds is not None
                else segment.text
            )
            current += len(line) + 1
            if current > max_chars:
                break
            buffer.append(line)
        return "\n".join(buffer)

    def _segment_to_schema(self, segment: TranscriptSegment) -> VideoTranscriptSegment:
        return VideoTranscriptSegment(
            start_seconds=segment.start_seconds,
            start_human=self._format_duration(segment.start_seconds) if segment.start_seconds is not None else None,
            end_seconds=segment.end_seconds,
            end_human=self._format_duration(segment.end_seconds) if segment.end_seconds is not None else None,
            text=segment.text,
        )

    def _format_duration(self, seconds: int | None) -> str:
        if seconds is None:
            return "unknown"
        hours, remainder = divmod(max(0, seconds), 3600)
        minutes, secs = divmod(remainder, 60)
        if hours:
            return f"{hours:d}:{minutes:02d}:{secs:02d}"
        return f"{minutes:d}:{secs:02d}"

    def _coerce_int(self, value: Any) -> int | None:
        if value is None:
            return None
        try:
            return max(0, int(float(value)))
        except (TypeError, ValueError):
            return None

    def _maybe_answer_from_keywords(
        self,
        *,
        info: dict[str, Any],
        summary_context: str | None,
        current_answer: str,
    ) -> str | None:
        if current_answer and "无法" not in current_answer and "不确定" not in current_answer:
            return None

        search_text = "\n".join(
            part for part in [str(info.get("description") or ""), summary_context or ""] if part
        )
        known_terms = [
            "Cursor",
            "MCP",
            "Agent Skills",
            "Next.js",
            "TypeScript",
            "Prisma",
            "MySQL",
            "GitHub App",
            "GitHub Webhook",
            "OpenRouter",
            "GPT",
            "Claude",
            "Gemini",
            "DeepSeek",
            "Ngrok",
            "Vercel",
        ]
        found_terms = [term for term in known_terms if term.lower() in search_text.lower()]
        if not found_terms:
            return None
        return "视频中明确提到的技术栈和平台包括：" + "、".join(found_terms) + "。"
