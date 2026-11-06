"""Intent-routing metrics on evaluation/golden/intents.jsonl (Addendum A6).

Usage: python -m evaluation.run_intent_eval   (exit code 1 if a CI gate fails)
Runs the configured router (stage 1 lexicon; stage 2 only if a real LLM + router model are set).
"""

import json
import os
import statistics
import sys
import time
from collections import Counter
from pathlib import Path

os.environ.setdefault("ASTRA_IGNORE_DOTENV", "1")

from app.core.config import get_settings  # noqa: E402
from app.services.intent import CONVERSATIONAL, route  # noqa: E402

GOLDEN = Path(__file__).parent / "golden" / "intents.jsonl"
OUT = Path(__file__).parent / "results" / "intents_latest.json"


def main() -> int:
    settings = get_settings()
    cases = [json.loads(x) for x in GOLDEN.read_text(encoding="utf-8").splitlines()]
    route(settings, "warm up")
    rows = []
    for c in cases:
        start = time.perf_counter()
        r = route(settings, c["text"])
        ms = (time.perf_counter() - start) * 1000
        rows.append((c, r, ms))

    labels = sorted({c["intent"] for c in cases})
    tp, fp, fn = Counter(), Counter(), Counter()
    for c, r, _ in rows:
        if r.intent == c["intent"]:
            tp[c["intent"]] += 1
        else:
            fp[r.intent] += 1
            fn[c["intent"]] += 1
    f1s = []
    for lab in labels:
        p = tp[lab] / (tp[lab] + fp[lab]) if tp[lab] + fp[lab] else 0.0
        rec = tp[lab] / (tp[lab] + fn[lab]) if tp[lab] + fn[lab] else 0.0
        f1s.append(2 * p * rec / (p + rec) if p + rec else 0.0)

    conv = [(c, r) for c, r, _ in rows if c["intent"] in CONVERSATIONAL]
    docq = [(c, r) for c, r, _ in rows if c["intent"] == "DOC_QUESTION"]
    false_refusal = sum(r.intent == "DOC_QUESTION" for _, r in conv)
    false_conv = sum(r.conversational for _, r in docq)
    greet_ms = [ms for c, _, ms in rows if c["category"] == "greeting"]
    report = {
        "n": len(cases),
        "router": "lexicon+classifier" if settings.router_model else "lexicon only",
        "accuracy": round(sum(tp.values()) / len(cases), 4),
        "macro_f1": round(statistics.mean(f1s), 4),
        "false_refusal_rate_conversational": f"{false_refusal}/{len(conv)}",
        "false_conversational_rate_doc_questions": f"{false_conv}/{len(docq)}",
        "fast_path_coverage_conversational": round(
            sum(r.stage == "lexicon" for _, r in conv) / len(conv), 4
        ),
        "mixed_detected": f"{sum(r.mixed for c, r, _ in rows if c['mixed'])}/"
        f"{sum(c['mixed'] for c in cases)}",
        "greeting_route_p95_ms": round(statistics.quantiles(greet_ms, n=20)[18], 3),
        "errors": [
            {"id": c["id"], "text": c["text"], "expected": c["intent"], "got": r.intent}
            for c, r, _ in rows
            if r.intent != c["intent"] or r.mixed != c["mixed"]
        ],
    }
    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({k: v for k, v in report.items() if k != "errors"}, indent=2))
    print(f"errors: {len(report['errors'])}  (details in {OUT})")
    gate_ok = false_refusal == 0 and false_conv / max(len(docq), 1) < 0.01
    return 0 if gate_ok else 1


if __name__ == "__main__":
    sys.exit(main())
