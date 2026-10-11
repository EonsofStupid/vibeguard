from __future__ import annotations

from pathlib import Path

import yaml

from .schema import EvalTask

TASKS_PATH = Path(__file__).with_name("tasks.yaml")


def load_tasks(path: Path = TASKS_PATH) -> list[EvalTask]:
    return [EvalTask.model_validate(t) for t in yaml.safe_load(path.read_text(encoding="utf-8"))]
