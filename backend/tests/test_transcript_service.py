from app.services.summary_cache import SummaryCacheStore
from app.services.transcript_models import TranscriptSegment
from app.services.transcript_service import TranscriptService


class FakeAsrService:
    def __init__(self):
        self.calls: list[tuple[str, str | None]] = []

    def transcribe_url(self, url: str, preferred_language: str | None):
        self.calls.append((url, preferred_language))
        return (
            [
                {
                    "start_seconds": 0,
                    "end_seconds": 5,
                    "text": "demo transcript segment " * 10,
                }
            ],
            preferred_language,
        )


def test_build_bundle_prefers_summary_media_url_for_asr(tmp_path):
    asr_service = FakeAsrService()
    cache_store = SummaryCacheStore(base_dir=tmp_path)
    service = TranscriptService(asr_service=asr_service, cache_store=cache_store)

    info = {
        "title": "Douyin Demo",
        "webpage_url": "https://www.douyin.com/video/demo",
        "_summary_media_url": "https://cdn.example.com/douyin.mp4",
        "subtitles": {},
        "automatic_captions": {},
    }

    bundle = service.build_bundle(info, "zh-CN", source_url="https://www.douyin.com/video/demo")

    assert bundle.source_type == "speech_to_text"
    assert asr_service.calls == [("https://cdn.example.com/douyin.mp4", "zh-CN")]
    assert bundle.segments[0].start_seconds == 0
    assert bundle.segments[0].end_seconds == 5
    assert bundle.segments[0].text.startswith("demo transcript segment")


def test_build_bundle_converts_traditional_to_simplified(tmp_path, monkeypatch):
    cache_store = SummaryCacheStore(base_dir=tmp_path)
    service = TranscriptService(cache_store=cache_store)

    monkeypatch.setattr(service, "_fetch_track", lambda url: "WEBVTT\n\n00:00:00.000 --> 00:00:02.000\n學習效率提升\n")

    info = {
        "subtitles": {
            "zh-TW": [
                {
                    "ext": "vtt",
                    "url": "https://example.com/demo.vtt",
                }
            ]
        },
        "automatic_captions": {},
    }

    bundle = service.build_bundle(info, "zh-CN")

    assert bundle.source_type == "human_subtitles"
    assert bundle.segments[0].text == "学习效率提升"
