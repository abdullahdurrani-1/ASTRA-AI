# Astra AI — Development Status

Updated after every phase. Current: **Phase 0 complete (2026-11-05), awaiting owner approval for Phase 1.**

## Completed features (Astra 1.x, verified)
- Document ingestion: PDF (text and scanned via Tesseract OCR), TXT, MD; verified indexing; failure reasons; restart recovery.
- Hybrid retrieval (dense + BM25, RRF), running-header filtering, evidence gate, bilingual query (Urdu question also searched in English).
- Grounded answers with page citations, abstention, citation validation; streaming over SSE with typewriter UI.
- Conversational layer: intent routing (EN/UR/Roman Urdu), template replies, typo and follow-up rewrite.
- Frontend: chat, library, research reader, voice shell; burgundy glassmorphism; brand intro; dark/light; RTL.
- Providers: Gemini/OpenAI/Anthropic LLM adapters with retries, timeouts, fallback model; local embeddings; OpenAI speech adapters (unconfigured).

## Pending features (by phase, see IMPLEMENTATION_ROADMAP.md)
- Phase 1: git + CI on GitHub, dependency pinning, auth/JWT/workspaces, PostgreSQL + Alembic, rate limiting, API v1, request IDs.
- Phase 2: Qdrant, DOCX, PaddleOCR engine, assets (page images, tables), reranking, parent context, chunk/embedding benchmarks, collections UI.
- Phase 3: web search providers, search decision, source scoring, web citations, injection isolation.
- Phase 4: local LLM provider, context budgeter, model router, verification engine, open-weight evaluation.
- Phase 5: vision provider and page-image QA, local STT, TTS, Urdu voice benchmark.
- Phase 6: orchestration state + LangGraph graphs, tool registry, sandboxed Python, memory (summaries, long-term, controls).
- Phase 7: feedback, error memory, evaluation datasets, fine-tuning pipeline (GPU needed).
- Phase 8: security audit, load test, monitoring, backups, deployment guide.

## Known issues
- No authentication: local single-user only; do not expose port 8000.
- Gemini key is free tier (~20 answers/day/model); live tests are rationed. Rewrite/translation quality and streamed answers on the real book remain to be observed live.
- Urdu OCR quality on Nastaliq scans is unmeasured.
- `sentence-transformers`/`torch` undeclared in requirements; Tesseract missing from Dockerfile; Docker images never built; CI never run (no git repository).
- `.env.example` omits 13 settings that the code reads (for example `PROVIDER_TIMEOUT_SECONDS`, `LOCAL_USER_ID`, `CORS_ORIGINS`, `RETRIEVAL_CANDIDATES`, `MIN_SUBSTANTIVE_CHUNK_CHARS`); see ARCHITECTURE_REVIEW.md.

## Tests executed (2026-11-05)
| Suite | Result |
|---|---|
| backend pytest | 260 passed |
| ruff check / format | clean |
| mypy | clean (36 files) |
| frontend vitest | 24 passed |
| frontend typecheck + build | OK |

## Required environment variables (current)
See `.env.example`. Minimum for a real answer: `LLM_PROVIDER=gemini`, `GEMINI_API_KEY`, `LLM_MODEL_ANSWER`, `LLM_MODEL_ROUTER`, `LLM_MODEL_FALLBACK`, `EMBEDDING_PROVIDER=sentence_transformers`. OCR: `OCR_ENABLED=true`, Tesseract installed with `eng` and `urd` data.

## Next implementation step
On approval: Phase 1, item 1 (initialise git with a correct `.gitignore`, first commit, push, confirm CI), then item 2 (dependency pinning and a Docker build), then authentication.
