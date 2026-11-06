# Astra AI — Principal Engineer Architecture Review

Date: 2026-11-05. Scope: the six Phase 0 documents, the 1.x documents, and the full repository (backend 36 modules, frontend 34 modules, tests, CI, Docker, env files). No implementation code was changed during this review; two factual errors in the Phase 0 documents were corrected (noted in §1).

## 1. Documentation versus code

Method: every architectural claim in the Phase 0 documents was checked against the module that would implement it.

### Verified as accurate
- Request flow (intent → rewrite → hybrid retrieval → evidence gate → streamed JSON → citation validation → persist) matches `services/assistant.py`, `rewrite.py`, `retrieval.py`, `rag.py`, `api/chat.py`.
- Every data access is filtered by `user_id`: documents (`api/documents.py`, `ingestion.get_user_document`), chunks (`retrieval.retrieve`), conversations (`api/chat.py`), vectors (`vector_store.query` passes user and document filters to Chroma).
- Providers and settings named in the docs exist with those names in `core/config.py` and `providers/*.py`. Embedding dimension is taken from the provider, and the Chroma collection name encodes model and dimension (`vector_store.index_name`).
- Test and tool counts: 260 backend tests, 24 frontend tests, ruff/mypy clean (run today).
- Ingestion verifies the vector count before READY (`ingestion.py`), and deleting a document deletes its vectors (`vector_store.delete_document`).

### Discrepancies found and fixed in the documents
| Claim | Reality | Fix |
|---|---|---|
| "Gemini reviewer flag has no consumer" (ASTRA_ARCHITECTURE, DEVELOPMENT_STATUS) | `backend/devtools/gemini_review.py` uses `GEMINI_REVIEW_ENABLED`, `GEMINI_API_KEY`, `GEMINI_MODEL` to review failing checks; it is a developer tool, not pipeline code | Corrected in both files |
| 1.x `IMPLEMENTATION_PLAN.md` described phases 0–7 of the MVP | Replaced today by the milestone plan; the MVP history remains in `README.md` | New file |

### Discrepancies that remain in the repository (to fix in milestone M1)
- `.env.example` documents 34 settings; `core/config.py` reads 47. Missing from the example: `CORS_ORIGINS`, `LOCAL_USER_ID`, `CHUNK_TARGET_CHARS`, `CHUNK_OVERLAP_CHARS`, `MIN_CHARS_PER_PAGE`, `EMBEDDING_BATCH_SIZE`, `LLM_MAX_TOKENS`, `LLM_TEMPERATURE`, `INTENT_CLASSIFIER_TIMEOUT_SECONDS`, `INTENT_MIN_CONFIDENCE`, `PROVIDER_TIMEOUT_SECONDS`, `RETRIEVAL_CANDIDATES`, `MIN_SUBSTANTIVE_CHUNK_CHARS`, `MAX_AUDIO_MB`. The owner's `.env` already uses `PROVIDER_TIMEOUT_SECONDS`, which a newcomer could not discover from the example.
- `backend/requirements.txt` omits `sentence-transformers` and `torch`, which the live configuration (`EMBEDDING_PROVIDER=sentence_transformers`, model `paraphrase-multilingual-MiniLM-L12-v2`, 384 dimensions) requires. `backend/Dockerfile` does not install Tesseract or its `eng`/`urd` data, so the image cannot OCR.
- `README.md` status heading says 2026-10-28 while its results line says 2026-11-05; `docs/ARCHITECTURE.md` (1.x) says "45 tests". Cosmetic; update when README is next touched.
- `ci.yml` runs `python -m evaluation.run_eval`, which uses mock providers; it is a smoke test, not a quality gate. Name it as such in the workflow.

## 2. Missing components, conflicts, unnecessary technology, unrealistic assumptions

### Missing from the current design (added to the plan)
- Request/trace IDs and a correlation header (no way to follow one request through logs today).
- Magic-byte validation of uploads and a size-capped streaming write (uploads are trusted by extension).
- Token counting anywhere (retrieval top-k is fixed; long chunks could exceed a small local model's context).
- A persisted keyword index: BM25 is recomputed over all selected chunks on every request. At ten books (about 13,000 chunks) this is roughly 150–400 ms of Python per question and grows linearly. Acceptable for Phase 1; must move to PostgreSQL full-text (or SQLite FTS5 in local mode) in the knowledge-engine phase.
- A retrieval quality harness: `evaluation/` has an intent gate and a mock-provider smoke run, but no recall@K or citation-accuracy measurement on real documents. Every embedding, chunking, reranking and OCR decision in the roadmap depends on this harness existing first.
- Conversation management endpoints beyond list/get (rename, delete) and document deletion from the UI.
- Playwright end-to-end tests; only component tests exist.

### Architectural conflicts to resolve (decisions for the owner in §11)
1. **Two storage modes.** The master prompt prescribes PostgreSQL + Qdrant + Redis + object storage. Keeping SQLite + Chroma + filesystem as a zero-setup mode means two code paths behind each storage interface. Both must run in CI (service containers), or the "production" path will rot. Recommendation: support both, test both, default local mode for `APP_ENV=development`.
2. **LangGraph.** Useful for cyclic, resumable, multi-step graphs (Deep Research, Agent mode). For the current linear flow it adds a dependency and indirection with no benefit. Recommendation: build an explicit `RunState` + step tracer first (Phase 4), adopt LangGraph only when Deep Research is implemented, and only if its checkpointing is actually used.
3. **Next.js / Framer Motion.** The master prompt lists them as preferred. The existing Vite SPA with CSS animations is working, tested and fast. Switching frameworks would be a rewrite of a working frontend. Recommendation: stay on Vite; add Framer Motion only for a specific interaction that CSS cannot express.
4. **PaddleOCR versus Docling.** Both are heavy. Choose by measurement on the owner's scans (M9), not by default.

### Unnecessary now (defer until a trigger)
| Technology | Trigger to adopt |
|---|---|
| Redis | More than one API or worker process, or rate limits must be shared across instances |
| MinIO / S3 | Deployment off a single machine, or page-image assets exceed local disk comfort |
| MLflow, DVC | First fine-tuning experiment (needs GPU) |
| Prometheus/Grafana, OpenTelemetry | A deployment someone else operates; until then, structured logs with request IDs |
| Kubernetes | Never, for this project's scale |

### Unrealistic assumptions in the master prompt, with practical alternatives
- **"Independent of commercial models" on CPU-only hardware.** A 4B-parameter quantised model on this machine will produce roughly 5–10 tokens/second and weak Urdu. It is viable for the router role (short outputs) and for private workspaces that forbid external processing, not as the default answer model. Alternative: hosted Gemini/OpenAI/Anthropic by default, local model for the router and for privacy-restricted workspaces, and a GPU box (cloud, rented by the hour) when benchmarking 8B+ models.
- **Controlled fine-tuning.** Requires a GPU with 16–24 GB for QLoRA on a 4–8B model, curated data (hundreds to thousands of examples) and evaluation sets that do not exist yet. Keep it as Phase 7 and build the evaluation sets first; they are valuable even if no fine-tune ever ships.
- **Urdu voice.** No open local TTS has convincing Urdu; local STT (Whisper family) has usable but unverified Urdu. Promise nothing until measured on recordings (M19).
- **Malware scanning.** Needs a ClamAV service; without it the control is a hook that is off. Document it as such.
- **"Understand charts and diagrams."** Hosted VLMs do this reasonably; local small VLMs on CPU do not. Treat vision as a hosted-first capability with a local option that is explicitly lower quality.

## 3. Can the architecture support each target capability?

| Capability | Supported by design? | What must exist first |
|---|---|---|
| Open-weight LLMs | Yes: `OpenAIProvider` already speaks the OpenAI wire format; a `local` provider is a base URL, a model name and a tokenizer | Capability registry, token counting, health check (M14) |
| RAG at ten-book scale | Yes, with a persisted keyword index and Qdrant or Chroma filters | Retrieval harness (M7), keyword index (M10), Qdrant adapter (M11) |
| Live web search | Yes, as a second evidence source feeding the same untrusted-evidence prompt and citation validator | Search provider interface, safe fetcher, source records (M12–M13) |
| VLMs | Yes, as a provider role; page images must be stored at ingestion | Asset storage (M9), vision interface (M18) |
| Audio | Yes, protocols exist (`providers/speech.py`) | Local STT adapter and Urdu measurement (M19) |
| Memory | Yes; conversations are already persisted | Summarisation and memory tables with user controls (M21) |
| Agents and tools | Yes, provided tool execution is isolated from the API process | Tool registry, Docker sandbox runner (M20) |
| Controlled model improvement | Only partially without a GPU: feedback, error memory and evaluation sets are feasible; training is not | M22, then GPU |

## 4. Security review

### Authentication
Current: none. `core/security.current_user_id()` returns `LOCAL_USER_ID`. Correct for local use; blocks any shared or networked deployment. Plan: local accounts with argon2id, short-lived JWT access tokens plus rotating refresh tokens in an httpOnly cookie, a revocation list (in-memory in local mode, Redis later), and an OIDC adapter interface. Because every query already takes `user_id` from one dependency, the change is narrow: replace the dependency, add `users`/`workspaces` tables, migrate existing rows to the first account.

### Tenant isolation
Current: enforced in backend queries, not only in the UI. Verified in `api/documents.py`, `api/chat.py` (conversation ownership, document ownership before answering), `retrieval.retrieve` (SQL filter on user and document IDs), `vector_store.query` (Chroma `where` on user and document). Gap: isolation is per user, not per workspace; sharing a document between users is impossible without copying. Plan: add `workspace_id` to documents, chunks, conversations and vector payloads; all repository functions take an authenticated principal; cross-tenant tests for every resource type.

### Prompt injection
Current: evidence is wrapped in delimited blocks with `</evidence>` escaped (`rag._escape`); the system prompt states evidence is data; the intent router detects instruction-like and key-mash inputs; the rewrite step has guards against the model answering instead of rewriting; citations cannot be invented. Gaps: no injection test suite; web and tool outputs do not exist yet and will need the same wrapping; the rewrite model sees conversation history, so a poisoned assistant turn could steer rewrites (mitigated by the term-overlap guard). Plan: a golden injection set (documents, web pages, image captions, tool outputs) run in CI; all tool invocations validated by a registry independent of the model.

### Uploaded document security
Current: extension allow-list, size cap, SHA-256 de-duplication, encrypted/corrupt/empty detection, inline serving with `nosniff` and a sandbox CSP for text. Gaps: no magic-byte check; PyMuPDF parses untrusted PDFs inside the API process's worker thread (a MuPDF parser bug would affect the API process); no scanning hook. Plan: magic-byte validation, parse in a separate worker process with memory and time limits, optional ClamAV hook that fails closed when configured.

### API keys and secrets
Current: read from environment via pydantic-settings; `.env` is owner-managed; the Gemini review tool redacts diffs; logs are structured and exclude content. Gap: the folder is not a git repository, so there is no `.gitignore` protecting `.env` and `data/` from the first commit. Plan: M1 initialises git with the ignore file before anything else; `pip-audit`/`npm audit` in CI.

### Tool execution
Current: none. Design: tool registry with JSON schemas and per-mode permissions; Python runs only in a disposable container (no network, CPU/memory/time caps, output cap); database access via application services with the caller's principal; sensitive tools require UI approval; every run recorded in `tool_runs`.

## 5. Database design and inter-store communication

Only the API and worker processes talk to the stores; stores never talk to each other. The relational database is the source of truth; vectors, cache and files are derived or referenced.

**Upload and ingestion**
1. API validates the file, streams it to object storage (local adapter: `data/uploads`), writes a `documents` row (status UPLOADED, `storage_key`), commits.
2. API enqueues the document ID (local mode: in-process executor; Redis mode: queue).
3. Worker loads the file from object storage, extracts pages and assets (page images, tables → object storage, `document_assets` rows), chunks, writes `chunks` rows, embeds, upserts vectors to the vector store with payload {user, workspace, document, chunk, page, language}, then **reads back the vector count** and only then sets status READY. Failures set FAILED with a message; restart recovery re-queues PROCESSING rows.

**Question**
1. API authenticates (JWT) → principal; rate limit check (Redis or in-memory).
2. Loads the selected documents with an ownership filter from PostgreSQL.
3. Vector search in Qdrant with a server-side payload filter; keyword search via PostgreSQL full-text over the same document set; fusion in the service.
4. Optional response cache lookup in Redis keyed by (principal, document set, normalised question, model).
5. Generation; `messages` and `citations` rows committed together; optional memory extraction later.

**Deletion**: delete vectors by document filter → delete assets from object storage → delete rows (cascade). Order ensures no dangling vectors if a later step fails; the READY check and a periodic reconciliation job catch the reverse case.

**Redis roles**: rate counters (TTL keys), refresh-token revocation list, ingestion queue, short-lived response cache. None are sources of truth; Redis loss degrades, never corrupts.

**Local mode mapping**: PostgreSQL → SQLite (same SQLAlchemy models, Alembic for both), Qdrant → Chroma (same `vector_store` functions), Redis → in-memory, object storage → filesystem adapter. CI runs the suite in both modes.

## 6. Model router: how a model is selected

Inputs: role (answer, router, judge, fallback, embed, rerank, vision, stt, tts), mode (General, Documents, Deep Research, Reasoning, Vision, Voice, Agent), workspace privacy policy, request properties (language, estimated prompt tokens, needs tools, needs vision), and the live health table.

Algorithm:
1. Candidate list for the role from configuration, ordered by preference, for example `LLM_ANSWER_CHAIN=gemini:gemini-3.5-flash,local:qwen3-4b`.
2. Drop candidates that violate the workspace policy (external processing denied → only `local`).
3. Drop candidates whose registry entry lacks a required capability (context window smaller than the budget, no vision, no tool calling).
4. Drop candidates marked unhealthy by the last health probe or circuit-breaker state (consecutive failures open the breaker for a cooling period).
5. Pick the first remaining candidate; on `ProviderError` move to the next; record provider, model and token usage on the message.
6. Mode adjustments: Reasoning mode raises `reasoning_effort` and prefers larger models; Deep Research prefers a cheaper model for per-source summarisation and the answer model for synthesis.

This generalises the existing per-role settings and fallback model without changing their semantics; the current `.env` continues to work.

## 7. Implementable and testable without paid APIs or a GPU
- Everything in Phase 1 (git, CI, dependency pinning, Docker build, auth, PostgreSQL, Alembic, rate limiting, API v1, request IDs).
- Retrieval harness, keyword index, Qdrant adapter, chunking and embedding benchmarks (local embedding models on CPU), reranker (CPU, slow but fine for evaluation), DOCX extraction, PaddleOCR engine, page images and table extraction.
- Context budgeter and tokenizers; capability registry; model router logic (tested with the mock provider).
- Local LLM provider against Ollama with a small quantised model (slow, but correct for integration tests).
- Verification engine's deterministic checks; injection test suite; sandbox runner (needs Docker only).
- Memory tables, summarisation logic (tested with fakes), user controls UI.
- Local STT with faster-whisper on CPU; evaluation sets and feedback capture.

## 8. Requires keys, cloud services, or hardware
| Need | For |
|---|---|
| Gemini billing (or OpenAI/Anthropic key) | Answer quality at scale, vision, hosted STT/TTS, live evaluation runs |
| Tavily and/or Brave API key | Web search |
| GPU (local or rented) | 8B+ local models at usable speed; fine-tuning; VLM locally |
| Docker Desktop | PostgreSQL, Qdrant, Redis, MinIO containers; the Python sandbox |
| ClamAV container | Malware scanning |
| Native Urdu speaker time | Rating TTS and reviewing Urdu strings |
| GitHub repository | CI, Dependabot, releases |

## 9. Folder structure (incremental, fits the existing repository)

Existing packages stay where they are; new packages are added beside them. A module moves only when the milestone that owns it touches it, with tests.

```
backend/app/
  api/
    v1/                    routers mounted at /api/v1; the existing routers are re-exported here first,
                           then edited in place (no copy)
  core/
    config.py errors.py logging.py
    security/              auth.py (principal, JWT), passwords.py, rbac.py, ratelimit.py
    request_context.py     request ID / trace ID
  db/                      session.py, alembic/ (env, versions/)
  models/                  split by table as they grow: user.py, workspace.py, document.py, ...
  schemas/
  providers/
    llm/                   base.py, openai_compat.py (OpenAI, Gemini, local), anthropic.py, mock.py, registry.py
    embeddings.py  rerank.py  vision.py  speech.py  search.py
  services/
    conversation/          intent.py normalize.py templates.py rewrite.py   (moved from services/ in M-knowledge)
    knowledge/             extraction/{pdf,docx,ocr/{tesseract,paddle}}.py chunking.py ingestion.py
                           keyword_index.py retrieval.py rerank.py
    rag.py streaming_json.py language.py assistant.py            (unchanged until orchestration milestone)
    orchestration/         state.py router.py tracer.py (graphs/ later)
    web/                   providers.py fetch.py extract.py score.py
    context/               budget.py tokenizers.py
    verification/          claims.py support.py
    memory/                summarize.py long_term.py
    tools/                 registry.py sandbox.py builtin/
    vision/                page_images.py tables.py
  storage/                 object_store.py (local, s3)
  workers/                 executor.py, queue.py
evaluation/                golden/{intents,documents,urdu,crosslingual,citations,injection,web}.jsonl
                           harness/ (retrieval, answer, injection runners) reports/
frontend/src/
  modes/                   one config per user mode (capabilities, composer hints, panels)
  features/                auth/, workspace/, memory/ (new); existing components/ hooks/ unchanged
docs/                      as today
infra/                     docker-compose.local.yml, docker-compose.full.yml, Caddyfile, sandbox/Dockerfile
```

## 10. Dependency graph
See `DEPENDENCY_GRAPH.md`. Critical path: git/CI → dependency pinning → auth → migrations → retrieval harness → keyword index → (Qdrant | web | local LLM in parallel) → verification → orchestration → tools/memory → production.

## 11. Decisions that require the owner's approval
1. Keep the Vite/React frontend (no Next.js migration). **Recommended: yes.**
2. Support two storage modes (local SQLite/Chroma/filesystem and full PostgreSQL/Qdrant/object storage), both tested in CI. **Recommended: yes.**
3. Defer Redis, MinIO, MLflow/DVC, Prometheus until their triggers. **Recommended: yes.**
4. Explicit state machine first; LangGraph only for Deep Research/Agent mode and only if checkpointing is used. **Recommended: yes.**
5. Default answer model stays hosted (Gemini) with a local model for the router role and for privacy-restricted workspaces, until a GPU is available. **Recommended: yes.**
6. Authentication style for the first release: local accounts (email + password) with an OIDC adapter later, versus OIDC-only now. **Recommended: local accounts first.**
7. Python target version for Docker and CI: 3.12 (safer ML wheels) while the local venv is 3.13. **Recommended: 3.12.**
8. Whether to create the GitHub repository now (public or private) so CI can run. **Needed to start M1.**
