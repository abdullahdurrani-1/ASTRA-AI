"""Streaming: the JSON answer field is revealed as it arrives, and the SSE endpoint works."""

import json

import pytest

from app.core.config import get_settings
from app.providers.llm import LLMRequest, MockLLMProvider
from app.services import rewrite as rewrite_module
from app.services.streaming_json import StringFieldExtractor
from tests.conftest import make_pdf, upload, wait_terminal


def _feed(chunks):
    ex = StringFieldExtractor("answer")
    pieces = [ex.feed(c) for c in chunks]
    return ex, "".join(pieces)


def test_extractor_reveals_answer_text_across_arbitrary_chunk_boundaries():
    doc = json.dumps(
        {"status": "answered", "answer": 'He said "hi"\nthen left — ok ✓', "citations": ["a"]}
    )
    for size in (1, 3, 7, 50):
        chunks = [doc[i : i + size] for i in range(0, len(doc), size)]
        ex, text = _feed(chunks)
        assert text == 'He said "hi"\nthen left — ok ✓'
        assert ex.complete
        assert json.loads(ex.raw)["citations"] == ["a"]


def test_extractor_handles_unicode_escapes_and_urdu():
    doc = (
        '{"status":"answered","answer":"\u0627\u062d\u0645\u062f \u0634\u0627\u06c1",'
        '"citations":[]}'
    )
    ex, text = _feed([doc[:30], doc[30:41], doc[41:]])
    assert text == "احمد شاہ"


def test_extractor_joins_surrogate_pairs_even_across_chunks():
    doc = '{"status":"answered","answer":"hi \\ud83d\\ude00!","citations":[]}'
    for cut in (None, doc.index("\\ude00")):
        chunks = [doc] if cut is None else [doc[:cut], doc[cut:]]
        ex, text = _feed(chunks)
        assert text == "hi \U0001f600!"
        text.encode("utf-8")  # no lone surrogates


def test_extractor_ignores_other_fields_and_handles_status_first():
    doc = '{"status": "insufficient_evidence", "answer": "", "citations": []}'
    ex, text = _feed([doc])
    assert text == "" and ex.complete


def test_mock_stream_concatenates_to_generate():
    p = MockLLMProvider()
    req = LLMRequest(system="", user="", question="moons of mars", evidence=[], language="en")
    from app.providers.llm import EvidenceItem

    req.evidence = [EvidenceItem("c1", "Mars has two moons named Phobos and Deimos.")]
    assert "".join(p.stream(req)) == p.generate(req)


# --- SSE endpoint and rewrite hook ----------------------------------------------------------------


def _events(text: str):
    out = []
    for frame in text.strip().split("\n\n"):
        ev, data = "message", ""
        for line in frame.split("\n"):
            if line.startswith("event:"):
                ev = line[6:].strip()
            elif line.startswith("data:"):
                data = line[5:].strip()
        out.append((ev, json.loads(data)))
    return out


@pytest.fixture(scope="module")
def mars(client):
    pages = [
        "# Mars\n\nMars has two moons named Phobos and Deimos. Olympus Mons is its tallest volcano."
    ]
    doc = upload(client, "stream-mars.pdf", make_pdf(pages)).json()["id"]
    assert wait_terminal(client, doc)["status"] == "READY"
    return doc


def test_stream_endpoint_sends_deltas_then_done(client, mars):
    r = client.post(
        "/api/chat/stream",
        json={"question": "How many moons does Mars have?", "document_ids": [mars]},
    )
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/event-stream")
    events = _events(r.text)
    deltas = [d["text"] for ev, d in events if ev == "delta"]
    done = [d for ev, d in events if ev == "done"]
    assert deltas and len(done) == 1
    assert "".join(deltas) == done[0]["answer"]
    assert done[0]["status"] == "answered" and done[0]["citations"]
    # Persisted like the non-streaming endpoint.
    conv = client.get(f"/api/conversations/{done[0]['conversation_id']}").json()
    assert [m["role"] for m in conv["messages"]] == ["user", "assistant"]


def test_stream_endpoint_conversational_reply_has_no_deltas(client):
    r = client.post("/api/chat/stream", json={"question": "hello", "document_ids": []})
    events = _events(r.text)
    assert [ev for ev, _ in events] == ["done"]
    assert events[0][1]["status"] == "conversational"


def test_stream_endpoint_reports_errors_as_events(client):
    r = client.post("/api/chat/stream", json={"question": "x", "document_ids": ["nope"]})
    events = _events(r.text)
    assert events[-1][0] == "error" and events[-1][1]["code"] == "not_found"


class _Rewriter:
    name = "fake"
    is_mock = False

    def __init__(self):
        self.calls = []

    def generate(self, req):
        self.calls.append(req)
        return json.dumps({"question": "Who was Ahmad Shah's father?", "changed": True})


def test_followup_is_rewritten_with_history_before_retrieval(monkeypatch):
    s = get_settings()
    monkeypatch.setattr(s, "llm_provider", "anthropic")
    monkeypatch.setattr(s, "llm_model_router", "router")
    fake = _Rewriter()
    monkeypatch.setattr(rewrite_module, "get_llm_provider", lambda _s: fake)
    history = [("user", "Where was Ahmad Shah born?"), ("assistant", "Multan, 1722.")]
    out = rewrite_module.rewrite_question(s, history, "who was his fathr?")
    assert out.changed and out.question == "Who was Ahmad Shah's father?"
    assert "Where was Ahmad Shah born?" in fake.calls[0].user
    assert fake.calls[0].model == "router"


def test_rewrite_is_skipped_in_mock_mode_and_on_failure(monkeypatch):
    s = get_settings()
    assert rewrite_module.rewrite_question(s, [], "typo quesion").source == "skipped"
    monkeypatch.setattr(s, "llm_provider", "anthropic")
    monkeypatch.setattr(s, "llm_model_router", "router")

    class Broken:
        name = "b"
        is_mock = False

        def generate(self, req):
            raise rewrite_module.ProviderError("down")

    monkeypatch.setattr(rewrite_module, "get_llm_provider", lambda _s: Broken())
    out = rewrite_module.rewrite_question(s, [], "typo quesion")
    assert out.question == "typo quesion" and not out.changed
