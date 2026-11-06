"""Conversational replies from a reviewed template bank. No model call, no retrieval.

Replies never claim anything about document *contents*: nudges are built from real document
state (names, processing step, failure reason) and suggested questions from real headings.
"""

import re
import zlib
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from functools import lru_cache
from pathlib import Path
from typing import Literal

import yaml
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.models import Chunk, Document, DocumentStatus
from app.services.intent import IntentResult

ReplyLang = Literal["en", "ur", "roman_ur"]
TEMPLATE_VERSION = "replies.v1"
_REPLIES = Path(__file__).resolve().parents[1] / "data" / "conversation" / "replies.yaml"
_MAX_SUGGESTIONS = 3
_FRONT_MATTER_PAGES = 5
_HEADING_SKIP = re.compile(
    r"^(chapter|part|section|contents|index|preface|page|table|list of|illustrations|"
    r"bibliography|acknowledg|foreword|appendix|abbreviations|errata|copyright)",
    re.I,
)
_LIST_NUMBER = re.compile(r"^[\dIVXivx]+[.)]?\s+")


@lru_cache
def templates() -> dict:
    return yaml.safe_load(_REPLIES.read_text(encoding="utf-8"))


@dataclass
class ConversationReply:
    text: str
    language: ReplyLang
    suggestions: list[str] = field(default_factory=list)


def reply_language(requested: str, script: str) -> ReplyLang:
    """Explicit selector wins; otherwise mirror the user's script (Roman Urdu stays Roman)."""
    if requested in ("en", "ur"):
        return requested  # type: ignore[return-value]
    return script if script in ("ur", "roman_ur") else "en"  # type: ignore[return-value]


def _pick(options: list[str], seed: str) -> str:
    # Deterministic per message, so tests and retries are reproducible.
    return options[zlib.crc32(seed.encode("utf-8")) % len(options)]


def _time_of_day(tz_offset_minutes: int | None) -> str:
    if tz_offset_minutes is None:
        return "any"
    hour = (datetime.now(UTC) + timedelta(minutes=tz_offset_minutes)).hour
    if 5 <= hour < 12:
        return "morning"
    if 12 <= hour < 17:
        return "afternoon"
    if 17 <= hour < 22:
        return "evening"
    return "any"


def _formats(settings: Settings) -> str:
    return ", ".join(e.lstrip(".").upper() for e in settings.allowed_extensions)


def opening(lang: ReplyLang, salam: bool, seed: str, tz_offset_minutes: int | None) -> str:
    t = templates()
    if salam:
        return _pick(t["salam_reply"][lang], seed)
    bank = t["greeting"][lang]
    tod = _time_of_day(tz_offset_minutes)
    options = bank["any"] + (bank[tod] if tod != "any" else [])
    return _pick(options, seed)


def capability_sheet(settings: Settings, lang: ReplyLang) -> str:
    """Built from live settings, so it never advertises a disabled feature."""
    c = templates()["capabilities"]
    lines = [c["docs"][lang].format(formats=_formats(settings)), c["languages"][lang]]
    if settings.ocr_enabled:
        lines.append(c["ocr_on"][lang].format(ocr_langs=settings.ocr_languages))
    else:
        lines.append(c["ocr_off"][lang])
    if settings.stt_provider != "disabled":
        lines.append(c["voice_in"][lang])
    if settings.tts_provider != "disabled":
        lines.append(c["voice_out"][lang])
    lines.append(c["limits_general" if settings.allow_general_knowledge else "limits"][lang])
    if settings.llm_provider == "mock":
        lines.append(c["mock"][lang])
    return c["intro"][lang] + "\n" + "\n".join(f"• {line}" for line in lines)


def _suggestions(db: Session, doc_ids: list[str], lang: ReplyLang) -> list[str]:
    if not doc_ids:
        return []
    rows = db.execute(
        select(Chunk.heading, Chunk.page_start)
        .where(Chunk.document_id.in_(doc_ids), Chunk.heading.is_not(None))
        .order_by(Chunk.document_id, Chunk.chunk_index)
        .limit(300)
    ).all()
    # Title and front-matter pages yield the book title and author name, which make poor
    # questions; use them only when the body has no usable headings.
    body = [h for h, page in rows if page is None or page > _FRONT_MATTER_PAGES]
    seen: list[str] = []
    for heading in body or [h for h, _ in rows]:
        h = _LIST_NUMBER.sub("", " ".join(str(heading).split()))
        if h.isupper():
            h = h.title()
        words = re.findall(r"[^\W\d_]{2,}", h)
        if 4 <= len(h) <= 60 and len(words) >= 2 and not _HEADING_SKIP.match(h) and h not in seen:
            seen.append(h)
        if len(seen) == _MAX_SUGGESTIONS:
            break
    template = templates()["suggestion_heading"][lang]
    return [template.format(heading=h) for h in seen]


def nudge(
    db: Session, settings: Settings, user_id: str, selected_ids: list[str], lang: ReplyLang
) -> tuple[list[str], list[str]]:
    """(sentences, suggested questions) describing what the user can do next."""
    t = templates()
    docs = list(db.scalars(select(Document).where(Document.user_id == user_id)))
    selected_ready = [d for d in docs if d.id in selected_ids and d.status == DocumentStatus.READY]
    ready = [d for d in docs if d.status == DocumentStatus.READY]
    processing = [d for d in docs if d.status not in (DocumentStatus.READY, DocumentStatus.FAILED)]
    failed = [d for d in docs if d.status == DocumentStatus.FAILED]

    sentences: list[str] = []
    suggestions: list[str] = []
    if selected_ready:
        titles = ", ".join(f"“{d.original_name}”" for d in selected_ready[:3])
        sentences.append(t["nudge_ready"][lang].format(titles=titles))
        suggestions = _suggestions(db, [d.id for d in selected_ready], lang)
        if suggestions:
            sentences.append(t["nudge_try"][lang])
    elif processing:
        d = processing[0]
        stage = t["stage_names"][lang].get(d.status, d.status)
        name = f"“{d.original_name}”"
        sentences.append(t["nudge_processing"][lang].format(name=name, stage=stage))
    elif ready:
        sentences.append(t["nudge_select"][lang].format(n=len(ready)))
    elif failed:
        d = failed[0]
        reason = (d.error_message or "").strip() or "—"
        sentences.append(t["nudge_failed"][lang].format(name=f"“{d.original_name}”", reason=reason))
    else:
        sentences.append(t["nudge_no_docs"][lang].format(formats=_formats(settings)))
    return sentences, suggestions


def conversational_reply(
    db: Session,
    settings: Settings,
    user_id: str,
    route: IntentResult,
    message: str,
    selected_ids: list[str],
    requested_language: str,
    tz_offset_minutes: int | None,
) -> ConversationReply:
    t = templates()
    topic = route.topic
    if route.intent == "LANG_SWITCH":
        target: ReplyLang = "ur" if topic == "LANG_UR" else "en"
        return ConversationReply(_pick(t["lang_switch"][target], message), target)

    lang = reply_language(requested_language, route.language)
    seed = message

    def with_nudge(first: list[str]) -> ConversationReply:
        sentences, suggestions = nudge(db, settings, user_id, selected_ids, lang)
        return ConversationReply(" ".join(first + sentences), lang, suggestions)

    if topic == "INJECTION" or route.intent == "UNSAFE":
        return ConversationReply(_pick(t["injection"][lang], seed), lang)
    if topic == "CAPABILITIES":
        return ConversationReply(capability_sheet(settings, lang), lang)
    if topic == "HOWTO":
        text = _pick(t["howto"][lang], seed).format(
            formats=_formats(settings), max_mb=settings.max_upload_mb
        )
        return ConversationReply(text, lang)
    if topic == "IDENTITY" or route.intent == "META":
        return with_nudge([_pick(t["identity"][lang], seed)])
    if route.intent == "THANKS":
        return ConversationReply(_pick(t["thanks"][lang], seed), lang)
    if route.intent == "FAREWELL":
        return ConversationReply(_pick(t["farewell"][lang], seed), lang)
    if route.intent == "SMALLTALK":
        first = [opening(lang, True, seed, None)] if route.salam else []
        return with_nudge([*first, _pick(t["smalltalk"][lang], seed)])
    if route.intent == "UNCLEAR":
        return ConversationReply(_pick(t["unclear"][lang], seed), lang, list(t["chips"][lang]))
    if route.intent == "GENERAL_KNOWLEDGE":
        return ConversationReply(_pick(t["general_knowledge"][lang], seed), lang)
    # GREETING (and any future conversational intent): greet + state-aware next step.
    return with_nudge([opening(lang, route.salam, seed, tz_offset_minutes)])


def needs_documents_reply(lang: ReplyLang, seed: str) -> str:
    return _pick(templates()["needs_documents"][lang], seed)
