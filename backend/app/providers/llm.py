"""LLM provider adapters. Each returns raw text; the RAG service parses and validates it.

The mock provider never calls a model: it extracts sentences from the evidence and labels them
`[MOCK MODE]` so its output can never be mistaken for a real model answer.
"""

import json
import logging
import random
import re
import time
from collections.abc import Iterator
from dataclasses import dataclass, field
from typing import Protocol

import httpx

from app.core.config import Settings
from app.core.errors import ProviderError, ProviderUnavailableError

logger = logging.getLogger(__name__)


@dataclass
class EvidenceItem:
    chunk_id: str
    text: str


@dataclass
class LLMRequest:
    system: str
    user: str
    question: str
    evidence: list[EvidenceItem] = field(default_factory=list)
    language: str = "en"
    # Per-call overrides (router/fallback roles); None means the provider's answer defaults.
    model: str | None = None
    timeout: float | None = None
    max_tokens: int | None = None


class LLMProvider(Protocol):
    name: str
    is_mock: bool

    def generate(self, req: LLMRequest) -> str: ...

    def stream(self, req: LLMRequest) -> Iterator[str]:
        """Text deltas as the model produces them; concatenated they equal generate()."""
        ...


_WORD = re.compile(r"\w+", re.UNICODE)
_SENT = re.compile(r"(?<=[.!?۔؟])\s+")


class MockLLMProvider:
    name = "mock"
    is_mock = True

    def generate(self, req: LLMRequest) -> str:
        q_terms = {w for w in _WORD.findall(req.question.casefold()) if len(w) > 2}
        scored: list[tuple[int, str, str]] = []
        for ev in req.evidence:
            for sent in _SENT.split(ev.text.replace("\n", " ")):
                overlap = len(q_terms & set(_WORD.findall(sent.casefold())))
                if overlap:
                    scored.append((overlap, sent.strip(), ev.chunk_id))
        scored.sort(key=lambda s: -s[0])
        if not scored:
            return json.dumps({"status": "insufficient_evidence", "answer": "", "citations": []})
        top = scored[:2]
        note = " (not translated — mock mode)" if req.language == "ur" else ""
        answer = "[MOCK MODE]" + note + " Relevant passages: " + " ".join(s for _, s, _ in top)
        cites = list(dict.fromkeys(c for _, _, c in top))
        return json.dumps({"status": "answered", "answer": answer, "citations": cites})

    def stream(self, req: LLMRequest) -> Iterator[str]:
        text = self.generate(req)
        for i in range(0, len(text), 12):
            yield text[i : i + 12]


_RETRYABLE = {429, 500, 502, 503, 504, 529}


def _post(url: str, headers: dict[str, str], body: dict, timeout: float, retries: int = 0) -> dict:
    """POST with jittered exponential backoff on 429/5xx. Timeouts are not retried (latency)."""
    for attempt in range(retries + 1):
        try:
            r = httpx.post(url, headers=headers, json=body, timeout=timeout)
            if r.status_code in _RETRYABLE and attempt < retries:
                delay = 0.5 * 2**attempt + random.uniform(0, 0.25)  # noqa: S311
                logger.warning("llm_retry", extra={"status": r.status_code, "attempt": attempt})
                time.sleep(delay)
                continue
            r.raise_for_status()
            return r.json()
        except httpx.TimeoutException as e:
            raise ProviderError("The language model timed out.") from e
        except (httpx.HTTPError, ValueError) as e:
            raise ProviderError("The language model returned an error.") from e
    raise ProviderError("The language model returned an error.")  # pragma: no cover


def _stream_post(
    url: str, headers: dict[str, str], body: dict, timeout: float, retries: int = 0
) -> Iterator[dict]:
    """POST and yield each parsed `data:` JSON object of a server-sent-event stream."""
    for attempt in range(retries + 1):
        try:
            with httpx.stream(
                "POST",
                url,
                headers=headers,
                json=body,
                timeout=httpx.Timeout(timeout, read=timeout),
            ) as r:
                if r.status_code in _RETRYABLE and attempt < retries:
                    time.sleep(0.5 * 2**attempt + random.uniform(0, 0.25))  # noqa: S311
                    continue
                r.raise_for_status()
                for line in r.iter_lines():
                    if not line.startswith("data:"):
                        continue
                    payload = line[5:].strip()
                    if not payload or payload == "[DONE]":
                        continue
                    try:
                        yield json.loads(payload)
                    except ValueError:
                        continue
                return
        except httpx.TimeoutException as e:
            raise ProviderError("The language model timed out.") from e
        except (httpx.HTTPError, ValueError) as e:
            raise ProviderError("The language model returned an error.") from e
    raise ProviderError("The language model returned an error.")  # pragma: no cover


class AnthropicProvider:
    name = "anthropic"
    is_mock = False

    def __init__(self, s: Settings):
        if not s.anthropic_api_key:
            raise ProviderUnavailableError("ANTHROPIC_API_KEY is not configured.")
        if not s.answer_model:
            raise ProviderUnavailableError("LLM_MODEL_ANSWER must be set (anthropic provider).")
        self._s = s

    def _call(self, req: LLMRequest) -> tuple[str, dict[str, str], dict, float, int]:
        assert self._s.anthropic_api_key is not None
        return (
            "https://api.anthropic.com/v1/messages",
            {
                "x-api-key": self._s.anthropic_api_key.get_secret_value(),
                "anthropic-version": "2023-06-01",
            },
            {
                "model": req.model or self._s.answer_model,
                "max_tokens": req.max_tokens or self._s.llm_max_tokens,
                "temperature": self._s.llm_temperature,
                "system": req.system,
                "messages": [{"role": "user", "content": req.user}],
            },
            req.timeout or self._s.provider_timeout_seconds,
            self._s.llm_max_retries if req.timeout is None else 0,
        )

    def generate(self, req: LLMRequest) -> str:
        data = _post(*self._call(req))
        try:
            return "".join(b["text"] for b in data["content"] if b.get("type") == "text")
        except (KeyError, TypeError) as e:
            raise ProviderError("Unexpected response from the language model.") from e

    def stream(self, req: LLMRequest) -> Iterator[str]:
        url, headers, body, timeout, retries = self._call(req)
        for ev in _stream_post(url, headers, {**body, "stream": True}, timeout, retries):
            if ev.get("type") == "content_block_delta":
                text = ev.get("delta", {}).get("text")
                if text:
                    yield text


GEMINI_OPENAI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai"


class OpenAIProvider:
    """OpenAI chat-completions API; also serves Gemini through Google's compatible endpoint."""

    name = "openai"
    is_mock = False

    def __init__(self, s: Settings, gemini: bool = False):
        key = s.gemini_api_key if gemini else s.openai_api_key
        if not key:
            env = "GEMINI_API_KEY" if gemini else "OPENAI_API_KEY"
            raise ProviderUnavailableError(f"{env} is not configured.")
        if not s.answer_model:
            raise ProviderUnavailableError("LLM_MODEL_ANSWER must be set for a real LLM provider.")
        if gemini:
            self.name = "gemini"
        self._s = s
        self._key = key
        self._base_url = GEMINI_OPENAI_BASE_URL if gemini else s.openai_base_url

    def _call(self, req: LLMRequest) -> tuple[str, dict[str, str], dict, float, int]:
        return (
            f"{self._base_url.rstrip('/')}/chat/completions",
            {"Authorization": f"Bearer {self._key.get_secret_value()}"},
            {
                "model": req.model or self._s.answer_model,
                "max_tokens": req.max_tokens or self._s.llm_max_tokens,
                "temperature": self._s.llm_temperature,
                "response_format": {"type": "json_object"},
                "messages": [
                    {"role": "system", "content": req.system},
                    {"role": "user", "content": req.user},
                ],
                **(
                    {"reasoning_effort": self._s.llm_reasoning_effort}
                    if self._s.llm_reasoning_effort
                    else {}
                ),
            },
            req.timeout or self._s.provider_timeout_seconds,
            self._s.llm_max_retries if req.timeout is None else 0,
        )

    def generate(self, req: LLMRequest) -> str:
        data = _post(*self._call(req))
        try:
            return str(data["choices"][0]["message"]["content"])
        except (KeyError, IndexError, TypeError) as e:
            raise ProviderError("Unexpected response from the language model.") from e

    def stream(self, req: LLMRequest) -> Iterator[str]:
        url, headers, body, timeout, retries = self._call(req)
        for ev in _stream_post(url, headers, {**body, "stream": True}, timeout, retries):
            choices = ev.get("choices") or []
            if choices:
                text = (choices[0].get("delta") or {}).get("content")
                if text:
                    yield text


def get_llm_provider(settings: Settings) -> LLMProvider:
    if settings.llm_provider == "anthropic":
        return AnthropicProvider(settings)
    if settings.llm_provider == "openai":
        return OpenAIProvider(settings)
    if settings.llm_provider == "gemini":
        return OpenAIProvider(settings, gemini=True)
    return MockLLMProvider()
