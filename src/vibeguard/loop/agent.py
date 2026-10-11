"""Agents. ScriptedAgent replays recorded candidates in order so every run is reproducible.
An LLM agent implements the same `attempt(task, feedback)` call; the harness around it does not change."""
from __future__ import annotations

from typing import Protocol

from vibeguard.evals import EvalTask


class Agent(Protocol):
    def attempt(self, task: EvalTask, n: int, feedback: list[str]) -> str | None: ...


class ScriptedAgent:
    def attempt(self, task: EvalTask, n: int, feedback: list[str]) -> str | None:
        return task.candidates[n] if n < len(task.candidates) else None
