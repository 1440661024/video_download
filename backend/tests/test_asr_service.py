from app.config import ASR_BEAM_SIZE
from app.services.asr_service import AudioTranscriptionService


def test_asr_service_uses_configured_beam_size():
    service = AudioTranscriptionService()
    assert service.beam_size == max(1, ASR_BEAM_SIZE)


def test_asr_service_builds_bilibili_referer():
    service = AudioTranscriptionService()

    headers = service._build_request_headers("https://www.bilibili.com/video/BV1mAAmzqEfP/")

    assert headers["Referer"] == "https://www.bilibili.com/"
    assert "Mozilla/5.0" in headers["User-Agent"]


def test_asr_service_builds_douyin_referer():
    service = AudioTranscriptionService()

    headers = service._build_request_headers("https://www.douyin.com/video/123456")

    assert headers["Referer"] == "https://www.douyin.com/"
