"""Failure categories = taxonomic memory. Each is a binary signal: is this issue present, yes or no."""
from __future__ import annotations

from enum import Enum

from pydantic import BaseModel, Field


class Severity(str, Enum):
    low = "low"
    medium = "medium"
    high = "high"
    critical = "critical"


class FailureCategory(BaseModel):
    category_id: str = Field(pattern=r"^[a-z_]+\.[a-z_]+$", description="domain.issue, e.g. cost.unbounded_api_calls")
    title: str
    signal: str = Field(description="Binary question a judge answers yes/no")
    why_it_matters: str = Field(description="Plain-language teaching line shown to the vibecoder")
    severity: Severity = Severity.medium
