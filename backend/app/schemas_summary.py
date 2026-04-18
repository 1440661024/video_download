from typing import Literal

from pydantic import BaseModel, Field, HttpUrl


SummaryFocusMode = Literal["overview", "study", "analysis"]
SummarySourceType = Literal["human_subtitles", "auto_subtitles", "speech_to_text", "metadata"]


class VideoSummaryRequest(BaseModel):
    url: HttpUrl
    focus_mode: SummaryFocusMode = "overview"
    preferred_language: str | None = Field(default="zh-CN", max_length=32)


class VideoQuestionMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=4000)


class VideoQuestionRequest(BaseModel):
    url: HttpUrl
    question: str = Field(min_length=1, max_length=4000)
    preferred_language: str | None = Field(default="zh-CN", max_length=32)
    history: list[VideoQuestionMessage] = Field(default_factory=list, max_length=12)
    summary_context: str | None = Field(default=None, max_length=20000)


class VideoSummaryChapter(BaseModel):
    title: str
    start_seconds: int | None = None
    start_human: str | None = None
    summary: str


class VideoTranscriptSegment(BaseModel):
    start_seconds: int | None = None
    start_human: str | None = None
    end_seconds: int | None = None
    end_human: str | None = None
    text: str


class VideoSummarySourceStatus(BaseModel):
    source_type: SummarySourceType
    language: str | None = None
    segment_count: int
    character_count: int
    fallback_used: bool = False


class VideoSummaryResponse(BaseModel):
    video_title: str
    source_url: HttpUrl
    summary_mode: SummaryFocusMode
    overview: str
    key_points: list[str]
    chapter_summaries: list[VideoSummaryChapter]
    takeaways: list[str]
    transcript_segments: list[VideoTranscriptSegment]
    mind_map_markdown: str
    source_text_status: VideoSummarySourceStatus
    disclaimer: str


class VideoQuestionResponse(BaseModel):
    answer: str
