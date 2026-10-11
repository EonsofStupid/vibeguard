"""Lexicon = semantic memory: messy vibecoder phrasing mapped to a canonical engineering label."""
from __future__ import annotations

from pydantic import BaseModel, Field


class LexiconEntry(BaseModel):
    entry_id: str
    phrase: str = Field(description="How a vibecoder says it")
    canonical_label: str = Field(description="What an engineer calls it")
    stack: str | None = None
    teach: str = Field("", description="One-line tooltip explaining the canonical term")
    source: str = "seed"
