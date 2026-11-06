import json
from pathlib import Path

import httpx
import pytest
from pydantic import SecretStr

from app.core.config import Settings
from devtools import gemini_review as gr


def _settings(**kw) -> Settings:
    return Settings(_env_file=None, **kw)  # type: ignore[call-arg]


def test_disabled_by_default_makes_no_calls(monkeypatch, capsys):
    monkeypatch.setattr(gr, "run_checks", lambda: pytest.fail("checks must not run"))
    assert gr.main([], settings=_settings()) == 0
    assert "disabled" in capsys.readouterr().out


def test_enabled_without_credentials_exits_cleanly(monkeypatch):
    monkeypatch.setattr(gr, "run_checks", lambda: pytest.fail("checks must not run"))
    assert gr.main([], settings=_settings(gemini_review_enabled=True)) == 2


def test_redaction_removes_secrets_and_personal_data():
    raw = (
        "key=AIzaSyA1234567890abcdefghijklmnop sk-ant-abcdefghijklmnopqrstu "
        "Authorization: Bearer abc.def api_key: hunter2 mail bob@example.com "
        r"C:\Users\CodeBricks\proj and /home/alice/x MYSECRETVALUE"
    )
    out = gr.redact(raw, ["MYSECRETVALUE"])
    for leaked in (
        "AIzaSy",
        "sk-ant",
        "abc.def",
        "hunter2",
        "bob@",
        "CodeBricks",
        "alice",
        "MYSECRETVALUE",
    ):
        assert leaked not in out


def test_suggestions_are_reported_never_applied(monkeypatch, tmp_path):
    failing = [gr.CheckResult("pytest", 1, "FAILED test_x - assert 1 == 2 token=SECRET123")]
    monkeypatch.setattr(gr, "run_checks", lambda: failing)
    monkeypatch.setattr(gr, "REPORTS_DIR", tmp_path / "reports")
    sent: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        sent["body"] = request.content.decode()
        sent["key"] = request.headers["x-goog-api-key"]
        finding = {
            "issue": "Off by one",
            "evidence": "assert 1 == 2",
            "severity": "low",
            "file": "app/x.py",
            "suggested_patch": "--- a\n+++ b\n-rm -rf /\n+fixed",
            "regression_test": "def test(): ...",
        }
        text = json.dumps({"findings": [finding]})
        return httpx.Response(200, json={"candidates": [{"content": {"parts": [{"text": text}]}}]})

    app_files_before = {p: p.stat().st_mtime for p in Path(gr.BACKEND_DIR, "app").rglob("*.py")}
    s = _settings(
        gemini_review_enabled=True, gemini_api_key=SecretStr("k-123"), gemini_model="test-model"
    )
    code = gr.main([], settings=s, client=httpx.Client(transport=httpx.MockTransport(handler)))

    assert code == 1  # still failing until a human fixes it
    assert "SECRET123" not in sent["body"] and sent["key"] == "k-123"
    reports = list((tmp_path / "reports").glob("*.md"))
    assert len(reports) == 1 and "NOT applied" in reports[0].read_text(encoding="utf-8")
    assert {p: p.stat().st_mtime for p in app_files_before} == app_files_before


def test_gemini_failure_is_reported_honestly(monkeypatch, capsys):
    monkeypatch.setattr(gr, "run_checks", lambda: [gr.CheckResult("ruff", 1, "E501")])
    s = _settings(gemini_review_enabled=True, gemini_api_key=SecretStr("k"), gemini_model="m")
    client = httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(503)))
    assert gr.main([], settings=s, client=client) == 1
    assert "request failed" in capsys.readouterr().out


def test_only_allowlisted_commands_exist():
    assert set(gr.CHECKS) == {"ruff", "mypy", "pytest"}
