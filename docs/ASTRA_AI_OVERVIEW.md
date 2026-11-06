# Astra AI — Complete Project Overview

> **Ask your documents. Understand them faster. See the evidence.**

Status as of 2026-11-05. This is the one document to read first. It explains what Astra is, how it works end to end, what has been built and verified, what is planned for Astra 2.0, how to run it, and where everything lives. Deeper documents are linked at the end.

---

## 1. What Astra AI is

Astra AI is a **bilingual (English and Urdu) document intelligence assistant**. You upload books, papers, notes or reports; Astra reads and indexes them; you ask questions by typing (and, once configured, by voice) in English or Urdu; Astra answers **only from your documents**, shows **page-level citations** with the exact passage, and **says honestly when the documents do not contain the answer**.

It is built for students, researchers, lawyers, historians and business users who work with long documents, including scanned books, and who need answers they can check.

### What makes it different from a chatbot wrapper
- **Grounded by design.** The model only sees retrieved passages, marked as untrusted data. It must cite them. Citations are verified against what was actually retrieved; page numbers come from Astra's database, never from the model.
- **Honest abstention.** An evidence gate runs before the model is called. Weak evidence means a polite "I couldn't find enough information" instead of an invented answer.
- **Bilingual at every layer.** Urdu and Roman Urdu are understood by the intent router; Urdu questions are also searched in English so an English book answers an Urdu question; answers render right-to-left.
- **Tolerant of real users.** Misspellings and follow-ups ("who was his fathr?") are rewritten before search; greetings and "what can you do?" are answered without touching the documents.
- **Scanned books work.** OCR turns image-only PDFs into searchable text; running page headers that pollute search are filtered out.
- **Provider independence.** Language models, embeddings and speech are behind interchangeable adapters. Today the answer model is Gemini; tomorrow it can be a local open-weight model.

---

## 2. How it works (plain explanation)

Astra uses **Retrieval-Augmented Generation (RAG)**. Uploading a book does not train a model. Instead:

### Ingestion (when you upload)
1. **Validate** the file (type, size, duplicates, encryption, corruption).
2. **Extract** text page by page with PyMuPDF. Pages without text are sent to **OCR** (Tesseract, English + Urdu).
3. **Clean** the text (repeated page headers are removed; running headers are merged into the text that follows).
4. **Chunk** it into passages that respect headings and page boundaries, keeping page numbers and section titles.
5. **Embed** every chunk into a vector (a list of numbers capturing meaning) with a local multilingual model.
6. **Index** the vectors (Chroma) and store the chunks (SQLite). Astra verifies the index count before marking the document READY. Failures are reported with a human-readable reason. Interrupted jobs resume after a restart.

### Answering (when you ask)
1. **Intent routing.** A fast lexicon router (English, Urdu, Roman Urdu) decides: greeting or small talk, capability question, general-knowledge question, or document question. Greetings are answered from templates immediately.
2. **Rewrite.** A small model fixes typos, resolves pronouns using the conversation ("his father" becomes "Ahmad Shah's father"), and adds an English search version for Urdu questions. Your original words stay in the transcript; the UI shows "Searched for: ...".
3. **Hybrid retrieval**, limited to the documents you selected: vector similarity search plus keyword (BM25) search, for each phrasing, fused with reciprocal-rank fusion. Header-like fragments are dropped.
4. **Evidence gate.** If the best passage is not similar enough and does not cover the keywords, Astra abstains without calling the model.
5. **Generation.** The answer model receives the passages as untrusted evidence and must return JSON with a status, an answer, and citation IDs. The answer is **streamed** word by word to the screen.
6. **Validation.** Citation IDs are checked against the retrieved set; invalid ones are dropped; if none remain, the status becomes "insufficient evidence". Page numbers and excerpts are filled from the database.
7. **Persist.** Question, answer, status, language and citations are saved to the conversation.

```
Browser (React) ──JSON / SSE──> FastAPI ──> intent → rewrite → retrieval → gate → LLM → validate
                                   │                    ├── Chroma (vectors)
                                   │                    └── SQLite (documents, chunks, conversations)
                                   └── background worker: ingestion (extract → OCR → chunk → embed → verify)
```

---

## 3. The user interface

A single-page app with a burgundy-and-black glassmorphism theme, dark and light modes, full RTL support, a cinematic brand intro (plays once per tab; skip or Escape; respects reduced-motion), and four modes:

| Mode | What it does |
|---|---|
| **Chat** | Ask questions; answers type out ChatGPT-style; Copy and Listen buttons; Sources list with page, section and passage; "Open page in reader" jumps to the exact page; suggested follow-ups; language selector (Auto / English / اردو). |
| **Library** | Upload (drag and drop or attach), processing status, failure reasons, select which documents to search. |
| **Research** | Document reader side by side with chat; citations open the page in the reader. |
| **Voice** | Microphone input and spoken answers. Shown as disabled until a speech provider is configured; typed chat always works. |

Accessibility: keyboard navigation, ARIA labels, live regions for streaming, focus management during the intro, reduced-motion fallbacks. Works at phone width.

---

## 4. Technology (as built and verified)

| Layer | Technology |
|---|---|
| Frontend | React 19, TypeScript 5, Vite 6, Tailwind CSS 4, react-markdown, vitest |
| Backend | Python 3.12+, FastAPI, Pydantic 2, SQLAlchemy 2, uvicorn |
| Storage | SQLite (metadata, chunks, conversations), Chroma (vectors), local filesystem (uploads) |
| Document processing | PyMuPDF (PDF), Tesseract OCR (eng + urd), heading-aware chunker |
| Embeddings | sentence-transformers multilingual model, runs locally on CPU |
| Language models | Gemini (via its OpenAI-compatible API), OpenAI, Anthropic, or mock; per-role models (answer, router, judge, fallback); retries, timeouts, fallback |
| Speech | OpenAI STT/TTS adapters (not configured) |
| Quality | pytest (260 tests), vitest (24 tests), ruff, mypy, intent evaluation gate (160+ cases), GitHub Actions workflow |
| Deployment | Dockerfiles and docker-compose (written, not yet built) |

---

## 5. What has been built and verified

| Area | Status | Evidence |
|---|---|---|
| Ingestion (text PDFs, scanned PDFs, TXT, MD) | ✅ | Live: 479-page scanned book indexed (1,326 chunks); corrupt, encrypted, empty files fail cleanly (tests) |
| Grounded answers with page citations | ✅ | Live with Gemini on the real book; fabricated and cross-document citations rejected (tests) |
| Abstention on unsupported questions | ✅ | Tests + live |
| Conversational layer (EN / UR / Roman Urdu) | ✅ | 160+ case gate in CI; live greetings |
| Typo and follow-up rewrite | ✅ unit-tested; live quality to observe | Tests with fake models; quota prevented live runs |
| Urdu question over English book | ✅ | Offline check: biography page now top result |
| Streaming answers with typewriter | ✅ | Tests + live greeting stream |
| Frontend (chat, library, research, voice shell) | ✅ | 24 tests, build clean, browser verified |
| Brand intro and theme | ✅ | Judged geometry; DOM-verified stages |
| Voice (speech in / out) | ⚠ adapters only | Needs a speech provider and an Urdu quality check |
| Docker / CI on GitHub | ⚠ written, never run | Folder is not a git repository yet |

Known limitations today:
- **Single user, local only.** There is no login; one configured user ID is used. Do not expose the port.
- **Gemini free tier** allows roughly 20 answers per day per model.
- Urdu OCR, speech and embedding quality are not yet measured on Nastaliq scans or Urdu audio.
- Two ML dependencies are installed but not declared in requirements; Tesseract is missing from the Dockerfile.

---

## 6. Where it is going: Astra AI 2.0

The owner's master engineering prompt defines Astra 2.0 as an independent, multimodal intelligence platform. The Phase 0 assessment is done; implementation starts on approval. In order:

1. **Core platform**: git and CI, dependency pinning, authentication with accounts and workspaces, PostgreSQL with migrations, rate limiting, versioned API.
2. **Knowledge engine 2.0**: Qdrant vector store, DOCX, PaddleOCR as a second OCR engine, page images and tables as assets, reranking, parent-context expansion, measured chunk and embedding choices, multi-book collections.
3. **Web intelligence**: authorised search providers (Tavily, Brave), search decision logic, source scoring, web citations, strict isolation of page content from instructions.
4. **Core model intelligence**: local open-weight models (Ollama on CPU, vLLM on GPU), context budgeting with real token counts, model router, a verification engine that checks claims against evidence before the answer is final.
5. **Vision and audio**: image, chart, table and diagram understanding; local speech recognition; text-to-speech; Urdu voice measured, not assumed.
6. **Agents and memory**: traced multi-step workflows (LangGraph for Deep Research and Agent mode), sandboxed Python, conversation summaries, long-term memory with user controls.
7. **Adaptive intelligence**: feedback, error categories, evaluation datasets, controlled fine-tuning with benchmark gates and rollback.
8. **Production readiness**: security audit, load tests, monitoring, backups, deployment guide.

Seven user modes will sit on top: General Chat, Document Intelligence, Deep Research, Advanced Reasoning, Vision, Voice, Agent. A mode is shown only when the backend truly supports it.

---

## 7. How to run it

Prerequisites: Python 3.12+, Node 20+, Tesseract installed with `eng` and `urd` data (for scanned PDFs).

```bash
# Terminal 1: backend
cd E:/Astra_AI/backend
.venv/Scripts/python -m uvicorn app.main:app --reload --port 8000

# Terminal 2: frontend
cd E:/Astra_AI/frontend
npm run dev
```

Open **http://localhost:5173**, upload or tick a document, and ask a question. Health check: http://localhost:8000/api/health.

Run the checks:
```bash
cd E:/Astra_AI/backend  && .venv/Scripts/python -m pytest && .venv/Scripts/python -m ruff check . && .venv/Scripts/python -m mypy app
cd E:/Astra_AI/frontend && npm run typecheck && npm test && npm run build
```

### Settings (`E:/Astra_AI/.env`, owner-managed)
| Setting | Current value | Meaning |
|---|---|---|
| `LLM_PROVIDER` | `gemini` | Answer model provider (`mock`, `openai`, `anthropic`, `gemini`) |
| `LLM_MODEL_ANSWER` / `ROUTER` / `FALLBACK` | gemini-3.5-flash / gemini-3.1-flash-lite / gemini-3.1-flash-lite | Model per role |
| `LLM_REASONING_EFFORT` | `low` | Faster answers |
| `PROVIDER_TIMEOUT_SECONDS` | `60` | Per-call timeout |
| `EMBEDDING_PROVIDER` | `sentence_transformers` | Local, free, multilingual |
| `OCR_ENABLED` / `OCR_LANGUAGES` | `true` / eng+urd | Scanned PDFs |
| `MAX_UPLOAD_MB` | `50` | Upload limit |
| `STT_PROVIDER` / `TTS_PROVIDER` | disabled | Voice |
| `ALLOW_GENERAL_KNOWLEDGE` | `false` | Astra refuses off-document questions |

API keys live only in `.env`, which git must ignore. Never paste keys into chat or code.

---

## 8. Privacy

| Setup | What leaves your computer |
|---|---|
| Local embeddings + OCR + mock model | Nothing |
| Current setup (Gemini answer model) | Your question (and its rewrite) plus the few retrieved passages, per question |
| OpenAI embeddings (optional) | Every passage once, at indexing |
| Hosted speech (optional) | Your recordings and the answer text |

Astra 2.0 adds a per-workspace "no external processing" setting that restricts the router to local models.

---

## 9. Project map

```
Astra_AI/
├── backend/
│   ├── app/
│   │   ├── api/         chat (JSON + SSE), documents, health, voice
│   │   ├── core/        settings, errors, logging, identity
│   │   ├── services/    intent, normalize, conversation, rewrite, extraction, chunking,
│   │   │                ingestion, vector_store, retrieval, rag, streaming_json, language
│   │   ├── providers/   llm, embeddings, speech adapters
│   │   ├── workers/     background ingestion executor
│   │   ├── models/ schemas/ db/
│   │   └── data/        intent lexicons and reply templates (YAML)
│   ├── tests/           260 tests
│   ├── evaluation/      golden sets and evaluation runners
│   └── devtools/        helper scripts (e.g. Urdu string export)
├── frontend/src/        components, pages, hooks, services, brand, styles, tests
├── docs/
│   ├── ASTRA_AI_OVERVIEW.md         this file
│   ├── ASTRA_ARCHITECTURE.md        as-built and target architecture (Phase 0)
│   ├── IMPLEMENTATION_ROADMAP.md    phases 1–8 with exit criteria
│   ├── TECH_STACK.md                now vs target, with reasons
│   ├── SECURITY_DESIGN.md           current posture, target controls, test plan
│   ├── AI_MODEL_STRATEGY.md         roles, candidates, evaluation rules
│   ├── DEVELOPMENT_STATUS.md        updated after every phase
│   ├── EVALUATION.md                every measurement and root-cause note so far
│   ├── ARCHITECTURE.md, SECURITY.md, TROUBLESHOOTING.md, URDU_QA.md   (1.x references)
├── data/                uploads, database, vector index (git-ignored)
├── .env / .env.example
├── docker-compose.yml
└── README.md
```
