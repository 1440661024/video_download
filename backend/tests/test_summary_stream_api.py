from app.routers import summary_stream
from app.schemas_summary import VideoSummarySourceStatus
from app.services.summary_service import SummaryServiceError
from app.services.transcript_models import TranscriptBundle, TranscriptSegment


def test_sse_message_preserves_trailing_newline_for_markdown_lists():
    payload = summary_stream._sse_message("## Heading\n* Point 1\n", event="summary")

    assert "data: ## Heading\n" in payload
    assert "data: * Point 1\n" in payload
    assert "data: \n\n" in payload


def test_summarize_stream_success(monkeypatch, member_client):
    bundle = TranscriptBundle(
        source_type="human_subtitles",
        language="zh-CN",
        segments=[TranscriptSegment(start_seconds=0, end_seconds=12, text="demo" * 40)],
        fallback_used=False,
    )

    monkeypatch.setattr(
        summary_stream.document_summary_service,
        "get_video_info",
        lambda *, url: {"title": "Demo", "subtitles": {"zh-CN": [{"url": "x"}]}, "automatic_captions": {}},
    )
    monkeypatch.setattr(
        summary_stream.document_summary_service,
        "build_transcript_bundle",
        lambda *, info, url, preferred_language: bundle,
    )
    monkeypatch.setattr(
        summary_stream.document_summary_service,
        "_segments_to_text",
        lambda segments, max_chars: "[0:00] " + ("demo transcript " * 12),
    )
    monkeypatch.setattr(
        summary_stream.document_summary_service,
        "stream_summary_from_context",
        lambda *, url, preferred_language, info, transcript_text: iter(["## 视频主题概览\n", "- Point 1"]),
    )

    response = member_client.get("/api/summarize", params={"video_url": "https://example.com/video"})

    assert response.status_code == 200
    assert "event: source-status" in response.text
    assert '"source_type":"human_subtitles"' in response.text
    assert "data: ## 视频主题概览" in response.text
    assert "视频解析完成，正在检查字幕来源" in response.text
    assert "event: done" in response.text


def test_mindmap_success(monkeypatch, member_client):
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
    response = member_client.get("/api/mindmap", params={"video_url": "https://example.com/video"})

    assert response.status_code == 200
    assert response.json()["mindmap"] == '{"title":"Demo"}'
    assert response.json()["source_status"]["source_type"] == "speech_to_text"


def test_qa_stream_error(monkeypatch, member_client):
    def fake_stream_answer(*, url: str, question: str, preferred_language: str | None):
        raise SummaryServiceError("TRANSCRIPT_UNAVAILABLE", "missing subtitles", None)
        yield ""

    monkeypatch.setattr(summary_stream.document_summary_service, "stream_answer", fake_stream_answer)
    response = member_client.get(
        "/api/qa",
        params={"video_url": "https://example.com/video", "question": "demo"},
    )

    assert response.status_code == 200
    assert "event: app-error" in response.text
    assert '"message": "missing subtitles"' in response.text


def test_summarize_stream_surfaces_asr_failure(monkeypatch, member_client):
    monkeypatch.setattr(
        summary_stream.document_summary_service,
        "get_video_info",
        lambda *, url: {"title": "Demo", "subtitles": {}, "automatic_captions": {}, "webpage_url": "https://www.douyin.com/video/demo"},
    )
    monkeypatch.setattr(
        summary_stream.document_summary_service,
        "build_transcript_bundle",
        lambda *, info, url, preferred_language: (_ for _ in ()).throw(
            SummaryServiceError(
                "ASR_AUDIO_DOWNLOAD_FAILED",
                "音频提取失败，暂时无法进行语音识别。",
                "403 Forbidden",
            )
        ),
    )

    response = member_client.get("/api/summarize", params={"video_url": "https://example.com/video"})

    assert response.status_code == 200
    assert "event: app-error" in response.text
    assert '"code": "ASR_AUDIO_DOWNLOAD_FAILED"' in response.text
    assert '"message": "音频提取失败，暂时无法进行语音识别。"' in response.text


def test_summarize_stream_emits_asr_preparation_progress(monkeypatch, member_client):
    bundle = TranscriptBundle(
        source_type="speech_to_text",
        language="zh",
        segments=[TranscriptSegment(start_seconds=0, end_seconds=12, text="demo" * 40)],
        fallback_used=True,
    )

    monkeypatch.setattr(
        summary_stream.document_summary_service,
        "get_video_info",
        lambda *, url: {"title": "Demo", "subtitles": {}, "automatic_captions": {}, "webpage_url": "https://www.douyin.com/video/demo"},
    )
    monkeypatch.setattr(
        summary_stream.document_summary_service,
        "build_transcript_bundle",
        lambda *, info, url, preferred_language: bundle,
    )
    monkeypatch.setattr(
        summary_stream.document_summary_service,
        "_segments_to_text",
        lambda segments, max_chars: "[0:00] " + ("demo transcript " * 12),
    )
    monkeypatch.setattr(
        summary_stream.document_summary_service,
        "stream_summary_from_context",
        lambda *, url, preferred_language, info, transcript_text: iter(["demo summary"]),
    )

    response = member_client.get("/api/summarize", params={"video_url": "https://example.com/video"})

    assert response.status_code == 200
    assert "未找到可用字幕，正在准备语音识别" in response.text


def test_summarize_stream_emits_preview_summary_for_asr(monkeypatch, member_client):
    bundle = TranscriptBundle(
        source_type="speech_to_text",
        language="zh",
        segments=[TranscriptSegment(start_seconds=0, end_seconds=12, text="demo" * 40)],
        fallback_used=True,
    )

    monkeypatch.setattr(
        summary_stream.document_summary_service,
        "get_video_info",
        lambda *, url: {
            "title": "Demo",
            "duration": 120,
            "subtitles": {},
            "automatic_captions": {},
            "webpage_url": "https://www.douyin.com/video/demo",
        },
    )
    monkeypatch.setattr(
        summary_stream.document_summary_service,
        "build_asr_preview_summary",
        lambda *, info, url, preferred_language: "## 核心总结\n预览内容",
    )
    monkeypatch.setattr(
        summary_stream.document_summary_service,
        "build_transcript_bundle",
        lambda *, info, url, preferred_language: bundle,
    )
    monkeypatch.setattr(
        summary_stream.document_summary_service,
        "_segments_to_text",
        lambda segments, max_chars: "[0:00] " + ("demo transcript " * 12),
    )
    monkeypatch.setattr(
        summary_stream.document_summary_service,
        "stream_summary_from_context",
        lambda *, url, preferred_language, info, transcript_text: iter(["final summary"]),
    )

    response = member_client.get("/api/summarize", params={"video_url": "https://example.com/video"})

    assert response.status_code == 200
    assert "event: preview-summary" in response.text
    assert "预览内容" in response.text
    assert "event: summary-reset" in response.text


def test_summarize_stream_skips_preview_summary_for_long_asr_video(monkeypatch, member_client):
    bundle = TranscriptBundle(
        source_type="speech_to_text",
        language="zh",
        segments=[TranscriptSegment(start_seconds=0, end_seconds=12, text="demo" * 40)],
        fallback_used=True,
    )

    monkeypatch.setattr(
        summary_stream.document_summary_service,
        "get_video_info",
        lambda *, url: {
            "title": "Demo",
            "duration": 600,
            "subtitles": {},
            "automatic_captions": {},
            "webpage_url": "https://www.douyin.com/video/demo",
        },
    )
    monkeypatch.setattr(
        summary_stream.document_summary_service,
        "build_asr_preview_summary",
        lambda *, info, url, preferred_language: (_ for _ in ()).throw(
            AssertionError("long ASR video should not build preview summary")
        ),
    )
    monkeypatch.setattr(
        summary_stream.document_summary_service,
        "build_transcript_bundle",
        lambda *, info, url, preferred_language: bundle,
    )
    monkeypatch.setattr(
        summary_stream.document_summary_service,
        "_segments_to_text",
        lambda segments, max_chars: "[0:00] " + ("demo transcript " * 12),
    )
    monkeypatch.setattr(
        summary_stream.document_summary_service,
        "stream_summary_from_context",
        lambda *, url, preferred_language, info, transcript_text: iter(["final summary"]),
    )

    response = member_client.get("/api/summarize", params={"video_url": "https://example.com/video"})

    assert response.status_code == 200
    assert "event: preview-summary" not in response.text
    assert "event: summary-reset" not in response.text


def test_should_generate_asr_preview_skips_long_video():
    service = summary_stream.document_summary_service

    assert (
        service.should_generate_asr_preview(
            {
                "duration": 181,
                "subtitles": {},
                "automatic_captions": {},
                "webpage_url": "https://www.douyin.com/video/demo",
            }
        )
        is False
    )


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
