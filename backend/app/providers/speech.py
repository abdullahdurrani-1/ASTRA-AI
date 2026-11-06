"""Speech-to-text and text-to-speech adapters. Audio is processed in memory and never stored."""

from typing import Protocol

import httpx

from app.core.config import Settings
from app.core.errors import ProviderError, ProviderUnavailableError


class STTProvider(Protocol):
    def transcribe(self, audio: bytes, filename: str, content_type: str) -> tuple[str, str | None]:
        """Returns (text, detected_language or None)."""
        ...


class TTSProvider(Protocol):
    media_type: str

    def synthesize(self, text: str, language: str) -> bytes: ...


class _OpenAIBase:
    def __init__(self, s: Settings, model: str, kind: str):
        if not s.openai_api_key:
            raise ProviderUnavailableError(f"OPENAI_API_KEY is not configured for {kind}.")
        if not model:
            raise ProviderUnavailableError(f"A model must be configured for {kind}.")
        self._key = s.openai_api_key.get_secret_value()
        self._base = s.openai_base_url.rstrip("/")
        self._timeout = s.provider_timeout_seconds
        self._model = model

    def _call(self, path: str, **kwargs) -> httpx.Response:  # type: ignore[no-untyped-def]
        try:
            r = httpx.post(
                f"{self._base}/{path}",
                headers={"Authorization": f"Bearer {self._key}"},
                timeout=self._timeout,
                **kwargs,
            )
            r.raise_for_status()
            return r
        except httpx.TimeoutException as e:
            raise ProviderError("The voice service timed out.") from e
        except httpx.HTTPError as e:
            raise ProviderError("The voice service returned an error.") from e


class OpenAISTT(_OpenAIBase):
    def __init__(self, s: Settings):
        super().__init__(s, s.stt_model, "speech-to-text")

    def transcribe(self, audio: bytes, filename: str, content_type: str) -> tuple[str, str | None]:
        r = self._call(
            "audio/transcriptions",
            data={"model": self._model, "response_format": "json"},
            files={"file": (filename, audio, content_type)},
        )
        try:
            body = r.json()
            return str(body["text"]), body.get("language")
        except (ValueError, KeyError) as e:
            raise ProviderError("Unexpected response from the voice service.") from e


class OpenAITTS(_OpenAIBase):
    media_type = "audio/mpeg"

    def __init__(self, s: Settings):
        super().__init__(s, s.tts_model, "text-to-speech")
        self._voice = s.tts_voice

    def synthesize(self, text: str, language: str) -> bytes:
        r = self._call(
            "audio/speech",
            json={"model": self._model, "voice": self._voice, "input": text, "format": "mp3"},
        )
        return r.content


def get_stt(s: Settings) -> STTProvider:
    if s.stt_provider == "openai":
        return OpenAISTT(s)
    raise ProviderUnavailableError("Speech-to-text is not enabled on this server.")


def get_tts(s: Settings) -> TTSProvider:
    if s.tts_provider == "openai":
        return OpenAITTS(s)
    raise ProviderUnavailableError("Server text-to-speech is not enabled.")
