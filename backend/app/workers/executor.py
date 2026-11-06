"""Minimal background worker for the MVP.

One worker thread processes documents in order so the request handler returns immediately.
On startup, documents left mid-pipeline by a crash/restart are re-queued (the job is idempotent).
Upgrade path: replace with RQ/Celery + Redis and enqueue `run_ingestion(document_id)` there.
"""

import logging
from concurrent.futures import Future, ThreadPoolExecutor

from sqlalchemy import select

from app.core.config import get_settings
from app.db.session import SessionLocal
from app.models import TERMINAL_STATUSES, Document
from app.services.ingestion import run_ingestion

logger = logging.getLogger(__name__)


class IngestionExecutor:
    def __init__(self) -> None:
        self._pool: ThreadPoolExecutor | None = None

    def start(self) -> None:
        if self._pool is None:
            self._pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="ingest")
        with SessionLocal() as db:
            pending = db.scalars(
                select(Document.id).where(
                    Document.status.not_in([s.value for s in TERMINAL_STATUSES])
                )
            ).all()
        for doc_id in pending:
            logger.info("requeue_interrupted", extra={"document_id": doc_id})
            self.submit(doc_id)

    def submit(self, document_id: str) -> Future[None]:
        if self._pool is None:
            self.start()
        assert self._pool is not None
        return self._pool.submit(run_ingestion, document_id, get_settings())

    def shutdown(self) -> None:
        if self._pool is not None:
            self._pool.shutdown(wait=True, cancel_futures=True)
            self._pool = None


ingestion_executor = IngestionExecutor()
