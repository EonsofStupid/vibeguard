"""Incident-grounded context-policy proposal and independently judged replay.

Only one policy-proposal generation is live. Provider responses, follow-up
timing, memory writes and assistant turns in this experiment are simulated.
The current chat already preserves replies on 429; the target is redundant
recall during an observed rate-limit episode, not allegedly lost answers.
"""
from __future__ import annotations

import argparse
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
from typing import Callable
from uuid import uuid4

from .live_eval import ResponsesClient

FIXTURES = Path(__file__).with_name("context_policy_fixtures.json")


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def content_hash(value: object) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()).hexdigest()


@dataclass(frozen=True)
class ContextPolicy:
    kind: str
    cooldown_seconds: int
    scope: str
    trigger: str
    fallback: str
    record_turns: bool
    disclose_unavailable_recall: bool

    @classmethod
    def parse(cls, value: dict) -> "ContextPolicy":
        fixed = {"kind": "memory_recall_cooldown", "scope": "user_session_provider",
                 "trigger": "embedding_rate_limit", "fallback": "current_thread_only"}
        if any(value.get(key) != expected for key, expected in fixed.items()):
            raise ValueError("Unsupported context-policy semantics")
        if type(value.get("cooldown_seconds")) is not int or not 5 <= value["cooldown_seconds"] <= 60:
            raise ValueError("Cooldown must be a bounded integer from 5 to 60 seconds")
        if value.get("record_turns") is not True or value.get("disclose_unavailable_recall") is not True:
            raise ValueError("Turn recording and honest recall disclosure must remain enabled")
        return cls(**{key: value[key] for key in cls.__dataclass_fields__})


POLICY_SCHEMA = {
    "type": "object", "additionalProperties": False,
    "properties": {
        "kind": {"type": "string", "enum": ["memory_recall_cooldown"]},
        "cooldown_seconds": {"type": "integer", "minimum": 5, "maximum": 60},
        "scope": {"type": "string", "enum": ["user_session_provider"]},
        "trigger": {"type": "string", "enum": ["embedding_rate_limit"]},
        "fallback": {"type": "string", "enum": ["current_thread_only"]},
        "record_turns": {"type": "boolean", "enum": [True]},
        "disclose_unavailable_recall": {"type": "boolean", "enum": [True]},
        "source_case_ids": {"type": "array", "items": {"type": "string"}},
        "explanation": {"type": "string"},
    },
    "required": ["kind", "cooldown_seconds", "scope", "trigger", "fallback", "record_turns", "disclose_unavailable_recall", "source_case_ids", "explanation"],
}


def scope_key(turn: dict) -> tuple[str, str, str]:
    return (turn.get("user", "operator"), turn.get("session", "thread"), turn.get("provider", "voyage"))


def is_embedding_rate_limit(response: dict) -> bool:
    """Mirror the current adapter: direct 429 or wrapped embedding-rate error."""
    status = response["status"]
    return status >= 400 and (status == 429 or bool(re.search(r"embedding.*rate limit", response.get("detail", ""), re.I)))


def replay(case: dict, policy: ContextPolicy | None = None) -> dict:
    """Replay current chat assembly or the proposed scoped cooldown.

    The runner reads only response status/body, never the fixture's oracle
    labels. It logs context construction, not invented/generated answer text.
    """
    blocked_until: dict[tuple, int] = {}
    trace = []
    for sequence, turn in enumerate(case["turns"], 1):
        key, at = scope_key(turn), turn["at"]
        entry = {"sequence": sequence, "at": at, "scope": list(key), "user_turn_recorded": True,
                 "recall_called": False, "recall_skipped": False, "assistant_produced": False,
                 "assistant_turn_recorded": False, "context_sources": ["current_thread"],
                 "retrieved_facts": [], "recall_unavailable_disclosed": False,
                 "do_not_invent_memories": False, "memory_error_status": None}
        if policy and at < blocked_until.get(key, -1):
            entry.update(recall_skipped=True, cooldown_until=blocked_until[key], outcome="cooldown_fallback")
            entry.update(assistant_produced=True, assistant_turn_recorded=True,
                         recall_unavailable_disclosed=True, do_not_invent_memories=True)
        else:
            entry["recall_called"] = True
            response = turn["response"]
            entry["observed_response"] = response
            if is_embedding_rate_limit(response):
                entry.update(outcome="rate_limit_fallback", assistant_produced=True,
                             assistant_turn_recorded=True, recall_unavailable_disclosed=True,
                             do_not_invent_memories=True)
                if policy:
                    blocked_until[key] = at + policy.cooldown_seconds
                    entry["cooldown_until"] = blocked_until[key]
            elif response["status"] >= 400:
                # Current chat returns a memory error before asking the model.
                entry.update(outcome="memory_error", memory_error_status=response["status"])
            else:
                blocked_until.pop(key, None)
                entry.update(outcome="recalled", assistant_produced=True, assistant_turn_recorded=True,
                             context_sources=["current_thread", "retrieved_memory"],
                             retrieved_facts=list(response.get("facts", [])))
        trace.append(entry)
    return {"case_id": case["id"], "split": case["split"], "trace": trace}


def judge(case: dict, execution: dict) -> dict:
    """Judge observable calls and context against frozen oracle labels.

    This does not inspect policy values or invoke the adapter's detector. A
    second call to a still-rate-limited scope before recovery is redundant;
    suppressing a healthy recall is a false block, not a saving.
    """
    known_limited = set()
    redundant = false_blocks = recall_calls = recorded = produced = 0
    failures = []
    if len(execution["trace"]) != len(case["turns"]):
        return {"passed": False, "failures": ["missing_turn_trace"], "avoidable_recalls": 0,
                "false_blocks": 0, "recall_calls": 0, "recorded_turns": 0, "produced_turns": 0}
    for turn, entry in zip(case["turns"], execution["trace"]):
        key = scope_key(turn)
        label = turn["oracle"]
        called = entry["recall_called"]
        recall_calls += int(called)
        if label == "rate_limited":
            if called and key in known_limited:
                redundant += 1
            if called:
                known_limited.add(key)
            if entry["context_sources"] != ["current_thread"] or entry["retrieved_facts"]:
                failures.append("unavailable_memory_injected")
            if not entry["recall_unavailable_disclosed"] or not entry["do_not_invent_memories"]:
                failures.append("fallback_not_disclosed")
            if not entry["assistant_produced"]:
                failures.append("fallback_reply_lost")
        elif label == "healthy":
            if not called:
                false_blocks += 1
            elif entry["retrieved_facts"] != turn["response"].get("facts", []):
                failures.append("recalled_facts_changed")
            if called:
                known_limited.discard(key)
            if not entry["assistant_produced"]:
                failures.append("healthy_reply_lost")
        elif label == "unrelated_error":
            if not called or entry["assistant_produced"] or entry["memory_error_status"] != turn["response"]["status"]:
                failures.append("unrelated_error_hidden")
        else:
            raise ValueError("Unknown frozen oracle label")
        produced += 1 + int(entry["assistant_produced"])
        recorded += int(entry["user_turn_recorded"]) + int(entry["assistant_turn_recorded"])
        if not entry["user_turn_recorded"] or entry["assistant_produced"] != entry["assistant_turn_recorded"]:
            failures.append("produced_turn_not_recorded")
    if redundant:
        failures.append("redundant_recall_during_observed_rate_limit")
    if false_blocks:
        failures.append("healthy_recall_suppressed")
    return {"passed": not failures, "failures": sorted(set(failures)), "avoidable_recalls": redundant,
            "false_blocks": false_blocks, "recall_calls": recall_calls,
            "recorded_turns": recorded, "produced_turns": produced}


def evaluated(case: dict, policy: ContextPolicy | None) -> dict:
    result = replay(case, policy)
    result["evaluation"] = judge(case, result)
    return result


def totals(results: list[dict]) -> dict:
    return {"passed": sum(result["evaluation"]["passed"] for result in results), "total": len(results),
            **{field: sum(result["evaluation"][field] for result in results)
               for field in ("avoidable_recalls", "false_blocks", "recall_calls", "recorded_turns", "produced_turns")}}


def run_context_experiment(*, root: Path, api_key: str | None = None, client=None,
                           experiment_id: str | None = None, on_checkpoint: Callable | None = None) -> dict:
    manifest_raw = FIXTURES.read_bytes()
    manifest = json.loads(manifest_raw)
    cases = manifest["cases"]
    if [sum(case["split"] == split for case in cases) for split in ("train", "heldout")] != [3, 4]:
        raise ValueError("Expected exactly three training and four held-out fixtures")
    incident_path = root / manifest["source_incident"]
    incident_raw = incident_path.read_bytes()
    incident = json.loads(incident_raw)
    if incident.get("passed") is not False or incident.get("error") != "Embedding service rate limit exceeded; retry later":
        raise ValueError("The cited real incident does not match the observed failure")
    source_paths = ("vibeguard/lib/agent-memory.ts", "vibeguard/lib/model-chat.ts")
    source_hashes = {path: hashlib.sha256((root / path).read_bytes()).hexdigest() for path in source_paths}
    model = client or ResponsesClient(api_key or "", max_model_calls=1)
    artifact = {
        "schema_version": 1, "experiment_id": experiment_id or "context-live-" + uuid4().hex[:12],
        "started_at": now(), "frozen_at": now(), "status": "running", "problem_statements": [1, 2],
        "example": "memory-recall-cooldown", "evidence_type": "incident_replay_with_live_context_policy_proposal",
        "fixture_manifest": manifest, "fixture_sha256": hashlib.sha256(manifest_raw).hexdigest(),
        "judge_source_sha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        "source_incident": {"path": manifest["source_incident"], "sha256": hashlib.sha256(incident_raw).hexdigest(),
                            "checked_at": incident.get("checked_at"), "stage": incident.get("stage"),
                            "error_type": incident.get("error_type"), "error": incident["error"]},
        "baseline_source_sha256": source_hashes,
        "baseline_description": "Current chat records the user, attempts recall on every message, falls back to current conversation on normalized 429, then records the produced assistant response. It has no cross-message cooldown.",
        "protocol": {"model_call_limit": 1, "provider_calls_simulated": True, "heldout_used_for_proposal": False,
                     "turn_recording_simulated": True, "automatic_model_retries": 0, "activation": "human review required"},
        "baseline": {}, "candidate": {}, "proposal": None, "model_calls": model.calls,
        "activation": {"status": "not_activated", "human_decision": None, "receipt": None},
    }
    def checkpoint():
        artifact["updated_at"] = now()
        if on_checkpoint:
            on_checkpoint(artifact)
    checkpoint()
    try:
        train = [case for case in cases if case["split"] == "train"]
        artifact["baseline"]["train"] = [evaluated(case, None) for case in train]
        failed_ids = {result["case_id"] for result in artifact["baseline"]["train"] if not result["evaluation"]["passed"]}
        if not failed_ids:
            raise ValueError("No training deficiency was found; do not manufacture a proposal")
        checkpoint()
        proposal = model.generate(
            purpose="train-only-context-policy-proposal",
            instructions="You propose a bounded context policy from the supplied training evidence. Current chat ALREADY replies using the current thread on embedding rate limits; do not claim replies are lost. The measured target is avoiding repeated recall requests to the same user/session/provider during an observed rate-limit burst. Choose a cooldown from 5 to 60 seconds, preserving turn recording and disclosure that long-term recall is unavailable. Recognize direct 429 and wrapped embedding-rate-limit errors. Unrelated failures must remain errors and must not start a cooldown. Recall must resume after expiry. Source only the supplied failing training cases. This is a proposed policy, never authorization or deployment. No held-out inputs are available. Timings are simulated; no real provider recovery bound or financial saving is established.",
            payload={"incident": artifact["source_incident"], "baseline": artifact["baseline_description"],
                     "training_results": artifact["baseline"]["train"], "constraints": {"cooldown_min_seconds": 5, "cooldown_max_seconds": 60}},
            schema=POLICY_SCHEMA)
        policy = ContextPolicy.parse(proposal)
        sources = proposal.get("source_case_ids")
        training_ids = {case["id"] for case in train}
        if not isinstance(sources, list) or not sources or any(source not in training_ids for source in sources) or not failed_ids.intersection(sources):
            raise ValueError("Policy provenance must cite training cases only, including at least one observed failure")
        policy_value = asdict(policy)
        policy_hash = content_hash(policy_value)
        artifact["candidate"].update(policy=policy_value, policy_hash=policy_hash, frozen_at=now())
        artifact["proposal"] = {"policy": policy_value, "policy_hash": policy_hash, "source_case_ids": sources,
                                "explanation": proposal.get("explanation", ""), "approval_required": True}
        checkpoint()
        for split in ("train", "heldout"):
            selected = [case for case in cases if case["split"] == split]
            if split == "heldout":
                artifact["baseline"][split] = [evaluated(case, None) for case in selected]
            artifact["candidate"][split] = [evaluated(case, policy) for case in selected]
        summaries = {arm: {split: totals(artifact[arm][split]) for split in ("train", "heldout")} for arm in ("baseline", "candidate")}
        for arm in summaries:
            artifact[arm]["summary"] = summaries[arm]
        regressions = [before["case_id"] for split in ("train", "heldout")
                       for before, after in zip(artifact["baseline"][split], artifact["candidate"][split])
                       if before["evaluation"]["passed"] and not after["evaluation"]["passed"]]
        bt, ct = summaries["baseline"]["train"], summaries["candidate"]["train"]
        bh, ch = summaries["baseline"]["heldout"], summaries["candidate"]["heldout"]
        false_blocks = ct["false_blocks"] + ch["false_blocks"]
        eligible = ct["passed"] > bt["passed"] and ch["passed"] >= bh["passed"] and not regressions and not false_blocks and ct["avoidable_recalls"] < bt["avoidable_recalls"] and ct["recorded_turns"] == ct["produced_turns"] and ch["recorded_turns"] == ch["produced_turns"]
        artifact["metrics"] = {split: {"before": summaries["baseline"][split]["passed"], "after": summaries["candidate"][split]["passed"], "total": summaries["baseline"][split]["total"],
                                       "avoidable_recalls_before": summaries["baseline"][split]["avoidable_recalls"], "avoidable_recalls_after": summaries["candidate"][split]["avoidable_recalls"],
                                       "recall_calls_before": summaries["baseline"][split]["recall_calls"], "recall_calls_after": summaries["candidate"][split]["recall_calls"],
                                       "recorded_turns_before": summaries["baseline"][split]["recorded_turns"], "recorded_turns_after": summaries["candidate"][split]["recorded_turns"]} for split in ("train", "heldout")}
        reason = "Scoped cooldown reduced avoidable recall in incident-derived replay while preserving simulated turn recording and healthy retrieval; human approval and live integration verification remain required." if eligible else "The candidate did not satisfy the replay improvement gate; do not activate."
        artifact["promotion"] = {"eligible": bool(eligible), "before": bt["passed"], "after": ct["passed"], "total": bt["total"], "regressions": regressions, "false_blocks": false_blocks, "reason": reason}
        artifact["assessment"] = {"limitations": [
            "Only policy generation is a real model API request; provider responses, follow-up times, writes and replies are simulated.",
            "The real source incident records one search_semantic rate-limit failure, not this multi-message sequence or a Retry-After bound.",
            "Current chat already preserves replies on 429. The measured improvement is fewer redundant recall attempts, not recovered replies or financial savings.",
            "A cooldown can suppress a provider that recovers earlier; the configured duration is a bounded tradeoff, not an observed universal recovery time.",
            "The replay verifies context provenance and anti-invention instructions, not generated-answer factual accuracy.",
            "Seven frozen scenarios do not establish general reliability, persistent distributed cooldown state, or billion-token capacity.",
            "No active policy changed. A real human decision and live integration rerun are required."]}
        artifact["status"] = "completed"
    except Exception as error:
        artifact["status"] = "failed"
        artifact["error"] = {"type": type(error).__name__, "message": str(error) if isinstance(error, ValueError) else "The bounded policy experiment did not complete; no success is claimed."}
    finally:
        artifact["actual_model_request_count"] = len(model.calls)
        artifact["usage"] = {key: sum((call.get("usage") or {}).get(key, 0) for call in model.calls) for key in ("input_tokens", "output_tokens", "total_tokens")}
        artifact["finished_at"] = now()
        checkpoint()
    return artifact


def persist_eligible(artifact: dict, *, root: Path, artifact_path: Path) -> dict:
    """Atomically insert immutable evidence, a proposed version and audit receipts."""
    from pymongo import MongoClient
    from pymongo.errors import CollectionInvalid
    from pymongo.read_concern import ReadConcern
    from pymongo.write_concern import WriteConcern
    from vibeguard.settings import load_env

    if artifact.get("status") != "completed" or artifact.get("promotion", {}).get("eligible") is not True:
        raise ValueError("Only an eligible completed candidate can be submitted for review")
    load_env(root / ".env")
    uri = os.environ.get("MONGODB_URI", "")
    if not uri:
        raise ValueError("Saved Atlas connection is missing")
    experiment_id = artifact["experiment_id"]
    proposal_id = experiment_id + "-proposal-v1"
    policy_hash = artifact["candidate"]["policy_hash"]
    if content_hash(artifact["candidate"]["policy"]) != policy_hash:
        raise ValueError("Policy digest mismatch")
    file_hash = hashlib.sha256(artifact_path.read_bytes()).hexdigest()
    if json.loads(artifact_path.read_bytes()) != artifact:
        raise ValueError("Saved artifact does not match the measured experiment")
    experiment = {"_id": experiment_id, **artifact, "artifact_sha256": file_hash,
                  "artifact_canonical_sha256": content_hash(artifact), "recorded_at": now(), "source_artifact": artifact_path.relative_to(root).as_posix()}
    proposal = {"_id": proposal_id, "experiment_id": experiment_id, "version": 1, "status": "proposed",
                "policy": artifact["candidate"]["policy"], "policy_hash": policy_hash, "created_at": now(),
                "evidence_summary": artifact["promotion"], "source_case_ids": artifact["proposal"]["source_case_ids"],
                "explanation": artifact["proposal"]["explanation"], "source_incident": artifact["source_incident"]}
    receipts = [{"_id": f"{event}:{experiment_id}", "event": event, "at": now(), "experiment_id": experiment_id,
                 "proposal_id": proposal_id, "policy_hash": policy_hash, "artifact_sha256": file_hash,
                 "authorization": "user_requested_measured_harness_improvement_and_proposal",
                 "check": "frozen_train_heldout_replay_and_completed_model_receipt",
                 "approvals_created": 0, "policy_transitions": 0}
                for event in ("harness_experiment_recorded", "harness_policy_proposed")]
    database = os.environ.get("MONGODB_DATABASE", "vibeguard")
    def connect():
        return MongoClient(uri, appname="VibeGuardContextPolicy", serverSelectionTimeoutMS=8000,
                           connectTimeoutMS=8000, socketTimeoutMS=15000, timeoutMS=20000)
    with connect() as client:
        db = client[database]
        names = set(db.list_collection_names())
        for name in ("harness_experiments", "harness_proposals", "audit"):
            if name not in names:
                try:
                    db.create_collection(name)
                except CollectionInvalid:
                    pass
        def save(session):
            existing = db.harness_experiments.find_one({"_id": experiment_id}, session=session)
            if existing:
                if existing.get("artifact_sha256") != file_hash:
                    raise ValueError("Experiment ID already contains different immutable evidence")
                return False
            db.harness_experiments.insert_one(experiment, session=session)
            db.harness_proposals.insert_one(proposal, session=session)
            db.audit.insert_many(receipts, session=session)
            return True
        with client.start_session() as session:
            inserted = session.with_transaction(save, read_concern=ReadConcern("snapshot"), write_concern=WriteConcern("majority"))
    with connect() as verifier:
        db = verifier.get_database(database, read_concern=ReadConcern("majority"))
        stored = db.harness_experiments.find_one({"_id": experiment_id})
        stored_proposal = db.harness_proposals.find_one({"_id": proposal_id})
        stored_receipts = list(db.audit.find({"_id": {"$in": [receipt["_id"] for receipt in receipts]}}))
        if not stored or content_hash({key: stored.get(key) for key in artifact}) != content_hash(artifact):
            raise ValueError("Independent experiment readback failed")
        if not stored_proposal or stored_proposal.get("policy_hash") != policy_hash or content_hash(stored_proposal.get("evidence_summary")) != content_hash(artifact["promotion"]):
            raise ValueError("Independent proposal readback failed")
        if len(stored_receipts) != 2 or any(receipt.get("artifact_sha256") != file_hash for receipt in stored_receipts):
            raise ValueError("Independent audit readback failed")
    return {"experiment_id": experiment_id, "proposal_id": proposal_id, "policy_hash": policy_hash,
            "inserted_experiments": int(inserted), "inserted_proposals": int(inserted), "verified_receipts": 2,
            "majority_readback": True, "approvals_created": 0, "policy_transitions": 0}


def validate_approved_snapshot(experiment: dict, proposal: dict | None, active: dict | None,
                               receipt: dict | None, expected_policy_hash: str | None = None) -> ContextPolicy:
    """Require the committed RRFlow decision, not a recalled or proposed rule."""
    if not active or not proposal or not receipt:
        raise ValueError("A committed active policy, approved proposal and human receipt are required")
    policy_hash = active.get("policy_hash")
    if active.get("_id") != "memory-recall-cooldown" or content_hash(active.get("policy")) != policy_hash:
        raise ValueError("Active context-policy identity or digest is invalid")
    if expected_policy_hash is not None and policy_hash != expected_policy_hash:
        raise ValueError("The active policy is not the reviewed candidate requested")
    if proposal.get("status") != "approved" or proposal.get("_id") != active.get("proposal_id") or proposal.get("policy_hash") != policy_hash or content_hash(proposal.get("policy")) != policy_hash:
        raise ValueError("The active policy has no matching approved proposal")
    if receipt.get("event") != "harness_policy_approved" or receipt.get("status") != "approved" or not str(receipt.get("actor", "")).startswith("human:"):
        raise ValueError("A human approval receipt is required before the rerun")
    if receipt.get("_id") != active.get("receipt_id") or receipt.get("_id") != proposal.get("decision_receipt_id"):
        raise ValueError("Approval receipt identity does not match the active policy and proposal")
    if receipt.get("policy_hash") != policy_hash or receipt.get("active_policy_version") != active.get("version") or receipt.get("rule_id") != proposal["_id"]:
        raise ValueError("Approval receipt is not bound to this policy version")
    if type(active.get("version")) is not int or active["version"] < 1 or proposal.get("version") != receipt.get("version", -2) + 1:
        raise ValueError("Approval/proposal version chain is invalid")
    if receipt.get("experiment_id") != experiment.get("_id") or proposal.get("experiment_id") != experiment.get("_id"):
        raise ValueError("Approval is bound to a different measured experiment")
    if experiment.get("candidate", {}).get("policy_hash") != policy_hash or not experiment.get("promotion", {}).get("eligible"):
        raise ValueError("The approved policy is not the eligible measured candidate")
    if receipt.get("experiment_hash") != content_hash(experiment):
        raise ValueError("Measured experiment changed after human review")
    return ContextPolicy.parse(active["policy"])


def rerun_approved_policy(*, root: Path, experiment_id: str,
                         expected_policy_hash: str | None = None) -> dict:
    """Read the approved Atlas version, replay frozen fixtures, save a receipt.

    No model/provider calls occur. The only writes are one immutable rerun and
    its audit receipt, after approval verification and a transaction-time
    recheck of the version. This function never approves or changes a policy.
    """
    from pymongo import MongoClient
    from pymongo.errors import CollectionInvalid
    from pymongo.read_concern import ReadConcern
    from pymongo.write_concern import WriteConcern
    from vibeguard.settings import load_env
    import inspect

    load_env(root / ".env")
    uri = os.environ.get("MONGODB_URI", "")
    if not uri:
        raise ValueError("Saved Atlas connection is missing")
    database = os.environ.get("MONGODB_DATABASE", "vibeguard")
    def connect():
        return MongoClient(uri, appname="VibeGuardApprovedContextRerun", serverSelectionTimeoutMS=8000,
                           connectTimeoutMS=8000, socketTimeoutMS=15000, timeoutMS=20000)
    with connect() as client:
        db = client.get_database(database, read_concern=ReadConcern("majority"))
        experiment = db.harness_experiments.find_one({"_id": experiment_id})
        if not experiment:
            raise ValueError("The measured experiment is missing")
        active = db.harness_policies.find_one({"_id": "memory-recall-cooldown"})
        proposal = db.harness_proposals.find_one({"_id": active.get("proposal_id")}) if active else None
        receipt = db.audit.find_one({"_id": active.get("receipt_id")}) if active else None
        policy = validate_approved_snapshot(experiment, proposal, active, receipt, expected_policy_hash)
        fixture_raw = FIXTURES.read_bytes()
        if hashlib.sha256(fixture_raw).hexdigest() != experiment["fixture_sha256"] or json.loads(fixture_raw) != experiment["fixture_manifest"]:
            raise ValueError("Frozen fixtures changed after the measured experiment")
        cases = experiment["fixture_manifest"]["cases"]
        results = {split: [evaluated(case, policy) for case in cases if case["split"] == split]
                   for split in ("train", "heldout")}
        summaries = {split: totals(results[split]) for split in results}
        metrics = {split: {"before": experiment["metrics"][split]["before"], "after": summaries[split]["passed"],
                           "total": summaries[split]["total"],
                           "avoidable_recalls_before": experiment["metrics"][split]["avoidable_recalls_before"],
                           "avoidable_recalls_after": summaries[split]["avoidable_recalls"],
                           "false_blocks": summaries[split]["false_blocks"],
                           "recorded_turns": summaries[split]["recorded_turns"],
                           "produced_turns": summaries[split]["produced_turns"]} for split in results}
        passed = all(summary["passed"] == summary["total"] and summary["false_blocks"] == 0 and summary["avoidable_recalls"] == 0 and summary["recorded_turns"] == summary["produced_turns"] for summary in summaries.values())
        rerun_id = f"context-rerun-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}-{uuid4().hex[:8]}"
        rerun = {"_id": rerun_id, "rerun_id": rerun_id, "experiment_id": experiment_id,
                 "policy_id": active["_id"], "policy_hash": active["policy_hash"], "active_policy_version": active["version"],
                 "proposal_id": proposal["_id"], "approval_receipt_id": receipt["_id"],
                 "approved_by": receipt["actor"], "policy": asdict(policy),
                 "phase": "post_approval_replay", "evidence_type": experiment["evidence_type"],
                 "fixture_sha256": experiment["fixture_sha256"],
                 "judge_function_sha256": hashlib.sha256(inspect.getsource(judge).encode()).hexdigest(),
                 "results": results, "metrics": metrics, "summary": summaries, "passed": passed,
                 "created_at": now(), "finished_at": now(), "actual_model_request_count": 0,
                 "provider_calls_simulated": True, "turn_recording_simulated": True,
                 "limitations": "Post-approval replay verifies the exact approved policy on frozen incident scenarios. It does not establish live provider recovery, actual chat integration, or improved answer quality."}
        rerun_hash = content_hash(rerun)
        audit = {"_id": "harness-rerun:" + rerun_id, "event": "harness_policy_rerun_recorded", "at": now(),
                 "rerun_id": rerun_id, "rerun_hash": rerun_hash, "experiment_id": experiment_id,
                 "policy_hash": active["policy_hash"], "active_policy_version": active["version"],
                 "authorization_receipt_id": receipt["_id"], "check": "exact_approved_policy_and_frozen_fixture_replay",
                 "passed": passed, "approvals_created": 0, "policy_transitions": 0}
        if "harness_reruns" not in db.list_collection_names():
            try:
                db.create_collection("harness_reruns")
            except CollectionInvalid:
                pass
        def save(session):
            current_active = db.harness_policies.find_one({"_id": active["_id"]}, session=session)
            current_proposal = db.harness_proposals.find_one({"_id": proposal["_id"]}, session=session)
            current_receipt = db.audit.find_one({"_id": receipt["_id"]}, session=session)
            current_experiment = db.harness_experiments.find_one({"_id": experiment_id}, session=session)
            validate_approved_snapshot(current_experiment, current_proposal, current_active, current_receipt, active["policy_hash"])
            if current_active["version"] != active["version"] or content_hash(current_receipt) != content_hash(receipt):
                raise ValueError("The approval version changed during the rerun; evidence was not committed")
            db.harness_reruns.insert_one(rerun, session=session)
            db.audit.insert_one(audit, session=session)
        with client.start_session() as session:
            session.with_transaction(save, read_concern=ReadConcern("snapshot"), write_concern=WriteConcern("majority"))
    with connect() as verifier:
        db = verifier.get_database(database, read_concern=ReadConcern("majority"))
        saved = db.harness_reruns.find_one({"_id": rerun_id})
        saved_receipt = db.audit.find_one({"_id": audit["_id"]})
        if not saved or content_hash(saved) != rerun_hash or not saved_receipt or saved_receipt.get("rerun_hash") != rerun_hash:
            raise ValueError("Independent approved-rerun readback failed")
    return {"rerun_id": rerun_id, "experiment_id": experiment_id, "policy_hash": active["policy_hash"],
            "active_policy_version": active["version"], "approval_receipt_id": receipt["_id"],
            "metrics": metrics, "passed": passed, "evidence_type": rerun["evidence_type"],
            "majority_readback": True, "actual_model_request_count": 0,
            "approvals_created": 0, "policy_transitions": 0}


def main():
    from vibeguard.settings import load_env
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path.cwd())
    parser.add_argument("--persist", action="store_true")
    args = parser.parse_args()
    root = args.root.resolve()
    for name in (".env", "vibeguard/.env.local", "rrflow/agents/rrflow/.env"):
        load_env(root / name)
    key = os.environ.get("VIBEGUARD_MODEL_API_KEY") or os.environ.get("LLM_API_KEY") or os.environ.get("OPENAI_API_KEY")
    experiment_id = "context-live-" + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    directory = root / "artifacts/improvement"
    directory.mkdir(parents=True, exist_ok=True)
    final_path = directory / f"{experiment_id}.json"
    checkpoint_path = directory / f"{experiment_id}.checkpoint.json"
    if final_path.exists() or checkpoint_path.exists():
        raise SystemExit("Experiment ID already exists; no overwrite is allowed")
    def checkpoint(value):
        checkpoint_path.write_text(json.dumps(value, indent=2), encoding="utf-8")
    result = run_context_experiment(root=root, api_key=key, experiment_id=experiment_id, on_checkpoint=checkpoint)
    with final_path.open("x", encoding="utf-8") as stream:
        json.dump(result, stream, indent=2)
    report = {"artifact": str(final_path), "status": result["status"], "model_requests": result["actual_model_request_count"], "metrics": result.get("metrics"), "promotion": result.get("promotion")}
    if args.persist and result.get("promotion", {}).get("eligible") is True:
        try:
            report["persistence"] = persist_eligible(result, root=root, artifact_path=final_path)
        except Exception as error:
            report["persistence"] = {"majority_readback": False, "error_type": type(error).__name__}
    print(json.dumps(report, indent=2))
    raise SystemExit(0 if result["status"] == "completed" and (not args.persist or report.get("persistence", {}).get("majority_readback")) else 1)


if __name__ == "__main__":
    main()
