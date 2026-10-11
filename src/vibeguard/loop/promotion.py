"""Training-only evidence before a human promotes a rule. Held-out stays unseen."""
from pydantic import BaseModel
from vibeguard.evals import Split
from vibeguard.loop.agent import ScriptedAgent
from vibeguard.loop.run import run_task

class PromotionCheck(BaseModel):
    eligible: bool
    before: int
    after: int
    total: int
    regressions: list[str]
    false_blocks: int
    reason: str

def check_promotion(rule, tasks, active) -> PromotionCheck:
    train = [t for t in tasks if t.split == Split.train]
    before = [run_task(t, ScriptedAgent(), active) for t in train]
    after = [run_task(t, ScriptedAgent(), [*active, rule]) for t in train]
    regressions = [a.task_id for b, a in zip(before, after) if b.verdict.passed and not a.verdict.passed]
    b, a = sum(t.verdict.passed for t in before), sum(t.verdict.passed for t in after)
    false = sum(t.false_blocks for t in after)
    eligible = bool(train) and a > b and not regressions and false == 0
    return PromotionCheck(eligible=eligible, before=b, after=a, total=len(train),
        regressions=regressions, false_blocks=false,
        reason='Training improves without regressions or false blocks. Ready for human review.' if eligible
        else 'Keep proposed: improvement, regression, or false-block check failed.')
