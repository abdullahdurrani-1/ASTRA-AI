"""Text extraction with page metadata and quality gates. OCR is optional and off by default."""

import re
import unicodedata
from dataclasses import dataclass, field
from pathlib import Path

import pymupdf


class ExtractionError(Exception):
    """User-safe message describing why a file cannot be processed."""


@dataclass
class Page:
    number: int | None  # 1-based; None for formats without pages
    text: str


@dataclass
class ExtractionResult:
    pages: list[Page]
    page_count: int | None
    warnings: list[str] = field(default_factory=list)


_HYPHEN_BREAK = re.compile(r"(\w)-\n(\w)")
_MULTI_SPACE = re.compile(r"[ \t ]+")
_MULTI_BLANK = re.compile(r"\n{3,}")
_CONTROL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")


def clean_text(text: str) -> str:
    text = unicodedata.normalize("NFC", text)
    text = _CONTROL.sub("", text)
    text = _HYPHEN_BREAK.sub(r"\1\2", text)
    text = _MULTI_SPACE.sub(" ", text)
    text = "\n".join(line.strip() for line in text.splitlines())
    return _MULTI_BLANK.sub("\n\n", text).strip()


def _strip_repeated_lines(pages: list[Page]) -> None:
    """Remove running headers/footers: short lines that repeat on most pages."""
    if len(pages) < 4:
        return
    counts: dict[str, int] = {}
    for p in pages:
        lines = [ln for ln in p.text.splitlines() if ln.strip()]
        for ln in set(lines[:2] + lines[-2:]):
            if len(ln) <= 80:
                key = re.sub(r"\d+", "#", ln)
                counts[key] = counts.get(key, 0) + 1
    repeated = {k for k, c in counts.items() if c >= 0.6 * len(pages)}
    if not repeated:
        return
    for p in pages:
        p.text = "\n".join(
            ln for ln in p.text.splitlines() if re.sub(r"\d+", "#", ln) not in repeated
        ).strip()


@dataclass
class OcrOptions:
    """Tesseract OCR via PyMuPDF. Used only for image pages that have no text layer."""

    languages: str = "eng"
    dpi: int = 300
    tessdata: str | None = None


def _ocr_page(page: pymupdf.Page, ocr: OcrOptions) -> str:
    tp = page.get_textpage_ocr(
        language=ocr.languages, dpi=ocr.dpi, full=True, tessdata=ocr.tessdata
    )
    blocks = page.get_text("blocks", sort=True, textpage=tp)
    return "\n\n".join(b[4] for b in blocks if b[6] == 0)


def extract_pdf(
    path: Path, min_chars_per_page: int, ocr: OcrOptions | None = None
) -> ExtractionResult:
    try:
        doc = pymupdf.open(path)
    except Exception as e:
        raise ExtractionError("This PDF appears to be corrupt or is not a valid PDF.") from e
    with doc:
        if doc.needs_pass or doc.is_encrypted:
            raise ExtractionError("This PDF is password-protected. Remove the password and retry.")
        if doc.page_count == 0:
            raise ExtractionError("This PDF has no pages.")
        pages: list[Page] = []
        image_pages = ocr_pages = ocr_failures = 0
        try:
            for i in range(doc.page_count):
                page = doc[i]
                # Text blocks approximate paragraphs; blank lines between them help the chunker.
                blocks = page.get_text("blocks", sort=True)
                raw = "\n\n".join(b[4] for b in blocks if b[6] == 0)
                has_images = bool(page.get_images(full=False))
                image_pages += has_images
                if ocr and has_images and len(raw.strip()) < min_chars_per_page:
                    try:
                        raw = _ocr_page(page, ocr)
                        ocr_pages += 1
                    except RuntimeError:  # Tesseract missing or failed on this page
                        ocr_failures += 1
                        if ocr_failures == 3 and ocr_pages == 0:
                            raise ExtractionError(
                                "OCR is enabled but Tesseract could not run. Check that it is "
                                "installed and TESSDATA_DIR/OCR_LANGUAGES are correct."
                            ) from None
                pages.append(Page(number=i + 1, text=clean_text(raw)))
        except ExtractionError:
            raise
        except Exception as e:
            raise ExtractionError(
                "Text could not be read from this PDF (it may be damaged)."
            ) from e
        page_count = doc.page_count

    _strip_repeated_lines(pages)
    text_pages = [p for p in pages if len(p.text) >= min_chars_per_page]
    warnings: list[str] = []
    if not text_pages:
        if image_pages and not ocr:
            raise ExtractionError(
                "This PDF looks scanned (images without a text layer). OCR is not supported yet, "
                "so no text could be extracted."
            )
        if image_pages:
            raise ExtractionError("OCR ran but found no readable text in this scanned PDF.")
        raise ExtractionError("No readable text was found in this PDF.")
    if ocr_pages:
        warnings.append(
            f"{ocr_pages} of {page_count} pages were scanned images and were read with OCR "
            f"({ocr.languages if ocr else ''}). OCR text can contain recognition errors, so "
            "check quotes and numbers against the original."
        )
    low = page_count - len(text_pages)
    if low:
        note = "" if ocr else " No OCR was performed."
        warnings.append(
            f"{low} of {page_count} pages had little or no extractable text "
            f"(possibly blank, illustrations or unreadable scans); they were skipped.{note}"
        )
    if _looks_garbled("\n".join(p.text for p in text_pages)):
        warnings.append(
            "Extracted text quality looks poor (unusual characters). Answers may be less reliable."
        )
    return ExtractionResult(pages=text_pages, page_count=page_count, warnings=warnings)


def extract_text_file(path: Path) -> ExtractionResult:
    raw = path.read_bytes()
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError as e:
        raise ExtractionError("Text files must be UTF-8 encoded.") from e
    text = clean_text(text)
    if not text:
        raise ExtractionError("This file is empty.")
    return ExtractionResult(pages=[Page(number=None, text=text)], page_count=None)


def _looks_garbled(text: str) -> bool:
    sample = text[:20000]
    if not sample:
        return False
    bad = sum(1 for ch in sample if ch == "�" or unicodedata.category(ch) in ("Co", "Cs"))
    return bad / len(sample) > 0.05


def extract(
    path: Path, file_type: str, min_chars_per_page: int, ocr: OcrOptions | None = None
) -> ExtractionResult:
    if file_type == "pdf":
        return extract_pdf(path, min_chars_per_page, ocr)
    return extract_text_file(path)
