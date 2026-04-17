from fastapi.testclient import TestClient

from app.main import app
from app.routers import video
from app.schemas import DownloadStrategy, VideoMeta
from app.services.video_service import VideoServiceError


client = TestClient(app)


def test_parse_success(monkeypatch):
    def fake_parse(url: str):
        return VideoMeta(
            source_url=url,
            title="Demo",
            thumbnail="https://example.com/thumb.jpg",
            duration_seconds=61,
            duration_human="1:01",
            uploader="Uploader",
            extractor="YouTube",
            webpage_url=url,
            can_use_direct_link=True,
            recommended_strategy=DownloadStrategy(
                mode="direct",
                reason="test",
                label="直链下载",
            ),
            formats=[],
            copyright_notice="notice",
        )

    monkeypatch.setattr(video.service, "parse_video", fake_parse)
    response = client.post("/api/video/parse", json={"url": "https://example.com/video"})
    body = response.json()
    assert response.status_code == 200
    assert body["success"] is True
    assert body["data"]["title"] == "Demo"


def test_parse_failure(monkeypatch):
    def fake_parse(url: str):
        raise VideoServiceError("VIDEO_EXTRACT_FAILED", "failed", "boom")

    monkeypatch.setattr(video.service, "parse_video", fake_parse)
    response = client.post("/api/video/parse", json={"url": "https://example.com/video"})
    body = response.json()
    assert response.status_code == 200
    assert body["success"] is False
    assert body["error"]["code"] == "VIDEO_EXTRACT_FAILED"


def test_download_link_success(monkeypatch):
    def fake_link(url: str, format_id: str):
        return {
            "url": "https://cdn.example.com/video.mp4",
            "strategy": {"mode": "direct", "reason": "ok", "label": "直链下载"},
            "expires_hint": "soon",
            "warning": None,
        }

    monkeypatch.setattr(video.service, "get_direct_link", fake_link)
    response = client.post(
        "/api/video/download-link",
        json={"url": "https://example.com/video", "format_id": "18"},
    )
    body = response.json()
    assert response.status_code == 200
    assert body["success"] is True
    assert body["data"]["strategy"]["mode"] == "direct"
