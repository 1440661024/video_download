import os
import shutil
from pathlib import Path


def _load_env_file(env_path: Path) -> None:
    if not env_path.exists():
        return
    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


def _read_float(name: str, default: float) -> float:
    value = os.getenv(name)
    if value is None:
        return default
    try:
        return float(value)
    except ValueError:
        return default


def _read_int(name: str, default: int) -> int:
    value = os.getenv(name)
    if value is None:
        return default
    try:
        return int(value)
    except ValueError:
        return default


def _read_list(name: str, default: list[str]) -> list[str]:
    raw = os.getenv(name)
    if raw is None:
        return default
    values = [item.strip() for item in raw.replace("\n", ",").split(",")]
    normalized = [item for item in values if item]
    return normalized or default


BASE_DIR = Path(__file__).resolve().parent.parent
_load_env_file(BASE_DIR / ".env")
DATA_DIR = BASE_DIR / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)
APP_ENV = os.getenv("APP_ENV", "development").strip().lower()
DATABASE_URL = os.getenv(
    "DATABASE_URL",
    f"sqlite:///{(DATA_DIR / 'app.db').as_posix()}",
)
JWT_SECRET = os.getenv("JWT_SECRET", "dev-insecure-change-me").strip()
JWT_ALGORITHM = "HS256"
JWT_EXPIRE_MINUTES = _read_int("JWT_EXPIRE_MINUTES", 60 * 24 * 7)

STRIPE_SECRET_KEY = os.getenv("STRIPE_SECRET_KEY", "").strip() or None
STRIPE_WEBHOOK_SECRET = os.getenv("STRIPE_WEBHOOK_SECRET", "").strip() or None
STRIPE_PRICE_ID = os.getenv("STRIPE_PRICE_ID", "").strip() or None
STRIPE_MEMBERSHIP_CNY_MINOR_UNITS = _read_int(
    "STRIPE_MEMBERSHIP_CNY_MINOR_UNITS", 990
)  # 9.90 CNY = 990 分

FRONTEND_BASE_URL = os.getenv("FRONTEND_BASE_URL", "http://localhost:5173").rstrip("/")
BACKEND_CORS_ORIGINS = _read_list(
    "BACKEND_CORS_ORIGINS",
    ["http://localhost:5173", "http://127.0.0.1:5173"],
)
AI_MEMBERSHIP_DAYS = _read_int("AI_MEMBERSHIP_DAYS", 30)
COOKIE_SECURE = os.getenv("COOKIE_SECURE", "false").strip().lower() in ("1", "true", "yes")

TEMP_DOWNLOAD_DIR = BASE_DIR / "temp_downloads"
TEMP_SUMMARY_DIR = BASE_DIR / "temp_summary"
TEMP_DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)
TEMP_SUMMARY_DIR.mkdir(parents=True, exist_ok=True)

MAX_DIRECT_LINK_SIZE = 500 * 1024 * 1024
FFMPEG_LOCATION = os.getenv("FFMPEG_LOCATION", "").strip() or None

AI_API_KEY = os.getenv("AI_API_KEY", "").strip() or None
AI_API_BASE_URL = os.getenv("AI_API_BASE_URL", "https://api.openai.com/v1").rstrip("/")
AI_MODEL = os.getenv("AI_MODEL", "gpt-4o-mini").strip() or "gpt-4o-mini"
AI_TIMEOUT_SECONDS = _read_float("AI_TIMEOUT_SECONDS", 60.0)
AI_MAX_RETRIES = _read_int("AI_MAX_RETRIES", 2)

ASR_MODEL_SIZE = os.getenv("ASR_MODEL_SIZE", "small")
ASR_DEVICE = os.getenv("ASR_DEVICE", "cpu")
ASR_COMPUTE_TYPE = os.getenv("ASR_COMPUTE_TYPE", "int8")
ASR_BEAM_SIZE = _read_int("ASR_BEAM_SIZE", 1)


def resolve_ffmpeg_location() -> str | None:
    if FFMPEG_LOCATION:
        return FFMPEG_LOCATION
    return shutil.which("ffmpeg")


def resolve_ffmpeg_executable() -> Path | None:
    raw_location = resolve_ffmpeg_location()
    if not raw_location:
        return None

    candidate = Path(raw_location)
    if candidate.is_dir():
        binary_name = "ffmpeg.exe" if os.name == "nt" else "ffmpeg"
        candidate = candidate / binary_name

    if candidate.exists():
        return candidate

    resolved = shutil.which(raw_location)
    return Path(resolved) if resolved else None
