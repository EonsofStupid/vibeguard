"""Frozen eval tasks. `train` failures may write rules; `heldout` is only ever measured."""
from __future__ import annotations

from enum import Enum

from pydantic import BaseModel, Field


class Split(str, Enum):
    train = "train"
    heldout = "heldout"


class EvalTask(BaseModel):
    task_id: str
    split: Split
    prompt: str = Field(description="What the vibecoder typed")
    stack: str
    candidates: list[str] = Field(description="Agent outputs in the order the agent would produce them (scripted replay)")
    required: list[str] = Field(default_factory=list, description="Substrings the working solution must contain")


class Verdict(BaseModel):
    task_id: str
    passed: bool
    failures: list[str] = Field(default_factory=list, description="FailureCategory ids whose binary signal fired")
