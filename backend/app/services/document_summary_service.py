from __future__ import annotations

import json
from typing import Any, Iterator

import httpx
from openai import APIConnectionError, APIError, APITimeoutError, AuthenticationError, RateLimitError

from app.schemas_summary import VideoSummarySourceStatus
from app.services.ai_client import AIClient
from app.services.asr_service import AsrTranscriptionError
from app.services.summary_cache import SummaryCacheStore
from app.services.summary_service import SummaryServiceError
from app.services.transcript_models import TranscriptBundle, TranscriptSegment
from app.services.transcript_service import TranscriptService
from app.services.video_service import VideoService


class DocumentSummaryService:
    ASR_PREVIEW_MAX_DURATION_SECONDS = 180

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

    def stream_summary(self, *, url: str, preferred_language: str | None) -> Iterator[str]:
        info, _, transcript_text = self.prepare_summary_context(
            url=url,
            preferred_language=preferred_language,
            max_chars=10000,
        )
        yield from self.stream_summary_from_context(
            url=url,
            preferred_language=preferred_language,
            info=info,
            transcript_text=transcript_text,
        )

    def prepare_summary_context(
        self,
        *,
        url: str,
        preferred_language: str | None,
        max_chars: int,
    ) -> tuple[dict[str, Any], TranscriptBundle, str]:
        return self._prepare_subtitle_text(
            url=url,
            preferred_language=preferred_language,
            max_chars=max_chars,
        )

    def get_video_info(self, *, url: str) -> dict[str, Any]:
        if not self.ai_client.is_configured():
            raise SummaryServiceError(
                code="AI_PROVIDER_ERROR",
                message="AI 服务未配置，请先设置 AI_API_KEY。",
            )

        try:
            return self.video_service.extract_info(url)
        except Exception as exc:
            raise SummaryServiceError(
                code="SUMMARY_NOT_SUPPORTED",
                message="当前视频暂不支持 AI 总结，暂时无法解析视频信息。",
                detail=str(exc),
            ) from exc

    def build_transcript_bundle(
        self,
        *,
        info: dict[str, Any],
        url: str,
        preferred_language: str | None,
    ) -> TranscriptBundle:
        try:
            return self.transcript_service.build_bundle(info, preferred_language, source_url=url)
        except AsrTranscriptionError as exc:
            refreshed_bundle = self._retry_bundle_after_refresh(
                info=info,
                url=url,
                preferred_language=preferred_language,
                error=exc,
            )
            if refreshed_bundle is not None:
                return refreshed_bundle
            raise SummaryServiceError(
                code=exc.code,
                message=exc.message,
                detail=exc.detail,
            ) from exc
        except httpx.HTTPError as exc:
            raise SummaryServiceError(
                code="TRANSCRIPT_UNAVAILABLE",
                message="字幕获取失败，当前视频暂时无法进行 AI 分析。",
                detail=str(exc),
            ) from exc

    def will_likely_use_asr(self, info: dict[str, Any]) -> bool:
        if info.get("subtitles") or info.get("automatic_captions"):
            return False
        webpage_url = str(info.get("webpage_url") or "").lower()
        return "bilibili.com" not in webpage_url

    def should_generate_asr_preview(self, info: dict[str, Any]) -> bool:
        if not self.will_likely_use_asr(info):
            return False
        duration = self._coerce_duration_seconds(info.get("duration"))
        if duration is None:
            return True
        return duration <= self.ASR_PREVIEW_MAX_DURATION_SECONDS

    def _retry_bundle_after_refresh(
        self,
        *,
        info: dict[str, Any],
        url: str,
        preferred_language: str | None,
        error: AsrTranscriptionError,
    ) -> TranscriptBundle | None:
        if error.code != "ASR_AUDIO_DOWNLOAD_FAILED":
            return None
        if not self._should_retry_asr_refresh(info=info, url=url):
            return None

        refreshed_info = self.video_service.extract_info(url)
        refreshed_media_url = str(refreshed_info.get("_summary_media_url") or "").strip()
        original_media_url = str(info.get("_summary_media_url") or "").strip()
        if not refreshed_media_url or refreshed_media_url == original_media_url:
            return None

        return self.transcript_service.build_bundle(
            refreshed_info,
            preferred_language,
            source_url=url,
        )

    def _should_retry_asr_refresh(self, *, info: dict[str, Any], url: str) -> bool:
        source_candidates = [
            str(info.get("webpage_url") or "").lower(),
            str(info.get("extractor") or "").lower(),
            str(info.get("extractor_key") or "").lower(),
            url.lower(),
        ]
        return any("douyin" in candidate for candidate in source_candidates)

    def build_asr_preview_summary(
        self,
        *,
        info: dict[str, Any],
        url: str,
        preferred_language: str | None,
    ) -> str | None:
        asr_source_url = str(info.get("_summary_media_url") or url or "").strip()
        if not asr_source_url:
            return None

        try:
            segments_payload, _ = self.transcript_service.asr_service.transcribe_url_preview(
                asr_source_url,
                preferred_language,
            )
        except AsrTranscriptionError:
            return None

        preview_segments = [
            TranscriptSegment(
                start_seconds=segment.get("start_seconds"),
                end_seconds=segment.get("end_seconds"),
                text=str(segment.get("text") or "").strip(),
            )
            for segment in segments_payload
            if str(segment.get("text") or "").strip()
        ]
        if not preview_segments:
            return None

        transcript_text = self._segments_to_text(preview_segments, max_chars=320)
        if len(transcript_text.strip()) < 30:
            return None

        return self._complete_text(
            system_prompt=(
                "You are a video learning assistant. "
                "Write polished Markdown in the user's preferred language. "
                "When responding in Chinese, always use Simplified Chinese characters. "
                "This is an early preview based on only the first part of the transcript, "
                "so keep it short, clear, and explicit that it is a preview."
            ),
            user_prompt=(
                "Generate an early preview summary in Markdown.\n\n"
                "Use this exact compact structure:\n"
                "## 核心总结\n"
                "Write 1 to 2 short sentences.\n\n"
                "## 核心观点\n"
                "Use 2 to 3 bullet points.\n\n"
                "Do not mention information that is not supported by the transcript excerpt.\n"
                "Keep the whole response short and easy to scan.\n\n"
                f"Video title: {info.get('title') or 'Untitled video'}\n"
                f"Transcript excerpt:\n{transcript_text}"
            ),
            temperature=0.3,
            max_tokens=360,
        ).strip()

    def stream_summary_from_context(
        self,
        *,
        url: str,
        preferred_language: str | None,
        info: dict[str, Any],
        transcript_text: str,
    ) -> Iterator[str]:
        model_name = getattr(self.ai_client, "model", "default-model")
        cached = self.cache_store.load_text(
            kind="document-summary",
            url=url,
            preferred_language=preferred_language,
            model=model_name,
        )
        if cached is not None:
            yield cached
            return

        collected: list[str] = []
        for chunk in self._complete_text_stream(
            system_prompt=(
                "You are a video learning assistant. "
                "Write polished Markdown in the user's preferred language. "
                "When responding in Chinese, always use Simplified Chinese characters. "
                "Be concise, structured, easy to scan, and faithful to the supplied transcript. "
                "Prefer short blocks, strong hierarchy, and bullet points over long paragraphs."
            ),
            user_prompt=(
                "Please summarize the following video for fast learning.\n\n"
                "Use this exact structure in Markdown:\n"
                "## 视频主题概览\n"
                "Write 2 to 3 short sentences only.\n\n"
                "## 核心知识点\n"
                "Use 3 to 5 bullet points. Each point should be one sentence.\n\n"
                "## 分段总结\n"
                "Use bullet points with timestamps like `0:00-0:12：...`.\n"
                "Each line should be concise and focus on one segment only.\n\n"
                "## 关键结论 / 学习收获\n"
                "Use 2 to 3 short bullet points or one short paragraph.\n\n"
                "Do not write long essays. Keep every section compact and easy to scan in 10 seconds.\n\n"
                f"Video title: {info.get('title') or 'Untitled video'}\n"
                f"Video description: {str(info.get('description') or '').strip()[:1200] or '(empty)'}\n\n"
                f"Transcript:\n{transcript_text}"
            ),
            temperature=0.4,
            max_tokens=2000,
        ):
            collected.append(chunk)
            yield chunk

        final_text = "".join(collected).strip()
        if final_text:
            self.cache_store.save_text(
                kind="document-summary",
                url=url,
                preferred_language=preferred_language,
                model=model_name,
                text=final_text,
            )

    def generate_mindmap(self, *, url: str, preferred_language: str | None) -> str:
        model_name = getattr(self.ai_client, "model", "default-model")
        cached = self.cache_store.load_text(
            kind="document-mindmap",
            url=url,
            preferred_language=preferred_language,
            model=model_name,
        )
        if cached is not None:
            return cached

        info, _, transcript_text = self._prepare_subtitle_text(
            url=url,
            preferred_language=preferred_language,
            max_chars=5000,
        )
        content = self._complete_text(
            system_prompt=(
                "You are a learning assistant that turns transcripts into structured mind maps. "
                "When responding in Chinese, always use Simplified Chinese characters. "
                "Return valid JSON only."
            ),
            user_prompt=(
                "Generate a compact mind map in JSON.\n"
                "Use this shape exactly:\n"
                '{"title":"...", "children":[{"title":"...", "children":["...", "..."]}]}\n'
                "Keep the hierarchy clear and use only information supported by the transcript.\n\n"
                f"Video title: {info.get('title') or 'Untitled video'}\n"
                f"Transcript:\n{transcript_text}"
            ),
            temperature=0.3,
            max_tokens=1000,
        ).strip()
        normalized = self._normalize_json_text(content)
        self.cache_store.save_text(
            kind="document-mindmap",
            url=url,
            preferred_language=preferred_language,
            model=model_name,
            text=normalized,
        )
        return normalized

    def stream_answer(self, *, url: str, question: str, preferred_language: str | None) -> Iterator[str]:
        _, _, transcript_text = self._prepare_subtitle_text(
            url=url,
            preferred_language=preferred_language,
            max_chars=5000,
        )
        yield from self._complete_text_stream(
            system_prompt=(
                "You are a grounded video Q&A assistant. "
                "When responding in Chinese, always use Simplified Chinese characters. "
                "Answer only from the supplied transcript. "
                "If the transcript does not support an answer, say so clearly."
            ),
            user_prompt=(
                "Answer the user's question using only the transcript below.\n\n"
                f"Transcript:\n{transcript_text}\n\n"
                f"Question:\n{question}"
            ),
            temperature=0.2,
            max_tokens=1000,
        )

    def get_source_status(self, *, url: str, preferred_language: str | None) -> VideoSummarySourceStatus:
        _, bundle = self._prepare_bundle(url=url, preferred_language=preferred_language)
        return self._bundle_to_status(bundle)

    def get_transcript(self, *, url: str, preferred_language: str | None) -> dict[str, Any]:
        _, bundle, transcript_text = self._prepare_subtitle_text(
            url=url,
            preferred_language=preferred_language,
            max_chars=50000,
        )
        return {
            "transcript": transcript_text,
            "source_status": self._bundle_to_status(bundle).model_dump(mode="json"),
            "segments": [
                {
                    "start_seconds": segment.start_seconds,
                    "start_human": self._format_duration(segment.start_seconds),
                    "end_seconds": segment.end_seconds,
                    "end_human": self._format_duration(segment.end_seconds),
                    "text": segment.text,
                }
                for segment in bundle.segments
            ],
        }

    def _prepare_subtitle_text(
        self,
        *,
        url: str,
        preferred_language: str | None,
        max_chars: int,
    ) -> tuple[dict[str, Any], TranscriptBundle, str]:
        info, bundle = self._prepare_bundle(url=url, preferred_language=preferred_language)
        self._ensure_document_supported(bundle)

        transcript_text = self._segments_to_text(bundle.segments, max_chars=max_chars)
        if not self._has_usable_transcript_text(info=info, bundle=bundle, transcript_text=transcript_text):
            raise SummaryServiceError(
                code="TRANSCRIPT_UNAVAILABLE",
                message="当前视频缺少可用字幕文本，暂时无法生成 AI 总结。",
            )

        return info, bundle, transcript_text

    def _has_usable_transcript_text(
        self,
        *,
        info: dict[str, Any],
        bundle: TranscriptBundle,
        transcript_text: str,
    ) -> bool:
        normalized = transcript_text.strip()
        if not normalized:
            return False

        char_count = len(normalized)
        
        # 降低阈值：从 120 降到 80
        if char_count >= 80:
            return True

        duration = info.get("duration")
        try:
            duration_seconds = int(float(duration)) if duration is not None else None
        except (TypeError, ValueError):
            duration_seconds = None

        # 短视频条件：降低字符要求从 20 到 15
        if bundle.segment_count >= 1 and char_count >= 15 and duration_seconds is not None and duration_seconds <= 90:
            return True

        # ASR 条件：降低段落要求从 3 到 2，字符要求从 20 到 15
        if bundle.source_type == "speech_to_text" and bundle.segment_count >= 2 and char_count >= 15:
            return True

        return False

    def _prepare_bundle(
        self,
        *,
        url: str,
        preferred_language: str | None,
    ) -> tuple[dict[str, Any], TranscriptBundle]:
        info = self.get_video_info(url=url)
        bundle = self.build_transcript_bundle(
            info=info,
            url=url,
            preferred_language=preferred_language,
        )
        return info, bundle

    def _ensure_document_supported(self, bundle: TranscriptBundle) -> None:
        if bundle.source_type in {"human_subtitles", "auto_subtitles", "speech_to_text"}:
            return
        raise SummaryServiceError(
            code="TRANSCRIPT_UNAVAILABLE",
            message="当前视频缺少可用字幕或语音识别文本，暂时无法生成 AI 结果。",
            detail={"source_type": bundle.source_type},
        )

    def _bundle_to_status(self, bundle: TranscriptBundle) -> VideoSummarySourceStatus:
        return VideoSummarySourceStatus(
            source_type=bundle.source_type,
            language=bundle.language,
            segment_count=bundle.segment_count,
            character_count=bundle.character_count,
            fallback_used=bundle.fallback_used,
        )

    def _segments_to_text(self, segments: list[TranscriptSegment], *, max_chars: int) -> str:
        lines: list[str] = []
        current = 0
        for segment in segments:
            line = segment.text.strip()
            if not line:
                continue
            if segment.start_seconds is not None:
                line = f"[{self._format_duration(segment.start_seconds)}] {line}"
            projected = current + len(line) + 1
            if lines and projected > max_chars:
                break
            lines.append(line)
            current = projected
        return "\n".join(lines)

    def _normalize_json_text(self, content: str) -> str:
        try:
            return json.dumps(json.loads(content), ensure_ascii=False, indent=2)
        except json.JSONDecodeError:
            start = content.find("{")
            end = content.rfind("}")
            if start >= 0 and end > start:
                candidate = content[start : end + 1]
                try:
                    return json.dumps(json.loads(candidate), ensure_ascii=False, indent=2)
                except json.JSONDecodeError:
                    pass
        raise SummaryServiceError(
            code="AI_RESPONSE_INVALID",
            message="AI 返回的思维导图结构无效。",
            detail=content,
        )

    def _complete_text(
        self,
        *,
        system_prompt: str,
        user_prompt: str,
        temperature: float,
        max_tokens: int | None,
    ) -> str:
        try:
            return self.ai_client.complete_text(
                system_prompt=system_prompt,
                user_prompt=user_prompt,
                temperature=temperature,
                max_tokens=max_tokens,
            )
        except APITimeoutError as exc:
            raise SummaryServiceError("SUMMARY_TIMEOUT", "AI 请求超时，请稍后重试。", str(exc)) from exc
        except (AuthenticationError, RateLimitError, APIConnectionError, APIError) as exc:
            raise SummaryServiceError("AI_PROVIDER_ERROR", "AI 服务暂时不可用，请检查配置后重试。", str(exc)) from exc

    def _complete_text_stream(
        self,
        *,
        system_prompt: str,
        user_prompt: str,
        temperature: float,
        max_tokens: int | None,
    ) -> Iterator[str]:
        try:
            yield from self.ai_client.complete_text_stream(
                system_prompt=system_prompt,
                user_prompt=user_prompt,
                temperature=temperature,
                max_tokens=max_tokens,
            )
        except APITimeoutError as exc:
            raise SummaryServiceError("SUMMARY_TIMEOUT", "AI 请求超时，请稍后重试。", str(exc)) from exc
        except (AuthenticationError, RateLimitError, APIConnectionError, APIError) as exc:
            raise SummaryServiceError("AI_PROVIDER_ERROR", "AI 服务暂时不可用，请检查配置后重试。", str(exc)) from exc

    def _format_duration(self, seconds: int | None) -> str | None:
        if seconds is None:
            return None
        hours, remainder = divmod(max(0, seconds), 3600)
        minutes, secs = divmod(remainder, 60)
        if hours:
            return f"{hours:d}:{minutes:02d}:{secs:02d}"
        return f"{minutes:d}:{secs:02d}"

    def _coerce_duration_seconds(self, value: Any) -> int | None:
        if value in (None, ""):
            return None
        try:
            return max(0, int(round(float(value))))
        except (TypeError, ValueError):
            return None
