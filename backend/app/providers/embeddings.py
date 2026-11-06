"""Embedding provider adapters.

`mock` is a deterministic hashing embedder for dev/tests: it captures word overlap only,
not meaning, and cannot match across languages. Use `openai` or `sentence_transformers`
for real semantic search.
"""

import hashlib
import math
import re
from typing import Protocol

import httpx

from app.core.config import Settings
from app.core.errors import ProviderError, ProviderUnavailableError

_TOKEN_RE = re.compile(r"\w+", re.UNICODE)


class EmbeddingProvider(Protocol):
    name: str
    model: str
    dimension: int

    def embed(self, texts: list[str]) -> list[list[float]]: ...


def _normalize(vec: list[float]) -> list[float]:
    norm = math.sqrt(sum(v * v for v in vec)) or 1.0
    return [v / norm for v in vec]


class MockEmbeddingProvider:
    name = "mock"
    model = "hashing-v1"
    dimension = 384

    def embed(self, texts: list[str]) -> list[list[float]]:
        return [self._embed_one(t) for t in texts]

    def _embed_one(self, text: str) -> list[float]:
        vec = [0.0] * self.dimension
        for token in _TOKEN_RE.findall(text.casefold()):
            features = [f"w:{token}"] + [
                f"c:{token[i : i + 4]}" for i in range(max(1, len(token) - 3))
            ]
            for f in features:
                h = int.from_bytes(hashlib.blake2b(f.encode(), digest_size=8).digest(), "big")
                vec[h % self.dimension] += 1.0 if (h >> 63) & 1 else -1.0
        return _normalize(vec)


class OpenAIEmbeddingProvider:
    name = "openai"

    def __init__(self, settings: Settings):
        if not settings.openai_api_key:
            raise ProviderUnavailableError("OPENAI_API_KEY is not configured for embeddings.")
        self.model = settings.embedding_model or "text-embedding-3-small"
        self.dimension = 1536 if self.model.endswith("small") else 3072
        self._key = settings.openai_api_key.get_secret_value()
        self._url = f"{settings.openai_base_url.rstrip('/')}/embeddings"
        self._timeout = settings.provider_timeout_seconds

    def embed(self, texts: list[str]) -> list[list[float]]:
        try:
            r = httpx.post(
                self._url,
                headers={"Authorization": f"Bearer {self._key}"},
                json={"model": self.model, "input": texts},
                timeout=self._timeout,
            )
            r.raise_for_status()
            data = sorted(r.json()["data"], key=lambda d: d["index"])
            return [d["embedding"] for d in data]
        except httpx.TimeoutException as e:
            raise ProviderError("The embedding service timed out.") from e
        except (httpx.HTTPError, KeyError, ValueError) as e:
            raise ProviderError("The embedding service returned an error.") from e


class SentenceTransformersProvider:
    """Local multilingual model. Requires `pip install sentence-transformers` (pulls in PyTorch)."""

    name = "sentence_transformers"

    def __init__(self, settings: Settings):
        try:
            from sentence_transformers import SentenceTransformer
        except ImportError as e:
            raise ProviderUnavailableError(
                "sentence-transformers is not installed. Run: pip install sentence-transformers"
            ) from e
        self.model = settings.embedding_model or "paraphrase-multilingual-MiniLM-L12-v2"
        self._st = SentenceTransformer(self.model)
        self.dimension = int(self._st.get_sentence_embedding_dimension() or 0)

    def embed(self, texts: list[str]) -> list[list[float]]:
        return [v.tolist() for v in self._st.encode(texts, normalize_embeddings=True)]


_cache: dict[tuple[str, str], EmbeddingProvider] = {}


def get_embedding_provider(settings: Settings) -> EmbeddingProvider:
    key = (settings.embedding_provider, settings.embedding_model)
    if key not in _cache:
        if settings.embedding_provider == "openai":
            _cache[key] = OpenAIEmbeddingProvider(settings)
        elif settings.embedding_provider == "sentence_transformers":
            _cache[key] = SentenceTransformersProvider(settings)
        else:
            _cache[key] = MockEmbeddingProvider()
    return _cache[key]
