"""Hybrid retrieval (vector + BM25 keyword) scoped to the user's selected documents."""

import math
import re
from collections import Counter
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.models import Chunk
from app.providers.embeddings import EmbeddingProvider
from app.services import vector_store

_WORD = re.compile(r"\w+", re.UNICODE)
_STOPWORDS_TEXT = (
    "a an and are as at be by can could did do does for from had has have how i in is it its "
    "me my of on or please tell that the their them there these this to was were what when where "
    "which who whom why will with would you your about explain describe document according "
    "کا کی کے کو میں سے نے ہے ہیں تھا تھی تھے اور یا کیا کیوں کون کب کہاں کیسے یہ وہ ایک "
    "پر بھی تو ہو ہوا ہوئی گیا گئی جو کس کسی بتائیں بتاؤ"
)
STOPWORDS = frozenset(_STOPWORDS_TEXT.split())  # noqa: SIM905


def terms(text: str) -> list[str]:
    return [w for w in _WORD.findall(text.casefold()) if w not in STOPWORDS and len(w) > 1]


@dataclass
class Candidate:
    chunk: Chunk
    vector_similarity: float = 0.0
    keyword_coverage: float = 0.0
    score: float = 0.0


@dataclass
class RetrievalResult:
    candidates: list[Candidate]
    best_similarity: float
    best_coverage: float


def _bm25(query: list[str], docs: list[list[str]], k1: float = 1.5, b: float = 0.75) -> list[float]:
    n = len(docs)
    avgdl = sum(len(d) for d in docs) / n if n else 0.0
    df = Counter(t for d in docs for t in set(d))
    scores = []
    for d in docs:
        tf = Counter(d)
        s = 0.0
        for t in set(query):
            if t not in tf:
                continue
            idf = math.log(1 + (n - df[t] + 0.5) / (df[t] + 0.5))
            s += idf * tf[t] * (k1 + 1) / (tf[t] + k1 * (1 - b + b * len(d) / (avgdl or 1)))
        scores.append(s)
    return scores


_SENTENCE_PUNCT = re.compile(r"[.!?۔؟:;,]")


def _looks_like_header(text: str) -> bool:
    """Running headers and page titles: short, no sentence punctuation, mostly upper-case."""
    t = " ".join(text.split())
    letters = [ch for ch in t if ch.isalpha()]
    if not letters or _SENTENCE_PUNCT.search(t):
        return False
    upper = sum(ch.isupper() for ch in letters) / len(letters)
    return upper >= 0.6 or len(t.split()) <= 2


def retrieve(
    db: Session,
    settings: Settings,
    provider: EmbeddingProvider,
    user_id: str,
    document_ids: list[str],
    question: str,
    extra_queries: list[str] | None = None,
) -> RetrievalResult:
    """`extra_queries` are alternative phrasings of the same question (e.g. an English translation
    of an Urdu question); hits from every phrasing are fused with reciprocal-rank fusion."""
    name = vector_store.index_name(provider)
    k = settings.retrieval_candidates
    queries = [question] + [q for q in (extra_queries or []) if q and q != question]

    vectors = provider.embed(queries)
    hit_lists = [vector_store.query(settings, name, v, user_id, document_ids, k) for v in vectors]

    # Keyword search runs over the selected documents only (MVP scale: in-memory BM25).
    chunks = db.scalars(
        select(Chunk).where(Chunk.user_id == user_id, Chunk.document_id.in_(document_ids))
    ).all()
    by_id = {c.id: c for c in chunks}
    tokenized = [set(terms(c.text)) for c in chunks]
    doc_terms = [list(t) for t in tokenized]
    per_query_terms = [terms(q) for q in queries]
    keyword_lists: list[list[int]] = []
    for q_terms in per_query_terms:
        if not q_terms:
            continue
        bm25 = _bm25(q_terms, doc_terms)
        keyword_lists.append(
            sorted((i for i, s in enumerate(bm25) if s > 0), key=lambda i: bm25[i], reverse=True)[
                :k
            ]
        )

    cands: dict[str, Candidate] = {}
    rrf_k = 60
    for hits in hit_lists:
        for rank, hit in enumerate(hits):
            chunk = by_id.get(hit.chunk_id)
            if chunk is None:  # stale vector; never cite it
                continue
            c = cands.setdefault(chunk.id, Candidate(chunk))
            c.vector_similarity = max(c.vector_similarity, hit.similarity)
            c.score += 1 / (rrf_k + rank + 1)
    for ranked_ids in keyword_lists:
        for rank, i in enumerate(ranked_ids):
            c = cands.setdefault(chunks[i].id, Candidate(chunks[i]))
            c.score += 1 / (rrf_k + rank + 1)

    # Coverage is the best over phrasings: an Urdu question scores against its English form too.
    for c in cands.values():
        chunk_terms = set(terms(c.chunk.text))
        for q_terms in per_query_terms:
            unique_q = set(q_terms)
            if unique_q:
                cov = len(unique_q & chunk_terms) / len(unique_q)
                c.keyword_coverage = max(c.keyword_coverage, cov)

    # Running headers and OCR fragments ("AHMAD SHAH", "Chapter IV") match names perfectly but
    # carry no information; keep them only if nothing substantive was found.
    ordered = sorted(cands.values(), key=lambda c: c.score, reverse=True)
    seen_text: set[str] = set()
    substantive: list[Candidate] = []
    for c in ordered:
        key = " ".join(c.chunk.text.split()).casefold()
        if key in seen_text or (
            len(key) < settings.min_substantive_chunk_chars
            and _looks_like_header(c.chunk.text)
            and c.vector_similarity < settings.min_vector_similarity
        ):
            continue
        seen_text.add(key)
        substantive.append(c)
    ranked = (substantive or ordered)[: settings.retrieval_top_k]
    return RetrievalResult(
        candidates=ranked,
        best_similarity=max((c.vector_similarity for c in ranked), default=0.0),
        best_coverage=max((c.keyword_coverage for c in ranked), default=0.0),
    )


def evidence_is_sufficient(result: RetrievalResult, settings: Settings) -> bool:
    """Independent relevance gate, so we do not rely only on the LLM saying "I don't know"."""
    if not result.candidates:
        return False
    return (
        result.best_similarity >= settings.min_vector_similarity
        or result.best_coverage >= settings.min_keyword_coverage
    )
