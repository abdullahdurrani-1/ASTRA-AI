# Security & Privacy

## Deployment scope

Astra MVP is **single-user and local-only**. There is no authentication. Docker Compose binds to `127.0.0.1`. **Do not expose it on a public network** until auth is added (replace `app/core/security.py::current_user_id`). Every query is already filtered by `user_id`, so adding auth is a narrow change.

## Controls implemented

| Area | Control | Where |
|---|---|---|
| Secrets | Env vars only (`SecretStr`, never logged); only `.env.example` is committed | `core/config.py`, `.gitignore` |
| Uploads | Extension allowlist, PDF magic-byte check, NUL-byte check for text, streaming size limit (413), empty-file rejection | `services/ingestion.py` |
| Path traversal | Client filename is reduced to its base name and used only for display; files are stored under random 128-bit names | `services/ingestion.py` |
| Data exposure | Responses never include storage paths, hashes or stack traces; unhandled errors return a generic message | `schemas`, `core/errors.py` |
| Access scoping | Documents, chunks, vectors and conversations are filtered by `user_id`; chat checks that every selected document belongs to the user | `services/rag.py`, `services/retrieval.py`, `services/vector_store.py` |
| Prompt injection | Passages are wrapped in `<evidence>` tags and tag-escaped; the system prompt says evidence is untrusted data; citations are validated against retrieved chunks; page numbers come from the DB, never the LLM | `services/rag.py` |
| Logging | JSON logs contain IDs, counts, timings and statuses only, with no document text, prompts, audio or keys | `core/logging.py` |
| Deletion | Vectors, then chunks and metadata, then the stored file are deleted together; documents that are still processing cannot be deleted | `services/ingestion.py` |
| Audio | Processed in memory, never written to disk; recordings are capped at 60 s in the browser and by `MAX_AUDIO_MB` on the server | `api/voice.py`, `useRecorder.ts` |
| CORS | Limited to the configured dev origins and methods | `main.py` |

Prompt-injection defences **reduce** risk. They cannot fully prevent a model from being influenced by malicious document text.

## Third-party data flows

| Setting | What leaves your machine |
|---|---|
| `EMBEDDING_PROVIDER=openai` | Every chunk of every uploaded document (at indexing) and every question |
| `LLM_PROVIDER=anthropic` / `openai` | The question plus up to `RETRIEVAL_TOP_K` retrieved passages per question |
| `STT_PROVIDER=openai` | Your voice recording |
| `TTS_PROVIDER=openai` | The answer text |
| `GEMINI_REVIEW_ENABLED=true` | Only **redacted** failing check output (and `git diff` of `app/` and `tests/` if `--diff` is passed). Never documents, conversations or `.env` |
| `mock` / `sentence_transformers` / `disabled` | Nothing. Everything stays local (sentence-transformers downloads model weights once) |

Provider retention policies are set by each provider. Check them before uploading sensitive material.

## Gemini reviewer guarantees

`backend/devtools/gemini_review.py`:
- Is off by default and is never imported by the app.
- Executes only a fixed allowlist: `ruff`, `mypy`, `pytest`, and optionally `git diff`.
- Writes suggestions to a Markdown report. It **never applies patches, runs suggested commands, installs packages or edits files**. This is covered by tests.

## Known gaps

- No authentication, rate limiting or CSRF protection (local-only scope).
- No antivirus scanning of uploads.
- SQLite and Chroma files are not encrypted at rest.
- Dependency vulnerability scanning (`pip-audit`, `npm audit`) is not yet part of CI.
