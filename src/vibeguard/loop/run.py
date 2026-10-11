"""One harness run: attempt -> guard -> judge -> (train only) propose rules. Writes an episodic record to wiki/runs."""
from __future__ import annotations

from datetime import datetime, timezone

from pydantic import BaseModel

from vibeguard.evals import EvalTask, Split, Verdict, judge
from vibeguard.rules import RuleGate
from vibeguard.storage import FlatFileStore

from .agent import Agent, ScriptedAgent
from .guard import first_violation
from .metrics import wilson
from .writer import propose_rules


class TaskTrace(BaseModel):
    task_id: str
    split: Split
    attempts: int
    blocked_by: list[str]
    false_blocks: int
    verdict: Verdict
    shipped: bool = False
    termination: str = "accepted"


class SplitMetrics(BaseModel):
    passed: int
    total: int
    pass_rate: float
    ci95: tuple[float, float]


class RunResult(BaseModel):
    run_id: str
    at: datetime
    rules_active: list[str]
    train: SplitMetrics
    heldout: SplitMetrics
    paid_attempts: int
    blocks: int
    false_blocks: int
    proposed: list[str]
    traces: list[TaskTrace]


def _split_metrics(traces: list[TaskTrace], split: Split) -> SplitMetrics:
    ts = [t for t in traces if t.split == split]
    k = sum(t.verdict.passed for t in ts)
    return SplitMetrics(passed=k, total=len(ts), pass_rate=round(k / len(ts), 3) if ts else 0.0, ci95=wilson(k, len(ts)))


def run_task(task: EvalTask, agent: Agent, rules, max_attempts: int = 8) -> TaskTrace:
    if max_attempts < 1:
        raise ValueError("max_attempts must be positive")
    feedback, blocked, false_blocks, n, accepted = [], [], 0, 0, None
    termination = "budget_exhausted"
    for attempt in range(max_attempts):
        candidate = agent.attempt(task, attempt, feedback)
        if candidate is None:
            termination = "candidates_exhausted"
            break
        n += 1
        hit = first_violation(candidate, rules)
        if hit is None:
            accepted = candidate
            termination = "accepted"
            break
        blocked.append(hit.rule_id)
        feedback.append(hit.user_message)
        if judge(task, candidate).passed:
            false_blocks += 1
    verdict = judge(task, accepted if accepted is not None else "")
    if accepted is None:
        verdict = verdict.model_copy(update={
            "passed": False,
            "failures": list(dict.fromkeys([*verdict.failures, "correctness.failed_tests"])),
        })
    return TaskTrace(task_id=task.task_id, split=task.split, attempts=n, blocked_by=blocked,
                     false_blocks=false_blocks, verdict=verdict, shipped=accepted is not None,
                     termination=termination)


def run_once(run_id: str, tasks: list[EvalTask], store: FlatFileStore, agent: Agent | None = None, max_new_rules: int = 1) -> RunResult:
    agent = agent or ScriptedAgent()
    gate = RuleGate(store)
    rules = gate.approved()
    traces = [run_task(t, agent, rules) for t in tasks]
    train_verdicts = [t.verdict for t in traces if t.split == Split.train and not t.verdict.passed]
    proposed = propose_rules(run_id, train_verdicts, gate, max_new=max_new_rules)
    result = RunResult(
        run_id=run_id, at=datetime.now(timezone.utc), rules_active=[r.rule_id for r in rules],
        train=_split_metrics(traces, Split.train), heldout=_split_metrics(traces, Split.heldout),
        paid_attempts=sum(t.attempts for t in traces), blocks=sum(len(t.blocked_by) for t in traces),
        false_blocks=sum(t.false_blocks for t in traces), proposed=[r.rule_id for r in proposed], traces=traces,
    )
    store.write("runs", run_id, result, body=_summary(result))
    return result


def _summary(r: RunResult) -> str:
    lines = [f"# {r.run_id}", "",
             f"- rules active: {', '.join(r.rules_active) or 'none'}",
             f"- train: {r.train.passed}/{r.train.total} (95% CI {r.train.ci95[0]}–{r.train.ci95[1]})",
             f"- held-out: {r.heldout.passed}/{r.heldout.total} (95% CI {r.heldout.ci95[0]}–{r.heldout.ci95[1]})",
             f"- blocks before shipping: {r.blocks} (false blocks: {r.false_blocks})",
             f"- proposed rules awaiting a human: {', '.join(r.proposed) or 'none'}"]
    return "\n".join(lines)
