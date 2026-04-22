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


def test_asr_service_builds_douyin_cdn_referer():
    service = AudioTranscriptionService()

    headers = service._build_request_headers("https://aweme.snssdk.com/aweme/v1/play/?video_id=demo")

    assert headers["Referer"] == "https://www.douyin.com/"


def test_asr_service_builds_douyinvod_referer_for_direct_download():
    service = AudioTranscriptionService()

    headers = service._build_download_headers("https://v95-bjb-mc-cold.douyinvod.com/demo.mp4")

    assert headers["Referer"] == "https://www.douyin.com/"


def test_asr_service_reuses_preview_download_for_full_transcription(tmp_path, monkeypatch):
    service = AudioTranscriptionService()
    download_calls: list[str] = []
    downloaded_paths: list[str] = []
    full_transcribe_paths: list[str] = []

    def fake_download(url: str):
        job_dir = tmp_path / f"job-{len(download_calls)}"
        job_dir.mkdir(parents=True, exist_ok=True)
        audio_path = job_dir / "audio.mp4"
        audio_path.write_bytes(b"0" * 4096)
        download_calls.append(url)
        downloaded_paths.append(str(audio_path))
        return audio_path

    monkeypatch.setattr(service, "_download_audio", fake_download)
    monkeypatch.setattr(
        service,
        "_transcribe_file",
        lambda **kwargs: (
            [{"start_seconds": 0, "end_seconds": 1, "text": "preview transcript"}],
            "zh",
        ),
    )
    monkeypatch.setattr(service, "_extract_preview_wav", lambda source_path, *, preview_seconds: source_path)

    service.transcribe_url_preview("https://example.com/video", "zh-CN")

    def fake_full_transcribe(*, audio_path, preferred_language):
        full_transcribe_paths.append(str(audio_path))
        return ([{"start_seconds": 0, "end_seconds": 1, "text": "full transcript"}], "zh")

    monkeypatch.setattr(service, "_transcribe_with_fallbacks", fake_full_transcribe)

    service.transcribe_url("https://example.com/video", "zh-CN")

    assert len(download_calls) == 1
    assert full_transcribe_paths == downloaded_paths
