import os
import tempfile
import time
from collections.abc import Iterator
from pathlib import Path

# Configure an isolated, credential-free environment BEFORE the app is imported.
_TMP = Path(tempfile.mkdtemp(prefix="astra-test-"))
os.environ.update(
    {
        "ASTRA_IGNORE_DOTENV": "1",
        "APP_ENV": "test",
        "DATA_DIR": str(_TMP),
        "EMBEDDING_PROVIDER": "mock",
        "LLM_PROVIDER": "mock",
        "STT_PROVIDER": "disabled",
        "TTS_PROVIDER": "disabled",
        "GEMINI_REVIEW_ENABLED": "false",
        "LOG_LEVEL": "WARNING",
    }
)
for key in ("OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY", "DATABASE_URL"):
    os.environ.pop(key, None)

import pymupdf  # noqa: E402
import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402


@pytest.fixture(scope="session")
def client() -> Iterator[TestClient]:
    with TestClient(app) as c:
        yield c


def make_pdf(pages: list[str]) -> bytes:
    doc = pymupdf.open()
    for text in pages:
        page = doc.new_page()
        page.insert_textbox(pymupdf.Rect(50, 50, 550, 800), text, fontsize=10)
    data = doc.tobytes()
    doc.close()
    return data


def make_scanned_pdf() -> bytes:
    doc = pymupdf.open()
    page = doc.new_page()
    pix = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 64, 64), False)
    pix.clear_with(200)
    page.insert_image(pymupdf.Rect(50, 50, 300, 300), pixmap=pix)
    data = doc.tobytes()
    doc.close()
    return data


def make_encrypted_pdf() -> bytes:
    doc = pymupdf.open()
    doc.new_page().insert_text((72, 72), "secret text " * 20)
    data = doc.tobytes(encryption=pymupdf.PDF_ENCRYPT_AES_256, user_pw="pw", owner_pw="owner")
    doc.close()
    return data


def upload(client: TestClient, name: str, data: bytes, mime: str = "application/pdf"):
    return client.post("/api/documents/upload", files={"file": (name, data, mime)})


def wait_terminal(client: TestClient, doc_id: str, timeout: float = 30) -> dict:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        body = client.get(f"/api/documents/{doc_id}/status").json()
        if body["status"] in ("READY", "FAILED"):
            return body
        time.sleep(0.05)
    raise AssertionError(f"document {doc_id} did not finish: {body}")
