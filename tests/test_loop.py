from vibeguard.evals import load_tasks
from vibeguard.loop import run_once, wilson
from vibeguard.rules import RuleGate, RuleStatus
from vibeguard.storage import FlatFileStore


def test_heldout_improves_only_through_human_approved_rules(tmp_path):
    store, tasks = FlatFileStore(tmp_path), load_tasks()
    gate = RuleGate(store)
    r1 = run_once("run_001", tasks, store)
    assert r1.rules_active == [] and r1.proposed  # agent proposed, nothing active yet
    r1b = run_once("run_001b", tasks, store)       # no human approval -> no improvement
    assert r1b.heldout.passed == r1.heldout.passed
    for i in range(2, 6):
        for rule in gate.all():
            if rule.status == RuleStatus.proposed:
                gate.approve(rule.rule_id, actor="human:test")
        last = run_once(f"run_{i:03d}", tasks, store)
    assert last.heldout.passed > r1.heldout.passed
    assert last.false_blocks == 0


def test_wilson_bounds():
    lo, hi = wilson(5, 6)
    assert 0.4 < lo < 0.5 and 0.95 < hi <= 1.0
