"""Phase 1 resolver: token overlap. Phase 2 swaps in Voyage embeddings + Atlas $vectorSearch behind the same call."""
from __future__ import annotations

import re

from .schema import LexiconEntry

SEED_LEXICON: list[LexiconEntry] = [
    LexiconEntry(entry_id="lx-001", phrase="stop it breaking when I click twice", canonical_label="debounce / idempotent submit",
                 teach="Idempotent means doing it twice has the same effect as once."),
    LexiconEntry(entry_id="lx-002", phrase="make it take payments", canonical_label="payment integration (Stripe checkout)",
                 teach="Use the provider's hosted checkout; never handle card numbers yourself."),
    LexiconEntry(entry_id="lx-003", phrase="keep my key secret", canonical_label="environment variables / secret management",
                 teach="Secrets live in .env or a vault, never in code."),
    LexiconEntry(entry_id="lx-004", phrase="save stuff so it's there next time", canonical_label="persistence (database)", stack="postgres",
                 teach="An ORM like Drizzle or Prisma gives you typed tables."),
    LexiconEntry(entry_id="lx-005", phrase="it keeps charging me", canonical_label="unbounded API usage / rate limiting",
                 teach="Add a hard cap and a retry limit on paid calls."),
    LexiconEntry(entry_id="lx-006", phrase="log people in", canonical_label="authentication", teach="Use a managed auth provider; don't roll your own."),
    LexiconEntry(entry_id="lx-007", phrase="make it fast", canonical_label="performance / caching", teach="Measure first, then cache the slow part."),
    LexiconEntry(entry_id="lx-008", phrase="undo when it breaks", canonical_label="version control / rollback", teach="Commit before each AI change so you can roll back."),
]

_WORD = re.compile(r"[a-z']+")
_STOP = {"i", "it", "the", "a", "my", "me", "to", "so", "when", "and", "make", "is", "on", "of", "there"}


def _tokens(s: str) -> set[str]:
    return {w for w in _WORD.findall(s.lower()) if w not in _STOP}


def resolve_label(text: str, lexicon: list[LexiconEntry] | None = None, k: int = 3) -> list[tuple[LexiconEntry, float]]:
    """Return top-k (entry, score) by Jaccard overlap. Used for recall@K."""
    lexicon = lexicon or SEED_LEXICON
    q = _tokens(text)
    scored = []
    for e in lexicon:
        t = _tokens(e.phrase) | _tokens(e.canonical_label)
        score = len(q & t) / len(q | t) if q | t else 0.0
        scored.append((e, score))
    scored.sort(key=lambda x: x[1], reverse=True)
    return scored[:k]
