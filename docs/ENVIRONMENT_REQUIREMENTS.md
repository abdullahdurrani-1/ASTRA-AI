# Astra AI — Environment Requirements

Date: 2026-11-05. What is needed to run, test and extend Astra, split by what exists now and what each later milestone adds. Nothing here assumes a service is configured unless stated.

## 1. Development machine (as used today)
- Windows 11 Pro; Git Bash and PowerShell. Linux/macOS work with the same commands (replace `.venv/Scripts` with `.venv/bin`).
- Python 3.13 in `backend/.venv` (project declares ≥3.12; CI and Docker should target 3.12).
- Node 20+ and npm (frontend uses Vite 6, React 19, Tailwind 4).
- Tesseract OCR installed with `eng` and `urd` traineddata (`TESSDATA_DIR` if not on the default path). Required only for scanned PDFs.
- Docker Desktop: installed; needed from M2 (image build) and M4 (PostgreSQL) onward.
- No GPU. All local models run on CPU: embeddings (fine), OCR (fine), local LLMs (slow, small models only), local STT (usable with int8 models).
- Disk: the embedding model is about 470 MB; torch CPU wheels about 200 MB; Chroma index and uploads live under `data/`.

## 2. Running the existing application
```bash
# backend
cd E:/Astra_AI/backend
.venv/Scripts/python -m uvicorn app.main:app --reload --port 8000
# frontend
cd E:/Astra_AI/frontend
npm run dev            # http://localhost:5173
```
Checks:
```bash
cd E:/Astra_AI/backend
.venv/Scripts/python -m pytest
.venv/Scripts/python -m ruff check . && .venv/Scripts/python -m ruff format --check .
.venv/Scripts/python -m mypy app devtools
.venv/Scripts/python -m evaluation.run_intent_eval
cd E:/Astra_AI/frontend
npm run typecheck && npm test && npm run build
```

## 3. Environment variables (current code, `backend/app/core/config.py`)
Values are read from `E:/Astra_AI/.env` (owner-managed; never committed, never pasted in chat).

| Group | Variables | Notes |
|---|---|---|
| App | `APP_ENV`, `LOG_LEVEL`, `CORS_ORIGINS`, `DATA_DIR`, `DATABASE_URL`, `LOCAL_USER_ID` | `APP_ENV=production` enforces model-role settings |
| Uploads | `MAX_UPLOAD_MB`, `ALLOWED_EXTENSIONS` | |
| Chunking | `CHUNK_TARGET_CHARS`, `CHUNK_OVERLAP_CHARS`, `MIN_CHARS_PER_PAGE`, `MIN_SUBSTANTIVE_CHUNK_CHARS` | |
| OCR | `OCR_ENABLED`, `OCR_LANGUAGES`, `OCR_DPI`, `TESSDATA_DIR` | |
| Embeddings | `EMBEDDING_PROVIDER` (mock, openai, sentence_transformers), `EMBEDDING_MODEL`, `EMBEDDING_BATCH_SIZE` | Default local model: paraphrase-multilingual-MiniLM-L12-v2 (384 dims) |
| LLM | `LLM_PROVIDER` (mock, openai, anthropic, gemini), `LLM_MODEL`, `LLM_MODEL_ANSWER`, `LLM_MODEL_ROUTER`, `LLM_MODEL_JUDGE`, `LLM_MODEL_FALLBACK`, `LLM_MAX_TOKENS`, `LLM_TEMPERATURE`, `LLM_MAX_RETRIES`, `LLM_REASONING_EFFORT`, `PROVIDER_TIMEOUT_SECONDS` | |
| Keys | `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `GEMINI_API_KEY` | Gemini key is free tier (about 20 answers/day/model) |
| Intent | `INTENT_CLASSIFIER_ENABLED`, `INTENT_CLASSIFIER_TIMEOUT_SECONDS`, `INTENT_MIN_CONFIDENCE`, `ALLOW_GENERAL_KNOWLEDGE` | Classifier off (too slow on Gemini) |
| Retrieval | `RETRIEVAL_TOP_K`, `RETRIEVAL_CANDIDATES`, `MIN_VECTOR_SIMILARITY`, `MIN_KEYWORD_COVERAGE` | |
| Voice | `STT_PROVIDER`, `TTS_PROVIDER`, `STT_MODEL`, `TTS_MODEL`, `TTS_VOICE`, `MAX_AUDIO_MB` | Both disabled today |
| Dev tool | `GEMINI_REVIEW_ENABLED`, `GEMINI_MODEL` | `devtools/gemini_review.py` only |

`.env.example` currently omits 14 of these; M1 brings it in line.

## 4. Minimum configurations
| Goal | Required |
|---|---|
| Run with no network and no keys | `LLM_PROVIDER=mock`, `EMBEDDING_PROVIDER=mock` (or sentence_transformers once the model is cached) |
| Real answers today | `LLM_PROVIDER=gemini`, `GEMINI_API_KEY`, `LLM_MODEL_ANSWER`, `LLM_MODEL_ROUTER`, `LLM_MODEL_FALLBACK`, `EMBEDDING_PROVIDER=sentence_transformers` |
| Scanned PDFs | Tesseract + `OCR_ENABLED=true` |
| Voice | `STT_PROVIDER=openai`, `TTS_PROVIDER=openai`, `OPENAI_API_KEY` (only adapters that exist today) |

## 5. What each later milestone adds
| Milestone | New requirement | Type |
|---|---|---|
| M1 | GitHub repository | service (free) |
| M2 | Docker build (done: `astra-backend` image, 2.8 GB); `requirements-ml.txt` for the local embedding stack | tool |
| M4 | PostgreSQL 16 container (`DATABASE_URL=postgresql+psycopg://...`) | container |
| M5 | `AUTH_SECRET` (JWT signing key, generated), `argon2-cffi`, `python-jose` or `PyJWT` | library + secret |
| M6 | optional Redis for shared rate limits; optional `MALWARE_SCAN_CMD` with ClamAV | container (optional) |
| M9 | PaddleOCR (PaddlePaddle CPU wheel, about 500 MB) via `OCR_ENGINE=paddle`; `python-docx` | library |
| M11 | Qdrant container (`VECTOR_STORE=qdrant`, `QDRANT_URL`) | container |
| M12 | cross-encoder model download (bge-reranker-v2-m3, about 1.1 GB) | model (free) |
| M13 | `TAVILY_API_KEY` and/or `BRAVE_API_KEY` | paid/free-tier key |
| M15 | `tiktoken`, HF tokenizers | library |
| M16 | Ollama with a small quantised model (`LLM_PROVIDER_LOCAL_URL`); vLLM needs a GPU | tool; GPU for larger models |
| M18 | VLM: Gemini key with billing, or Ollama vision model (CPU, slow) | key or hardware |
| M19 | faster-whisper (CTranslate2 CPU), TTS adapter keys; Urdu test recordings; native speaker ratings | library + owner time |
| M21 | Docker for the sandbox runner image | container |
| M25 | GPU with 16–24 GB VRAM (rented is fine), MLflow | hardware |
| M26 | reverse proxy with TLS (Caddy), backup target | infra |

## 6. Known platform caveats
- Windows: `uvicorn --reload` must be started from the backend folder or with `--app-dir`; parallel shell calls should use absolute paths.
- Python 3.13: all current wheels install, but ML packages release 3.12 wheels first; pin 3.12 for CI/Docker.
- Headless browser screenshots show CSS transitions mid-way; verify UI stages from the DOM, not screenshots.
- Gemini free tier: avoid benchmark loops against the live key; use the mock provider or a local model for bulk tests.
