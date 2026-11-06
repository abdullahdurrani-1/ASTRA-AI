from fastapi import APIRouter, Depends, File, Response, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.errors import AppError
from app.core.security import current_user_id
from app.db.session import get_db
from app.models import TERMINAL_STATUSES, Document, DocumentStatus
from app.schemas import DocumentList, DocumentOut, DocumentStatusOut
from app.services import ingestion
from app.workers.executor import ingestion_executor

router = APIRouter(prefix="/documents", tags=["documents"])


@router.post("/upload", response_model=DocumentOut, status_code=202)
async def upload_document(
    response: Response,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user_id: str = Depends(current_user_id),
) -> Document:
    doc = await ingestion.store_upload(db, get_settings(), user_id, file)
    if doc.status == DocumentStatus.UPLOADED:
        ingestion_executor.submit(doc.id)
    else:
        response.status_code = 200  # identical file already uploaded
    return doc


@router.get("", response_model=DocumentList)
def list_documents(
    db: Session = Depends(get_db), user_id: str = Depends(current_user_id)
) -> DocumentList:
    docs = db.scalars(
        select(Document).where(Document.user_id == user_id).order_by(Document.created_at.desc())
    ).all()
    return DocumentList(documents=[DocumentOut.model_validate(d) for d in docs])


@router.get("/{document_id}", response_model=DocumentOut)
def get_document(
    document_id: str, db: Session = Depends(get_db), user_id: str = Depends(current_user_id)
) -> Document:
    return ingestion.get_user_document(db, user_id, document_id)


@router.get("/{document_id}/status", response_model=DocumentStatusOut)
def get_status(
    document_id: str, db: Session = Depends(get_db), user_id: str = Depends(current_user_id)
) -> DocumentStatusOut:
    d = ingestion.get_user_document(db, user_id, document_id)
    return DocumentStatusOut(
        id=d.id, status=d.status, error_message=d.error_message, chunk_count=d.chunk_count
    )


_MEDIA = {
    "pdf": "application/pdf",
    "txt": "text/plain; charset=utf-8",
    "md": "text/plain; charset=utf-8",
}


@router.get("/{document_id}/file")
def get_file(
    document_id: str, db: Session = Depends(get_db), user_id: str = Depends(current_user_id)
) -> FileResponse:
    """The original upload, for the in-app reader. Served inline, owner only."""
    doc = ingestion.get_user_document(db, user_id, document_id)
    path = get_settings().uploads_dir / doc.stored_name
    if not path.is_file():
        raise AppError(
            "The original file is no longer available.", code="not_found", status_code=404
        )
    headers = {"Content-Disposition": "inline", "X-Content-Type-Options": "nosniff"}
    if doc.file_type != "pdf":
        # Uploaded text must never run in the app's origin. (A sandbox CSP would stop the
        # browser's PDF viewer, and nosniff already prevents PDFs being treated as HTML.)
        headers["Content-Security-Policy"] = "sandbox; default-src 'none'"
    return FileResponse(
        path, media_type=_MEDIA.get(doc.file_type, "application/octet-stream"), headers=headers
    )


@router.post("/{document_id}/reindex", response_model=DocumentOut, status_code=202)
def reindex(
    document_id: str, db: Session = Depends(get_db), user_id: str = Depends(current_user_id)
) -> Document:
    """Retry a failed document, or re-index after changing the embedding model."""
    doc = ingestion.get_user_document(db, user_id, document_id)
    if doc.status not in TERMINAL_STATUSES:
        raise AppError("This document is already processing.", code="busy", status_code=409)
    doc.status, doc.error_message = DocumentStatus.UPLOADED, None
    db.commit()
    ingestion_executor.submit(doc.id)
    return doc


@router.delete("/{document_id}", status_code=204)
def delete(
    document_id: str, db: Session = Depends(get_db), user_id: str = Depends(current_user_id)
) -> Response:
    doc = ingestion.get_user_document(db, user_id, document_id)
    ingestion.delete_document(db, get_settings(), doc)
    return Response(status_code=204)
