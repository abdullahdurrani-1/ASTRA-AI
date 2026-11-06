# Astra AI 2.0 — Implementation Roadmap

Written 2026-11-05 (Phase 0). Each phase leaves the app runnable and tested. Phases are sequenced so that security and storage foundations come before features that would multiply their blast radius. Estimates are working sessions, not calendar days, and assume one engineer plus Claude Code.

Legend: ✅ exists today · 🔧 extend existing · 🆕 new

## Phase 0 — Assessment (this phase) — done
Deliverables: `ASTRA_ARCHITECTURE.md`, this roadmap, `TECH_STACK.md`, `SECURITY_DESIGN.md`, `AI_MODEL_STRATEGY.md`, `DEVELOPMENT_STATUS.md`. Owner approval before Phase 1.

## Phase 1 — Core platform (4–6 sessions)
Goal: multi-user-safe foundation without breaking local single-user use.
1. 🆕 Git repository, `.gitignore` (`.env`, data, venv), first commit; CI runs on GitHub.
2. 🔧 Declare missing dependencies (`sentence-transformers`, `torch` CPU wheel, `pytesseract`/Tesseract in Dockerfile); build the Docker images once and record the result.
3. 🆕 Authentication: local accounts (argon2 password hashing) + JWT access/refresh, `users` and `workspaces` tables, `current_user()` dependency replacing `current_user_id()`; OIDC adapter interface for later. Existing data migrated to the first account.
4. 🆕 Alembic migrations; PostgreSQL support alongside SQLite (tests stay on SQLite).
5. 🆕 API versioning under `/api/v1` (old paths proxied for one release), rate limiting (Redis if present, in-memory otherwise), request IDs in logs and responses.
6. 🔧 Frontend: login/register, session handling, workspace switcher (minimal).
Exit: a second user cannot see the first user's documents or conversations (test), CI green on GitHub, Docker compose up with PostgreSQL.

## Phase 2 — Knowledge engine 2.0 (5–7 sessions)
1. 🆕 Qdrant adapter behind `vector_store` (Chroma kept for no-infra dev); collection named by model and dimension; payload filters for workspace/document.
2. 🔧 Ingestion: DOCX extraction, `OCR_ENGINE=tesseract|paddle` (owner's PaddleOCR project integrated as engine two with fallback), page images and tables stored as assets, extraction_method/processing_version recorded, hierarchical metadata (chapter/section from headings, parent chunk IDs).
3. 🔧 Retrieval: cross-encoder reranker (bge-reranker-v2-m3 candidate), parent-context expansion, deduplication, workspace filters.
4. 🆕 Chunk-size and overlap benchmark on the golden set; embedding benchmark (current multilingual model vs. BGE-M3 vs. multilingual-E5) for EN, UR and cross-lingual recall@K.
5. 🔧 Library UI: collections, multi-book selection, processing detail per document.
Exit: recall@5 and citation accuracy reported in `EVALUATION.md` for EN/UR/cross-lingual; ten-book workspace indexed and queried in a live check.

## Phase 3 — Web intelligence (3–4 sessions)
1. 🆕 Search provider interface with Tavily and Brave adapters (keys owner-supplied); Google Programmable Search optional.
2. 🆕 Search decision in the router (document evidence insufficient, or time-sensitive intent, or Deep Research mode).
3. 🆕 Fetch + readability extraction, source scoring (domain, date, agreement), passage retrieval using the existing hybrid ranker.
4. 🔧 Answer prompt distinguishes document, web, and model knowledge; web citations with title, URL, date; disagreement surfaced.
5. 🆕 Injection isolation: web text enters only as untrusted evidence; tool calls never originate from page content (tests).
Exit: web-grounded answers with validated links on a golden set; zero tool calls from injected pages in tests.

## Phase 4 — Core model intelligence (4–6 sessions)
1. 🆕 `local` LLM provider (OpenAI-compatible: Ollama for CPU dev, vLLM for GPU), health checks, model capability registry (context length, tool calling, vision).
2. 🆕 Context budgeter: tokenizer per provider, profiles Standard/Extended/Research/Long Document, reserved output tokens, truncation protection.
3. 🔧 Model router by role and mode with fallback chains; structured outputs via JSON schema where supported.
4. 🆕 Verification engine v1: deterministic checks (citations, numbers/dates present in evidence) + model-assisted claim support check; retry retrieval once, else abstain.
5. 🆕 Open-weight model evaluation on EN/UR golden sets; default chosen from numbers.
Exit: answers verified before `done`; local model runs end-to-end on CPU with documented limits.

## Phase 5 — Vision and audio (4–6 sessions)
1. 🆕 Vision provider interface (Gemini, OpenAI-compatible VLM, local via Ollama); image upload in chat; PDF page-image QA; chart/table structured extraction kept as JSON.
2. 🔧 Audio: faster-whisper local STT, Gemini/OpenAI STT; TTS adapters (OpenAI, local Coqui/Piper candidate); Urdu benchmark (WER on a small recorded set, native-speaker rating of TTS).
3. 🔧 Voice mode: interruption, playback controls, language detection from audio.
Exit: vision QA and voice round-trip verified live in both languages, with measured Urdu quality written down.

## Phase 6 — Agent and memory (4–6 sessions)
1. 🆕 Orchestration state machine with traced steps; LangGraph graphs for Deep Research and Agent mode only.
2. 🆕 Tool registry with schemas, authorization, timeouts, audit; sandboxed Python (Docker-based runner with CPU/memory/network limits); calculator; file tools.
3. 🆕 Memory: conversation summarisation, long-term user memory with review/delete UI, optional semantic retrieval over history.
Exit: multi-step research task traced end-to-end; sandbox escape tests pass; memory isolation tests pass.

## Phase 7 — Adaptive intelligence (3–5 sessions)
1. 🆕 Feedback capture, error categories, evaluation datasets per capability, regression suite in CI.
2. 🆕 Fine-tuning experiment pipeline (PEFT/LoRA, TRL) with MLflow tracking and fixed benchmark gate; model versioning and rollback. Needs GPU (cloud) — documented as owner-dependent.
Exit: a released model version must beat the previous on the fixed benchmark; rollback tested.

## Phase 8 — Production readiness (3–4 sessions)
Security audit (checklist in `SECURITY_DESIGN.md`), load test, Prometheus/Grafana, backups and restore drill, deployment guide, final documentation.

## Dependencies the owner must supply (by phase)
| Phase | Dependency |
|---|---|
| 1 | GitHub repository; PostgreSQL (Docker is enough) |
| 2 | PaddleOCR project folder; Qdrant (Docker) |
| 3 | Tavily and/or Brave API key |
| 4 | Gemini billing or a local model (Ollama) for benchmarks |
| 5 | Microphone test recordings in Urdu and English; TTS rating by a native speaker |
| 6 | Docker for the sandbox runner |
| 7 | GPU (cloud) for fine-tuning experiments |
