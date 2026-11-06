# Troubleshooting

| Symptom | Cause / fix |
|---|---|
| UI shows "Can't reach the Astra server" | The backend isn't running on port 8000. Start it (see README) and click **Try again**. The Vite dev server proxies `/api` to `127.0.0.1:8000`; override with `VITE_PROXY_TARGET`. |
| Banner "Development mock mode" | No real providers are configured. Set `EMBEDDING_PROVIDER` / `LLM_PROVIDER` (+ keys and `LLM_MODEL`) in `.env` and restart. |
| Every answer is `error` / "couldn't generate an answer" | The LLM provider is misconfigured (missing key or `LLM_MODEL`), timed out, or returned non-JSON. Check backend logs for `rag_provider_error` / `rag_unparseable_output`. |
| Document FAILED: "looks scanned… OCR is not supported" | The PDF has images but no text layer. Run OCR first (e.g. `ocrmypdf in.pdf out.pdf`), then upload the result. |
| Document FAILED: "password-protected" | Remove the password and upload again. |
| Chat returns 409 `reindex_required` | You changed the embedding provider/model. Click **Retry** on the document or `POST /api/documents/{id}/reindex`. |
| Urdu questions about English documents always abstain | The mock embedder can't match across languages. Use `EMBEDDING_PROVIDER=sentence_transformers` (`pip install sentence-transformers`) or `openai`, then re-index. |
| Too many "not enough evidence" answers with a real model | Lower `MIN_VECTOR_SIMILARITY` after checking `best_similarity` in the `rag_abstain_gate` log lines and running the evaluation. |
| 🎤 button disabled | `STT_PROVIDER=disabled` (the default), or the browser has no `MediaRecorder`. Typed chat still works. |
| "Microphone access was blocked" | Allow the microphone for `localhost` in your browser's site settings. |
| "No Urdu voice is installed" | Browser speech has no Urdu voice on this device. Install an Urdu voice in the OS, or enable `TTS_PROVIDER=openai`. |
| Upload rejected with 413 | The file exceeds `MAX_UPLOAD_MB`. Behind Docker, nginx also allows at most 30 MB (`frontend/nginx.conf`). |
| Processing stuck after a crash | On startup the worker re-queues every non-terminal document automatically. Restart the backend. |
| pytest on Windows: "environment variable is longer than 32767 characters" | Give parametrized tests explicit `ids=`. Test IDs are stored in an env var. |
| Reset everything | Stop the backend, then delete the `data/` folder (uploads, DB, index). **This permanently deletes all documents.** |
