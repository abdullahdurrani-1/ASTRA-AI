"""Paragraph/heading-aware chunking that preserves page and heading metadata."""

import re
from dataclasses import dataclass

from app.services.extraction import Page

_MD_HEADING = re.compile(r"^#{1,6}\s+(.+)$")
# "1. Intro", "2.3 Methods", "IV. Results", "Chapter 3 ..." — but not "1990 was a good year".
_NUMBERED_HEADING = re.compile(
    r"^(?:\d{1,2}(?:\.\d{1,2})*\.?|[IVXLC]+\.|(?:Chapter|Section|Part)\s+\w+)\s+\S.{0,80}$",
    re.I,
)
_SENTENCE_SPLIT = re.compile(r"(?<=[.!?۔؟])\s+")


@dataclass
class ChunkData:
    index: int
    text: str
    page_start: int | None
    page_end: int | None
    heading: str | None


def _heading_of(line: str) -> str | None:
    line = line.strip()
    if not line or len(line) > 100:
        return None
    m = _MD_HEADING.match(line)
    if m:
        return m.group(1).strip()
    if line.endswith((".", ",", ";", ":")):
        return None
    if _NUMBERED_HEADING.match(line):
        return line
    letters = [c for c in line if c.isalpha()]
    if len(letters) >= 4 and line.isupper() and len(line.split()) <= 12:
        return line
    return None


def _paragraphs(text: str) -> list[tuple[str | None, str]]:
    """Split text into (heading, body) items. PDFs often put a heading in the same block as its
    body, so headings are detected line by line."""
    out: list[tuple[str | None, str]] = []
    for para in re.split(r"\n\s*\n", text):
        body: list[str] = []
        for line in para.splitlines():
            h = _heading_of(line)
            if h:
                if body:
                    out.append((None, " ".join(body)))
                    body = []
                out.append((h, h))  # keep the heading text searchable within its section
            elif line.strip():
                body.append(line.strip())
        if body:
            out.append((None, " ".join(body)))
    return out


def _split_long(paragraph: str, target: int) -> list[str]:
    if len(paragraph) <= target:
        return [paragraph]
    parts: list[str] = []
    buf = ""
    for sentence in _SENTENCE_SPLIT.split(paragraph):
        while len(sentence) > target:  # pathological sentence with no punctuation
            parts.append(sentence[:target])
            sentence = sentence[target:]
        if buf and len(buf) + len(sentence) + 1 > target:
            parts.append(buf)
            buf = sentence
        else:
            buf = f"{buf} {sentence}".strip()
    if buf:
        parts.append(buf)
    return parts


MIN_STANDALONE_CHARS = 80


def chunk_pages(pages: list[Page], target_chars: int, overlap_chars: int) -> list[ChunkData]:
    # Flatten into (paragraph, page, heading) units.
    units: list[tuple[str, int | None, str | None]] = []
    heading: str | None = None
    for page in pages:
        for h, body in _paragraphs(page.text):
            if h:
                heading = h[:300]
            for piece in _split_long(body, target_chars):
                units.append((piece, page.number, heading))

    chunks: list[ChunkData] = []
    buf: list[tuple[str, int | None, str | None]] = []

    def flush() -> None:
        if not buf:
            return
        # Page range comes from body units; a merged running header (a heading-only unit)
        # from the previous page must not pull page_start backwards.
        body = [u for u in buf if u[0] != u[2]] or buf
        nums = [p for _, p, _ in body if p is not None]
        chunks.append(
            ChunkData(
                index=len(chunks),
                text="\n\n".join(t for t, _, _ in buf),
                page_start=min(nums) if nums else None,
                page_end=max(nums) if nums else None,
                heading=buf[-1][2],
            )
        )

    size = 0
    for unit in units:
        # Start a new chunk on heading change so sections stay together, unless the buffer is
        # only a heading or a running header: those merge into the text that follows.
        heading_changed = bool(buf) and unit[2] != buf[-1][2] and size >= MIN_STANDALONE_CHARS
        if buf and (size + len(unit[0]) > target_chars or heading_changed):
            flush()
            tail = buf[-1]
            carry = overlap_chars > 0 and not heading_changed and len(tail[0]) <= overlap_chars
            buf = [tail] if carry else []
            size = len(tail[0]) if carry else 0
        buf.append(unit)
        size += len(unit[0])
    flush()
    return chunks
