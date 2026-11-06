from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

AnswerLanguage = Literal["auto", "en", "ur"]
AnswerStatus = Literal[
    "answered", "insufficient_evidence", "error", "conversational", "needs_documents", "general"
]


class HealthResponse(BaseModel):
    status: Literal["ok"]
    app_env: str
    mock_mode: bool
    providers: dict[str, str]
    voice: dict[str, bool]
    limits: dict[str, int | list[str]]
    features: dict[str, bool] = {}


class DocumentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    original_name: str
    file_type: str
    size_bytes: int
    status: str
    error_message: str | None
    warnings: list[str]
    page_count: int | None
    chunk_count: int
    created_at: datetime
    updated_at: datetime


class DocumentList(BaseModel):
    documents: list[DocumentOut]


class DocumentStatusOut(BaseModel):
    id: str
    status: str
    error_message: str | None
    chunk_count: int


class ChatRequest(BaseModel):
    question: str = Field(min_length=1, max_length=2000)
    # May be empty: greetings and "what can you do?" work before any document is selected.
    document_ids: list[str] = Field(default_factory=list, max_length=20)
    language: AnswerLanguage = "auto"
    conversation_id: str | None = None
    # Minutes ahead of UTC (browser: -new Date().getTimezoneOffset()); for time-of-day greetings.
    tz_offset_minutes: int | None = Field(default=None, ge=-840, le=840)


class Citation(BaseModel):
    chunk_id: str
    document_id: str
    document_name: str
    page_start: int | None
    page_end: int | None
    heading: str | None
    excerpt: str


class ChatResponse(BaseModel):
    conversation_id: str
    message_id: str
    answer: str
    status: AnswerStatus
    language: Literal["en", "ur"]
    citations: list[Citation]
    mock: bool = Field(description="True when the answer came from the mock LLM (dev/test mode).")
    intent: str = "DOC_QUESTION"
    intent_stage: Literal["lexicon", "classifier", "default"] = "default"
    detected_language: Literal["en", "ur", "roman_ur", "mixed"] = "en"
    suggestions: list[str] = []
    searched_question: str | None = None


class MessageOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    role: str
    content: str
    language: str
    status: str | None
    document_ids: list[str]
    citations: list[Citation]
    created_at: datetime


class ConversationSummary(BaseModel):
    id: str
    title: str
    created_at: datetime
    updated_at: datetime
    message_count: int


class ConversationList(BaseModel):
    conversations: list[ConversationSummary]


class ConversationOut(BaseModel):
    id: str
    created_at: datetime
    messages: list[MessageOut]


class TranscriptionOut(BaseModel):
    text: str
    language: str | None


class SynthesizeRequest(BaseModel):
    text: str = Field(min_length=1, max_length=4000)
    language: Literal["en", "ur"] = "en"
