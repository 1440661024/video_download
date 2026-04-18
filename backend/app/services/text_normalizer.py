from __future__ import annotations

from functools import lru_cache

try:
    from opencc import OpenCC
except ImportError:  # pragma: no cover - optional dependency fallback
    OpenCC = None  # type: ignore[assignment]


def prefers_simplified_chinese(preferred_language: str | None) -> bool:
    if not preferred_language:
        return True
    normalized = preferred_language.strip().lower()
    return normalized in {"zh", "zh-cn", "zh-hans", "zh-sg"}


@lru_cache(maxsize=1)
def _get_converter():
    if OpenCC is None:
        return None
    return OpenCC("t2s")


def normalize_text(text: str, preferred_language: str | None) -> str:
    if not text or not prefers_simplified_chinese(preferred_language):
        return text
    converter = _get_converter()
    if converter is None:
        return text
    return converter.convert(text)
