# Astra AI

**Ask your documents. Understand them faster. See the evidence.**

Astra is a bilingual (English/Urdu), voice-capable document assistant. Upload PDFs or text files, then ask questions by typing or speaking. Answers come only from retrieved passages, with page citations. If the documents don't support an answer, Astra says so.

> Astra uses **retrieval (RAG)**, not fine-tuning. Uploaded files are indexed for search; they do not become permanent model knowledge. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Quick start (Windows, Git Bash; tested)

Requirements: Python 3.12+ (tested with 3.13.12), Node 20+ (tested with 24.13.1).

```bash
# 1. Backend
cd backend
python -m venv .venv
.venv/Scripts/pip install -r requirements-dev.txt
.venv/Scripts/python -m uvicorn app.main:app --reload --port 8000
# API docs: http://127.0.0.1:8000/docs

# 2. Frontend (new terminal)
cd frontend
npm ci
npm run dev
# open http://localhost:5173
```

PowerShell: use `.venv\Scripts\python.exe` etc. On Linux/macOS: use `.venv/bin/...`.

With no `.env`, Astra runs **offline in mock mode**. Embeddings are a word-hashing stand-in and "answers" are extracted sentences labelled `[MOCK MODE]`. The UI shows a banner while this is active. To use real models, copy `.env.example` to `.env` and set the providers and keys. **Never paste keys into code or chat.**

### Docker (local only)

```bash
docker compose up --build      # UI: http://127.0.0.1:8080, API: http://127.0.0.1:8000
```

⚠ The compose file passes `docker compose config`, but **the images have not been built or run yet**, because the Docker daemon wasn't running on the development machine. Treat Docker as unverified.

## Configuration

All settings are environment variables. See [.env.example](.env.example).

| Feature | Variables | Default |
|---|---|---|
| Embeddings | `EMBEDDING_PROVIDER` (`mock`/`openai`/`sentence_transformers`), `EMBEDDING_MODEL`, `OPENAI_API_KEY` | `mock` |
| Answers | `LLM_PROVIDER` (`mock`/`anthropic`/`openai`), `LLM_MODEL`, `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` | `mock` |
| Voice | `STT_PROVIDER`, `STT_MODEL`, `TTS_PROVIDER`, `TTS_MODEL` (`disabled`/`openai`) | `disabled` |
| Evidence gate | `MIN_VECTOR_SIMILARITY`, `MIN_KEYWORD_COVERAGE`, `RETRIEVAL_TOP_K` | 0.45 / 0.6 / 6 |
| Gemini reviewer | `GEMINI_REVIEW_ENABLED`, `GEMINI_API_KEY`, `GEMINI_MODEL` | off |

When server TTS is disabled, **Listen** uses the browser's built-in speech. Whether an Urdu voice is available depends on the device.

## Tests and checks

```bash
cd backend
.venv/Scripts/ruff check . && .venv/Scripts/ruff format --check .
.venv/Scripts/mypy app devtools
.venv/Scripts/python -m pytest
.venv/Scripts/python -m evaluation.run_eval

cd ../frontend
npm run typecheck && npm test && npm run build
```

All automated tests use mocks. **No real provider (Anthropic, OpenAI, Gemini, sentence-transformers) has been called or verified yet**, because no credentials were available.

## Gemini code reviewer (optional)

```bash
# in .env: GEMINI_REVIEW_ENABLED=true, GEMINI_API_KEY=..., GEMINI_MODEL=<current model id>
cd backend && .venv/Scripts/python -m devtools.gemini_review [--diff]
```

The reviewer runs ruff, mypy and pytest. If a check fails, it sends the **redacted** output to Gemini and writes the suggestions to `backend/devtools/reports/`. It never applies changes or runs anything Gemini suggests. To disable it, set `GEMINI_REVIEW_ENABLED=false` (the default). See [docs/SECURITY.md](docs/SECURITY.md).

## Status (2026-10-28)

| Phase | State | Evidence |
|---|---|---|
| 0 Plan | ✅ | [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md), [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) |
| 1 Backend skeleton | ✅ | uvicorn served `/api/health` live |
| 2 Ingestion | ✅ | Live: sample PDF → READY with verified vector count; scanned, encrypted, corrupt and empty files → FAILED (tests) |
| 3 Grounded RAG | ✅ (mock) | Live: supported question answered with a page citation, unsupported one abstained |
| 4 Frontend | ✅ redesigned 2026-10-29 (chat, library, research reader, voice; dark/light) | 11 component tests; real-browser screenshots at desktop and phone width. Full manual click-through still pending |
| 5 Urdu + voice | ✅ adapters; ⚠ real STT/TTS unverified | Urdu detection and answers; voice disabled → typed chat works |
| 6 Gemini reviewer | ✅ (mocked HTTP) | Live Gemini call unverified |
| 7 Hardening | ✅ docs, evaluation, CI file; ⚠ Docker unbuilt, CI not yet run on GitHub | [docs/EVALUATION.md](docs/EVALUATION.md) |
| 1.5 Conversational layer (Addendum A) | ✅ intent router, templates, model roles; ⚠ LLM classifier, model comparison and Urdu human rating need a key / owner review | Live: greetings answered without retrieval; 160-case intent gate in CI |

Latest local results (2026-11-05): backend **260 passed**; ruff and mypy clean; frontend **24 passed**, typecheck and build OK. Evaluation results are in [docs/EVALUATION.md](docs/EVALUATION.md).

## Known limitations

- A free-tier Gemini key allows about 20 answers per day per model; enable billing for normal use.

- Single-user, no authentication: run it locally only.
- OCR (Tesseract) is optional and off by default; without it, scanned PDFs are rejected with an explanation.
- Conversational replies come from a fixed template bank. Urdu wording awaits native review ([docs/URDU_QA.md](docs/URDU_QA.md)).
- The mock embedder can't do paraphrase or cross-language (Urdu ↔ English) retrieval. Use a multilingual model.
- Evidence thresholds are not yet calibrated for any real embedding model.
- Voice uses push-to-talk (record, then transcribe). It is not real-time streaming.
- The in-process worker handles one document at a time. See ARCHITECTURE.md for the queue upgrade.
- SQLite tables are created with `create_all`. Add Alembic before the first production schema change.

More: [docs/SECURITY.md](docs/SECURITY.md) · [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md)
