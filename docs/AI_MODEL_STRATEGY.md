# Astra AI — Model Strategy

Written 2026-11-05. Governs how language, embedding, reranking, vision, and speech models are chosen, wired, evaluated, and (later) improved.

## 1. Principles
1. **Astra is the system, not the model.** Identity lives in routing, retrieval, verification, memory, and evaluation. Any model behind a role can be swapped by configuration.
2. **No unverified claims.** A model becomes a default only after it is measured on the project's golden sets. We do not say "Astra's own model" until a fine-tune has been trained, evaluated, and released through the Phase 7 pipeline.
3. **Roles, not one model.** Roles: `answer`, `router` (intent/rewrite/translation), `judge` (verification), `fallback`, `embed`, `rerank`, `vision`, `stt`, `tts`. Each role has its own provider and model setting. This already exists for the first four.
4. **Privacy-aware routing.** A workspace marked as no-external-processing can only use local providers; the router enforces this before any call.
5. **Fail soft.** Provider errors degrade to the fallback model, then to an honest error status; never a crash or a fabricated answer.

## 2. Provider abstraction (existing, to extend)
`providers/llm.py` defines `LLMRequest` (system, user, evidence, language, model, timeout, max_tokens) and providers with `generate()` and `stream()`. Adapters today: mock, OpenAI, Anthropic, Gemini (OpenAI-compatible endpoint).

Additions:
- `local`: OpenAI-compatible server (Ollama in dev, vLLM/TGI in production). Base URL, model name, and context length from settings; health check at startup and on a timer.
- Capability registry per model: context window, supports tools, supports JSON schema, supports vision, cost class, locality. The context budgeter and router read it; nothing advertises a capability the registry does not list.
- Token counting: tiktoken for OpenAI-compatible hosted models, HF tokenizer for local models, provider-reported usage recorded on every message.

## 3. Language model candidates
Evaluated on: EN document QA, UR document QA, cross-lingual QA, instruction following (JSON contract), tool calling, latency on the available hardware, licence.

| Candidate | Why considered | Constraint |
|---|---|---|
| Gemini flash family (hosted) | already wired; good Urdu; fast when not throttled | free-tier quota; external processing |
| Qwen 3 4B/8B (open weights, Apache-2.0) | strong multilingual incl. Urdu, tool calling, long context | CPU: quantised 4B is usable, 8B slow |
| Gemma 3 4B/12B (open weights, Gemma licence) | good quality, vision variants | licence terms to review |
| Llama 3.x 8B (open weights, Llama licence) | ecosystem, tooling | weaker Urdu |

Decision rule: the default `answer` model is the best golden-set scorer that the deployment can run within the latency budget (p95 under 15 s streamed first token under 3 s). The `router` role uses the smallest model that passes the intent and rewrite gates.

## 4. Transformer architecture (documentation commitment)
`docs/MODEL_INTERNALS.md` (Phase 4) will document, for the chosen local model: tokenizer, embeddings, RoPE, grouped-query attention, feed-forward/normalisation/residual layout, causal masking, KV cache, decoding settings used by Astra, and the practical consequences (context limit, quantisation effects on Urdu). This is explanatory documentation of a pretrained model, not a claim of original architecture.

## 5. Embeddings and reranking
- Benchmark current multilingual MiniLM-class model vs. BGE-M3 vs. multilingual-E5-base on EN, UR, and cross-lingual recall@5/@10 with the golden set; record latency and index size.
- Collection dimension is read from the provider at startup (already the case); a model change creates a new collection and triggers re-indexing with a versioned alias.
- Reranker: bge-reranker-v2-m3 on the top-20 fused candidates; adopted only if it improves citation accuracy on the golden set.

## 6. Vision
Interface: `describe(image) `, `answer(image, question)`, `extract_table(image) -> rows`. Providers: Gemini, OpenAI-compatible VLMs, Ollama vision models. Charts and tables keep structured output (JSON rows) next to the description, and citations point to the page image. Evaluation set: 30 page images (tables, charts, diagrams) with expected answers.

## 7. Speech
STT candidates: faster-whisper (local, int8 CPU), Gemini, OpenAI. TTS candidates: OpenAI, Piper, Coqui. Urdu is measured, not assumed: a 50-utterance recorded set for WER, and a native-speaker rating (1–5) for TTS naturalness and pronunciation. Results go in `EVALUATION.md` before voice is shown as "ready" in the UI.

## 8. Verification and self-correction (inference time)
Pipeline after generation: claim extraction (sentence-level) → support check against evidence (deterministic string/number/date match first, then judge model) → unsupported claims removed or the answer regenerated once with the gap named → citations re-validated → abstain if still unsupported. Agreement between two models is not treated as truth; evidence support is.

## 9. Controlled improvement (Phase 7)
- Error memory: categorised failures (wrong fact, fabricated citation, wrong page, poor Urdu, retrieval miss, tool failure, OCR error) stored with permission and without raw private content where avoidable.
- Golden datasets: general, document EN, document UR, cross-lingual, numeric, visual, citation, web, tool.
- Fine-tuning: PEFT/LoRA/QLoRA with TRL on curated, approved data only; MLflow-tracked; a candidate ships only if it beats the previous version on the fixed benchmark with no safety regressions; rollback by configuration. Never automatic training on conversations; never feedback writing weights.

## 10. Current configuration (for the record)
Provider gemini; answer `gemini-3.5-flash`, router/fallback `gemini-3.1-flash-lite`, reasoning effort low, 60 s timeout; embeddings sentence-transformers (local); OCR Tesseract eng+urd; STT/TTS unconfigured. Free-tier quota limits live evaluation to about 20 answers per day per model.
