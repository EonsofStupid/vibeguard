"""COSTAR capture: Context, Objective, Style, Tone, Audience, Response format."""
from __future__ import annotations

from datetime import datetime
from enum import Enum

from pydantic import BaseModel, Field


class Dimension(str, Enum):
    context = "context"
    objective = "objective"
    style = "style"
    tone = "tone"
    audience = "audience"
    response = "response"


class DimensionScore(BaseModel):
    dimension: Dimension
    p_present: float = Field(ge=0, le=1, description="Phase 1: squashed feature score. Phase 2: calibrated probability.")
    evidence: list[str] = []


class CostarCapture(BaseModel):
    capture_id: str
    prompt: str
    scores: list[DimensionScore]
    missing: list[Dimension]
    filled: dict[Dimension, str] = {}
    created_at: datetime

    @property
    def complete(self) -> bool:
        return not [d for d in self.missing if d not in self.filled]
