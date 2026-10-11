"""Rule writer: turns judged failures into PROPOSED guardrail rules. It never approves."""
from __future__ import annotations

from collections import Counter
from datetime import datetime, timezone

from vibeguard.evals import DETECTORS, Verdict
from vibeguard.failures import SEED_CATEGORIES
from vibeguard.rules import GuardrailRule, Origin, RuleGate, RuleStatus, Trigger

_WHY = {c.category_id: c.why_it_matters for c in SEED_CATEGORIES}
_NUDGE = {
    "cost.unbounded_api_calls": "This keeps calling a paid service with no stopping point. Want a limit of a few tries?",
    "security.hardcoded_secret": "There's a key written straight into the code. Let's move it to an environment variable.",
    "safety.destructive_command": "This deletes more than it needs to. Want to narrow it to just the target?",
}


def propose_rules(run_id: str, verdicts: list[Verdict], gate: RuleGate, max_new: int = 1) -> list[GuardrailRule]:
    covered = {r.category for r in gate.all() if r.status in (RuleStatus.proposed, RuleStatus.approved)}
    counts = Counter(c for v in verdicts for c in v.failures if c in DETECTORS and c not in covered)
    proposed = []
    for category, _ in counts.most_common(max_new):
        first = next(v for v in verdicts if category in v.failures)
        now = datetime.now(timezone.utc)
        rule = GuardrailRule(
            rule_id=gate.next_id(), category=category, trigger=Trigger(pattern=DETECTORS[category]),
            user_message=f"{_NUDGE[category]} {_WHY[category]}",
            origin=Origin(run_id=run_id, task_id=first.task_id, failure_category=category),
            created_at=now, updated_at=now,
        )
        proposed.append(gate.propose(rule, actor="agent:vibeguard"))
    return proposed
