from app.services.video_service import DouyinResolver, VideoService


def test_extract_video_id_from_share_path():
    resolver = DouyinResolver()
    video_id = resolver._extract_video_id("https://www.iesdouyin.com/share/video/7628224063790296489/")
    assert video_id == "7628224063790296489"


def test_extract_video_id_from_modal_id_query():
    resolver = DouyinResolver()
    video_id = resolver._extract_video_id("https://www.douyin.com/?modal_id=7628224063790296489")
    assert video_id == "7628224063790296489"


def test_select_download_url_removes_watermark_marker():
    resolver = DouyinResolver()
    download_url = resolver._select_download_url(
        {
            "video": {
                "play_addr": {
                    "url_list": [
                        "https://aweme.snssdk.com/aweme/v1/playwm/?video_id=demo123&ratio=720p"
                    ]
                }
            }
        }
    )
    assert "playwm" not in download_url
    assert "play/?" in download_url


def test_normalize_bilibili_video_url_adds_www_and_trailing_slash():
    service = VideoService()
    normalized = service._normalize_source_url("https://bilibili.com/video/BV1mAAmzqEfP")
    assert normalized == "https://www.bilibili.com/video/BV1mAAmzqEfP/"


def test_save_cached_info_registers_webpage_url_alias():
    service = VideoService()
    service._info_cache.clear()

    requested_url = "https://v.douyin.com/demo/"
    webpage_url = "https://www.iesdouyin.com/share/video/123456/"
    info = {"title": "Demo", "webpage_url": webpage_url}

    service._save_cached_info(requested_url, info)

    assert service._load_cached_info(requested_url) == info
    assert service._load_cached_info(webpage_url) == info
