# Astra AI — Security Design

Written 2026-11-05. Supersedes the threat notes in `SECURITY.md` for Astra 2.0 planning; that file remains the record of the 1.x controls.

## 1. Current posture (as inspected)

Strengths already in place:
- Every query is filtered by `user_id` (documents, chunks, conversations, vector queries). Ownership checks return 404 for foreign IDs.
- Uploads: extension allow-list, size limit, SHA-256 de-duplication, encrypted/corrupt/empty PDFs rejected with safe messages, files served with `nosniff` and a sandbox CSP for text files.
- Prompt design: evidence wrapped as untrusted data with tag escaping; citations validated against retrieved IDs; page numbers from DB only; injection/key-mash inputs detected by the intent router.
- Secrets only from environment; `.env` is owner-managed; logs are JSON without document content.
- Provider calls have timeouts and bounded retries.
- CORS restricted to configured origins; Docker compose binds to 127.0.0.1.

Weaknesses (ordered by severity):
1. **No authentication.** A single configured user ID is applied to every request. Any process that can reach port 8000 is that user. Acceptable only on a local machine; blocks any shared deployment.
2. **No rate limiting.** Upload and chat endpoints can be hammered; the LLM quota (free tier) can be drained by one loop.
3. **Upload content is trusted by extension.** No magic-byte check for PDFs, no malware scanning.
4. **No audit log** of who did what.
5. **No API versioning**; breaking changes would hit the UI silently.
6. **Dependencies unpinned in practice** for ML packages (installed but undeclared), so a clean install differs from the running one.
7. **Secrets in `.env` next to the repo** and the folder is not yet a git repository: the first commit must exclude `.env`, `data/`, and venvs.

## 2. Target controls by layer

### Identity and access (Phase 1)
- Local accounts with argon2id hashing; JWT access tokens (15 min) + rotating refresh tokens (httpOnly cookie), revocation list in Redis.
- OIDC adapter interface (Google/Microsoft) for later; same session model.
- Workspaces with roles: owner, editor, viewer. Every table that holds user content carries `workspace_id`; every repository function takes the authenticated principal and applies the filter. No endpoint reads an ID from the client without an ownership query.
- Vector queries always include `workspace_id` and `document_id` filters server-side (Qdrant payload filters), never relying on the client's document list.

### API gateway (Phase 1)
- `/api/v1` prefix; central error handler keeps internal details out of responses.
- Rate limits per principal and per IP (uploads, chat, search, voice) with 429 and `Retry-After`.
- Request size limits; multipart streamed to disk with a hard cap; magic-byte validation (PDF, DOCX zip signature, text UTF-8 check); optional ClamAV scan hook (`MALWARE_SCAN_CMD`), fail-closed when configured.
- Request ID and trace ID on every response and log line.
- CORS allow-list, security headers (CSP for the SPA, HSTS behind TLS, `X-Content-Type-Options`, `Referrer-Policy`).
- TLS terminated by a reverse proxy (Caddy or nginx) in the compose file; the app never listens publicly without it.

### Prompt-injection and untrusted content (every phase)
- Documents, web pages, OCR text, image descriptions, and tool outputs are data. They are wrapped in delimited evidence blocks, never concatenated into the system prompt.
- Tool calls are validated by the tool registry against schema, permissions, and mode; a model-proposed call is a request, not an authorisation. Sensitive tools require explicit user approval in the UI.
- Web content is fetched through an allow-listed fetcher (no local/private IP ranges, size and time caps, HTML sanitised to text).
- A prompt-injection test suite (documents and web pages carrying instructions) runs in CI; expected result is that no instruction from content changes behaviour or triggers a tool.

### Data protection
- Encryption at rest: PostgreSQL volume and object storage encrypted at the platform level; application-level encryption for stored refresh tokens and API keys supplied by users (if ever added).
- Privacy setting per workspace: `external_processing: allowed | denied`. When denied, document text and images are never sent to hosted providers; only local providers are eligible, and the router enforces it.
- Retention policy and deletion: deleting a document removes its chunks, vectors, assets, and citations; deleting a conversation removes messages and memories derived from it; user deletion cascades.
- Backups: nightly PostgreSQL dump + Qdrant snapshot + object storage sync; restore drill in Phase 8.

### Sandboxed tools (Phase 6)
- Python runs in a disposable container: no network, CPU and memory limits, read-only image, a scratch volume per run, 30 s wall clock, output size cap. Never `exec` in the API process.
- Database access for tools goes through application services with the caller's principal, never raw SQL.

### Logging and audit
- Audit events: login, logout, upload, delete, share, memory edit, tool approval, provider switch, admin actions.
- Never log passwords, tokens, API keys, document content, or audio. Request bodies are logged only as sizes and hashes.

### Supply chain
- Pinned dependencies; `pip-audit` and `npm audit` in CI; Dependabot or Renovate.
- Docker images built from pinned base images; non-root user; health checks.

## 3. Security test plan
| Test | Phase |
|---|---|
| Cross-user access attempts on every resource type return 404 | 1 |
| Rate limit triggers and recovers | 1 |
| Malformed/mislabelled uploads rejected (PDF with .txt, zip bomb, 0-byte, oversized) | 1 |
| JWT tampering, expired, revoked tokens rejected | 1 |
| Prompt injection via document, web page, image caption, tool output | 3–6 |
| Fetcher blocks private IPs and redirects to them | 3 |
| Sandbox: network, filesystem, time, memory escapes | 6 |
| Memory isolation across users and workspaces | 6 |
| Dependency audit clean or triaged | every CI run |
