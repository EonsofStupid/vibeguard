"""CLI: python -m vibeguard <run|rules|approve|revert|demo|costar> ..."""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from vibeguard.costar import score_prompt, side_conversation
from vibeguard.costar.check import missing
from vibeguard.evals import load_tasks
from vibeguard.loop import run_once
from vibeguard.rules import RuleGate
from vibeguard.storage import FlatFileStore


def main() -> None:
    p = argparse.ArgumentParser(prog="vibeguard")
    p.add_argument("--wiki", default="wiki")
    sub = p.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("run"); r.add_argument("run_id"); r.add_argument("--max-new-rules", type=int, default=1)
    sub.add_parser("rules")
    a = sub.add_parser("approve"); a.add_argument("rule_id"); a.add_argument("--as", dest="actor", required=True)
    v = sub.add_parser("revert"); v.add_argument("rule_id"); v.add_argument("--as", dest="actor", required=True); v.add_argument("--reason", default="")
    d = sub.add_parser("demo", help="5 runs; the named human approves each proposed rule between runs")
    d.add_argument("--approver", required=True, help="e.g. human:jesse")
    c = sub.add_parser("costar"); c.add_argument("prompt")
    args = p.parse_args()

    store = FlatFileStore(Path(args.wiki))
    gate = RuleGate(store)
    if args.cmd == "run":
        res = run_once(args.run_id, load_tasks(), store, max_new_rules=args.max_new_rules)
        print(json.dumps(res.model_dump(mode="json", exclude={"traces"}), indent=2))
    elif args.cmd == "rules":
        for x in gate.all():
            print(f"{x.rule_id} v{x.version} {x.status.value:9} {x.category}  <- {x.origin.run_id}/{x.origin.task_id}")
    elif args.cmd == "approve":
        print(gate.approve(args.rule_id, actor=args.actor).model_dump_json(indent=2))
    elif args.cmd == "revert":
        print(gate.revert(args.rule_id, actor=args.actor, reason=args.reason).model_dump_json(indent=2))
    elif args.cmd == "costar":
        m = missing(score_prompt(args.prompt))
        print(json.dumps({"missing": [d.value for d in m], "ask": side_conversation(m)}, indent=2))
    elif args.cmd == "demo":
        tasks = load_tasks()
        print(f"{'run':8} {'rules':16} {'train':>7} {'heldout':>8} {'attempts':>9} {'blocks':>7} {'false':>6}")
        for i in range(1, 6):
            res = run_once(f"run_{i:03d}", tasks, store)
            print(f"{res.run_id:8} {','.join(res.rules_active) or '-':16} {res.train.passed:>3}/{res.train.total:<3} "
                  f"{res.heldout.passed:>4}/{res.heldout.total:<3} {res.paid_attempts:>9} {res.blocks:>7} {res.false_blocks:>6}")
            for rid in res.proposed:
                gate.approve(rid, actor=args.approver)


if __name__ == "__main__":
    main()
