"""Guardrail rules = procedural memory. Written by failed evals, gated by a human."""
from __future__ import annotations

import re
from datetime import datetime
from enum import Enum

from pydantic import BaseModel, Field, field_validator


class RuleStatus(str, Enum):
    proposed = "proposed"
    approved = "approved"
    reverted = "reverted"


class Direction(str, Enum):
    tighten = "tighten"
    loosen = "loosen"


class RuleAction(str, Enum):
    block_and_explain = "block_and_explain"
    warn = "warn"
    ask = "ask"


class Trigger(BaseModel):
    type: str = Field("regex", pattern="^(regex|keyword)$")
    pattern: str

    @field_validator("pattern")
    @classmethod
    def _compiles(cls, v: str, info):  # reject rules that can't run
        re.compile(v)
        return v

    def matches(self, text: str) -> bool:
        if self.type == "keyword":
            return self.pattern.lower() in text.lower()
        return re.search(self.pattern, text, re.IGNORECASE | re.DOTALL) is not None


class Origin(BaseModel):
    run_id: str
    task_id: str
    failure_category: str
    judge_score: float | None = None


class GuardrailRule(BaseModel):
    rule_id: str = Field(pattern=r"^VG-\d{4}$")
    version: int = 1
    status: RuleStatus = RuleStatus.proposed
    direction: Direction = Direction.tighten
    category: str = Field(description="FailureCategory.category_id this rule guards")
    trigger: Trigger
    action: RuleAction = RuleAction.block_and_explain
    user_message: str = Field(description="Natural, non-robotic line shown to the vibecoder")
    origin: Origin
    proposed_by: str = "agent:vibeguard"
    approved_by: str | None = None
    created_at: datetime
    updated_at: datetime
