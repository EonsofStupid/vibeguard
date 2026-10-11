"""CLI: python -m vibeguard <run|rules|approve|revert|demo|costar|memory-sync|memory-context|memory-recall> ...

Store: flat-file wiki/ by default; VIBEGUARD_STORE=atlas uses MONGODB_URI (see .env.example).
Hosted memory: --memory (or VIBEGUARD_MEMORY=agentengine) mirrors the loop into Atlas Agent Engine memory.
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path

from vibeguard.costar import score_prompt, side_conversation
from vibeguard.costar.check import missing
from vibeguard.evals import load_tasks
from vibeguard.loop import run_once
from vibeguard.rules import RuleGate
from vibeguard.settings import load_env
from vibeguard.storage import FlatFileStore


def make_store(wiki: str):
    load_env()
    if os.environ.get("VIBEGUARD_STORE", "flatfile").lower() == "atlas":
        from vibeguard.storage.atlas import AtlasStore
        return AtlasStore.from_env()
    return FlatFileStore(Path(wiki))


def make_memory(enabled: bool):
    if not (enabled or os.environ.get("VIBEGUARD_MEMORY", "").lower() == "agentengine"):
        return None
    from vibeguard.memory import AgentEngineMemory
    return AgentEngineMemory.from_env()


def main() -> None:
    p = argparse.ArgumentParser(prog="vibeguard")
    p.add_argument("--wiki", default="wiki")
    sub = p.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("run"); r.add_argument("run_id"); r.add_argument("--max-new-rules", type=int, default=1)
    sub.add_parser("rules")
    a = sub.add_parser("approve"); a.add_argument("rule_id"); a.add_argument("--as", dest="actor", required=True)
    v = sub.add_parser("revert"); v.add_argument("rule_id"); v.add_argument("--as", dest="actor", required=True); v.add_argument("--reason", default="")
    r.add_argument("--memory", action="store_true", help="build_context before every attempt; mirror the run into Agent Engine memory")
    d = sub.add_parser("demo", help="5 runs; the named human approves each proposed rule between runs")
    d.add_argument("--approver", required=True, help="e.g. human:jesse")
    d.add_argument("--memory", action="store_true", help="mirror rules/runs into Agent Engine memory and measure the context policy per run")
    d.add_argument("--runs", type=int, default=5)
    c = sub.add_parser("costar"); c.add_argument("prompt")
    ms = sub.add_parser("memory-sync", help="mirror failures, lexicon, approved rules and runs into Agent Engine memory")
    ms.add_argument("--only", choices=["taxonomic", "semantic", "procedural", "episodic"], action="append", help="limit to one memory type (repeatable)")
    mc = sub.add_parser("memory-context", help="show what build_context puts in front of the agent for a prompt"); mc.add_argument("prompt")
    mr = sub.add_parser("memory-recall", help="search the four hosted memory types"); mr.add_argument("query"); mr.add_argument("--top-k", type=int, default=5)
    args = p.parse_args()

    store = make_store(args.wiki)
    gate = RuleGate(store)
    if args.cmd == "run":
        res = run_once(args.run_id, load_tasks(), store, max_new_rules=args.max_new_rules, memory=make_memory(args.memory))
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
        memory = make_memory(args.memory)
        print(f"{'run':8} {'rules':24} {'train':>7} {'heldout':>8} {'attempts':>9} {'blocks':>7} {'false':>6} {'ctx-mem':>8}")
        for i in range(1, args.runs + 1):
            res = run_once(f"run_{i:03d}", tasks, store, memory=memory)
            print(f"{res.run_id:8} {','.join(res.rules_active) or '-':24} {res.train.passed:>3}/{res.train.total:<3} "
                  f"{res.heldout.passed:>4}/{res.heldout.total:<3} {res.paid_attempts:>9} {res.blocks:>7} {res.false_blocks:>6} {res.context_memories:>8}")
            for rid in res.proposed:
                rule = gate.approve(rid, actor=args.approver)
                if memory is not None:
                    memory.mirror_rule(rule)
    elif args.cmd == "memory-sync":
        from vibeguard.failures.catalog import SEED_CATEGORIES
        from vibeguard.lexicon.resolve import SEED_LEXICON
        from vibeguard.loop.run import RunResult
        from vibeguard.memory import AgentEngineMemory
        mem = AgentEngineMemory.from_env()
        want = set(args.only or ["taxonomic", "semantic", "procedural", "episodic"])
        out = {}
        if "taxonomic" in want: out["taxonomic"] = mem.mirror_failures(SEED_CATEGORIES)
        if "semantic" in want: out["semantic"] = mem.mirror_lexicon(SEED_LEXICON)
        if "procedural" in want: out["procedural"] = mem.mirror_rules(gate.all())
        if "episodic" in want: out["episodic"] = sum(1 for r in store.list("runs", RunResult) if mem.mirror_run(r))
        print(json.dumps({"mirrored": out, "project_id": mem.project_id}, indent=2))
    elif args.cmd == "memory-context":
        from vibeguard.memory import AgentEngineMemory
        mem = AgentEngineMemory.from_env()
        print(json.dumps(mem.context_for(args.prompt).model_dump(), indent=2))
        print(mem.formatted_context(args.prompt))
    elif args.cmd == "memory-recall":
        from vibeguard.memory import AgentEngineMemory
        print(json.dumps(AgentEngineMemory.from_env().recall(args.query, top_k=args.top_k), indent=2, default=str))


if __name__ == "__main__":
    main()
