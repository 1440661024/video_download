from __future__ import annotations

import json
from typing import Iterable

from fastapi import APIRouter, Query
from fastapi.responses import JSONResponse, StreamingResponse

from app.services.document_summary_service import DocumentSummaryService
from app.services.summary_service import SummaryServiceError


router = APIRouter(prefix="/api", tags=["summary"])
document_summary_service = DocumentSummaryService()


def _sse_message(data: str, event: str | None = None) -> str:
    lines = data.splitlines() or [""]
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


def _buffered_sse_chunks(chunks: Iterable[str]) -> Iterable[str]:
    buffer = ""
    separators = {"\n", "。", "！", "？", ".", "!", "?"}
    for chunk in chunks:
        if not chunk:
            continue
        buffer += chunk
        if any(separator in chunk for separator in separators) or len(buffer) >= 120:
            yield _sse_message(buffer)
            buffer = ""
    if buffer:
        yield _sse_message(buffer)


@router.get("/summarize")
def summarize_video(
    video_url: str = Query(..., description="Video URL"),
    preferred_language: str = Query("zh-CN", max_length=32),
):
    def generate():
        try:
            yield _sse_message(
                _progress_payload("preparing", "正在解析视频并获取可用文本..."),
                event="progress",
            )
            info, bundle, transcript_text = document_summary_service.prepare_summary_context(
                url=video_url,
                preferred_language=preferred_language,
                max_chars=10000,
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
            yield from _buffered_sse_chunks(
                document_summary_service.stream_summary_from_context(
                    url=video_url,
                    preferred_language=preferred_language,
                    info=info,
                    transcript_text=transcript_text,
                )
            )
            yield _sse_message(
                _progress_payload("completed", "总结生成完成。"),
                event="progress",
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


@router.get("/mindmap")
def generate_mindmap(
    video_url: str = Query(..., description="Video URL"),
    preferred_language: str = Query("zh-CN", max_length=32),
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
):
    def generate():
        try:
            yield from _buffered_sse_chunks(
                document_summary_service.stream_answer(
                    url=video_url,
                    question=question,
                    preferred_language=preferred_language,
                )
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
