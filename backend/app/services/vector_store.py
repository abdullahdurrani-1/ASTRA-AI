"""The only module that knows about Chroma. Swap for pgvector behind the same functions."""

import re
import threading
from dataclasses import dataclass

import chromadb
from chromadb.api import ClientAPI

from app.core.config import Settings
from app.providers.embeddings import EmbeddingProvider

_lock = threading.Lock()
_clients: dict[str, ClientAPI] = {}


@dataclass
class VectorHit:
    chunk_id: str
    similarity: float  # cosine similarity in [-1, 1]


def index_name(provider: EmbeddingProvider) -> str:
    raw = f"chunks_{provider.name}_{provider.model}_{provider.dimension}"
    return re.sub(r"[^a-zA-Z0-9._-]", "_", raw)[:120]


def _client(settings: Settings) -> ClientAPI:
    key = str(settings.chroma_dir)
    with _lock:
        if key not in _clients:
            settings.chroma_dir.mkdir(parents=True, exist_ok=True)
            _clients[key] = chromadb.PersistentClient(
                path=key, settings=chromadb.Settings(anonymized_telemetry=False)
            )
        return _clients[key]


def _collection(settings: Settings, name: str):  # type: ignore[no-untyped-def]
    return _client(settings).get_or_create_collection(
        name, embedding_function=None, metadata={"hnsw:space": "cosine"}
    )


def upsert(
    settings: Settings,
    name: str,
    ids: list[str],
    embeddings: list[list[float]],
    metadatas: list[dict[str, str | int]],
) -> None:
    _collection(settings, name).upsert(ids=ids, embeddings=embeddings, metadatas=metadatas)  # type: ignore[arg-type]


def count_for_document(settings: Settings, name: str, document_id: str) -> int:
    res = _collection(settings, name).get(where={"document_id": document_id}, include=[])
    return len(res["ids"])


def delete_document(settings: Settings, name: str, document_id: str) -> None:
    _collection(settings, name).delete(where={"document_id": document_id})


def query(
    settings: Settings,
    name: str,
    embedding: list[float],
    user_id: str,
    document_ids: list[str],
    n: int,
) -> list[VectorHit]:
    col = _collection(settings, name)
    doc_filter = (
        {"document_id": document_ids[0]}
        if len(document_ids) == 1
        else {"document_id": {"$in": document_ids}}
    )
    res = col.query(
        query_embeddings=[embedding],  # type: ignore[arg-type]
        n_results=n,
        where={"$and": [{"user_id": user_id}, doc_filter]},
        include=["distances"],
    )
    ids = res["ids"][0] if res["ids"] else []
    dists = res["distances"][0] if res.get("distances") else []
    return [
        VectorHit(chunk_id=i, similarity=1.0 - float(d)) for i, d in zip(ids, dists, strict=True)
    ]
