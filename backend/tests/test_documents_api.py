from app.core.config import get_settings
from app.providers.embeddings import get_embedding_provider
from app.services import vector_store
from tests.conftest import make_pdf, make_scanned_pdf, upload, wait_terminal


def test_pdf_reaches_ready_only_after_index_verification(client):
    data = make_pdf(
        ["Photosynthesis converts light energy. " * 20, "Chlorophyll absorbs light. " * 20]
    )
    r = upload(client, "bio.pdf", data)
    assert r.status_code == 202
    doc_id = r.json()["id"]
    status = wait_terminal(client, doc_id)
    assert status["status"] == "READY", status
    assert status["chunk_count"] > 0

    s = get_settings()
    name = vector_store.index_name(get_embedding_provider(s))
    assert vector_store.count_for_document(s, name, doc_id) == status["chunk_count"]

    listed = client.get("/api/documents").json()["documents"]
    assert any(d["id"] == doc_id for d in listed)
    detail = client.get(f"/api/documents/{doc_id}").json()
    assert detail["page_count"] == 2
    assert "stored_name" not in detail and "sha256" not in detail  # no internal paths exposed


def test_duplicate_upload_returns_existing_document(client):
    data = make_pdf(["Unique duplicate test content. " * 20])
    first = upload(client, "dup.pdf", data).json()
    wait_terminal(client, first["id"])
    second = upload(client, "dup-again.pdf", data)
    assert second.status_code == 200
    assert second.json()["id"] == first["id"]


def test_scanned_pdf_fails_with_helpful_message(client):
    r = upload(client, "scan.pdf", make_scanned_pdf())
    status = wait_terminal(client, r.json()["id"])
    assert status["status"] == "FAILED"
    assert "OCR is not supported" in status["error_message"]
    assert status["chunk_count"] == 0


def test_upload_validation(client):
    assert upload(client, "x.exe", b"MZ...", "application/octet-stream").json()["error"][
        "code"
    ] == ("unsupported_type")
    assert upload(client, "empty.txt", b"", "text/plain").json()["error"]["code"] == "empty_file"
    fake = upload(client, "fake.pdf", b"not a pdf at all")
    assert fake.status_code == 400 and fake.json()["error"]["code"] == "invalid_file"
    # Path traversal in the filename is neutralised.
    r = upload(client, "../../evil.txt", b"hello world " * 10, "text/plain")
    assert r.status_code == 202 and r.json()["original_name"] == "evil.txt"
    wait_terminal(client, r.json()["id"])


def test_size_limit(client, monkeypatch):
    monkeypatch.setattr(get_settings(), "max_upload_mb", 1)
    r = upload(client, "big.txt", b"a" * (1024 * 1024 + 1), "text/plain")
    assert r.status_code == 413


def test_delete_removes_file_chunks_and_vectors(client):
    r = upload(client, "del.txt", b"Deletion target paragraph. " * 30, "text/plain")
    doc_id = r.json()["id"]
    assert wait_terminal(client, doc_id)["status"] == "READY"
    s = get_settings()
    name = vector_store.index_name(get_embedding_provider(s))
    files_before = set(s.uploads_dir.iterdir())

    assert client.delete(f"/api/documents/{doc_id}").status_code == 204
    assert client.get(f"/api/documents/{doc_id}").status_code == 404
    assert vector_store.count_for_document(s, name, doc_id) == 0
    assert len(set(s.uploads_dir.iterdir())) == len(files_before) - 1


def test_reindex_is_idempotent(client):
    r = upload(client, "re.txt", b"Reindex me please. " * 40, "text/plain")
    doc_id = r.json()["id"]
    first = wait_terminal(client, doc_id)
    assert client.post(f"/api/documents/{doc_id}/reindex").status_code == 202
    second = wait_terminal(client, doc_id)
    assert second["status"] == "READY" and second["chunk_count"] == first["chunk_count"]
    s = get_settings()
    name = vector_store.index_name(get_embedding_provider(s))
    assert vector_store.count_for_document(s, name, doc_id) == first["chunk_count"]
