from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Iterable

from fastapi import APIRouter, Depends, Query
from fastapi.responses import JSONResponse, StreamingResponse
from sqlalchemy.orm import Session

from app.db.models import User
from app.deps import (
    get_current_user,
    get_free_ai_summaries_remaining_today,
    require_ai_member,
    user_has_ai_access,
)
from app.db.session import get_db
from app.services.document_summary_service import DocumentSummaryService
from app.services.summary_service import SummaryServiceError


router = APIRouter(prefix="/api", tags=["summary"])
document_summary_service = DocumentSummaryService()


def _sse_message(data: str, event: str | None = None) -> str:
    # Preserve trailing newlines so streamed Markdown keeps its structure.
    normalized = data.replace("\r\n", "\n").replace("\r", "\n")
    lines = normalized.split("\n")
    payload: list[str] = []
    if event:
        payload.append(f"event: {event}")
    for line in lines:
        payload.append(f"data: {line}")
    return "\n".join(payload) + "\n\n"


def _streaming_headers() -> dict[str, str]:
    return {
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
    }


def _progress_payload(stage: str, message: str) -> str:
    return json.dumps({"stage": stage, "message": message}, ensure_ascii=False)


def _buffered_sse_chunks(chunks: Iterable[str], event: str | None = None) -> Iterable[str]:
    buffer = ""
    separators = {"\n", "。", "！", "？", ".", "!", "?"}
    for chunk in chunks:
        if not chunk:
            continue
        buffer += chunk
        if any(separator in chunk for separator in separators) or len(buffer) >= 120:
            yield _sse_message(buffer, event=event)
            buffer = ""
    if buffer:
        yield _sse_message(buffer, event=event)


def _claim_summary_access(user: User, db: Session) -> tuple[bool, bool, datetime | None]:
    if user_has_ai_access(user):
        return True, False, None

    if get_free_ai_summaries_remaining_today(user) <= 0:
        return False, False, None

    previous_last_used_at = user.free_ai_summary_last_used_at
    user.free_ai_summary_last_used_at = datetime.now(timezone.utc)
    db.add(user)
    db.commit()
    db.refresh(user)
    return True, True, previous_last_used_at


@router.get("/summarize")
def summarize_video(
    video_url: str = Query(..., description="Video URL"),
    preferred_language: str = Query("zh-CN", max_length=32),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    has_access, used_free_quota, previous_last_used_at = _claim_summary_access(user, db)
    if not has_access:
        return JSONResponse(
            status_code=403,
            content={
                "success": False,
                "data": None,
                "error": {
                    "code": "DAILY_FREE_AI_LIMIT_REACHED",
                    "message": "免费用户每天只能体验 1 次 AI 总结，如需多次使用请开通 AI 会员。",
                    "detail": None,
                },
            },
        )

    def generate():
        emitted_summary_content = False
        try:
            if used_free_quota:
                yield _sse_message(
                    _progress_payload("preparing", "本次正在使用今日免费 AI 总结次数。"),
                    event="progress",
                )
            yield _sse_message(
                _progress_payload("preparing", "正在解析视频并获取可用文本..."),
                event="progress",
            )
            info = document_summary_service.get_video_info(url=video_url)
            yield _sse_message(
                _progress_payload("preparing", "视频解析完成，正在检查字幕来源..."),
                event="progress",
            )
            preview_sent = False
            if document_summary_service.will_likely_use_asr(info):
                yield _sse_message(
                    _progress_payload("preparing", "未找到可用字幕，正在准备语音识别..."),
                    event="progress",
                )
                if document_summary_service.should_generate_asr_preview(info):
                    preview_summary = document_summary_service.build_asr_preview_summary(
                        info=info,
                        url=video_url,
                        preferred_language=preferred_language,
                    )
                    if preview_summary:
                        preview_sent = True
                        yield _sse_message(preview_summary, event="preview-summary")
                        yield _sse_message(
                            _progress_payload("generating", "已生成预览，正在补全完整总结..."),
                            event="progress",
                        )
            bundle = document_summary_service.build_transcript_bundle(
                info=info,
                url=video_url,
                preferred_language=preferred_language,
            )
            transcript_text = document_summary_service._segments_to_text(bundle.segments, max_chars=10000)
            document_summary_service._ensure_document_supported(bundle)
            if not document_summary_service._has_usable_transcript_text(
                info=info,
                bundle=bundle,
                transcript_text=transcript_text,
            ):
                raise SummaryServiceError(
                    code="TRANSCRIPT_UNAVAILABLE",
                    message="当前视频缺少可用字幕或语音识别文本，暂时无法生成 AI 结果。",
                )
            status = document_summary_service._bundle_to_status(bundle)
            yield _sse_message(status.model_dump_json(), event="source-status")

            source_message = (
                "未找到字幕，正在使用语音识别转写..."
                if status.source_type == "speech_to_text"
                else "字幕文本准备完成，正在生成 AI 总结..."
            )
            yield _sse_message(
                _progress_payload("generating", source_message),
                event="progress",
            )
            if preview_sent:
                yield _sse_message("", event="summary-reset")
            for chunk in _buffered_sse_chunks(
                document_summary_service.stream_summary_from_context(
                    url=video_url,
                    preferred_language=preferred_language,
                    info=info,
                    transcript_text=transcript_text,
                ),
                event="summary",
            ):
                emitted_summary_content = True
                yield chunk
            yield _sse_message(
                _progress_payload("completed", "总结生成完成。"),
                event="progress",
            )
            yield _sse_message("[DONE]", event="done")
        except SummaryServiceError as exc:
            if used_free_quota and not emitted_summary_content:
                user.free_ai_summary_last_used_at = previous_last_used_at
                db.add(user)
                db.commit()
                db.refresh(user)
            payload = json.dumps(
                {"message": exc.message, "code": exc.code, "detail": exc.detail},
                ensure_ascii=False,
            )
            yield _sse_message(payload, event="app-error")

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers=_streaming_headers(),
    )


@router.get("/mindmap")
def generate_mindmap(
    video_url: str = Query(..., description="Video URL"),
    preferred_language: str = Query("zh-CN", max_length=32),
    _: User = Depends(require_ai_member),
):
    try:
        status = document_summary_service.get_source_status(
            url=video_url,
            preferred_language=preferred_language,
        )
        return {
            "mindmap": document_summary_service.generate_mindmap(
                url=video_url,
                preferred_language=preferred_language,
            ),
            "source_status": status.model_dump(mode="json"),
        }
    except SummaryServiceError as exc:
        return JSONResponse(
            status_code=400,
            content={"error": exc.message, "code": exc.code, "detail": exc.detail},
        )


@router.get("/transcript")
def get_transcript(
    video_url: str = Query(..., description="Video URL"),
    preferred_language: str = Query("zh-CN", max_length=32),
    _: User = Depends(require_ai_member),
):
    try:
        return document_summary_service.get_transcript(
            url=video_url,
            preferred_language=preferred_language,
        )
    except SummaryServiceError as exc:
        return JSONResponse(
            status_code=400,
            content={"error": exc.message, "code": exc.code, "detail": exc.detail},
        )


@router.get("/qa")
def stream_question_answer(
    video_url: str = Query(..., description="Video URL"),
    question: str = Query(..., min_length=1, max_length=4000, description="Question"),
    preferred_language: str = Query("zh-CN", max_length=32),
    _: User = Depends(require_ai_member),
):
    def generate():
        try:
            yield from _buffered_sse_chunks(
                document_summary_service.stream_answer(
                    url=video_url,
                    question=question,
                    preferred_language=preferred_language,
                ),
                event="answer",
            )
            yield _sse_message("[DONE]", event="done")
        except SummaryServiceError as exc:
            payload = json.dumps(
                {"message": exc.message, "code": exc.code, "detail": exc.detail},
                ensure_ascii=False,
            )
            yield _sse_message(payload, event="app-error")

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers=_streaming_headers(),
    )
