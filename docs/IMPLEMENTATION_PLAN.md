# Astra AI 2.0 — Implementation Plan (milestones)

Date: 2026-11-05. Replaces the 1.x plan (its history is in `README.md`). Ordering and prerequisites are in `DEPENDENCY_GRAPH.md`; environment needs in `ENVIRONMENT_REQUIREMENTS.md`. Each milestone is small enough to finish, test and leave the application runnable. "Files" lists the main files created (new) or changed (edit); exact names may shift during implementation but the scope will not.

Conventions for every milestone: run the full backend and frontend suites plus ruff/mypy/typecheck before calling it done; update `DEVELOPMENT_STATUS.md`; no placeholder code presented as complete; no behaviour that advertises an unconfigured service.

---

## Phase 1 — Core platform

### M1 Git repository, ignore rules, CI running
- Objective: version control and a green CI baseline before any further change.
- Files: new `.gitignore` (`.env`, `data/`, `backend/.venv`, `frontend/node_modules`, `dist`, caches), edit `.env.example` (add the 14 missing settings with placeholders), edit `.github/workflows/ci.yml` (name the mock evaluation as a smoke test), edit `README.md` dates.
- Dependencies: GitHub repository URL from the owner (or local-only git by decision).
- Steps: `git init`; verify `git status` shows no secrets or data; first commit; push; watch CI.
- Tests: CI backend and frontend jobs green; `git ls-files | grep -c "\.env$"` is 0.
- Acceptance: CI badge green on the default branch; `.env` and `data/` untracked.

### M2 Dependency pinning and Docker build
- Objective: a clean install reproduces the running system.
- Files: edit `backend/requirements.txt` (add `sentence-transformers`, `torch` CPU index pin, `pytesseract` if used, pin versions), edit `backend/Dockerfile` (python:3.12-slim, Tesseract + eng/urd data, non-root user), edit `docker-compose.yml` (healthcheck unchanged), new `backend/requirements-ml.txt` if the ML set is split for CI speed.
- Dependencies: M1.
- Steps: fresh venv install from requirements; run suite; build backend and frontend images; `docker compose up`; call `/api/health` and upload a one-page scanned PDF inside the container.
- Tests: suite passes in the fresh venv; compose health check passes; OCR path works in the image.
- Acceptance: `docker compose up` serves the app; `pip-audit` reports no critical findings or each is triaged in `DEVELOPMENT_STATUS.md`.

### M3 Request IDs and API v1 prefix
- Objective: traceability and a stable API surface.
- Files: new `backend/app/core/request_context.py` (middleware: `X-Request-ID` in/out, contextvar used by the JSON log formatter), edit `core/logging.py`, edit `main.py` (mount routers at `/api/v1`, keep `/api` as an alias for one release with a deprecation header), edit `frontend/src/services/api.ts` (base path `/api/v1`).
- Dependencies: M1.
- Tests: new `tests/test_request_context.py` (ID echoed, generated when absent, present in log records); existing API tests pass under both prefixes.
- Acceptance: every response carries `X-Request-ID`; every log line carries it.

### M4 Alembic migrations and PostgreSQL mode
- Objective: schema changes become migrations; PostgreSQL supported alongside SQLite.
- Files: new `backend/app/db/alembic/` (env, initial revision equal to current `create_all` schema), edit `db/session.py` (run migrations at startup in dev; `alembic upgrade head` documented for prod), edit `core/config.py` (`DATABASE_URL` examples), edit `ci.yml` (PostgreSQL service job), new `infra/docker-compose.full.yml` (postgres service), requirements: `alembic`, `psycopg[binary]`.
- Dependencies: M2.
- Steps: generate the initial revision from models; verify `alembic upgrade head` on empty SQLite and PostgreSQL produce identical tables; run the suite against both.
- Tests: `tests/test_migrations.py` (upgrade from empty, downgrade one step, upgrade again); the full suite parametrised by `DATABASE_URL` in CI.
- Acceptance: CI green on SQLite and PostgreSQL; existing `data/astra.db` upgrades in place with no data loss (verified on a copy).

### M5 Authentication: users and JWT
- Objective: a real principal replaces the fixed local user without breaking local use.
- Files: new `models/user.py`, new `core/security/{passwords,jwt,auth}.py`, new `api/v1/auth.py` (register, login, refresh, logout, me), edit `core/security.py` (`current_user()` dependency; `APP_ENV=development` + `AUTH_MODE=local_single_user` keeps today's behaviour), migration adding `users` and mapping existing rows to a created owner account, frontend: new `features/auth/` (login/register forms, token handling in `api.ts`), edit `App.tsx`.
- Dependencies: M3, M4. Owner decision 6 (local accounts first).
- Steps: argon2id hashing; access token 15 min, refresh token rotating in httpOnly cookie; revocation list in memory (Redis later); migration script; frontend session flow.
- Tests: `tests/test_auth.py` (register/login/refresh/logout, tampered and expired tokens, password policy), cross-user access tests for documents and conversations (404), frontend auth flow test.
- Acceptance: two accounts cannot see each other's data in any endpoint; single-user mode still starts with no login when explicitly configured.

### M6 Workspaces, RBAC, rate limits, upload hardening
- Objective: tenancy unit, abuse limits and safer uploads.
- Files: new `models/workspace.py` (+ members), migration adding `workspace_id` to documents, chunks, conversations (backfilled with each user's default workspace), edit `services/ingestion.py`, `retrieval.py`, `vector_store.py` (workspace filter), new `core/security/{rbac,ratelimit}.py`, edit `api/v1/documents.py` (magic-byte check, streaming write with hard cap, optional `MALWARE_SCAN_CMD` hook that fails closed when configured), new `storage/object_store.py` (local adapter; same interface for S3 later), frontend: minimal workspace switcher.
- Dependencies: M5.
- Tests: `tests/test_workspaces.py` (roles, member access, cross-workspace 404), `tests/test_ratelimit.py` (429 and `Retry-After`), `tests/test_upload_security.py` (PDF-with-.txt, oversized, zero bytes, zip-as-pdf), vector queries include the workspace filter (unit test on the `where` clause).
- Acceptance: all security tests in `SECURITY_DESIGN.md` §3 for Phase 1 pass.

---

## Phase 2 — Knowledge engine 2.0

### M7 Retrieval evaluation harness
- Objective: numbers before choices. Recall@K, MRR, citation accuracy, abstention correctness on real documents.
- Files: new `evaluation/golden/documents_en.jsonl`, `documents_ur.jsonl`, `crosslingual.jsonl` (question, document, expected pages, expected answer keywords), new `evaluation/harness/retrieval.py`, `answer.py`, `report.py`, reports under `evaluation/reports/`.
- Dependencies: M2. Owner: a few public-domain documents (the Ahmad Shah book is one) and 40–60 questions; I draft, owner reviews the Urdu.
- Tests: harness unit tests with the mock embedder; CI runs the harness in mock mode as a smoke test; real runs are manual and committed as reports.
- Acceptance: a baseline report for the current system exists in `EVALUATION.md`.

### M8 Chunking and embedding benchmark
- Objective: choose chunk size/overlap and the embedding model from measurement.
- Files: new `evaluation/harness/benchmark_chunking.py`, `benchmark_embeddings.py`; edit `providers/embeddings.py` only if a new model needs a different pooling or prefix (BGE-M3, multilingual-E5 use query prefixes).
- Dependencies: M7.
- Tests: provider tests for any new prefix handling; benchmark scripts have unit tests on their scoring.
- Acceptance: a decision table in `EVALUATION.md`; defaults updated only if the winner beats the baseline on EN, UR and cross-lingual recall@5.

### M9 DOCX, OCR engine switch, page assets
- Objective: more formats, the owner's PaddleOCR as engine two, and page images/tables stored for vision later.
- Files: new `services/knowledge/extraction/docx.py` (python-docx), new `extraction/ocr/{base,tesseract,paddle}.py` with `OCR_ENGINE` setting and fallback, new `models/document_asset.py` + migration, edit `ingestion.py` (store page images for OCR'd pages and extracted tables as JSON), edit `allowed_extensions`.
- Dependencies: M7; the owner's PaddleOCR folder.
- Tests: extraction tests for DOCX (headings, tables), OCR engine selection and fallback tests with a fake engine, asset rows created and deleted with the document; harness run comparing Tesseract vs PaddleOCR on 20 EN + 20 UR pages.
- Acceptance: both engines run behind the switch; default chosen from the comparison; DOCX documents reach READY with page-less citations clearly labelled.

### M10 Persisted keyword index
- Objective: BM25 no longer recomputed per request.
- Files: new `services/knowledge/keyword_index.py` (PostgreSQL `tsvector` with simple + unaccent config for EN/UR, SQLite FTS5 in local mode), migration, edit `retrieval.py` (keyword candidates from the index; coverage computed as today), edit `ingestion.py` (index on insert, remove on delete).
- Dependencies: M4.
- Tests: index built on ingest, removed on delete, parity test: fused results on the sample corpus match the in-memory BM25 ordering within tolerance; latency test on 13k synthetic chunks under 50 ms.
- Acceptance: harness recall unchanged or better; retrieval p95 under 100 ms excluding embedding.

### M11 Qdrant adapter and workspace filters
- Objective: production vector store behind the existing interface.
- Files: new `services/knowledge/vector_qdrant.py` implementing the five `vector_store` functions, edit `vector_store.py` (dispatch on `VECTOR_STORE=chroma|qdrant`), `infra/docker-compose.full.yml` (qdrant service), collection naming by model and dimension with alias for re-index, CI job with Qdrant service.
- Dependencies: M6, M8.
- Tests: the existing vector-store tests parametrised over both backends; filter tests (user, workspace, document); re-index script test (alias swap, old collection dropped after verification).
- Acceptance: suite green on Chroma and Qdrant; ten-book workspace indexed and queried live with correct filtering.

### M12 Reranker and parent-context expansion
- Objective: better top-k precision and fuller evidence.
- Files: new `providers/rerank.py` (cross-encoder; `RERANK_PROVIDER=none|local`), edit `retrieval.py` (rerank top-20 fused → top-k; expand to parent chunk or neighbouring chunks within a token cap), edit `chunking.py` (parent IDs in metadata) + migration.
- Dependencies: M7.
- Tests: reranker unit tests with a fake scorer; expansion respects the token cap and page boundaries; harness comparison.
- Acceptance: adopted as default only if citation accuracy or recall@5 improves on the harness; otherwise left off with the numbers recorded.

---

## Phase 3 — Web intelligence

### M13 Search providers and safe fetcher
- Objective: authorised web search as an evidence source.
- Files: new `providers/search.py` (interface; Tavily and Brave adapters; mock), new `services/web/{fetch,extract,score}.py` (allow-listed fetcher blocking private IP ranges and redirects to them, size and time caps, readability extraction with trafilatura, source scoring), new `models/web_source.py` + migration, settings for keys and per-user daily search caps.
- Dependencies: M6. Owner: Tavily or Brave key.
- Tests: adapters with recorded responses; fetcher blocks `127.0.0.1`, `10.x`, `169.254.x`, redirects to them, oversized bodies; extraction on fixtures; scoring deterministic.
- Acceptance: a search returns scored, extracted sources with titles, URLs and dates; nothing runs when no key is configured and the UI shows web search as unavailable.

### M14 Web evidence in answers and prompt-injection suite
- Objective: answers can combine document and web evidence with distinct citations; injection resistance is tested.
- Files: edit `services/rag.py` (evidence items carry a source kind; prompt distinguishes document, web and model knowledge; disagreement instruction), edit `schemas` and `MessageBubble.tsx` (web citations with link and date), new search decision in `assistant.py` (documents insufficient, time-sensitive intent, or Deep Research mode), new `evaluation/golden/injection.jsonl` and `harness/injection.py` run in CI with the mock provider plus a fake "obedient" provider that follows embedded instructions to prove the validator blocks the effect.
- Dependencies: M13.
- Tests: citation validation for web sources; decision logic unit tests; injection suite green.
- Acceptance: a web-grounded answer with validated links on the golden set; zero tool or behaviour changes from injected content in tests.

---

## Phase 4 — Core model intelligence

### M15 Capability registry and token budgeter
- Objective: know what each model can do and how much fits.
- Files: new `providers/llm/registry.py` (context window, tools, JSON schema, vision, locality, cost class; loaded from `models.yaml`), new `services/context/{tokenizers,budget}.py` (tiktoken / HF tokenizers; profiles Standard, Extended, Research, Long Document; reserved output tokens), edit `rag.py` (evidence trimmed to budget instead of fixed top-k), token usage recorded on messages + migration.
- Dependencies: M2.
- Tests: budget never exceeds the model's window; evidence trimmed by rank; profile switching; token counts match the tokenizer on fixtures.
- Acceptance: a request to a model with a 4k window produces a prompt under 4k minus reserved output, verified by test.

### M16 Local LLM provider and model router
- Objective: open-weight models through the same adapter, selected by policy.
- Files: new `providers/llm/local.py` (OpenAI-compatible base URL, health probe, capability entry), new `services/orchestration/router.py` (algorithm in `ARCHITECTURE_REVIEW.md` §6; chains per role; circuit breaker), edit `config.py` (`LLM_*_CHAIN`, `WORKSPACE_EXTERNAL_PROCESSING` policy), edit `assistant.py`/`rag.py` to obtain providers via the router.
- Dependencies: M15. Owner: Ollama installed with one small model for integration tests (optional; unit tests use the mock).
- Tests: router unit tests (policy exclusion, capability exclusion, health exclusion, fallback order, usage recording); integration test against Ollama marked optional.
- Acceptance: a privacy-restricted workspace never calls a hosted provider (test); existing `.env` keeps working unchanged.

### M17 Verification engine
- Objective: claims checked against evidence before the final event.
- Files: new `services/verification/{claims,support,engine}.py` (sentence-level claims; deterministic checks for numbers, dates, names present in evidence; judge-model support check via the `judge` role; outcomes: pass, regenerate once with named gaps, abstain), edit `rag.answer_question_stream` (verification before `final`; streamed text can be replaced, as today for citations), schema field `verification` on messages.
- Dependencies: M12, M14, M16.
- Tests: deterministic checks on fixtures; engine decisions with fake judge outputs; end-to-end with the mock provider; latency budget test (verification under 30 % of total).
- Acceptance: unsupported claims are removed or the answer abstains on a golden set of 30 seeded errors; no regression in answered rate on the clean set.

---

## Phase 5 — Vision and audio

### M18 Vision provider and page-image QA
- Objective: images, charts and tables understood; PDF pages answerable visually.
- Files: new `providers/vision.py` (interface: describe, answer, extract_table; Gemini, OpenAI-compatible, Ollama adapters; mock), new `api/v1/vision.py` (image upload in chat), edit `assistant.py` (Vision mode path; images are untrusted evidence), edit `ingestion.py` (page images for all pages when `STORE_PAGE_IMAGES=true`), frontend image attach and preview, new `evaluation/golden/vision.jsonl`.
- Dependencies: M9, M16. Owner: a key with vision access or an Ollama vision model.
- Tests: adapters with recorded responses; table extraction returns rows JSON; injection via image caption handled by the validator; UI tests for attach/preview.
- Acceptance: 30-item vision set scored and recorded; the mode is hidden when no vision provider is configured.

### M19 Audio: local STT, TTS, Urdu benchmark
- Objective: voice in and out, with Urdu measured.
- Files: new `providers/speech_local.py` (faster-whisper), edit `providers/speech.py` (Gemini STT/TTS adapters if available), edit `api/voice.py` (language detection from audio), frontend Voice mode (interrupt, playback controls), new `evaluation/golden/audio/` (50 EN + 50 UR utterances; owner records or supplies), harness for WER.
- Dependencies: M6. Owner: recordings and a native speaker's TTS ratings.
- Tests: adapter tests with short fixtures; endpoint limits; UI tests.
- Acceptance: WER and TTS ratings recorded in `EVALUATION.md`; Voice mode shown as ready only when both STT and TTS are configured.

---

## Phase 6 — Agents and memory

### M20 Orchestration state and tracer
- Objective: every answer is an explicit run with traced steps.
- Files: new `services/orchestration/{state,runner,tracer}.py` (RunState: mode, principal, steps with inputs/outputs/timings; the current pipeline becomes steps), new `models/run.py` + migration (`runs`, `run_steps`), edit `assistant.py` to use the runner, SSE gains optional `step` events for the UI.
- Dependencies: M17.
- Tests: runner executes the same steps as before (golden transcript test); traces persisted; step events ordered.
- Acceptance: behaviour unchanged on the suite; a trace exists for every message.

### M21 Tool registry and sandbox
- Objective: controlled tool use.
- Files: new `services/tools/{registry,schemas,sandbox,builtin/{calculator,python_tool,file_tool}}.py`, new `infra/sandbox/Dockerfile`, `models/tool_run.py` + migration, approval flow endpoint and UI component.
- Dependencies: M20. Owner: Docker.
- Tests: schema validation, permission denial, timeout, output cap, network blocked, filesystem isolated, memory limit (container tests marked requiring Docker); audit rows.
- Acceptance: all sandbox escape tests pass; sensitive tools require approval in the UI.

### M22 Memory
- Objective: long conversations stay coherent; useful preferences persist with user control.
- Files: new `services/memory/{summarize,long_term}.py`, `models/memory.py` + migration (`memories`, `conversations.summary`), edit `assistant.py` (summary replaces old turns beyond the budget), new `api/v1/memory.py` (list, edit, delete), frontend memory panel.
- Dependencies: M20.
- Tests: summarisation triggers at budget; key facts preserved (fixture); isolation across users and workspaces; delete removes influence (test asks the same question before and after).
- Acceptance: memory isolation tests pass; user can see and delete every stored memory.

### M23 Deep Research and Agent mode graphs
- Objective: multi-step research and tool workflows.
- Files: new `services/orchestration/graphs/{deep_research,agent}.py` (LangGraph only if checkpointing is used; otherwise the runner), frontend mode configs and progress UI.
- Dependencies: M21, M22.
- Tests: graph unit tests with fake tools and providers; budget and step caps; cancellation.
- Acceptance: a research question yields a traced multi-source report with validated citations.

---

## Phase 7 — Adaptive intelligence

### M24 Feedback, error memory, evaluation sets
- Files: `models/feedback.py` + migration, feedback endpoint and UI, error categorisation from verification outcomes, golden sets for every capability under `evaluation/golden/`, regression suite in CI (mock) and nightly real runs (manual until keys allow).
- Dependencies: M17.
- Acceptance: every critical workflow has a regression case; feedback is stored without raw private content unless the user opts in.

### M25 Fine-tuning pipeline
- Files: `training/` (data curation, PEFT/LoRA/QLoRA with TRL, MLflow tracking, benchmark gate, model registry, rollback by configuration).
- Dependencies: M24, a GPU.
- Acceptance: a candidate ships only if it beats the previous version on the fixed benchmark with no safety regressions; rollback tested.

---

## Phase 8 — Production readiness

### M26 Audit, load test, monitoring, backups, deployment guide
- Files: `infra/` (Caddy TLS, compose full), Prometheus client metrics, Grafana dashboard JSON, backup and restore scripts, `docs/DEPLOYMENT.md`, `docs/SECURITY_AUDIT.md`.
- Dependencies: M18, M19, M23.
- Acceptance: security checklist complete; load test at the target concurrency with p95 recorded; restore drill succeeds.
