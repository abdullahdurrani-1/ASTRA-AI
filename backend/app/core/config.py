"""Application settings loaded from environment variables (and an optional .env file)."""

import os
from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field, SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parents[2]
REPO_DIR = BACKEND_DIR.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(REPO_DIR / ".env", BACKEND_DIR / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_env: Literal["development", "test", "production"] = "development"
    log_level: str = "INFO"
    cors_origins: list[str] = ["http://localhost:5173", "http://127.0.0.1:5173"]

    # Storage
    data_dir: Path = REPO_DIR / "data"
    database_url: str | None = None  # defaults to sqlite in data_dir
    local_user_id: str = "local"

    # Uploads
    max_upload_mb: int = Field(default=25, ge=1, le=500)
    allowed_extensions: list[str] = [".pdf", ".txt", ".md"]

    # Chunking
    chunk_target_chars: int = Field(default=1200, ge=200)
    chunk_overlap_chars: int = Field(default=150, ge=0)
    min_chars_per_page: int = Field(default=40, ge=1)

    # OCR for scanned PDFs (needs Tesseract installed). Off by default.
    ocr_enabled: bool = False
    ocr_languages: str = "eng"  # Tesseract codes joined by "+", e.g. "eng+urd"
    ocr_dpi: int = Field(default=300, ge=72, le=600)
    tessdata_dir: str | None = None  # e.g. C:/Program Files/Tesseract-OCR/tessdata

    # Embeddings: mock | openai | sentence_transformers
    embedding_provider: Literal["mock", "openai", "sentence_transformers"] = "mock"
    embedding_model: str = ""
    embedding_batch_size: int = 64

    # LLM: mock | anthropic | openai | gemini (gemini uses GEMINI_API_KEY)
    llm_provider: Literal["mock", "anthropic", "openai", "gemini"] = "mock"
    llm_model: str = ""  # legacy single-model setting; LLM_MODEL_ANSWER takes precedence
    # Model per role (IDs live in .env only, never in code).
    llm_model_answer: str = ""
    llm_model_router: str = ""
    llm_model_judge: str = ""
    llm_model_fallback: str = ""
    llm_max_tokens: int = 1024
    llm_temperature: float = 0.1
    llm_max_retries: int = Field(default=2, ge=0, le=5)
    # How much "thinking" reasoning models do before answering (openai/gemini providers).
    # Empty = provider default. Lower values cut latency sharply on Gemini 3.x models.
    llm_reasoning_effort: Literal["", "none", "minimal", "low", "medium", "high"] = ""

    # Conversational layer
    intent_classifier_enabled: bool = True  # stage 2; only runs with a real LLM + router model
    intent_classifier_timeout_seconds: float = 1.5
    intent_min_confidence: float = 0.7
    # Product decision (owner): answer general-knowledge questions with a "not from your
    # documents" label. Off by default.
    allow_general_knowledge: bool = False

    # Provider credentials (never logged)
    anthropic_api_key: SecretStr | None = None
    openai_api_key: SecretStr | None = None
    openai_base_url: str = "https://api.openai.com/v1"
    provider_timeout_seconds: float = 60.0

    # Retrieval / evidence
    retrieval_top_k: int = Field(default=6, ge=1, le=20)
    retrieval_candidates: int = Field(default=20, ge=1, le=100)
    min_vector_similarity: float = 0.45
    min_keyword_coverage: float = 0.6
    # Chunks shorter than this (running headers, page numbers) are skipped when longer ones exist.
    min_substantive_chunk_chars: int = Field(default=40, ge=0)

    # Voice: disabled | openai
    stt_provider: Literal["disabled", "openai"] = "disabled"
    tts_provider: Literal["disabled", "openai"] = "disabled"
    stt_model: str = ""
    tts_model: str = ""
    tts_voice: str = "alloy"
    max_audio_mb: int = Field(default=10, ge=1, le=50)

    # Optional Gemini code reviewer (dev tool, see backend/devtools)
    gemini_review_enabled: bool = False
    gemini_api_key: SecretStr | None = None
    gemini_model: str = ""

    @property
    def uploads_dir(self) -> Path:
        return self.data_dir / "uploads"

    @property
    def chroma_dir(self) -> Path:
        return self.data_dir / "chroma"

    @property
    def resolved_database_url(self) -> str:
        return self.database_url or f"sqlite:///{(self.data_dir / 'astra.db').as_posix()}"

    @property
    def max_upload_bytes(self) -> int:
        return self.max_upload_mb * 1024 * 1024

    @property
    def mock_mode(self) -> bool:
        return self.embedding_provider == "mock" or self.llm_provider == "mock"

    @property
    def answer_model(self) -> str:
        return self.llm_model_answer or self.llm_model

    @property
    def router_model(self) -> str:
        return self.llm_model_router

    @model_validator(mode="after")
    def _require_models_in_production(self) -> "Settings":
        if self.app_env == "production" and self.llm_provider != "mock":
            missing = [
                name
                for name, value in (
                    ("LLM_MODEL_ANSWER", self.answer_model),
                    ("LLM_MODEL_ROUTER", self.llm_model_router),
                )
                if not value
            ]
            if missing:
                raise ValueError(f"Production requires these settings: {', '.join(missing)}")
        return self


@lru_cache
def get_settings() -> Settings:
    # ASTRA_IGNORE_DOTENV=1 makes tests independent of a developer's local .env file.
    if os.environ.get("ASTRA_IGNORE_DOTENV") == "1":
        return Settings(_env_file=None)  # type: ignore[call-arg]
    return Settings()
