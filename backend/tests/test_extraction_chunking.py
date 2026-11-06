from pathlib import Path

import pytest

from app.services.chunking import chunk_pages
from app.services.extraction import (
    ExtractionError,
    Page,
    clean_text,
    extract_pdf,
    extract_text_file,
)
from tests.conftest import make_encrypted_pdf, make_pdf, make_scanned_pdf


def _write(tmp_path: Path, name: str, data: bytes) -> Path:
    p = tmp_path / name
    p.write_bytes(data)
    return p


def test_pdf_extraction_preserves_page_numbers(tmp_path):
    path = _write(tmp_path, "a.pdf", make_pdf(["Alpha page text " * 10, "Beta page text " * 10]))
    res = extract_pdf(path, min_chars_per_page=40)
    assert [p.number for p in res.pages] == [1, 2]
    assert "Alpha" in res.pages[0].text and "Beta" in res.pages[1].text
    assert res.page_count == 2


def test_partially_blank_pdf_warns(tmp_path):
    path = _write(tmp_path, "a.pdf", make_pdf(["Real content here " * 10, ""]))
    res = extract_pdf(path, min_chars_per_page=40)
    assert len(res.pages) == 1
    assert any("No OCR" in w for w in res.warnings)


@pytest.mark.parametrize(
    ("data", "message"),
    [
        (make_encrypted_pdf(), "password"),
        (make_scanned_pdf(), "scanned"),
        (make_pdf([""]), "No readable text"),
        (b"%PDF-1.7\n garbage", "corrupt"),
    ],
    ids=["encrypted", "scanned", "empty", "corrupt"],  # byte IDs exceed Windows env-var limits
)
def test_bad_pdfs_raise_helpful_errors(tmp_path, data, message):
    path = _write(tmp_path, "bad.pdf", data)
    with pytest.raises(ExtractionError, match=message):
        extract_pdf(path, min_chars_per_page=40)


def test_text_file_must_be_utf8_and_non_empty(tmp_path):
    with pytest.raises(ExtractionError, match="UTF-8"):
        extract_text_file(_write(tmp_path, "a.txt", "café".encode("latin-1")))
    with pytest.raises(ExtractionError, match="empty"):
        extract_text_file(_write(tmp_path, "b.txt", b"   \n "))


def test_clean_text_joins_hyphenation_and_keeps_urdu():
    assert clean_text("infor-\nmation  here") == "information here"
    assert clean_text("یہ ایک   جملہ ہے") == "یہ ایک جملہ ہے"


def test_chunks_keep_page_heading_and_order():
    pages = [
        Page(1, "# Introduction\n\n" + "Intro sentence one. " * 20),
        Page(2, "# Methods\n\n" + "Method detail. " * 120),
    ]
    chunks = chunk_pages(pages, target_chars=500, overlap_chars=0)
    assert [c.index for c in chunks] == list(range(len(chunks)))
    assert chunks[0].heading == "Introduction" and chunks[0].page_start == 1
    methods = [c for c in chunks if c.heading == "Methods"]
    assert len(methods) >= 3
    assert all(c.page_start == c.page_end == 2 for c in methods)
    assert all(len(c.text) <= 520 for c in chunks)
    # No chunk mixes the two sections.
    assert not any("Intro sentence" in c.text and "Method detail" in c.text for c in chunks)


def test_text_without_pages_has_null_page_metadata():
    chunks = chunk_pages([Page(None, "Hello world. " * 10)], 1000, 100)
    assert chunks[0].page_start is None and chunks[0].page_end is None


_TESSDATA = Path("C:/Program Files/Tesseract-OCR/tessdata")


@pytest.mark.skipif(not (_TESSDATA / "eng.traineddata").exists(), reason="Tesseract not installed")
def test_ocr_reads_image_only_pages(tmp_path):
    import pymupdf

    from app.services.extraction import OcrOptions

    src = pymupdf.open()
    src.new_page().insert_textbox(
        pymupdf.Rect(50, 50, 550, 300), "The treaty was signed in 1757 at Delhi. " * 4, fontsize=14
    )
    pix = src[0].get_pixmap(dpi=200)
    scanned = pymupdf.open()
    scanned.new_page().insert_image(scanned[0].rect, pixmap=pix)
    path = _write(tmp_path, "scan.pdf", scanned.tobytes())

    with pytest.raises(ExtractionError, match="OCR is not supported"):
        extract_pdf(path, 40)  # OCR off by default
    res = extract_pdf(path, 40, OcrOptions("eng", 300, str(_TESSDATA)))
    assert "treaty" in res.pages[0].text and "1757" in res.pages[0].text
    assert res.pages[0].number == 1
    assert any("read with OCR" in w for w in res.warnings)


def test_running_headers_merge_into_following_text():
    from app.services.chunking import Page, chunk_pages

    pages = [
        Page(
            1,
            "AHMAD SHAH\n\nAhmad Khan was the second son of Zaman Khan Abdali, born in 1722.",
        ),
        Page(
            2,
            "AHMAD SHAH\n\nHe founded the Durrani Empire after being elected at Qandahar in 1747.",
        ),
    ]
    chunks = chunk_pages(pages, target_chars=1200, overlap_chars=0)
    assert all(len(c.text) > 40 for c in chunks), [c.text for c in chunks]
    assert any("Zaman Khan" in c.text for c in chunks)
