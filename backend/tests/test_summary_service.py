from app.schemas_summary import VideoQuestionMessage
from app.services.summary_service import SummaryService, SummaryServiceError
from app.services.transcript_models import TranscriptBundle, TranscriptSegment


class FakeVideoService:
    def __init__(self, info):
        self._info = info

    def extract_info(self, url: str):
        return self._info


class FakeTranscriptService:
    def __init__(self, bundle: TranscriptBundle):
        self._bundle = bundle

    def build_bundle(self, info, preferred_language, source_url=None):
        return self._bundle


class FakeAIClient:
    def __init__(self, responses):
        self._responses = list(responses)

    def is_configured(self):
        return True

    def complete_json(self, *, system_prompt: str, user_prompt: str):
        return self._responses.pop(0)


def test_generate_summary_from_transcript():
    info = {
        "title": "Demo",
        "uploader": "Author",
        "duration": 600,
        "chapters": [{"title": "Introduction", "start_time": 0}],
    }
    bundle = TranscriptBundle(
        source_type="speech_to_text",
        language="zh",
        segments=[
            TranscriptSegment(start_seconds=0, end_seconds=12, text="First transcript segment " * 10),
            TranscriptSegment(start_seconds=90, end_seconds=102, text="Second transcript segment " * 10),
        ],
        fallback_used=True,
    )
    ai_client = FakeAIClient(
        [
            {"summary": "Chunk summary"},
            {
                "overview": "Overview text",
                "key_points": ["Point A", "Point B"],
                "chapter_summaries": [
                    {
                        "title": "Introduction",
                        "start_seconds": 0,
                        "start_human": "0:00",
                        "summary": "Chapter summary",
                    }
                ],
                "takeaways": ["Takeaway"],
                "mind_map_markdown": "# Demo\n- Point A\n  - Detail",
            },
        ]
    )
    service = SummaryService(
        video_service=FakeVideoService(info),
        transcript_service=FakeTranscriptService(bundle),
        ai_client=ai_client,
    )

    summary = service.generate_summary(
        url="https://example.com/video",
        focus_mode="study",
        preferred_language="zh-CN",
    )

    assert summary.video_title == "Demo"
    assert summary.summary_mode == "study"
    assert summary.source_text_status.source_type == "speech_to_text"
    assert summary.key_points == ["Point A", "Point B"]
    assert summary.mind_map_markdown.startswith("# Demo")
    assert len(summary.transcript_segments) == 2


def test_generate_summary_rejects_short_metadata():
    info = {"title": "Short", "description": "too short"}
    bundle = TranscriptBundle(
        source_type="metadata",
        language=None,
        segments=[TranscriptSegment(start_seconds=None, end_seconds=None, text="short text")],
        fallback_used=True,
    )
    service = SummaryService(
        video_service=FakeVideoService(info),
        transcript_service=FakeTranscriptService(bundle),
        ai_client=FakeAIClient([]),
    )

    try:
        service.generate_summary(
            url="https://example.com/video",
            focus_mode="overview",
            preferred_language="zh-CN",
        )
    except SummaryServiceError as exc:
        assert exc.code == "SUMMARY_NOT_SUPPORTED"
    else:
        raise AssertionError("expected SummaryServiceError")


def test_answer_question_from_transcript():
    info = {"title": "Demo", "uploader": "Author", "duration": 200}
    bundle = TranscriptBundle(
        source_type="speech_to_text",
        language="zh",
        segments=[
            TranscriptSegment(
                start_seconds=0,
                end_seconds=15,
                text=("The project uses OpenRouter and GitHub App. " * 4).strip(),
            ),
            TranscriptSegment(
                start_seconds=15,
                end_seconds=30,
                text=("It also uses Next.js and Prisma. " * 4).strip(),
            ),
        ],
        fallback_used=True,
    )
    service = SummaryService(
        video_service=FakeVideoService(info),
        transcript_service=FakeTranscriptService(bundle),
        ai_client=FakeAIClient([{"answer": "The project uses OpenRouter, GitHub App, Next.js, and Prisma."}]),
    )

    answer = service.answer_question(
        url="https://example.com/video",
        question="What stack is mentioned?",
        preferred_language="en",
        history=[VideoQuestionMessage(role="user", content="Summarize the stack.")],
        summary_context="Overview: The project uses OpenRouter, GitHub App, Next.js, and Prisma.",
    )

    assert "OpenRouter" in answer.answer
