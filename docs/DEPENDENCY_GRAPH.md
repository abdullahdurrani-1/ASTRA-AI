# Astra AI — Implementation Dependency Graph

Milestone IDs refer to `IMPLEMENTATION_PLAN.md`. An arrow means "must be complete first". Milestones in the same column with no arrow between them can run in parallel.

```mermaid
graph TD
  M1[M1 Git, ignore file, CI runs] --> M2[M2 Dependency pinning + Docker build]
  M1 --> M3[M3 Request IDs, API v1 prefix]
  M2 --> M4[M4 Alembic migrations, PostgreSQL mode]
  M3 --> M5[M5 Auth: users, JWT]
  M4 --> M5
  M5 --> M6[M6 Workspaces, RBAC, rate limits, upload hardening]
  M2 --> M7[M7 Retrieval evaluation harness]
  M7 --> M8[M8 Chunking + embedding benchmark]
  M7 --> M9[M9 DOCX, OCR engine switch, assets]
  M4 --> M10[M10 Persisted keyword index]
  M6 --> M11[M11 Qdrant adapter + workspace filters]
  M8 --> M11
  M7 --> M12[M12 Reranker + parent context]
  M6 --> M13[M13 Web search providers + safe fetcher]
  M13 --> M14[M14 Web evidence in answers + injection suite]
  M2 --> M15[M15 Capability registry + token budgeter]
  M15 --> M16[M16 Local LLM provider + model router]
  M14 --> M17[M17 Verification engine]
  M16 --> M17
  M12 --> M17
  M9 --> M18[M18 Vision provider + page-image QA]
  M16 --> M18
  M6 --> M19[M19 Audio: local STT, TTS, Urdu benchmark]
  M17 --> M20[M20 Orchestration state + tracer]
  M20 --> M21[M21 Tool registry + sandbox]
  M20 --> M22[M22 Memory: summaries, long-term, controls]
  M21 --> M23[M23 Deep Research + Agent mode graphs]
  M22 --> M23
  M17 --> M24[M24 Feedback, error memory, evaluation sets]
  M24 --> M25[M25 Fine-tuning pipeline (GPU)]
  M23 --> M26[M26 Production: audit, load test, monitoring, backups]
  M19 --> M26
  M18 --> M26
```

## Prerequisite table

| Milestone | Depends on | Why |
|---|---|---|
| M1 Git + CI | — | Everything else needs version control and a green baseline |
| M2 Pinning + Docker | M1 | CI must install the real dependency set; Docker build proves it |
| M3 Request IDs + v1 | M1 | Tracing before new endpoints are added |
| M4 Alembic + PostgreSQL | M2 | Schema changes from M5 onward need migrations; CI needs the PostgreSQL service |
| M5 Auth | M3, M4 | New tables (migration), new middleware (request context) |
| M6 Workspaces, RBAC, limits, upload hardening | M5 | Needs a principal to authorise and to count against |
| M7 Retrieval harness | M2 | Needs declared ML dependencies to run embeddings in CI |
| M8 Chunk/embedding benchmark | M7 | Cannot choose without measurement |
| M9 DOCX, OCR switch, assets | M7 | OCR engines compared with the same harness; assets need storage adapter from M2's layout |
| M10 Keyword index | M4 | Uses PostgreSQL full-text (SQLite FTS5 in local mode) |
| M11 Qdrant + workspace filters | M6, M8 | Payload filters need workspace IDs; collection layout needs the chosen embedding |
| M12 Reranker + parent context | M7 | Adopted only if the harness shows a gain |
| M13 Web providers + fetcher | M6 | Rate limits and keys per principal |
| M14 Web evidence + injection suite | M13 | Prompt changes once web evidence exists |
| M15 Registry + budgeter | M2 | Tokenizers are dependencies |
| M16 Local LLM + router | M15 | Router reads the registry and budgets |
| M17 Verification | M12, M14, M16 | Needs the final evidence shape (reranked, web) and a judge model slot |
| M18 Vision | M9, M16 | Page images from ingestion; router selects VLM |
| M19 Audio | M6 | Upload limits and auth for audio endpoints |
| M20 Orchestration | M17 | Wraps the complete pipeline |
| M21 Tools + sandbox | M20 | Tool calls are orchestration steps |
| M22 Memory | M20 | Memory read/write are orchestration steps |
| M23 Deep Research + Agent | M21, M22 | Graphs use tools and memory |
| M24 Feedback + evaluation sets | M17 | Error categories map to verification outcomes |
| M25 Fine-tuning | M24, GPU | Curated data and a fixed benchmark first |
| M26 Production | M18, M19, M23 | Audit covers all surfaces |

## Critical path
M1 → M2 → M4 → M5 → M6 → M11 → M17 → M20 → M21/M22 → M23 → M26. Roughly 22–30 sessions if nothing else is done; parallel tracks (M7–M9, M13–M14, M15–M16, M19) shorten calendar time when run alongside.

## Parallel tracks after M6
- Knowledge track: M7 → M8 → M11, M9, M10, M12.
- Web track: M13 → M14.
- Model track: M15 → M16.
- Audio track: M19.
These converge at M17 (verification).
