"""Upload storage and the idempotent ingestion pipeline."""

import hashlib
import logging
import secrets
import time
from pathlib import Path

from fastapi import UploadFile
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.errors import AppError, NotFoundError
from app.db.session import SessionLocal
from app.models import TERMINAL_STATUSES, Chunk, Document, DocumentStatus
from app.providers.embeddings import get_embedding_provider
from app.services import vector_store
from app.services.chunking import chunk_pages
from app.services.extraction import ExtractionError, OcrOptions, extract

logger = logging.getLogger(__name__)

_READ_BLOCK = 1024 * 1024


def _validate_content(head: bytes, file_type: str) -> None:
    if file_type == "pdf":
        if not head.lstrip()[:5] == b"%PDF-":
            raise AppError("This file is not a valid PDF.", code="invalid_file")
    elif b"\x00" in head:
        raise AppError("This does not look like a plain text file.", code="invalid_file")


async def store_upload(
    db: Session, settings: Settings, user_id: str, upload: UploadFile
) -> Document:
    original = Path(upload.filename or "").name.strip()
    ext = Path(original).suffix.lower()
    if not original or ext not in settings.allowed_extensions:
        allowed = ", ".join(settings.allowed_extensions)
        raise AppError(f"Unsupported file type. Allowed: {allowed}.", code="unsupported_type")

    settings.uploads_dir.mkdir(parents=True, exist_ok=True)
    stored_name = f"{secrets.token_hex(16)}{ext}"
    dest = settings.uploads_dir / stored_name
    sha = hashlib.sha256()
    size = 0
    head = b""
    try:
        with dest.open("wb") as out:
            while block := await upload.read(_READ_BLOCK):
                size += len(block)
                if size > settings.max_upload_bytes:
                    raise AppError(
                        f"File is larger than the {settings.max_upload_mb} MB limit.",
                        code="file_too_large",
                        status_code=413,
                    )
                if len(head) < 1024:
                    head += block[: 1024 - len(head)]
                sha.update(block)
                out.write(block)
        if size == 0:
            raise AppError("The uploaded file is empty.", code="empty_file")
        _validate_content(head, ext.lstrip("."))
    except Exception:
        dest.unlink(missing_ok=True)
        raise

    digest = sha.hexdigest()
    existing = db.scalars(
        select(Document).where(
            Document.user_id == user_id,
            Document.sha256 == digest,
            Document.status != DocumentStatus.FAILED,
        )
    ).first()
    if existing:
        dest.unlink(missing_ok=True)
        return existing

    doc = Document(
        user_id=user_id,
        original_name=original[:255],
        stored_name=stored_name,
        file_type=ext.lstrip("."),
        size_bytes=size,
        sha256=digest,
        status=DocumentStatus.UPLOADED,
        warnings=[],
    )
    db.add(doc)
    db.commit()
    logger.info("document_uploaded", extra={"document_id": doc.id, "size": size, "type": ext})
    return doc


def _set_status(db: Session, doc: Document, status: DocumentStatus) -> None:
    doc.status = status
    db.commit()


def run_ingestion(document_id: str, settings: Settings) -> None:
    """Idempotent job: safe to re-run; always clears previous chunks/vectors first."""
    db = SessionLocal()
    started = time.perf_counter()
    try:
        doc = db.get(Document, document_id)
        if doc is None:
            return
        provider = get_embedding_provider(settings)
        name = vector_store.index_name(provider)
        if doc.index_name and doc.index_name != name:
            vector_store.delete_document(settings, doc.index_name, doc.id)
        vector_store.delete_document(settings, name, doc.id)
        db.execute(delete(Chunk).where(Chunk.document_id == doc.id))
        doc.error_message, doc.chunk_count, doc.index_name = None, 0, name
        doc.warnings = []

        _set_status(db, doc, DocumentStatus.EXTRACTING)
        ocr = (
            OcrOptions(settings.ocr_languages, settings.ocr_dpi, settings.tessdata_dir)
            if settings.ocr_enabled
            else None
        )
        result = extract(
            settings.uploads_dir / doc.stored_name, doc.file_type, settings.min_chars_per_page, ocr
        )
        doc.page_count = result.page_count
        doc.warnings = result.warnings

        _set_status(db, doc, DocumentStatus.CHUNKING)
        chunks = chunk_pages(
            result.pages, settings.chunk_target_chars, settings.chunk_overlap_chars
        )
        if not chunks:
            raise ExtractionError("No usable text passages were found in this document.")
        rows = [
            Chunk(
                id=f"{doc.id}-{c.index}",
                document_id=doc.id,
                user_id=doc.user_id,
                chunk_index=c.index,
                page_start=c.page_start,
                page_end=c.page_end,
                heading=c.heading,
                text=c.text,
            )
            for c in chunks
        ]
        db.add_all(rows)
        db.flush()

        _set_status(db, doc, DocumentStatus.EMBEDDING)
        vectors: list[list[float]] = []
        bs = settings.embedding_batch_size
        for i in range(0, len(rows), bs):
            vectors.extend(provider.embed([r.text for r in rows[i : i + bs]]))
        if len(vectors) != len(rows):
            raise AppError("Embedding provider returned an unexpected number of vectors.")

        _set_status(db, doc, DocumentStatus.INDEXING)
        vector_store.upsert(
            settings,
            name,
            ids=[r.id for r in rows],
            embeddings=vectors,
            metadatas=[
                {"document_id": doc.id, "user_id": doc.user_id, "chunk_index": r.chunk_index}
                for r in rows
            ],
        )

        _set_status(db, doc, DocumentStatus.VERIFYING)
        indexed = vector_store.count_for_document(settings, name, doc.id)
        if indexed != len(rows):
            raise AppError(f"Index verification failed ({indexed}/{len(rows)} passages indexed).")
        doc.chunk_count = len(rows)
        _set_status(db, doc, DocumentStatus.READY)
        logger.info(
            "document_ready",
            extra={
                "document_id": doc.id,
                "chunks": len(rows),
                "pages": doc.page_count,
                "ms": round((time.perf_counter() - started) * 1000),
            },
        )
    except Exception as e:
        db.rollback()
        user_msg = (
            str(e)
            if isinstance(e, ExtractionError)
            else e.message
            if isinstance(e, AppError)
            else "Processing failed unexpectedly. Please retry."
        )
        logger.warning(
            "document_failed",
            extra={"document_id": document_id, "error_type": type(e).__name__},
            exc_info=not isinstance(e, ExtractionError | AppError),
        )
        doc = db.get(Document, document_id)
        if doc is not None:
            _cleanup_index(db, settings, doc)
            doc.status, doc.error_message, doc.chunk_count = DocumentStatus.FAILED, user_msg, 0
            db.commit()
    finally:
        db.close()


def _cleanup_index(db: Session, settings: Settings, doc: Document) -> None:
    db.execute(delete(Chunk).where(Chunk.document_id == doc.id))
    if doc.index_name:
        try:
            vector_store.delete_document(settings, doc.index_name, doc.id)
        except Exception:
            logger.exception("vector_cleanup_failed", extra={"document_id": doc.id})


def get_user_document(db: Session, user_id: str, document_id: str) -> Document:
    doc = db.get(Document, document_id)
    if doc is None or doc.user_id != user_id:
        raise NotFoundError("Document not found.")
    return doc


def delete_document(db: Session, settings: Settings, doc: Document) -> None:
    if doc.status not in TERMINAL_STATUSES:
        raise AppError(
            "This document is still processing. Try again when it finishes.",
            code="busy",
            status_code=409,
        )
    if doc.index_name:
        vector_store.delete_document(settings, doc.index_name, doc.id)
    stored = settings.uploads_dir / doc.stored_name
    db.delete(doc)  # cascades to chunks
    db.commit()
    stored.unlink(missing_ok=True)
    logger.info("document_deleted", extra={"document_id": doc.id})
