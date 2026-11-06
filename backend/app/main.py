import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import router as api_router
from app.core.config import get_settings
from app.core.errors import register_error_handlers
from app.core.logging import configure_logging
from app.db.session import init_db
from app.workers.executor import ingestion_executor

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    settings = get_settings()
    configure_logging(settings.log_level)
    settings.uploads_dir.mkdir(parents=True, exist_ok=True)
    init_db()
    ingestion_executor.start()
    logger.info("startup", extra={"env": settings.app_env, "mock_mode": settings.mock_mode})
    yield
    ingestion_executor.shutdown()


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title="Astra AI",
        description="Ask your documents. Understand them faster. See the evidence.",
        version="0.1.0",
        lifespan=lifespan,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=["GET", "POST", "DELETE"],
        allow_headers=["Content-Type"],
    )
    register_error_handlers(app)
    app.include_router(api_router, prefix="/api")
    return app


app = create_app()
