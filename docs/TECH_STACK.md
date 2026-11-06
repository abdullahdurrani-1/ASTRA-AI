# Astra AI — Technology Stack

Written 2026-11-05. "Now" is what the repository uses and has been verified running. "Target" is the Astra 2.0 choice and the reason. Nothing in the Target column is installed until its phase.

| Component | Now (verified) | Target | Why / decision |
|---|---|---|---|
| Frontend | React 19, Vite 6, TypeScript 5, Tailwind 4, react-markdown | Keep. Framer Motion only if a need appears | Next.js adds SSR and a server we do not need; Vite build is 1.3 MB and fast. Existing CSS animations suffice today. |
| Backend | FastAPI 0.162, Pydantic 2.14, uvicorn | Keep | Already typed, tested, streaming works. |
| Relational DB | SQLite via SQLAlchemy 2.1, `create_all` | PostgreSQL 16 + Alembic; SQLite kept for tests and single-user local | Multi-user, concurrency, JSONB, migrations. |
| Vector DB | Chroma 1.5 (local persistent) | Qdrant (Docker); Chroma kept as no-infra option | Payload filtering, named vectors, collection aliases for re-index, server-side isolation. |
| Cache / queues | none (thread executor) | Redis 7 (rate limits, sessions, ingestion queue via RQ or arq) | Needed once more than one worker process exists. |
| Object storage | local `data/uploads` | S3-compatible adapter (MinIO in Docker) + local adapter | Page images, assets, audio. |
| Document parsing | PyMuPDF 2.0 | + python-docx; Docling evaluated for layout/tables | Docling is heavy; adopt only if its table extraction measurably beats PyMuPDF on our PDFs. |
| OCR | Tesseract (eng+urd) via PyMuPDF | `OCR_ENGINE` switch: Tesseract or PaddleOCR (owner's project) | Measured on the same 20 EN and 20 UR pages before choosing a default. |
| Embeddings | sentence-transformers (multilingual MiniLM-class, local CPU) | Benchmark BGE-M3 and multilingual-E5-base; dimension read from model | Cross-lingual recall is the deciding metric. |
| Reranking | none | bge-reranker-v2-m3 (cross-encoder, CPU-feasible at top-20) | Phase 2. |
| LLM (hosted) | Gemini (OpenAI-compatible endpoint), OpenAI, Anthropic adapters | Keep as optional providers | Owner's Gemini key is free tier. |
| LLM (local) | none | Ollama (CPU dev) / vLLM (GPU) via the OpenAI-compatible adapter | Same wire format as today's provider. |
| Model families to evaluate | — | Qwen 3 (strong multilingual), Gemma 3, Llama 3.x; sizes 4B–8B quantised for CPU | Chosen by EN/UR golden-set results, licence, tool calling. |
| Orchestration | linear service calls | explicit state object; LangGraph for Deep Research and Agent mode | Avoid a framework where a function suffices. |
| Vision | none | Gemini / OpenAI-compatible VLM / Ollama (e.g. Qwen-VL class) behind one interface | Phase 5. |
| STT | OpenAI adapter (unconfigured) | faster-whisper local (CPU int8), Gemini, OpenAI | Urdu WER measured before promising. |
| TTS | OpenAI adapter (unconfigured) | OpenAI, Piper/Coqui local candidates | Urdu naturalness rated by a native speaker. |
| Web search | none | Tavily, Brave; Google PSE optional; readability extraction with trafilatura | No scraping of search engines. |
| Sandbox | none | Docker-based Python runner with limits | Phase 6. |
| Auth | single local user | local accounts (argon2) + JWT; OIDC adapter | Phase 1. |
| Testing | pytest 9 (260), vitest (24), ruff, mypy | + Playwright, prompt-injection suite, load test (k6 or locust) | |
| CI/CD | GitHub Actions workflow (never run: no git repo yet) | Same, plus Docker build and evaluation gates | Phase 1 item 1. |
| Observability | JSON logging | request/trace IDs, Prometheus client, Grafana dashboards; OpenTelemetry optional | Phase 8 full, basics in Phase 1. |
| Experiment tracking | none | MLflow (Phase 7), DVC for golden datasets | Only when fine-tuning starts. |
| Deployment | Dockerfiles + compose (unbuilt) | Same, verified; no Kubernetes | |

## Dependency hygiene to fix in Phase 1
- `backend/requirements.txt` does not list `sentence-transformers` or `torch` although `EMBEDDING_PROVIDER=sentence_transformers` is the live configuration; pin them (CPU torch index).
- Tesseract and its `urd` traineddata are not installed in `backend/Dockerfile`.
- Python 3.13 is used locally; `pyproject` says `>=3.12`. Keep 3.12 as the CI/Docker target until all ML wheels are confirmed for 3.13.
