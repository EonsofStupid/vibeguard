"""Use the hosted memory service with VibeGuard's saved service account.

Statement 2 / resume-the-goal example: save a scoped fact and read it in a new
session. This deliberately does not activate rules or claim async extraction.
Requires agent-engine-sdk-memory==0.10.0 in the selected Python environment.
"""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
from importlib.metadata import version
import json
from pathlib import Path

import httpx
from agent_engine_sdk_memory import Memory, MemoryRequestContext


ROOT = Path(__file__).resolve().parents[1]
BASE_URL = "https://agentengine.mongodb.com"
ACCOUNT_FILE = ROOT / ".runtime" / "agentengine-service-account.json"


class HostedMemory:
    """Refresh the one-hour OAuth token before opening each short-lived client."""

    def __init__(self, account_file: Path = ACCOUNT_FILE):
        saved = json.loads(account_file.read_text(encoding="utf-8-sig"))
        account = saved["service_account"]
        self.project_id = account["project_id"]
        response = httpx.post(
            f"{BASE_URL}/api/v1/oauth/token",
            auth=(account["client_id"], saved["client_secret"]),
            data={"grant_type": "client_credentials"},
            timeout=30,
        )
        self.auth_status = response.status_code
        response.raise_for_status()
        token = response.json()
        if not token.get("access_token"):
            raise RuntimeError("OAuth response did not contain an access token")
        self.expires_in = token.get("expires_in")
        # SDK 0.10 selects hosted routes by project_id, not by token presence.
        self.memory = Memory(
            service_account_token=token["access_token"],
            base_url=BASE_URL,
            project_id=self.project_id,
        )

    def bind(self, user_id: str, session_id: str) -> Memory:
        return self.memory.bind(
            MemoryRequestContext(user_id=user_id, session_id=session_id)
        )

    def close(self) -> None:
        self.memory.close()

    def __enter__(self) -> "HostedMemory":
        return self

    def __exit__(self, *args: object) -> None:
        self.close()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--auth-only", action="store_true")
    parser.add_argument("--with-context", action="store_true", help=argparse.SUPPRESS)
    parser.add_argument("--with-search", action="store_true", help="Also check semantic search; adds an embedding request")
    parser.add_argument("--user-id", default="vibeguard-operator")
    parser.add_argument("--session-id", default="vibeguard-memory-setup")
    args = parser.parse_args()
    report = {
        "checked_at": datetime.now(timezone.utc).isoformat(),
        "sdk_version": version("agent-engine-sdk-memory"),
        "statement": 2,
        "example": "resume the goal",
        "passed": False,
        "core_passed": False,
        "stage": "oauth",
    }
    try:
        with HostedMemory() as client:
            report.update(
                project_id=client.project_id,
                oauth_status=client.auth_status,
                token_expires_in=client.expires_in,
            )
            if args.auth_only:
                report["passed"] = True
            else:
                fact = (
                    "VibeGuard's goal is to use MongoDB Atlas memory to preserve "
                    "project context across sessions and route durable harness "
                    "changes through RRFlow human review."
                )
                chat = client.bind(args.user_id, args.session_id)
                report["stage"] = "record_turn"
                turn = chat.record_turn(
                    role="user",
                    content=fact,
                    idempotency_key="vibeguard-memory-setup-goal-v1",
                    metadata={"kind": "setup_probe"},
                )
                report["turn"] = turn.model_dump(mode="json")
                if not turn.acknowledged:
                    raise RuntimeError("Turn write was not acknowledged")
                report["stage"] = "save_semantic"
                saved = chat.save_semantic(
                    text=fact,
                    label="vibeguard-project-goal-setup",
                    source="vibeguard-setup",
                    metadata={"kind": "setup_probe"},
                    upsert=True,
                )
                report["semantic_write"] = saved.model_dump(mode="json")
                if not saved.acknowledged:
                    raise RuntimeError("Semantic write was not acknowledged")
                report["stage"] = "read_in_new_session"
                later = client.bind(args.user_id, args.session_id + "-resumed")
                recalled = later.get_semantic("vibeguard-project-goal-setup")
                report["semantic_read_matches"] = (
                    isinstance(recalled, dict)
                    and recalled.get("content") == fact
                    and recalled.get("user_id") == args.user_id
                    and recalled.get("label") == "vibeguard-project-goal-setup"
                )
                if not report["semantic_read_matches"]:
                    raise RuntimeError("Saved fact was not returned in the new session")
                report["semantic_read"] = {
                    key: recalled.get(key)
                    for key in ("id", "label", "user_id", "has_embedding", "embedding_model_id")
                }
                report["stage"] = "build_context"
                context = later.build_context(
                    query="What is VibeGuard's project goal?",
                    enabled_sources={"semantic"},
                    max_tokens=1024,
                    include_memories=True,
                )
                report["context_metadata"] = context.metadata.model_dump(mode="json")
                report["context_contains_goal"] = fact in str(context.formatted_context)
                report["context_memory_ids"] = [
                    item.id for item in context.selected_memories or []
                ]
                if not report["context_contains_goal"]:
                    raise RuntimeError("Context did not recall the stored project goal")
                report["core_passed"] = True
                if args.with_search:
                    report["stage"] = "search_semantic"
                    hits = later.search_semantic(
                        "What is VibeGuard's project goal?", top_k=5
                    )
                    report["semantic_search"] = {
                        "count": len(hits),
                        "contains_exact_goal": any(item.content == fact for item in hits),
                        "memory_ids": [item.id for item in hits],
                    }
                    if not report["semantic_search"]["contains_exact_goal"]:
                        raise RuntimeError("Semantic search did not retrieve the stored goal")
                report["passed"] = True
                report["stage"] = "complete"
    except Exception as exc:
        report["error_type"] = type(exc).__name__
        report["http_status"] = getattr(exc, "status", None)
        report["error_code"] = getattr(exc, "code", None)
        # Do not serialize response bodies, request headers, credentials or tokens.
        report["error"] = str(exc)[:500]
    out = ROOT / "artifacts" / (
        "service-account-auth.json" if args.auth_only else "hosted-memory-checkpoint.json"
    )
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
