"""Semantic memory on Atlas: lexicon entries embedded with Voyage, retrieved with $vectorSearch.

Phase 1 resolver (token overlap) stays as the offline fallback; this is the Atlas-backed path.
"""
from __future__ import annotations

import os
import time

from pymongo.operations import SearchIndexModel

from vibeguard.context.voyage import _call
from vibeguard.lexicon import SEED_LEXICON, LexiconEntry
from vibeguard.loop.metrics import recall_at_k

INDEX = "lexicon_vec"
DIMS = 1024


def _model() -> str:
    return os.environ.get("VOYAGE_MODEL", "voyage-code-4")


def embed(texts: list[str], input_type: str) -> list[list[float]]:
    out = _call("embeddings", {"model": _model(), "input": texts, "input_type": input_type})
    return [d["embedding"] for d in out["data"]]


def embed_lexicon(db, entries: list[LexiconEntry] | None = None) -> int:
    entries = entries or SEED_LEXICON
    vecs = embed([f"{e.phrase} -> {e.canonical_label}" for e in entries], "document")
    coll = db["lexicon"]
    for e, v in zip(entries, vecs):
        coll.replace_one({"_id": e.entry_id},
                         {"_id": e.entry_id, "record": e.model_dump(mode="json"), "body": e.teach, "embedding": v},
                         upsert=True)
    return len(entries)


def ensure_vector_index(db, wait_s: int = 120) -> str:
    coll = db["lexicon"]
    existing = {i["name"]: i for i in coll.list_search_indexes()}
    if INDEX not in existing:
        coll.create_search_index(SearchIndexModel(
            name=INDEX, type="vectorSearch",
            definition={"fields": [{"type": "vector", "path": "embedding", "numDimensions": DIMS, "similarity": "cosine"}]}))
    t0 = time.time()
    while time.time() - t0 < wait_s:
        info = {i["name"]: i for i in coll.list_search_indexes()}.get(INDEX, {})
        if info.get("queryable"):
            return info.get("status", "READY")
        time.sleep(3)
    return "PENDING"


def vector_resolve(db, text: str, k: int = 3) -> list[tuple[dict, float]]:
    q = embed([text], "query")[0]
    cur = db["lexicon"].aggregate([
        {"$vectorSearch": {"index": INDEX, "path": "embedding", "queryVector": q, "numCandidates": 50, "limit": k}},
        {"$project": {"_id": 0, "record": 1, "score": {"$meta": "vectorSearchScore"}}},
    ])
    return [(d["record"], round(d["score"], 4)) for d in cur]


# Held-out phrasings: how a vibecoder might say it differently from the seed phrase. Gold = the seed entry.
EVAL_QUERIES: list[tuple[str, str]] = [
    ("my site keeps charging me money", "lx-005"),
    ("let people pay with a card", "lx-002"),
    ("don't put my api key in the code", "lx-003"),
    ("stop the button firing twice", "lx-001"),
    ("remember things between visits", "lx-004"),
    ("add a login page", "lx-006"),
    ("the page is slow", "lx-007"),
    ("go back to the version that worked", "lx-008"),
]


def recall_at_k_eval(db, k: int = 3) -> dict:
    hits, per = [], []
    for q, gold in EVAL_QUERIES:
        ranked = [r["entry_id"] for r, _ in vector_resolve(db, q, k=k)]
        r = recall_at_k(ranked, {gold}, k)
        hits.append(r); per.append({"query": q, "gold": gold, "top": ranked, "hit": bool(r)})
    return {"k": k, "recall_at_k": round(sum(hits) / len(hits), 3), "n": len(hits), "per_query": per}
