from pathlib import Path


BASE_DIR = Path(__file__).resolve().parent.parent
TEMP_DOWNLOAD_DIR = BASE_DIR / "temp_downloads"
TEMP_DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)

MAX_DIRECT_LINK_SIZE = 500 * 1024 * 1024
FFMPEG_LOCATION = Path("C:/Dev/ffmpeg/bin")
