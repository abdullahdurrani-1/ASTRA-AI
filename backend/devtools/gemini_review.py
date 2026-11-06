"""Optional Gemini code reviewer (developer tool — not part of the Astra runtime).

What it does:
  1. Runs a FIXED allowlist of local checks (ruff, mypy, pytest). Nothing else is ever executed.
  2. If a check fails, redacts secrets/personal data from the output (and optional code diff),
     truncates it, and asks Gemini for structured findings.
  3. Writes the findings to devtools/reports/ for a human to read.

What it never does: apply patches, edit files, run commands suggested by the model, install
packages, or send uploaded documents / conversations / .env contents. Gemini output is untrusted.

Usage (from backend/):
  python -m devtools.gemini_review            # review failing checks
  python -m devtools.gemini_review --diff     # also include `git diff` (redacted) as context
Requires GEMINI_REVIEW_ENABLED=true, GEMINI_API_KEY and GEMINI_MODEL in the environment/.env.
The Gemini REST call follows the public `generateContent` API but has NOT been verified against
the live service in this repository (no key was available) — treat it as unverified.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess  # noqa: S404  (fixed argv lists only, never model output)
import sys
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

import httpx

from app.core.config import Settings, get_settings

BACKEND_DIR = Path(__file__).resolve().parents[1]
REPORTS_DIR = BACKEND_DIR / "devtools" / "reports"
MAX_CONTEXT_CHARS = 12_000

CHECKS: dict[str, list[str]] = {
    "ruff": [sys.executable, "-m", "ruff", "check", "."],
    "mypy": [sys.executable, "-m", "mypy", "app"],
    "pytest": [sys.executable, "-m", "pytest", "-q", "-x", "--no-header", "-p", "no:cacheprovider"],
}

_REDACTIONS: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"AIza[0-9A-Za-z_\-]{20,}"), "[REDACTED_GOOGLE_KEY]"),
    (re.compile(r"sk-(?:ant-|proj-)?[0-9A-Za-z_\-]{16,}"), "[REDACTED_KEY]"),
    (re.compile(r"(?i)bearer\s+[0-9A-Za-z._\-]+"), "Bearer [REDACTED]"),
    (re.compile(r"(?i)((?:api[_-]?key|secret|token|password)\s*[=:]\s*)\S+"), r"\1[REDACTED]"),
    (re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+"), "[REDACTED_EMAIL]"),
    (re.compile(r"(?i)[A-Z]:[\\/]+Users[\\/]+[^\\/\s]+"), "<HOME>"),
    (re.compile(r"/(?:home|Users)/[^/\s]+"), "<HOME>"),
]

SYSTEM = """You are a careful senior Python reviewer. You receive redacted output from failing \
checks and optionally a code diff. Identify the root causes. Respond ONLY with JSON:
{"findings": [{"issue": str, "evidence": str, "severity": "low"|"medium"|"high", \
"file": str, "suggested_patch": str (unified diff), "regression_test": str}]}
Do not include shell commands to run. Your output will be read by a human, not executed."""


@dataclass
class CheckResult:
    name: str
    returncode: int
    output: str


def redact(text: str, extra_secrets: list[str] | None = None) -> str:
    for secret in extra_secrets or []:
        if secret:
            text = text.replace(secret, "[REDACTED]")
    for pattern, repl in _REDACTIONS:
        text = pattern.sub(repl, text)
    return text


def truncate(text: str, limit: int = MAX_CONTEXT_CHARS) -> str:
    return (
        text
        if len(text) <= limit
        else text[: limit // 2] + "\n…[truncated]…\n" + text[-limit // 2 :]
    )


def run_checks() -> list[CheckResult]:
    results = []
    for name, argv in CHECKS.items():
        proc = subprocess.run(  # noqa: S603
            argv, cwd=BACKEND_DIR, capture_output=True, text=True, timeout=600, check=False
        )
        results.append(CheckResult(name, proc.returncode, proc.stdout + proc.stderr))
    return results


def git_diff() -> str:
    try:
        proc = subprocess.run(  # noqa: S603
            ["git", "diff", "--", "app", "tests"],  # noqa: S607 — code only, never data/ or .env
            cwd=BACKEND_DIR,
            capture_output=True,
            text=True,
            timeout=60,
            check=False,
        )
        return proc.stdout if proc.returncode == 0 else ""
    except (OSError, subprocess.SubprocessError):
        return ""


def build_prompt(failures: list[CheckResult], diff: str, secrets: list[str]) -> str:
    parts = [f"## {f.name} (exit {f.returncode})\n{f.output}" for f in failures]
    if diff:
        parts.append(f"## git diff\n{diff}")
    return truncate(redact("\n\n".join(parts), secrets))


def call_gemini(settings: Settings, prompt: str, client: httpx.Client | None = None) -> list[dict]:
    assert settings.gemini_api_key is not None
    url = (
        "https://generativelanguage.googleapis.com/v1beta/models/"
        f"{settings.gemini_model}:generateContent"
    )
    body = {
        "systemInstruction": {"parts": [{"text": SYSTEM}]},
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        "generationConfig": {"responseMimeType": "application/json", "temperature": 0.1},
    }
    http = client or httpx.Client(timeout=settings.provider_timeout_seconds)
    r = http.post(
        url, json=body, headers={"x-goog-api-key": settings.gemini_api_key.get_secret_value()}
    )
    r.raise_for_status()
    text = "".join(p.get("text", "") for p in r.json()["candidates"][0]["content"]["parts"])
    findings = json.loads(text).get("findings", [])
    return [f for f in findings if isinstance(f, dict)]


def write_report(findings: list[dict], failures: list[CheckResult]) -> Path:
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    path = REPORTS_DIR / f"review-{stamp}.md"
    lines = [
        "# Gemini review (UNTRUSTED SUGGESTIONS — review before applying anything)",
        f"Failing checks: {', '.join(f.name for f in failures)}",
        "",
    ]
    for i, f in enumerate(findings, 1):
        lines += [
            f"## {i}. [{f.get('severity', '?')}] {f.get('issue', '')}",
            f"File: {f.get('file', '?')}",
            f"Evidence: {f.get('evidence', '')}",
            "Suggested patch (NOT applied):",
            "```diff",
            str(f.get("suggested_patch", "")),
            "```",
            "Regression test idea:",
            "```python",
            str(f.get("regression_test", "")),
            "```",
            "",
        ]
    path.write_text("\n".join(lines), encoding="utf-8")
    return path


def main(
    argv: list[str] | None = None,
    settings: Settings | None = None,
    client: httpx.Client | None = None,
) -> int:
    args = argparse.ArgumentParser(description=__doc__.splitlines()[0]).parse_known_args(argv)[1]
    include_diff = "--diff" in args
    s = settings or get_settings()
    if not s.gemini_review_enabled:
        print("Gemini review is disabled (set GEMINI_REVIEW_ENABLED=true to enable).")
        return 0
    if not s.gemini_api_key or not s.gemini_model:
        print("Gemini review is enabled but GEMINI_API_KEY and/or GEMINI_MODEL are not set.")
        return 2

    results = run_checks()
    failures = [r for r in results if r.returncode != 0]
    for r in results:
        print(f"{r.name}: {'FAIL' if r.returncode else 'ok'}")
    if not failures:
        print("All checks pass — nothing sent to Gemini.")
        return 0

    secrets = [
        v.get_secret_value()
        for v in (s.gemini_api_key, s.openai_api_key, s.anthropic_api_key)
        if v is not None
    ]
    prompt = build_prompt(failures, git_diff() if include_diff else "", secrets)
    try:
        findings = call_gemini(s, prompt, client)
    except (httpx.HTTPError, KeyError, IndexError, ValueError) as e:
        print(f"Gemini request failed ({type(e).__name__}). Checks still failing; fix manually.")
        return 1
    path = write_report(findings, failures)
    print(f"{len(findings)} suggestion(s) written to {path} (not applied).")
    return 1  # checks are still failing until a human fixes them


if __name__ == "__main__":
    raise SystemExit(main())
