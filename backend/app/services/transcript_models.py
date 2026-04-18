from __future__ import annotations

from dataclasses import dataclass


@dataclass
class TranscriptSegment:
    start_seconds: int | None
    text: str
    end_seconds: int | None = None


@dataclass
class TranscriptBundle:
    source_type: str
    language: str | None
    segments: list[TranscriptSegment]
    fallback_used: bool

    @property
    def segment_count(self) -> int:
        return len(self.segments)

    @property
    def character_count(self) -> int:
        return sum(len(segment.text) for segment in self.segments)
