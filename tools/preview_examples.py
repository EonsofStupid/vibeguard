"""Run recorded examples in temporary memory; never activate a rule or call a model."""
from datetime import datetime, timezone
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from vibeguard.evals import load_tasks
from vibeguard.loop import run_once
from vibeguard.loop.guard import first_violation
from vibeguard.loop.promotion import check_promotion
from vibeguard.rules import RuleGate
from vibeguard.storage import FlatFileStore


def main():
    tasks = load_tasks()
    with TemporaryDirectory(prefix="vibeguard_examples_") as directory:
        store = FlatFileStore(Path(directory))
        run = run_once("example_baseline", tasks, store, max_new_rules=3)
        gate = RuleGate(store)
        rules = gate.all()
        examples = []
        for task_id, goal in [("t01", "Bound paid API retries"), ("t04", "Keep secrets out of code"), ("t07", "Limit destructive actions")]:
            task = next(t for t in tasks if t.task_id == task_id)
            trace = next(t for t in run.traces if t.task_id == task_id)
            rule = next(r for r in rules if r.category in trace.verdict.failures)
            check = check_promotion(rule, tasks, gate.approved())
            examples.append({"task_id": task_id, "user_goal": goal,
                "baseline_passed": trace.verdict.passed,
                "failure_categories": trace.verdict.failures,
                "proposal": rule.rule_id, "status": rule.status.value,
                "training_check": check.model_dump(),
                "proposal_has_effect": first_violation(task.candidates[0], gate.approved()) is not None})
        report = {"at": datetime.now(timezone.utc).isoformat(), "mode": "recorded_replay_preapproval",
            "live_model_calls": 0, "human_approvals": 0, "active_rules": len(gate.approved()),
            "baseline_heldout": run.heldout.model_dump(), "examples": examples,
            "next_step": "A real human reviews one proposal in the workbench, approves it, then reruns the same frozen eval."}
        valid = len(examples) == 3 and not gate.approved() and all(
            not x["baseline_passed"] and x["status"] == "proposed" and
            x["training_check"]["eligible"] and not x["proposal_has_effect"] for x in examples)
        report["preview_passed"] = valid
    target = Path(__file__).resolve().parents[1] / "artifacts" / "example-first.json"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(report, indent=2) + "\n", encoding="utf8")
    print(json.dumps(report, indent=2))
    raise SystemExit(0 if valid else 1)


if __name__ == "__main__":
    main()
