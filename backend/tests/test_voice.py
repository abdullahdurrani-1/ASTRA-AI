from app.core.config import get_settings
from app.core.errors import ProviderError


def _wav(n: int) -> tuple[str, bytes, str]:
    return ("a.wav", b"RIFF" + b"\x00" * n, "audio/wav")


def test_voice_disabled_returns_503_and_typed_chat_unaffected(client):
    r = client.post("/api/voice/transcribe", files={"file": _wav(4000)})
    assert r.status_code == 503 and r.json()["error"]["code"] == "provider_unavailable"
    r = client.post("/api/voice/synthesize", json={"text": "hello"})
    assert r.status_code == 503
    assert client.get("/api/health").json()["voice"] == {"stt": False, "tts": False}


def test_openai_voice_without_key_is_unavailable(client, monkeypatch):
    monkeypatch.setattr(get_settings(), "stt_provider", "openai")
    monkeypatch.setattr(get_settings(), "openai_api_key", None)
    r = client.post("/api/voice/transcribe", files={"file": _wav(4000)})
    assert r.status_code == 503 and "OPENAI_API_KEY" in r.json()["error"]["message"]


class FakeSTT:
    def __init__(self, text="  hello there ", fail=False):
        self.text, self.fail = text, fail

    def transcribe(self, audio, filename, content_type):
        if self.fail:
            raise ProviderError("The voice service timed out.")
        return self.text, "en"


def test_transcribe_validation_and_errors(client, monkeypatch):
    monkeypatch.setattr("app.api.voice.get_stt", lambda s: FakeSTT())
    assert client.post("/api/voice/transcribe", files={"file": _wav(4000)}).json() == {
        "text": "hello there",
        "language": "en",
    }
    r = client.post("/api/voice/transcribe", files={"file": _wav(10)})
    assert r.json()["error"]["code"] == "empty_audio"
    r = client.post("/api/voice/transcribe", files={"file": ("a.txt", b"x" * 4000, "text/plain")})
    assert r.json()["error"]["code"] == "unsupported_audio"

    monkeypatch.setattr("app.api.voice.get_stt", lambda s: FakeSTT(text="   "))
    assert (
        client.post("/api/voice/transcribe", files={"file": _wav(4000)}).json()["error"]["code"]
        == "no_speech"
    )

    monkeypatch.setattr("app.api.voice.get_stt", lambda s: FakeSTT(fail=True))
    r = client.post("/api/voice/transcribe", files={"file": _wav(4000)})
    assert r.status_code == 502 and r.json()["error"]["code"] == "provider_error"


def test_synthesize_returns_audio(client, monkeypatch):
    class FakeTTS:
        media_type = "audio/mpeg"

        def synthesize(self, text, language):
            return b"ID3fakeaudio"

    monkeypatch.setattr("app.api.voice.get_tts", lambda s: FakeTTS())
    r = client.post("/api/voice/synthesize", json={"text": "سلام", "language": "ur"})
    assert r.status_code == 200 and r.headers["content-type"] == "audio/mpeg"
    assert r.content == b"ID3fakeaudio"
