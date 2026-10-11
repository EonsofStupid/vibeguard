"""
VibeGuard x Atlas Agent Engine hosted memory.

The harness keeps its source of truth in its own Atlas collections (rules, runs, lexicon, failures, audit).
This module mirrors those records into the Agent Engine memory server so the platform's retrieval
(`build_context`) assembles the agent's context from the SAME four memory types the harness learns:

    procedural  <- approved guardrail rules     save_procedure / discover_procedures
    episodic    <- run traces                   save_episode   / search_episodes
    semantic    <- vibecoder lexicon            save_semantic  / search_semantic
    taxonomic   <- failure categories           save_taxonomic / search_taxonomic

Before every attempt the loop asks `build_context(task prompt)`. The returned ContextPolicy records how
many memories of each type were selected, so "the harness evolves its context policy" is a measured
number per run, not a claim.

Auth: a project service account (client credentials -> 1h bearer token). Nothing here loosens anything:
the mirror writes exactly what a human already approved.
"""
from __future__ import annotations

import base64
import json
import os
import time
import urllib.request
from typing import Any, Iterable

from pydantic import BaseModel, Field

from vibeguard.failures.schema import FailureCategory
from vibeguard.lexicon.schema import LexiconEntry
from vibeguard.rules.schema import GuardrailRule, RuleStatus

TOKEN_URL = "https://agentengine.mongodb.com/api/v1/oauth/token"
RETRY_DELAYS = (2, 4, 8, 16, 30)   # the hosted embedding service rate-limits bursts; writes are idempotent, so retry


def _retry(fn, *args, **kwargs):
    from agent_engine_sdk_memory.errors import MemoryAPIError

    for i, delay in enumerate((*RETRY_DELAYS, None)):
        try:
            return fn(*args, **kwargs)
        except MemoryAPIError as e:
            msg = str(e).lower()
            if delay is None or not any(k in msg for k in ("rate limit", "429", "retry later", "timeout", "503")):
                raise
            time.sleep(delay)
USER_ID = "vibeguard"           # one harness identity; sessions are run ids
SOURCES = ("procedural", "semantic", "taxonomic", "episodic")


class ContextPolicy(BaseModel):
    """What the platform chose to put in front of the agent for one prompt."""
    query: str
    selected: int = 0
    memory_counts: dict[str, int] = Field(default_factory=dict)
    token_count: int = 0
    formatted_chars: int = 0
    retrieval_ms: float = 0.0


def service_account_token(client_id: str | None = None, client_secret: str | None = None) -> str:
    """Client-credentials exchange; the token is valid for one hour."""
    cid = client_id or os.environ["MONGODB_AGENTIC_CLIENT_ID"]
    sec = client_secret or os.environ["MONGODB_AGENTIC_CLIENT_SECRET"]
    req = urllib.request.Request(TOKEN_URL, data=b"grant_type=client_credentials", method="POST")
    req.add_header("Authorization", "Basic " + base64.b64encode(f"{cid}:{sec}".encode()).decode())
    req.add_header("Content-Type", "application/x-www-form-urlencoded")
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())["access_token"]


class AgentEngineMemory:
    def __init__(self, token: str, project_id: str, user_id: str = USER_ID):
        from agent_engine_sdk_memory import Memory, MemoryRequestContext  # private registry package

        self.project_id = project_id
        self.user_id = user_id
        self._memory = Memory(service_account_token=token, project_id=project_id)
        self._ctx_cls = MemoryRequestContext
        self._bound = self._memory.bind(MemoryRequestContext(user_id=user_id, session_id="harness"))

    @classmethod
    def from_env(cls) -> "AgentEngineMemory":
        project_id = os.environ.get("AGENTIC_MEMORY_PROJECT_ID") or os.environ.get("AGENT_ENGINE_PROJECT_ID")
        if not project_id:
            raise ValueError("AGENTIC_MEMORY_PROJECT_ID is required for the hosted memory gateway.")
        return cls(service_account_token(), project_id)

    def session(self, session_id: str):
        return self._memory.bind(self._ctx_cls(user_id=self.user_id, session_id=session_id))

    # ---- mirrors: one method per memory type -------------------------------------------------

    def mirror_failures(self, categories: Iterable[FailureCategory]) -> int:
        """Taxonomic terms are org-unique and have no upsert; an existing term counts as mirrored."""
        from agent_engine_sdk_memory.errors import MemoryBadRequestError

        n = 0
        for c in categories:
            try:
                _retry(self._bound.save_taxonomic,
                    domain="failure", term=c.category_id,
                    definition=f"{c.title}. {c.signal} {c.why_it_matters}",
                    related_terms=[c.title], metadata={"severity": c.severity.value, "source": "vibeguard"},
                )
            except MemoryBadRequestError as e:
                if "already exists" not in str(e):
                    raise
            n += 1
        return n

    def mirror_lexicon(self, entries: Iterable[LexiconEntry]) -> int:
        n = 0
        for e in entries:
            _retry(self._bound.save_semantic,
                text=f"{e.phrase} -> {e.canonical_label}. {e.teach}".strip(), label=e.canonical_label,
                source="vibeguard-lexicon", upsert=True,
                metadata={"entry_id": e.entry_id, "phrase": e.phrase, "stack": e.stack or ""},
            )
            n += 1
        return n

    def mirror_rule(self, rule: GuardrailRule) -> Any:
        """Approved rules become procedures the agent must follow; reverted ones are kept but tagged."""
        content = (
            f"# {rule.rule_id} v{rule.version} ({rule.status.value})\n\n"
            f"Category: {rule.category}\nAction: {rule.action.value}\n"
            f"Trigger ({rule.trigger.type}): `{rule.trigger.pattern}`\n\n"
            f"Tell the user: {rule.user_message}\n\n"
            f"Origin: {rule.origin.run_id}/{rule.origin.task_id} ({rule.origin.failure_category}); "
            f"proposed by {rule.proposed_by}, approved by {rule.approved_by or '-'}"
        )
        return _retry(self._bound.save_procedure,
            procedure=rule.rule_id, description=rule.user_message, content=content,
            trigger_conditions=[rule.trigger.pattern], tags=[rule.category, rule.status.value, f"v{rule.version}"],
            metadata={"rule_id": rule.rule_id, "version": rule.version, "status": rule.status.value,
                      "category": rule.category, "direction": rule.direction.value},
            update_existing=True,
        )

    def mirror_rules(self, rules: Iterable[GuardrailRule]) -> int:
        return sum(1 for r in rules if r.status != RuleStatus.proposed and self.mirror_rule(r))

    def mirror_run(self, run) -> Any:
        """One episode per run, in the run's own session; re-syncing never duplicates."""
        sess = self.session(run.run_id)
        if sess.list_episodes(session_id=run.run_id, limit=1):
            return True
        summary = (f"held-out {run.heldout.passed}/{run.heldout.total}, train {run.train.passed}/{run.train.total}, "
                   f"blocks {run.blocks} (false {run.false_blocks}), rules {', '.join(run.rules_active) or 'none'}")
        content = "\n".join([
            f"# {run.run_id}", "",
            f"- rules active: {', '.join(run.rules_active) or 'none'}",
            f"- train pass rate: {run.train.pass_rate} (95% CI {run.train.ci95[0]}-{run.train.ci95[1]})",
            f"- held-out pass rate: {run.heldout.pass_rate} (95% CI {run.heldout.ci95[0]}-{run.heldout.ci95[1]})",
            f"- paid attempts: {run.paid_attempts}; blocks before shipping: {run.blocks}; false blocks: {run.false_blocks}",
            f"- proposed rules awaiting a human: {', '.join(run.proposed) or 'none'}",
        ])
        return _retry(sess.save_episode,
            title=run.run_id, content=content, summary=summary, session_id=run.run_id,
            tags=["harness-run", *run.rules_active],
            metadata={"heldout_pass_rate": run.heldout.pass_rate, "train_pass_rate": run.train.pass_rate,
                      "false_blocks": run.false_blocks, "rules_active": list(run.rules_active)},
        )

    # ---- retrieval: the context policy ---------------------------------------------------------

    def context_for(self, prompt: str, session_id: str = "harness") -> ContextPolicy:
        t = time.perf_counter()
        resp = _retry(self.session(session_id).build_context, query=prompt, enabled_sources=set(SOURCES), include_memories=True)
        ms = (time.perf_counter() - t) * 1000
        md = resp.metadata
        counts = dict(getattr(md, "memory_counts", {}) or {})
        selected = len(resp.selected_memories or []) or sum(counts.values())
        text = resp.formatted_context if isinstance(resp.formatted_context, str) else json.dumps(resp.formatted_context)
        return ContextPolicy(query=prompt, selected=selected, memory_counts=counts,
                             token_count=int(getattr(md, "token_count", 0) or 0), formatted_chars=len(text), retrieval_ms=round(ms, 1))

    def formatted_context(self, prompt: str) -> str:
        resp = self._bound.build_context(query=prompt, enabled_sources=set(SOURCES), include_memories=True)
        return resp.formatted_context if isinstance(resp.formatted_context, str) else json.dumps(resp.formatted_context, indent=2)

    def recall(self, query: str, sources: Iterable[str] = SOURCES, top_k: int = 5) -> list[dict[str, Any]]:
        hits = self._bound.search(query, sources=list(sources), top_k=top_k)
        out = []
        for h in hits:
            d = h.model_dump() if hasattr(h, "model_dump") else dict(h)
            out.append({k: d.get(k) for k in ("source", "score", "text", "id") if k in d} or d)
        return out

    def close(self) -> None:
        self._memory.close()
