# Astra AI — Architecture

## Big picture (beginner-friendly)

Astra uses **Retrieval-Augmented Generation (RAG)**. Uploading a file does **not** teach or fine-tune a model. Instead:

1. **Ingest** – the text is extracted page by page, split into small passages ("chunks"), and each chunk is turned into a vector (a list of numbers capturing meaning) by an *embedding model*. Vectors are stored in an index (Chroma).
2. **Retrieve** – when you ask a question, the question is embedded too, and the closest chunks are found (vector search), combined with classic keyword search (BM25).
3. **Check evidence** – before calling the LLM, Astra checks whether the best chunks are actually relevant. If not, it abstains.
4. **Generate** – the LLM gets only those chunks, marked as *untrusted evidence*, and must answer from them and cite chunk IDs.
5. **Validate** – cited IDs are checked against what was actually retrieved; invalid ones are dropped. Page numbers come from our database, never from the LLM.

```
Browser (React) ──HTTP──> FastAPI ──> services ──> providers (embeddings / LLM / STT / TTS)
                                │             └──> Chroma (vectors)
                                └──> SQLite (documents, chunks, conversations)
                 background worker thread ── ingestion pipeline
```

## Backend layout (`backend/app`)

| Package | Responsibility |
|---|---|
| `core/` | Settings (env vars), structured JSON logging, error types/handlers |
| `db/` | SQLAlchemy engine/session, table creation |
| `models/` | ORM tables: `Document`, `Chunk`, `Conversation`, `Message` |
| `schemas/` | Pydantic request/response models (the API contract) |
| `providers/` | Replaceable adapters: embeddings, LLM, speech. Each has a `mock`/`disabled` variant |
| `services/` | Business logic: extraction, chunking, vector store, ingestion pipeline, retrieval, RAG, language |
| `workers/` | Background ingestion executor + recovery of interrupted jobs |
| `api/` | HTTP routes only — thin, delegate to services |

## Document lifecycle

`UPLOADED → EXTRACTING → CHUNKING → EMBEDDING → INDEXING → VERIFYING → READY`, or `FAILED` (with a user-safe message).

- **Idempotent:** every run first deletes the document's existing chunks and vectors, so a retry never duplicates data.
- **Verification:** `READY` is set only if the number of vectors in Chroma for the document equals the number of chunks in SQLite.
- **Quality gates:** encrypted, corrupt, empty, and likely-scanned PDFs fail with a clear message. **No OCR is performed.**
- **Delete:** vectors → chunks/metadata → stored file.

## Embedding index safety

The Chroma collection name includes the embedding provider, model and dimension. Switching models therefore never mixes incompatible vectors — documents simply need re-indexing (`POST /api/documents/{id}/reindex`).

## Security boundaries

- Retrieved passages are wrapped in `<evidence>` tags and the system prompt states they are data, not instructions (prompt-injection defence; reduces risk, not a guarantee).
- All DB and vector queries are filtered by `user_id` and selected `document_id`s.
- Uploads: extension + magic-byte check, size limit, random storage names, files kept outside any served directory.
- Logs contain IDs, sizes, timings, and statuses — never document text, prompts, audio, or keys.

## Upgrade paths

- **Queue:** replace `workers/executor.py` with RQ/Celery + Redis; `run_ingestion(document_id)` is already a pure, idempotent job function.
- **Database:** set `DATABASE_URL` to PostgreSQL; introduce Alembic migrations.
- **Vectors:** `services/vector_store.py` is the only Chroma-aware module; pgvector can replace it behind the same interface.
- **Auth:** replace `core/security.current_user_id()` with real authentication.
