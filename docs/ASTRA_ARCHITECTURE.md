# Astra AI — Architecture Assessment and Target Architecture

Status: Phase 0 (assessment). Written 2026-11-05 from a full read of the repository. No code was changed for this document.

## 1. What exists today (as-built)

Astra 1.x is a working single-user, local-only, bilingual (English/Urdu) document assistant: ~7,650 lines of source (backend 36 Python modules, frontend 34 TypeScript modules), 260 backend tests and 24 frontend tests passing, ruff/mypy clean.

```
Browser (React 19 + Vite 6 + Tailwind 4)
   │  JSON + Server-Sent Events (/api/chat/stream)
   ▼
FastAPI 0.162 (backend/app)
   ├─ api/        chat, documents, health, voice
   ├─ core/       settings (pydantic-settings), errors, JSON logging, identity (single local user)
   ├─ services/   intent router → rewrite → retrieval (vector + BM25, RRF) → RAG prompt → citation validation
   │              extraction (PyMuPDF + Tesseract OCR), chunking, ingestion, conversation templates
   ├─ providers/  LLM (mock | openai | anthropic | gemini), embeddings (mock | openai | sentence-transformers), speech (openai)
   ├─ workers/    background ingestion thread with restart recovery
   └─ db/         SQLAlchemy 2 + SQLite (Document, Chunk, Conversation, Message)
Chroma 1.5 (local, persistent)  ← vectors, filtered by user_id and document_id
```

Request flow for a document question:

1. Lexicon intent router (YAML lexicons, Urdu/Roman-Urdu normalisation) decides conversational vs. document question vs. general knowledge.
2. Query rewrite (router model): fixes typos, resolves follow-up pronouns from history, and adds an English search version for Urdu questions.
3. Hybrid retrieval scoped to the user's selected documents: dense (Chroma) + BM25 (in-memory over the selected documents), fused by reciprocal-rank fusion; running-header fragments filtered.
4. Evidence gate (min similarity 0.45 or keyword coverage 0.6) → abstain without calling the model if weak.
5. Answer model streams JSON; the `answer` field is revealed token by token over SSE; citations are validated against retrieved chunk IDs; page numbers come from the database, never the model.
6. Transcript persisted with citations and status.

### What works (preserve)
- Upload → extraction (text PDFs, scanned PDFs via OCR, TXT/MD) → chunking → embedding → index verification → READY/FAILED with user-readable reasons; interrupted jobs recovered on restart.
- Grounded answers with page-level citations, abstention, fabricated-citation rejection, cross-document citation dropping.
- Conversational layer (greetings, capability questions, needs-documents replies) in EN/UR/Roman Urdu, intent evaluation gate (160+ cases) in CI.
- Streaming answers with typewriter UI, Copy and Listen controls, Library, Research reader (page jump from citation), Voice mode shell, burgundy glassmorphism theme, cinematic brand intro, dark/light, RTL.
- Provider abstraction for LLM/embeddings/speech with retries, timeouts, fallback model, per-role models.

### What is incomplete
- Voice: STT/TTS adapters exist for OpenAI only; nothing is configured, so the UI shows voice as disabled (correctly).
- Web search: none.
- Vision: none (images in PDFs are OCR'd as text only; no chart/table understanding).
- Memory: conversation history only (last 6 turns passed to rewrite); no summarisation, no long-term memory.
- Verification: deterministic citation validation and evidence gate only; no claim-level checking. (The Gemini "reviewer" setting belongs to a developer-only script, `backend/devtools/gemini_review.py`, that reviews failing checks; it is not part of the answer pipeline.)
- Authentication: single hard-coded local user (`LOCAL_USER_ID`); CORS and ports are bound to localhost as the only protection.
- Storage: SQLite + Chroma + local filesystem; no PostgreSQL, Qdrant, Redis, object storage, or migrations (tables are created with `create_all`).
- Deployment: Dockerfiles and compose exist but have never been built; CI workflow exists but has never run on GitHub (not a git repository yet).
- Dependency drift: `sentence-transformers`/`torch` are installed in the venv and used (`EMBEDDING_PROVIDER=sentence_transformers`) but are not declared in `requirements.txt`; Tesseract is a system dependency not in the Dockerfile.

## 2. Target architecture (Astra 2.0)

Principle: keep the working core, add layers around it, and swap infrastructure behind existing interfaces. Each layer below maps to a phase in `IMPLEMENTATION_ROADMAP.md`.

```
┌──────────────────────── Client (React, TS, Tailwind) ────────────────────────┐
│ modes: General · Documents · Deep Research · Reasoning · Vision · Voice · Agent │
└──────────────────────────────┬────────────────────────────────────────────────┘
                               │ HTTPS, JWT, SSE
┌──────────────────────────────▼────────────────────────────────────────────────┐
│ API gateway (FastAPI /api/v1): auth, RBAC, rate limits, validation, errors     │
└──────────────────────────────┬────────────────────────────────────────────────┘
┌──────────────────────────────▼────────────────────────────────────────────────┐
│ Orchestration engine (explicit state machine; LangGraph for multi-step modes)  │
│  intent router → mode/model router → [doc research | web research | vision |  │
│  audio | tools | memory] → context budgeter → generation → verification        │
└───┬──────────────┬──────────────┬───────────────┬──────────────┬──────────────┘
    ▼              ▼              ▼               ▼              ▼
 Knowledge      Web search     Vision         Audio          Tools (sandbox)
 (ingest, RAG)  providers      providers      providers      python, calc, files
    │
┌───▼───────────────────────── Storage ──────────────────────────────────────────┐
│ PostgreSQL (users, workspaces, docs, chunks, conversations, memory, audit)      │
│ Qdrant (vectors; per-workspace collections, versioned)  Redis (cache, limits)  │
│ Object storage (S3-compatible; local adapter in dev)                           │
└────────────────────────────────────────────────────────────────────────────────┘
 Cross-cutting: provider abstraction, evaluation framework, observability, security
```

### Layer notes and migration decisions

| Area | Today | Target | Change strategy |
|---|---|---|---|
| Identity | single local user | OAuth2/OIDC or local accounts, JWT, workspaces, RBAC | `current_user_id()` already gates every query; replace it with a real dependency. Data migration: existing rows get the local user mapped to the first account. |
| Relational DB | SQLite, `create_all` | PostgreSQL + Alembic | Models are SQLAlchemy 2 already; add Alembic, keep SQLite for tests/dev. |
| Vectors | Chroma | Qdrant (named vectors, payload filters, collection versions) | `vector_store.py` is the only consumer; add a `QdrantStore` behind the same functions, keep Chroma adapter for zero-infra dev. Dimension is read from the embedding provider, as today. |
| Retrieval | hybrid + RRF + fragment filter + bilingual query | + cross-encoder rerank, parent-context expansion, workspace filters, chunk-size benchmark | Additive stages in `retrieval.py`. |
| Ingestion | PyMuPDF, Tesseract, heading-aware chunking | + DOCX, Docling layout parsing (evaluate), PaddleOCR engine option, tables/images extracted as assets, hierarchical metadata (chapter/section) | `OCR_ENGINE` switch; extraction returns pages + assets; chunking gains parent IDs. |
| Models | mock/openai/anthropic/gemini via HTTP | + local open-weight via OpenAI-compatible server (vLLM/Ollama/TGI) | The existing `OpenAIProvider` already speaks the OpenAI wire format; a local server is a base-URL change plus a `local` provider name and tokenizer-based token counting. |
| Orchestration | linear `assistant.respond_stream` | explicit state (`AstraRun`) with traced steps; LangGraph only for Deep Research and Agent mode | Wrap, don't rewrite: current flow becomes the "Documents" path of the graph. |
| Verification | citation validation + evidence gate | claim extraction → evidence support check → retry/abstain; deterministic first (citations, numbers, dates), model-assisted second | New `verification/` service, called before the final SSE `done`. |
| Web | none | provider adapters (Tavily, Brave; Google PSE optional), fetch+extract, source scoring, injection isolation | New `web/` package; results enter the same untrusted-evidence prompt format. |
| Vision | none | VLM provider interface (Gemini/OpenAI-compatible/local), page-image QA, table/chart structured extraction | New `providers/vision.py`; ingestion stores page images and table JSON. |
| Audio | OpenAI STT/TTS adapters | + faster-whisper (local), Gemini, Urdu benchmark | Existing `speech.py` protocols reused. |
| Memory | last-6-turn history | summarisation, long-term user memory table with user controls, optional semantic memory | New `memory/` service; PostgreSQL tables; Qdrant only if retrieval over history proves useful. |
| Context | fixed top-k, no token counting | token budgeter with model-specific limits and profiles | New `context.py`; tokenizer per provider (tiktoken for OpenAI-compatible; HF tokenizer for local). |
| Frontend | 4 modes | 7 modes as orchestration configs, capability flags from `/health` | Extend `features` in the health response; modes hidden unless backend supports them. |
| Observability | JSON logs | request/trace IDs, Prometheus metrics, optional OpenTelemetry | Middleware + counters; no new services required in dev. |

### What is deliberately not changed
- The frontend visual identity, intro, and component set.
- The grounded-answer contract (status, citations from DB, abstention).
- The evidence-as-untrusted-data prompt design.
- The provider-adapter pattern.

## 3. Proposed folder structure

```
backend/app/
  api/v1/            auth.py chat.py documents.py conversations.py memory.py voice.py vision.py search.py health.py
  core/              config.py errors.py logging.py security/ (auth.py jwt.py rbac.py ratelimit.py)
  db/                session.py migrations/ (alembic)
  models/            user.py workspace.py document.py chunk.py conversation.py memory.py audit.py tool_run.py
  schemas/           per-resource request/response models
  providers/         llm/ (openai_compat.py anthropic.py gemini.py local.py mock.py) embeddings/ vision/ speech/ search/ rerank/
  services/
    orchestration/   state.py router.py graph.py (LangGraph) tracing.py
    knowledge/       extraction/ (pdf.py docx.py ocr/ {tesseract.py paddle.py}) chunking.py ingestion.py retrieval.py rerank.py
    web/             providers.py fetch.py extract.py score.py
    vision/          page_images.py tables.py
    memory/          history.py summarize.py long_term.py
    verification/    claims.py support.py citations.py
    context/         budget.py tokenizers.py
    tools/           registry.py sandbox.py python_tool.py calculator.py
    conversation/    intent.py normalize.py templates.py rewrite.py
  workers/           executor.py (ingestion), later: queue adapter (Redis/RQ)
  storage/           object_store.py (local adapter, S3 adapter)
evaluation/          golden/ (intents, documents, urdu, crosslingual, citations, web), run_*.py, reports/
frontend/src/        modes/ (one config per mode), components/, hooks/, services/, brand/
docs/                this set + per-phase status
```

Existing modules move in small, test-covered steps (one package per phase), never in one sweep.

## 4. Database architecture (target)

PostgreSQL (Alembic-managed):

- `users` (id, email, password_hash | oidc_subject, role, created_at)
- `workspaces` (id, owner_id, name), `workspace_members` (workspace_id, user_id, role)
- `documents` (+ workspace_id, title, language, extraction_method, processing_version, storage_key, page_count, status, warnings)
- `document_assets` (document_id, page, kind: image|table, storage_key, structured_json)
- `chunks` (+ workspace_id, chapter, section, parent_chunk_id, language, token_count)
- `conversations` (+ workspace_id, title, mode, summary, summary_upto_message_id)
- `messages` (+ provider, model, token_usage, tool_calls_json, attachments_json)
- `citations` (message_id, chunk_id | web_source_id, page, excerpt)
- `web_sources` (url, title, published_at, fetched_at, content_hash)
- `memories` (user_id, kind, content, source_message_id, created_at, revoked_at)
- `tool_runs` (conversation_id, tool, input_json, output_json, status, duration_ms)
- `feedback` (message_id, rating, category, note)
- `audit_events` (actor_id, action, target, ip, created_at)

Qdrant: one collection per embedding model version (`chunks_<model>_<dim>`), payload {user_id, workspace_id, document_id, chunk_id, page, language}; filters enforced server-side on every query.

Redis: rate-limit counters, session revocation list, ingestion queue, response cache keyed by (user, question hash, document set).

Object storage: `originals/<doc>`, `pages/<doc>/<n>.png`, `assets/<doc>/...`, `audio/<msg>.mp3`; local filesystem adapter in development.

## 5. Model integration strategy (summary; detail in AI_MODEL_STRATEGY.md)

- Keep hosted providers as optional adapters (today: Gemini free tier, OpenAI, Anthropic).
- Add a `local` provider: any OpenAI-compatible inference server (Ollama for CPU dev, vLLM for GPU). Candidate open-weight models are evaluated on the project's own EN/UR golden sets before being made default.
- Roles stay separate (answer, router, judge, fallback, embedding, rerank, vision, STT, TTS) so each can be local or hosted independently.
- No claim of "Astra's own weights" until a fine-tune is trained, evaluated, and released through the controlled pipeline in Phase 7.

## 6. Risks and limitations to state up front

- No GPU on the development machine: local LLMs are CPU-only (small quantised models, slow); embeddings and OCR already run on CPU.
- Gemini key is free tier (about 20 answers/day per model): live evaluation is rationed; benchmarks must use local models or an upgraded key.
- Urdu quality (OCR, STT, TTS, embeddings) is unproven for every candidate technology; each needs its own measurement before promises are made.
- Moving to PostgreSQL/Qdrant/Redis adds operational weight; SQLite/Chroma stay supported for single-user local use.
