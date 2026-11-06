from fastapi import APIRouter

from app.core.config import get_settings
from app.schemas import HealthResponse

router = APIRouter(tags=["health"])


@router.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    s = get_settings()
    return HealthResponse(
        status="ok",
        app_env=s.app_env,
        mock_mode=s.mock_mode,
        providers={"embeddings": s.embedding_provider, "llm": s.llm_provider},
        voice={"stt": s.stt_provider != "disabled", "tts": s.tts_provider != "disabled"},
        limits={"max_upload_mb": s.max_upload_mb, "allowed_extensions": s.allowed_extensions},
        features={"ocr": s.ocr_enabled, "general_knowledge": s.allow_general_knowledge},
    )
