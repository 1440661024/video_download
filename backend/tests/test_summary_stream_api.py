from fastapi.testclient import TestClient

from app.main import app
from app.routers import summary_stream
from app.schemas_summary import VideoSummarySourceStatus
from app.services.summary_service import SummaryServiceError
from app.services.transcript_models import TranscriptBundle, TranscriptSegment


client = TestClient(app)


def test_summarize_stream_success(monkeypatch):
    bundle = TranscriptBundle(
        source_type="human_subtitles",
        language="zh-CN",
        segments=[TranscriptSegment(start_seconds=0, end_seconds=12, text="demo" * 40)],
        fallback_used=False,
    )

    def fake_prepare_summary_context(*, url: str, preferred_language: str | None, max_chars: int):
        return (
            {"title": "Demo"},
            bundle,
            "[0:00] demo transcript",
        )

    def fake_stream_summary_from_context(*, url: str, preferred_language: str | None, info, transcript_text):
        yield "## 视频主题概览\n"
        yield "- Point 1"

    monkeypatch.setattr(
        summary_stream.document_summary_service,
        "prepare_summary_context",
        fake_prepare_summary_context,
    )
    monkeypatch.setattr(
        summary_stream.document_summary_service,
        "stream_summary_from_context",
        fake_stream_summary_from_context,
    )
    response = client.get("/api/summarize", params={"video_url": "https://example.com/video"})

    assert response.status_code == 200
    assert "event: source-status" in response.text
    assert '"source_type":"human_subtitles"' in response.text
    assert "data: ## 视频主题概览" in response.text
    assert "event: done" in response.text


def test_mindmap_success(monkeypatch):
    monkeypatch.setattr(
        summary_stream.document_summary_service,
        "get_source_status",
        lambda *, url, preferred_language: VideoSummarySourceStatus(
            source_type="speech_to_text",
            language="zh",
            segment_count=10,
            character_count=520,
            fallback_used=True,
        ),
    )
    monkeypatch.setattr(
        summary_stream.document_summary_service,
        "generate_mindmap",
        lambda *, url, preferred_language: '{"title":"Demo"}',
    )
    response = client.get("/api/mindmap", params={"video_url": "https://example.com/video"})

    assert response.status_code == 200
    assert response.json()["mindmap"] == '{"title":"Demo"}'
    assert response.json()["source_status"]["source_type"] == "speech_to_text"


def test_qa_stream_error(monkeypatch):
    def fake_stream_answer(*, url: str, question: str, preferred_language: str | None):
        raise SummaryServiceError("TRANSCRIPT_UNAVAILABLE", "missing subtitles", None)
        yield ""

    monkeypatch.setattr(summary_stream.document_summary_service, "stream_answer", fake_stream_answer)
    response = client.get(
        "/api/qa",
        params={"video_url": "https://example.com/video", "question": "demo"},
    )

    assert response.status_code == 200
    assert "event: app-error" in response.text
    assert '"message": "missing subtitles"' in response.text


def test_document_summary_accepts_asr_source():
    service = summary_stream.document_summary_service
    service._ensure_document_supported(
        TranscriptBundle(
            source_type="speech_to_text",
            language="zh",
            segments=[TranscriptSegment(start_seconds=0, end_seconds=1, text="demo" * 40)],
            fallback_used=True,
        )
    )


def test_document_summary_rejects_metadata_source():
    service = summary_stream.document_summary_service
    try:
        service._ensure_document_supported(
            TranscriptBundle(
                source_type="metadata",
                language="zh",
                segments=[TranscriptSegment(start_seconds=0, end_seconds=1, text="demo")],
                fallback_used=True,
            )
        )
    except SummaryServiceError as exc:
        assert exc.code == "TRANSCRIPT_UNAVAILABLE"
    else:
        raise AssertionError("expected SummaryServiceError")
