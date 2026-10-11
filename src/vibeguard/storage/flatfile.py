"""Flat-file record store: one Markdown file per record, YAML frontmatter for typed fields.

This is the source of truth until the Atlas port; the Atlas backend implements the same interface.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterator, TypeVar

import yaml
from pydantic import BaseModel

M = TypeVar("M", bound=BaseModel)

_FRONTMATTER = "---"


class FlatFileStore:
    def __init__(self, root: str | Path):
        self.root = Path(root)

    def _dir(self, kind: str) -> Path:
        d = self.root / kind
        d.mkdir(parents=True, exist_ok=True)
        return d

    def path(self, kind: str, record_id: str) -> Path:
        return self._dir(kind) / f"{record_id}.md"

    def write(self, kind: str, record_id: str, record: BaseModel, body: str = "") -> Path:
        data = json.loads(record.model_dump_json())
        text = f"{_FRONTMATTER}\n{yaml.safe_dump(data, sort_keys=False, allow_unicode=True)}{_FRONTMATTER}\n\n{body}".rstrip() + "\n"
        p = self.path(kind, record_id)
        p.write_text(text, encoding="utf-8")
        return p

    def read(self, kind: str, record_id: str, model: type[M]) -> M:
        return self._parse(self.path(kind, record_id), model)

    def exists(self, kind: str, record_id: str) -> bool:
        return self.path(kind, record_id).exists()

    def list(self, kind: str, model: type[M]) -> Iterator[M]:
        for p in sorted(self._dir(kind).glob("*.md")):
            yield self._parse(p, model)

    def append_log(self, kind: str, event: dict) -> None:
        """Append-only JSONL log (audit trail). Never rewritten."""
        event = {"at": datetime.now(timezone.utc).isoformat(), **event}
        with (self._dir(kind) / "log.jsonl").open("a", encoding="utf-8") as f:
            f.write(json.dumps(event) + "\n")

    @staticmethod
    def _parse(p: Path, model: type[M]) -> M:
        text = p.read_text(encoding="utf-8")
        if not text.startswith(_FRONTMATTER):
            raise ValueError(f"{p} has no frontmatter")
        _, fm, _ = text.split(_FRONTMATTER, 2)
        return model.model_validate(yaml.safe_load(fm))
