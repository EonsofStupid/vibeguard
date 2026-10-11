"""Record and recall VibeGuard memory through the local OE using external Atlas.

Statement 2 / resume-the-goal example. The caller must supply the actual OE URL
from `agentengine dev up`. This does not start containers or change deployment.
"""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
from importlib.metadata import version
import json
import os
from pathlib import Path
from urllib.parse import urlsplit

from agent_engine_sdk_memory import Memory, MemoryRequestContext


ROOT = Path(__file__).resolve().parents[1]


def local_memory(base_url: str) -> Memory:
    """Construct flat local routes without stale hosted identity or credentials."""
    url = urlsplit(base_url)
    if url.scheme not in {"http", "https"} or url.hostname not in {
        "localhost", "127.0.0.1", "::1"
    }:
        raise ValueError("Supply the loopback OE URL printed by the local runtime")
    if url.username or url.password or url.query or url.fragment:
        raise ValueError("OE URL must not contain credentials, query or fragment")
    keys = (
        "AGENTIC_MEMORY_PROJECT_ID",
        "AGENTIC_MEMORY_SERVICE_ACCOUNT_TOKEN",
        "AGENTIC_MEMORY_API_KEY",
    )
    previous = {key: os.environ.pop(key) for key in keys if key in os.environ}
    try:
        # SDK 0.10 selects local routes when project_id is absent.
        return Memory(base_url=base_url.rstrip("/"))
    finally:
        os.environ.update(previous)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", required=True)
    parser.add_argument("--user-id", default="vibeguard-operator")
    parser.add_argument("--session-id", default="vibeguard-memory-local-setup")
    parser.add_argument("--with-context", action="store_true")
    args = parser.parse_args()
    report = {
        "checked_at": datetime.now(timezone.utc).isoformat(),
        "sdk_version": version("agent-engine-sdk-memory"),
        "statement": 2,
        "example": "resume the goal",
        "runtime": "local OE",
        "base_url": args.base_url,
        "user_id": args.user_id,
        "session_id": args.session_id,
        "passed": False,
        "stage": "connect",
    }
    memory = None
    try:
        memory = local_memory(args.base_url)
        chat = memory.bind(
            MemoryRequestContext(user_id=args.user_id, session_id=args.session_id)
        )
        fact = (
            "VibeGuard's goal is to preserve project context in MongoDB Atlas "
            "across sessions and route durable harness changes through RRFlow "
            "human review."
        )
        report["stage"] = "record_turn"
        turn = chat.record_turn(
            role="user",
            content=fact,
            idempotency_key="vibeguard-local-memory-setup-goal-v1",
            metadata={"kind": "setup_probe"},
        )
        report["turn"] = turn.model_dump(mode="json")
        if not turn.acknowledged:
            raise RuntimeError("Turn write was not acknowledged")
        report["stage"] = "save_semantic"
        saved = chat.save_semantic(
            text=fact,
            label="vibeguard-project-goal-local-setup",
            source="vibeguard-setup",
            metadata={"kind": "setup_probe"},
            upsert=True,
        )
        report["semantic_write"] = saved.model_dump(mode="json")
        if not saved.acknowledged:
            raise RuntimeError("Semantic write was not acknowledged")
        report["stage"] = "read_in_new_session"
        later = memory.bind(
            MemoryRequestContext(
                user_id=args.user_id, session_id=args.session_id + "-resumed"
            )
        )
        recalled = later.get_semantic("vibeguard-project-goal-local-setup")
        report["semantic_read_matches"] = (
            isinstance(recalled, dict)
            and recalled.get("content") == fact
            and recalled.get("user_id") == args.user_id
        )
        if not report["semantic_read_matches"]:
            raise RuntimeError("Saved fact was not returned in the new session")
        if args.with_context:
            report["stage"] = "build_context"
            context = later.build_context(
                query="What is VibeGuard's project goal?",
                enabled_sources={"stm", "semantic"},
                max_tokens=1024,
                include_memories=True,
            )
            report["context_metadata"] = context.metadata.model_dump(mode="json")
            report["context_contains_goal"] = fact in str(context.formatted_context)
            if not report["context_contains_goal"]:
                raise RuntimeError("Context did not recall the stored project goal")
        report["passed"] = True
        report["stage"] = "complete"
    except Exception as exc:
        report["error_type"] = type(exc).__name__
        report["error"] = str(exc)[:500]
    finally:
        if memory is not None:
            memory.close()
    output = ROOT / "artifacts" / "local-memory-checkpoint.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
