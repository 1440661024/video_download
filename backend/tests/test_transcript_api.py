from app.routers import summary_stream
from app.schemas_summary import VideoSummarySourceStatus


def test_transcript_success(monkeypatch, member_client):
    monkeypatch.setattr(
        summary_stream.document_summary_service,
        "get_transcript",
        lambda *, url, preferred_language: {
            "transcript": "[0:00] demo transcript",
            "source_status": VideoSummarySourceStatus(
                source_type="human_subtitles",
                language="zh-CN",
                segment_count=3,
                character_count=120,
                fallback_used=False,
            ).model_dump(mode="json"),
            "segments": [
                {
                    "start_seconds": 0,
                    "start_human": "0:00",
                    "end_seconds": 4,
                    "end_human": "0:04",
                    "text": "demo transcript",
                }
            ],
        },
    )

    response = member_client.get("/api/transcript", params={"video_url": "https://example.com/video"})
    assert response.status_code == 200
    payload = response.json()
    assert payload["transcript"] == "[0:00] demo transcript"
    assert payload["source_status"]["source_type"] == "human_subtitles"
    assert payload["segments"][0]["text"] == "demo transcript"
