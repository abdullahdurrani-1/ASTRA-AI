"""Urdu questions over English documents: the rewrite step supplies an English search version and
retrieval fuses hits from both phrasings, so the right passage is found and the answer language
still follows the user's words."""

import json

import pytest

from app.core.config import get_settings
from app.services import assistant as assistant_module
from app.services import rewrite as rewrite_module
from app.services.rewrite import Rewrite
from tests.conftest import make_pdf, upload, wait_terminal

MARS = (
    "# Mars\n\nMars has two moons named Phobos and Deimos. Olympus Mons on Mars is the tallest "
    "volcano known in the Solar System."
)
BREAD = "# Bread\n\nSourdough bread rises using wild yeast and lactic acid bacteria. " * 3
URDU_Q = "مریخ کے چاند کون سے ہیں؟"
ENGLISH_Q = "What are the moons of Mars?"


@pytest.fixture(scope="module")
def doc(client):
    d = upload(client, "mars.pdf", make_pdf([BREAD, MARS])).json()["id"]
    assert wait_terminal(client, d)["status"] == "READY"
    return d


class _Translator:
    name, is_mock = "fake", False

    def __init__(self, english):
        self.english = english

    def generate(self, req):
        return json.dumps({"question": req.question, "changed": False, "english": self.english})


def _router(monkeypatch, provider):
    s = get_settings()
    monkeypatch.setattr(s, "llm_provider", "anthropic")
    monkeypatch.setattr(s, "llm_model_router", "router")
    monkeypatch.setattr(rewrite_module, "get_llm_provider", lambda _s: provider)
    return s


def test_english_version_is_kept_only_for_non_english_questions(monkeypatch):
    s = _router(monkeypatch, _Translator(ENGLISH_Q))
    out = rewrite_module.rewrite_question(s, [], URDU_Q)
    assert out.english == ENGLISH_Q and out.search_queries == [URDU_Q, ENGLISH_Q]
    # An English question never gets a second query, whatever the model returns.
    out = rewrite_module.rewrite_question(s, [], "moons of mars?")
    assert out.english is None and out.search_queries == ["moons of mars?"]


@pytest.mark.parametrize(
    "bad",
    [None, "", "   ", "مریخ کے دو چاند ہیں", "x " * 200],
    ids=["null", "empty", "blank", "not-english", "too-long"],
)
def test_bad_english_versions_are_dropped(monkeypatch, bad):
    s = _router(monkeypatch, _Translator(bad))
    assert rewrite_module.rewrite_question(s, [], URDU_Q).english is None


class _Citer:
    """Answers from whatever evidence retrieval supplied, citing the first chunk."""

    name, is_mock = "citer", False

    def generate(self, req):
        first = req.evidence[0]
        return json.dumps(
            {"status": "answered", "answer": "فوبوس اور ڈیموس۔", "citations": [first.chunk_id]}
        )


def _ask(client, doc, question, language="auto"):
    return client.post(
        "/api/chat", json={"question": question, "document_ids": [doc], "language": language}
    ).json()


def test_urdu_question_finds_english_passage_via_english_search(client, doc, monkeypatch):
    monkeypatch.setattr("app.services.rag.get_llm_provider", lambda s: _Citer())

    # Control: Urdu words alone share nothing with the English text, so the evidence gate refuses.
    monkeypatch.setattr(
        assistant_module, "rewrite_question", lambda *_a: Rewrite(URDU_Q, False, "unchanged")
    )
    body = _ask(client, doc, URDU_Q)
    assert body["status"] == "insufficient_evidence"

    # With the English search version the Mars page is found; the answer stays in Urdu.
    monkeypatch.setattr(
        assistant_module,
        "rewrite_question",
        lambda *_a: Rewrite(URDU_Q, False, "llm", ENGLISH_Q),
    )
    body = _ask(client, doc, URDU_Q)
    assert body["status"] == "answered", body
    assert body["language"] == "ur"
    assert body["citations"][0]["page_start"] == 2
    assert "Phobos" in body["citations"][0]["excerpt"]
    assert body["searched_question"] == ENGLISH_Q


def test_english_phrasing_does_not_leak_into_transcript(client, doc, monkeypatch):
    monkeypatch.setattr("app.services.rag.get_llm_provider", lambda s: _Citer())
    monkeypatch.setattr(
        assistant_module,
        "rewrite_question",
        lambda *_a: Rewrite("مریخ کے چاند کون سے ہیں؟", True, "llm", ENGLISH_Q),
    )
    body = _ask(client, doc, "مریخ کے چند کون سے ہیں؟")  # typo: چند for چاند
    assert body["status"] == "answered"
    assert body["searched_question"] == f"مریخ کے چاند کون سے ہیں؟ / {ENGLISH_Q}"
    conv = client.get(f"/api/conversations/{body['conversation_id']}").json()
    assert conv["messages"][0]["content"] == "مریخ کے چند کون سے ہیں؟"
