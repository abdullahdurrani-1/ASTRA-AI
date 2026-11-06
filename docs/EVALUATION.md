# Evaluation

## How to run

```bash
cd backend
.venv/Scripts/python -m evaluation.run_eval      # Windows (Git Bash); use .venv/bin/python on Linux/macOS
```

The script builds a 4-page PDF from [`backend/evaluation/sample_document.md`](../backend/evaluation/sample_document.md), an original text written for this project, so there are no copyright concerns. It ingests the PDF into a throwaway data directory with **whatever providers are configured in your environment**, asks the 17 questions in [`questions.json`](../backend/evaluation/questions.json), and writes `backend/evaluation/results/latest.json`.

Question mix: 10 answerable questions (exact facts, numbers, dates, a technical term, paraphrases, an ambiguous question), 4 unanswerable questions, 2 Urdu questions about the English document, and 1 English question with an Urdu answer.

## Metrics

| Metric | Meaning |
|---|---|
| answerable_answered | Answerable questions that got `answered` |
| retrieval_hit_at_k / hit_at_1 | Expected page among the top-k / ranked first |
| citation_page_correct | Every cited page is an expected page |
| answer_contains_expected_terms | Exact names, numbers and dates are preserved |
| unanswerable_abstained | Unanswerable questions that got `insufficient_evidence` |
| cross_lingual_* | Urdu question about the English document |
| median_latency_ms | End-to-end per question (excludes ingestion) |

## Results: mock providers (2026-10-27, Windows 11, Python 3.13)

These were measured with `EMBEDDING_PROVIDER=mock` and `LLM_PROVIDER=mock`. They show the **pipeline mechanics**, not the quality of a real AI model.

| Metric | Result |
|---|---|
| answerable_answered | 9/11 |
| retrieval_hit_at_k | 11/11 (**trivial**: only 4 chunks exist and k=6) |
| retrieval_hit_at_1 | 11/11 |
| citation_page_correct | 7/9 |
| answer_contains_expected_terms | 9/9 |
| unanswerable_abstained | 3/4 |
| cross_lingual_answered | 0/2 |
| cross_lingual_retrieval_hit_at_1 | 0/2 |
| median_latency_ms | ~9 |

### Reading the failures honestly

- **Paraphrases (q07) and an ambiguous question (q10) abstained.** The mock embedder only matches overlapping words, so "how far can sailors *see*" does not match "*visible* for 22 nautical miles". Real semantic embeddings are needed for paraphrases.
- **One unanswerable question was answered (u01: "Miriam Okafor's salary").** The name matches strongly, so the keyword gate passed, and the mock LLM cannot reason that "salary" is missing. The evidence gate is a *coarse first filter*. The real LLM's own abstention, which the prompt requires, is the second layer. Mock mode has no such second layer.
- **2 citation-page misses (q03, q08).** The mock LLM cites the two best-overlapping sentences, and the second one sometimes comes from another page. Citation *IDs* were still all valid, because invalid IDs are always dropped.
- **Cross-lingual: 0/2.** A hashing embedder cannot match Urdu words to English text. This is exactly why a multilingual embedding model (`sentence_transformers` with `paraphrase-multilingual-MiniLM-L12-v2`, or `openai`) is required for Urdu-about-English questions. **This has not been measured with a real model yet.**

## Before trusting a real configuration

1. Set real providers in `.env` and re-run the script.
2. **Calibrate `MIN_VECTOR_SIMILARITY`** for your embedding model. Similarity scales differ between models, and 0.45 is a starting point, not a measured value.
3. Use a larger document, so that hit@k stops being trivial, and add owner-reviewed questions. Avoid tuning thresholds on the same questions you report, because that overfits.
4. Have a human review answer quality, especially Urdu fluency and term preservation.
5. Track API cost per question from your provider dashboard. The script does not measure cost.

Astra reduces unsupported answers through evidence gating and citation validation. It is **not** hallucination-free or 100% accurate.

## Real-book check: local multilingual embeddings (2026-10-28)

Setup: `EMBEDDING_PROVIDER=sentence_transformers` (`paraphrase-multilingual-MiniLM-L12-v2`, CPU), `LLM_PROVIDER=mock`, `OCR_ENABLED=true` (Tesseract 5.4, eng, 300 dpi). The document was a scanned 479-page history book (owner-provided, kept in the git-ignored `data/` folder and not bundled).

**Ingestion:** all 479 pages were OCR'd, 5 near-blank pages were skipped, and 1,656 passages were indexed and verified. READY took 13.5 min.

| Question | Best similarity | Outcome | Correct? |
|---|---|---|---|
| Where and when was Ahmad Shah born? | 0.79 | answered, p.31 | ✅ |
| Who was Ahmad Shah's father? | 0.76 | answered, p.31 | ✅ |
| Who murdered Emperor Alamgir? | 0.64 | answered, p.241 | ✅ |
| Where did the Shah cross the Beas in 1759? | 0.64 | answered, p.241 | ✅ |
| Paraphrase: how did his mother keep him safe? | 0.43 | abstained at the gate | ❌ (answer is on p.31, ranked 2nd) |
| Urdu: where was he born / who was his father / who killed Alamgir? | 0.71 / 0.73 / 0.55 | passed the gate, correct pages retrieved; **mock LLM abstained** | needs a real LLM |
| Off-topic (EN: capital of Japan, telephone; UR: capital of Japan) | 0.40 / – / 0.39 | abstained | ✅ |

### Findings
- **Cross-lingual retrieval works** with the multilingual model: Urdu questions retrieve the right English pages. The mock LLM can't write Urdu answers, so a real LLM is required for end-to-end Urdu.
- **Threshold 0.45 kept.** Off-topic questions scored 0.39–0.40 and the hard paraphrase scored 0.43. These are too close to separate safely, so lowering the threshold would admit off-topic questions. Next options: a stronger embedding model (e.g. multilingual E5) or a reranker. Measure before switching.
- Citations use the **PDF page index**. In this book that is about 13 pages ahead of the printed page number.
- Testing tip: on Windows Git Bash, `curl` can garble Urdu text in arguments. Send Urdu test requests from Python or a JSON file.

## Conversational layer: intent routing (2026-10-28)

Run with `python -m evaluation.run_intent_eval`. The CI gate is `tests/test_intents.py`, which fails on any greeting that gets a refusal or a citation.

Golden set: [`backend/evaluation/golden/intents.jsonl`](../backend/evaluation/golden/intents.jsonl), n = 160.

| Category | n |
|---|---|
| Greetings (EN, Urdu script, Roman Urdu, typos, emoji) | 40 |
| Thanks and farewells | 15 |
| Small talk and meta | 20 |
| Language switch | 10 |
| Mixed (greeting + question) | 25 |
| Questions that look like chit-chat | 20 |
| Injection-flavoured messages | 10 |
| Plain document questions | 15 |
| Unclear | 5 |

Results with the router running on the lexicon only (no LLM key):

| Metric | Result | Target |
|---|---|---|
| Intent accuracy / macro-F1 | 160/160 / 1.00 | – |
| False refusal on conversational inputs | 0/100 | 0 |
| False "conversational" on document questions | 0/60 | < 1% |
| Mixed messages detected | 25/25 | – |
| Fast-path coverage (conversational) | 100% | – |
| Routing P95 | 0.03 ms | < 5 ms |
| Server time for a greeting, end to end (curl, local) | 5–25 ms | < 150 ms |

**How to read this honestly:** I wrote the lexicon and this test set together, and I fixed 6 misroutes found while building it. So 100% is a **regression gate, not an independent accuracy estimate**. For a real accuracy number, the owner (or real chat logs) should supply about 50 held-out messages that were not seen while building the lexicon.

Live check on the real book (mock LLM):
- "hello", "السلام علیکم" and "salam kya haal hai" got the correct script and reply ("وعلیکم السلام", Roman Urdu mirrored), with no retrieval and no citations.
- "hi, where was Ahmad Shah born?" got a greeting, then a cited answer (p.31).
- The Urdu mixed question abstained because the mock LLM can't write Urdu. This is the known limit; it needs a real LLM.

### Not yet measured (blocked on keys or owner input)
- **Stage-2 LLM classifier.** The code and safe-default tests use a fake provider. The live classifier is unmeasured.
- **Model comparison: Haiku 5.5, Sonnet 5.5 and Opus 5.5** (faithfulness, Urdu fluency, refusals, P95, cost per query). This needs `ANTHROPIC_API_KEY`. No numbers exist yet, so no default model has been chosen from data.
- **Urdu eval:** at least 60 cases, a 40-answer human rating (`eval/human/ur_ratings.csv`), and STT WER on 30 or more owner recordings. All of these need the owner.
- **Native review** of all 102 Urdu and Roman Urdu strings in [URDU_QA.md](URDU_QA.md).

### Model ID record
- 2026-10-28: suggested IDs `claude-sonnet-5-5` (answers), `claude-haiku-5-5` (router), and `claude-opus-5-5` (judge and fallback), noted in `.env.example`.
- These come from the assistant's model list. They were **not** re-checked against docs.claude.com in this session, so confirm IDs and pricing there before pinning.
- IDs are configured only through `LLM_MODEL_*` in `.env`.

## First real-LLM run: Gemini via OpenAI-compatible endpoint (2026-10-29)

Setup: `LLM_PROVIDER=gemini`, answer model `gemini-3.6-flash`, fallback `gemini-3.1-flash-lite`, local multilingual embeddings, and the 479-page book. Book passages and questions were sent to Google.

**Model selection:** I tested which models the key can use (2026-10-29).
- `gemini-2.5-pro`, `gemini-2.5-flash` and `gemini-2.5-flash-lite` returned 404 ("no longer available to new users").
- `gemini-3.8-flash` and `gemini-flash-latest` returned repeated 503s ("high demand") or timeouts.
- Even trivial calls took 2–30 s that day, so latency below reflects Google's load as well as Astra.
- No Gemini model met the 1.5 s classifier budget, so `INTENT_CLASSIFIER_ENABLED=false`. Stage-1 routing still runs.

| Question | Outcome | Correct? |
|---|---|---|
| Where and when was Ahmad Shah born? | answered, p.31: 1722, Multan; notes Ghubar's dissent (Herat) | ✅ |
| Who was Ahmad Shah's father? | answered, p.31: Zaman Khan Abdali, Saddozei clan | ✅ |
| Who murdered Emperor Alamgir? | answered, pp.241, 273: Ghazi-ud-Din | ✅ |
| How did his mother keep him safe? (paraphrase) | abstained at the gate | ❌ known gate limit |
| احمد شاہ کہاں اور کب پیدا ہوئے؟ | answered in fluent Urdu, p.31, both traditions | ✅ |
| ان کے والد کون تھے؟ ("his father", no name) | answered about a **different person** (p.52) | ❌ no conversation context |
| عالمگیر کو کس نے قتل کیا؟ | abstained | ❌ cross-lingual miss |
| السلام علیکم + birth question | greeting, then **provider error** (Gemini timeout) | ❌ provider |
| Capital of Japan (EN / UR) | abstained in about 0.3 s | ✅ |

Overall: 5 of 8 answerable questions correct, 0 fabricated facts, 2 of 2 off-topic questions refused. Answer latency was 19–63 s.

**Most important finding:** a follow-up that uses a pronoun ("his father") is searched on its own, without the earlier turns. The answer is grounded and cited, but it is about the wrong person. Fix: rewrite follow-up questions using conversation history before retrieval. This is not built yet.

n = 11 is a smoke test, not a benchmark.

## Why "it gives an error": Gemini latency and timeouts (2026-11-04)

Symptom: book questions returned the generic "couldn't generate an answer" error. Retrieval was fine (best similarity 0.62, keyword coverage 1.0). The cause was the LLM step: `gemini-3.6-flash` took 28–35 s even for a one-word reply because it "thinks" heavily by default, which exceeded the 30 s provider timeout; the lite fallback then also failed under load, plus occasional 429 bursts.

Benchmark on a realistic RAG prompt (6 passages, same question), all correct when they answered:

| Model | default | `reasoning_effort=low` | `=none` |
|---|---|---|---|
| gemini-3.6-flash | 35 s | 39 s | 12 s |
| gemini-3.5-flash | 22 s | **12 s** | 503 |
| gemini-3.1-flash-lite | 503 | **2.7 s** | 1.8 s |
| gemini-3.5-flash-lite | 17 s | 17 s | 400 |

Changes: new `LLM_REASONING_EFFORT` setting (sent as `reasoning_effort` to openai/gemini providers); `.env` now uses answer `gemini-3.5-flash`, fallback `gemini-3.1-flash-lite`, effort `low`, timeout 60 s. Re-check through the API: 3/3 questions answered without error (27–57 s end to end; Google's load varies minute to minute, so real latency is above the benchmark). Latency of 30 s+ is still a UX problem; options are switching the answer model to `gemini-3.1-flash-lite` (≈3 s, same correctness on this small test) or streaming partial answers.

## "Who is Ahmad Shah?" refused: running-header chunks (2026-11-04)

Symptom: a correctly spelled, on-topic question got "not enough information" while retrieval reported similarity 0.86 and full keyword coverage. Inspecting the six retrieved chunks explained it: every one was the 10-character running header **"AHMAD SHAH"** from the top of a page (pp. 18, 32, 48, 81, 101, 294). 325 of the book's 1,656 chunks (20%) were such fragments; the chunker had started a new chunk on every detected heading. The model's refusal was honest; retrieval was wrong.

Fixes, both covered by tests:
- Retrieval skips chunks under `MIN_SUBSTANTIVE_CHUNK_CHARS` (40) and exact duplicates when longer candidates exist (works on the existing index).
- Chunking merges heading-only / running-header buffers into the following text (`MIN_STANDALONE_CHARS` = 80); the book was re-indexed.

Also added today: a pre-retrieval **query rewrite** (typos, pronoun follow-ups like "his father", via the router model; the user's words are kept in the transcript and the UI shows "Searched for: …"), and **streamed answers** (`POST /api/chat/stream`, server-sent events) with a typewriter rendering in the UI.

### Gemini free tier
The key is on Google's free tier: **20 requests per day** for the flash models. Benchmarking exhausted it ("retry in 18h"), so the rewrite step and the revised abstention prompt are implemented and unit-tested with fake providers but **not yet measured live**. Either enable billing on the Gemini key or expect ~20 answers per day.

### Adversarial review of the above (2026-11-04)
Three reviewers (streaming correctness, retrieval quality, frontend stream) found 12 candidate defects; 11 were confirmed by independent verification and fixed the same day: surrogate-pair emoji crashing the SSE stream, the finished answer re-typing from scratch, the fragment filter dropping short decisive lines (now only header-like fragments with low similarity are dropped), answer language taken from the rewrite instead of the user's words, merged running headers corrupting page numbers, weak rewrite guards, Urdu drafts streaming left-to-right, the thinking indicator persisting, and the typewriter ignoring reduced motion. All are covered by tests where testable without a live model.

## Urdu questions over an English book: cross-lingual search (2026-11-05)
Observed: "احمد شاہ کے والد کون تھے؟" (who was Ahmad Shah's father?) retrieved six passages with similarity 0.69-0.73 and keyword coverage 0, none of them the biography page. The multilingual embedding gets the topic (Ahmad Shah) but not the relation (father), and BM25 cannot match Urdu words to English text.

Fix: the pre-retrieval rewrite call (router model) now also returns an English version of a non-English question. Retrieval embeds both phrasings, runs BM25 for both, fuses the lists with reciprocal-rank fusion, and takes the best similarity and coverage per chunk. The answer language still follows the user's words; the English phrasing is shown under the answer as "Searched for". Guards: the English version is dropped unless the question is non-English, the text is English script, and it is at most max(160, 4x question) characters.

Offline check on the live index (1326 chunks, no LLM call):

| Query set | Top passage | Coverage |
|---|---|---|
| Urdu only | p47, an execution list (sim 0.73, kw 0.00) | 0.00 |
| Urdu + "Who was Ahmad Shah's father?" | p31 "EARLY LIFE OF AHMAD SHAH ... second son of Zaman Khan" (sim 0.72, kw 1.00) | 1.00 |

Tests: `tests/test_crosslingual.py` (8) cover the guard, an Urdu question over an English document answered with the right page only when the English phrasing is present, and the transcript keeping the user's original words. Not yet measured live: the quality of the router model's translation (free-tier quota).
