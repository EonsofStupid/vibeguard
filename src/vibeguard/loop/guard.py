"""Runtime guard: approved rules (procedural memory) checked before a candidate ships."""
from __future__ import annotations

from vibeguard.rules import GuardrailRule


def first_violation(code: str, rules: list[GuardrailRule]) -> GuardrailRule | None:
    for r in rules:
        if r.trigger.matches(code):
            return r
    return None
