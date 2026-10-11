"""Live-model, paired retry-policy experiment with frozen behavioral outcomes.

This module has no storage or approval authority. A successful shadow result is
only evidence for a human review, never an activation instruction.
"""
from __future__ import annotations

from dataclasses import asdict
from datetime import datetime, timezone
import hashlib
import json
import time
from typing import Callable
from uuid import uuid4

import httpx

from .behavior import RetryPlan, RetryPolicy, evaluate, execute_plan
from .fixtures import CASES, RetryCase, fixture_manifest


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _digest(value: object) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


PLAN_SCHEMA = {
    "type": "object", "additionalProperties": False,
    "properties": {
        "max_outer_calls": {"type": "integer", "minimum": 1, "maximum": 6},
        "sdk_max_attempts": {"type": "integer", "minimum": 1, "maximum": 6},
        "stop_on_success": {"type": "boolean"},
        "stop_on_nonretryable_error": {"type": "boolean"},
        "explanation": {"type": "string"},
    },
    "required": ["max_outer_calls", "sdk_max_attempts", "stop_on_success", "stop_on_nonretryable_error", "explanation"],
}
POLICY_SCHEMA = {
    "type": "object", "additionalProperties": False,
    "properties": {
        "kind": {"type": "string", "enum": ["retry_budget"]},
        "max_total_attempts": {"type": "integer", "minimum": 1, "maximum": 3},
        "honor_lower_user_limit": {"type": "boolean"},
        "stop_on_success": {"type": "boolean"},
        "stop_on_nonretryable": {"type": "boolean"},
        "source_case_ids": {"type": "array", "items": {"type": "string"}},
        "explanation": {"type": "string"},
    },
    "required": ["kind", "max_total_attempts", "honor_lower_user_limit", "stop_on_success", "stop_on_nonretryable", "source_case_ids", "explanation"],
}

PLAN_INSTRUCTIONS = """You are the workflow agent. Produce a declarative execution plan for the user's task, satisfying the task's budget and stopping requirements. You cannot see future tool results. The bounded runner executes up to max_outer_calls SDK invocations. Each invocation makes up to sdk_max_attempts actual paid attempts and automatically retries only retryable_error. An SDK call returns immediately on success or nonretryable_error. The stop_on_* booleans control whether the outer workflow terminates when an SDK call returns that status. Otherwise it calls the SDK again if outer calls remain. You may override the SDK default attempt count. Each SDK attempt, including failed ones, is billable. Output only the JSON plan. Do not claim to have executed it."""
POLICY_INSTRUCTIONS = """Propose a declarative harness change using only the supplied training failures and controls. The user requires at most three TOTAL paid attempts for a workflow, honors any lower task-specific limit, retries transient errors within the budget, and stops on success or permanent errors. The harness can enforce a counter before each paid attempt, including nested SDK retries; it can honor lower user limits and terminal conditions. Propose the smallest policy that fixes the observed failures without blocking valid work. source_case_ids must name supplied failing training cases only. This is a proposed shadow policy requiring human review; you cannot activate it. Output only JSON. No held-out tasks or labels are available."""


class ModelCallError(RuntimeError):
    """Sanitized failure with a non-secret, already recorded request receipt."""


class ResponsesClient:
    """Bounded official Responses request; zero automatic retries."""

    def __init__(self, api_key: str, model: str = "gpt-5.6-luna", max_model_calls: int = 8, max_output_tokens: int = 2048):
        if not api_key.strip():
            raise ValueError("A model API key is required")
        if not 1 <= max_model_calls <= 24 or not 1 <= max_output_tokens <= 2048:
            raise ValueError("Experiment bounds are at most 24 generations and 2048 output tokens per generation")
        self._api_key = api_key
        self.model = model
        self.max_model_calls = max_model_calls
        self.max_output_tokens = max_output_tokens
        self.calls: list[dict] = []

    def generate(self, *, purpose: str, instructions: str, payload: dict, schema: dict) -> dict:
        if len(self.calls) >= self.max_model_calls:
            raise ModelCallError("The experiment's model generation limit was reached; no extra request was sent")
        body = {
            "model": self.model, "max_output_tokens": self.max_output_tokens,
            "instructions": instructions,
            "input": json.dumps(payload, sort_keys=True),
            "text": {"format": {"type": "json_schema", "name": "retry_plan" if schema is PLAN_SCHEMA else "retry_policy", "schema": schema, "strict": True}},
            "store": False,
        }
        receipt = {"sequence": len(self.calls) + 1, "purpose": purpose, "started_at": _now(), "requested_model": self.model, "request_sha256": _digest(body), "input": payload, "instructions": instructions, "max_output_tokens": self.max_output_tokens, "automatic_retries": 0}
        self.calls.append(receipt)
        start = time.monotonic()
        try:
            with httpx.Client(timeout=httpx.Timeout(60.0, connect=10.0), transport=httpx.HTTPTransport(retries=0)) as client:
                response = client.post("https://api.openai.com/v1/responses", headers={"Authorization": "Bearer " + self._api_key, "Content-Type": "application/json"}, json=body)
            receipt["http_status"] = response.status_code
            receipt["request_id"] = response.headers.get("x-request-id")
            if response.status_code != 200:
                receipt["status"] = "failed"
                raise ModelCallError(f"Model request failed with HTTP {response.status_code}; no automatic retry was attempted")
            data = response.json()
            receipt.update({"response_id": data.get("id"), "model": data.get("model"), "status": data.get("status"), "usage": data.get("usage"), "output": data.get("output"), "created_at": data.get("created_at")})
            text = "\n".join(part["text"] for item in data.get("output", []) for part in item.get("content", []) if part.get("type") == "output_text" and isinstance(part.get("text"), str))
            if data.get("status") != "completed" or not text:
                raise ModelCallError("Model did not return a completed text response")
            try:
                result = json.loads(text)
            except json.JSONDecodeError as error:
                raise ModelCallError("Model returned invalid JSON; no automatic retry was attempted") from error
            if not isinstance(result, dict):
                raise ModelCallError("Model output must be a JSON object")
            receipt["parsed_output"] = result
            return result
        except httpx.TimeoutException as error:
            receipt["status"] = "timeout"
            raise ModelCallError("Model request timed out; outcome is unknown and no automatic retry was attempted") from error
        except httpx.HTTPError as error:
            receipt["status"] = "transport_error"
            raise ModelCallError("Model transport failed; no automatic retry was attempted") from error
        finally:
            receipt["finished_at"] = _now()
            receipt["duration_ms"] = round((time.monotonic() - start) * 1000)


def _case_result(case: RetryCase, plan: RetryPlan, policy: RetryPolicy | None) -> dict:
    execution = execute_plan(case, plan, policy)
    return {"case_id": case.id, "split": case.split, "execution": execution, "evaluation": evaluate(case, execution)}


def summarize(results: list[dict]) -> dict:
    passed = sum(int(result["evaluation"]["passed"]) for result in results)
    return {"passed": passed, "total": len(results), "pass_rate": passed / len(results) if results else None, "false_blocks": sum(int(result["evaluation"]["false_block"]) for result in results), "simulated_paid_attempts": sum(result["execution"]["simulated_paid_attempts"] for result in results)}


def run_experiment(*, api_key: str | None = None, model: str = "gpt-5.6-luna", experiment_id: str | None = None, max_model_calls: int = 8, on_checkpoint: Callable[[dict], None] | None = None, client: ResponsesClient | None = None) -> dict:
    """Run at most eight generations; return evidence, never activate a policy.

    ``on_checkpoint`` receives JSON-serializable progress after every completed
    generation and final failure/success. Persist it to survive an interrupted
    process. Tests inject a fake client; real callers supply a private API key.
    Candidate replay reuses identical model plans to isolate harness effects.
    """
    model_client = client or ResponsesClient(api_key or "", model, max_model_calls)
    manifest = fixture_manifest()
    artifact: dict = {
        "schema_version": 1, "experiment_id": experiment_id or "retry-live-" + uuid4().hex[:12],
        "status": "running", "started_at": _now(), "frozen_at": _now(),
        "problem_statements": [1, 2], "example": "retry-budget",
        "evidence_type": "live_model_plans_with_simulated_tool_outcomes",
        "scope": "Model generates bounded declarative plans; actual downstream tool calls are simulated. Candidate enforcement is shadow-only.",
        "fixture_manifest": manifest, "fixture_sha256": manifest["sha256"],
        "protocol": {"model_call_limit": max_model_calls, "max_output_tokens_per_call": 2048, "automatic_model_retries": 0, "experiment_simulated_attempt_ceiling_per_case": 6, "paired_identical_model_plans": True, "proposal_inputs": "training failures and training controls only", "heldout_used_for_proposal": False, "activation": "requires separate human review and version-bound receipt"},
        "baseline": {"train": [], "heldout": []}, "candidate": {"train": [], "heldout": []},
        "proposal": None, "model_calls": model_client.calls,
        "activation": {"status": "not_activated", "human_decision": None, "receipt": None},
    }

    def checkpoint() -> None:
        artifact["updated_at"] = _now()
        if on_checkpoint:
            on_checkpoint(artifact)

    checkpoint()  # Freeze fixture digest before the first live API call.
    plans: dict[str, RetryPlan] = {}
    policy: RetryPolicy | None = None
    try:
        for case in (case for case in CASES if case.split == "train"):
            data = model_client.generate(purpose="plan:" + case.id, instructions=PLAN_INSTRUCTIONS, payload=case.public_task(), schema=PLAN_SCHEMA)
            plans[case.id] = RetryPlan.parse(data)
            artifact["baseline"]["train"].append(_case_result(case, plans[case.id], None))
            checkpoint()
        failed_training = [result for result in artifact["baseline"]["train"] if not result["evaluation"]["passed"]]
        if failed_training:
            payload = {"training_results": artifact["baseline"]["train"], "training_tasks": [{"case_id": case.id, **case.public_task()} for case in CASES if case.split == "train"]}
            proposal = model_client.generate(purpose="train-only-policy-proposal", instructions=POLICY_INSTRUCTIONS, payload=payload, schema=POLICY_SCHEMA)
            policy = RetryPolicy.parse(proposal)
            allowed_ids = {result["case_id"] for result in failed_training}
            source_ids = proposal.get("source_case_ids")
            if not isinstance(source_ids, list) or not source_ids or not all(case_id in allowed_ids for case_id in source_ids):
                raise ValueError("Proposal provenance must reference observed failing training cases only")
            artifact["proposal"] = {"policy": asdict(policy), "policy_sha256": _digest(asdict(policy)), "source_case_ids": source_ids, "explanation": proposal.get("explanation", ""), "frozen_at": _now(), "status": "shadow_candidate", "approval_required": True}
            artifact["candidate"]["policy"] = asdict(policy)
            for case in (case for case in CASES if case.split == "train"):
                artifact["candidate"]["train"].append(_case_result(case, plans[case.id], policy))
            checkpoint()
        # No held-out task is sent until the policy is frozen (or no proposal is warranted).
        for case in (case for case in CASES if case.split == "heldout"):
            data = model_client.generate(purpose="plan:" + case.id, instructions=PLAN_INSTRUCTIONS, payload=case.public_task(), schema=PLAN_SCHEMA)
            plans[case.id] = RetryPlan.parse(data)
            artifact["baseline"]["heldout"].append(_case_result(case, plans[case.id], None))
            if policy:
                artifact["candidate"]["heldout"].append(_case_result(case, plans[case.id], policy))
            checkpoint()
        for arm in ("baseline", "candidate"):
            artifact[arm]["summary"] = {split: summarize(artifact[arm][split]) for split in ("train", "heldout")}
        baseline_train = artifact["baseline"]["summary"]["train"]
        baseline_heldout = artifact["baseline"]["summary"]["heldout"]
        candidate_train = artifact["candidate"]["summary"]["train"]
        candidate_heldout = artifact["candidate"]["summary"]["heldout"]
        regressions = []
        for split in ("train", "heldout"):
            for baseline, candidate in zip(artifact["baseline"][split], artifact["candidate"][split]):
                if baseline["evaluation"]["passed"] and not candidate["evaluation"]["passed"]:
                    regressions.append(baseline["case_id"])
        eligible = bool(policy and candidate_train["passed"] > baseline_train["passed"] and candidate_heldout["passed"] >= baseline_heldout["passed"] and not regressions and candidate_train["false_blocks"] == 0 and candidate_heldout["false_blocks"] == 0)
        artifact["assessment"] = {
            "eligible_for_human_review": eligible,
            "train_pass_delta": candidate_train["passed"] - baseline_train["passed"] if policy else 0,
            "heldout_pass_delta": candidate_heldout["passed"] - baseline_heldout["passed"] if policy else 0,
            "regressions": regressions,
            "conclusion": "Candidate improved training behavior without measured regressions; human approval is still required." if eligible else ("Baseline had no training failures; no improvement proposal was manufactured." if not policy else "Candidate did not meet the improvement gate; do not activate."),
            "limitations": ["Seven fixed tasks are a bounded example, not a general reliability estimate.", "Downstream paid-tool outcomes and billing are simulated; model API calls are real.", "Identical live-generated plans are replayed to isolate the candidate harness's causal effect.", "No model weights were trained; no durable rule was activated."],
        }
        artifact["promotion"] = {"eligible": eligible, "before": baseline_train["passed"], "after": candidate_train["passed"] if policy else baseline_train["passed"], "total": baseline_train["total"], "regressions": regressions, "false_blocks": candidate_train["false_blocks"] + candidate_heldout["false_blocks"] if policy else baseline_train["false_blocks"] + baseline_heldout["false_blocks"], "reason": artifact["assessment"]["conclusion"]}
        artifact["metrics"] = {"train": {"before": baseline_train["passed"], "after": candidate_train["passed"] if policy else baseline_train["passed"], "total": baseline_train["total"]}, "heldout": {"before": baseline_heldout["passed"], "after": candidate_heldout["passed"] if policy else baseline_heldout["passed"], "total": baseline_heldout["total"]}}
        artifact["status"] = "completed"
    except (ModelCallError, ValueError) as error:
        artifact["status"] = "failed"
        artifact["error"] = {"type": type(error).__name__, "message": str(error)}
    finally:
        artifact["finished_at"] = _now()
        artifact["actual_model_request_count"] = len(model_client.calls)
        artifact["usage"] = {key: sum((call.get("usage") or {}).get(key, 0) for call in model_client.calls) for key in ("input_tokens", "output_tokens", "total_tokens")}
        checkpoint()
    return artifact
