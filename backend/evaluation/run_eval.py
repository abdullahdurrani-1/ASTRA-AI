"""Reproducible RAG evaluation.

Builds a PDF from sample_document.md, ingests it into an isolated temporary data directory using
the CURRENTLY CONFIGURED providers (mock by default), asks every question in questions.json and
reports retrieval hit@k, citation page correctness, answer-term match, abstention accuracy and
latency. Results are written to evaluation/results/latest.json.

Run from backend/:  python -m evaluation.run_eval
"""

import json
import os
import statistics
import tempfile
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
os.environ["DATA_DIR"] = tempfile.mkdtemp(prefix="astra-eval-")
os.environ.setdefault("LOG_LEVEL", "WARNING")

import pymupdf  # noqa: E402

from app.core.config import get_settings  # noqa: E402
from app.core.logging import configure_logging  # noqa: E402
from app.db.session import SessionLocal, init_db  # noqa: E402
from app.models import Document  # noqa: E402
from app.providers.embeddings import get_embedding_provider  # noqa: E402
from app.services.ingestion import run_ingestion  # noqa: E402
from app.services.rag import answer_question  # noqa: E402
from app.services.retrieval import retrieve  # noqa: E402


def build_pdf(md: str) -> bytes:
    body = md.split("-->", 1)[-1]
    doc = pymupdf.open()
    for page_text in body.split("=== PAGE ==="):
        page = doc.new_page()
        page.insert_textbox(pymupdf.Rect(50, 50, 550, 800), page_text.strip(), fontsize=10)
    data = doc.tobytes()
    doc.close()
    return data


def main() -> None:
    s = get_settings()
    configure_logging(s.log_level)
    s.uploads_dir.mkdir(parents=True, exist_ok=True)
    init_db()
    pdf = build_pdf((HERE / "sample_document.md").read_text(encoding="utf-8"))
    (s.uploads_dir / "eval.pdf").write_bytes(pdf)

    with SessionLocal() as db:
        doc = Document(
            user_id=s.local_user_id,
            original_name="port_vellan.pdf",
            stored_name="eval.pdf",
            file_type="pdf",
            size_bytes=len(pdf),
            sha256="eval",
            warnings=[],
        )
        db.add(doc)
        db.commit()
        doc_id = doc.id
    run_ingestion(doc_id, s)

    questions = json.loads((HERE / "questions.json").read_text(encoding="utf-8"))
    embedder = get_embedding_provider(s)
    rows = []
    with SessionLocal() as db:
        status = db.get(Document, doc_id).status  # type: ignore[union-attr]
        assert status == "READY", f"ingestion failed: {status}"
        for q in questions:
            t0 = time.perf_counter()
            res = answer_question(
                db, s, s.local_user_id, q["question"], [doc_id], q.get("language", "auto")
            )
            ms = (time.perf_counter() - t0) * 1000
            retrieved = retrieve(db, s, embedder, s.local_user_id, [doc_id], q["question"])
            pages = set(q.get("pages", []))
            hit = any(c.chunk.page_start in pages for c in retrieved.candidates) if pages else None
            top = retrieved.candidates[0].chunk.page_start if retrieved.candidates else None
            hit1 = (top in pages) if pages else None
            cited = {c.page_start for c in res.citations}
            rows.append(
                {
                    "id": q["id"],
                    "type": q["type"],
                    "expect": q["expect"],
                    "status": res.status,
                    "status_ok": res.status == q["expect"],
                    "retrieval_hit": hit,
                    "retrieval_hit_at_1": hit1,
                    "citation_page_ok": (bool(cited) and cited <= pages) if res.citations else None,
                    "terms_ok": all(t in res.answer for t in q.get("must_contain", []))
                    if res.status == "answered"
                    else None,
                    "ms": round(ms, 1),
                }
            )

    def rate(key: str, subset: list[dict]) -> str:
        vals = [r[key] for r in subset if r[key] is not None]
        return f"{sum(vals)}/{len(vals)}" if vals else "n/a"

    answerable = [
        r for r in rows if r["expect"] == "answered" and not r["type"].startswith("cross")
    ]
    unanswerable = [r for r in rows if r["expect"] == "insufficient_evidence"]
    cross = [r for r in rows if r["type"].startswith("cross")]
    summary = {
        "providers": {"embeddings": s.embedding_provider, "llm": s.llm_provider},
        "answerable_answered": rate("status_ok", answerable),
        "retrieval_hit_at_k": rate("retrieval_hit", answerable),
        "retrieval_hit_at_1": rate("retrieval_hit_at_1", answerable),
        "chunks_indexed_vs_k": f"{len(retrieved.candidates)} retrieved (k={s.retrieval_top_k})",
        "citation_page_correct": rate("citation_page_ok", answerable),
        "answer_contains_expected_terms": rate("terms_ok", answerable),
        "unanswerable_abstained": rate("status_ok", unanswerable),
        "cross_lingual_answered": rate("status_ok", cross),
        "cross_lingual_retrieval_hit_at_1": rate("retrieval_hit_at_1", cross),
        "median_latency_ms": round(statistics.median(r["ms"] for r in rows), 1),
    }
    out = HERE / "results"
    out.mkdir(exist_ok=True)
    (out / "latest.json").write_text(
        json.dumps({"summary": summary, "rows": rows}, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )
    for r in rows:
        print(
            f"{r['id']:4} {r['type']:34} expect={r['expect']:22} got={r['status']:22} "
            f"hit={r['retrieval_hit']} cite={r['citation_page_ok']} terms={r['terms_ok']}"
        )
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
