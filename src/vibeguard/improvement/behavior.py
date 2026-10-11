"""Small declarative interpreter and independent outcome oracle; no generated code."""
from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any

from .fixtures import RetryCase


@dataclass(frozen=True)
class RetryPlan:
    max_outer_calls: int
    sdk_max_attempts: int
    stop_on_success: bool
    stop_on_nonretryable_error: bool

    @classmethod
    def parse(cls, data: dict[str, Any]) -> "RetryPlan":
        for key in ("max_outer_calls", "sdk_max_attempts"):
            if type(data.get(key)) is not int or not 1 <= data[key] <= 6:
                raise ValueError(f"{key} must be an integer between 1 and 6")
        for key in ("stop_on_success", "stop_on_nonretryable_error"):
            if type(data.get(key)) is not bool:
                raise ValueError(f"{key} must be a boolean")
        return cls(**{key: data[key] for key in cls.__dataclass_fields__})


@dataclass(frozen=True)
class RetryPolicy:
    kind: str
    max_total_attempts: int
    honor_lower_user_limit: bool
    stop_on_success: bool
    stop_on_nonretryable: bool

    @classmethod
    def parse(cls, data: dict[str, Any]) -> "RetryPolicy":
        if data.get("kind") != "retry_budget":
            raise ValueError("Candidate kind must be retry_budget")
        limit = data.get("max_total_attempts")
        if type(limit) is not int or not 1 <= limit <= 3:
            raise ValueError("Candidate total limit must be between 1 and the user's maximum of 3")
        for key in ("honor_lower_user_limit", "stop_on_success", "stop_on_nonretryable"):
            if type(data.get(key)) is not bool:
                raise ValueError(f"{key} must be a boolean")
        return cls(**{key: data[key] for key in cls.__dataclass_fields__})


def execute_plan(case: RetryCase, plan: RetryPlan, policy: RetryPolicy | None = None) -> dict:
    """Execute model-selected branches, with a six-attempt experiment ceiling.

    A candidate is an isolated shadow harness. It checks its shared quota before
    EACH SDK attempt, never changing the active application policy.
    """
    trace: list[dict] = []
    attempts = 0
    termination = "plan_exhausted"
    terminal_status: str | None = None
    policy_limit = None
    if policy:
        policy_limit = min(policy.max_total_attempts, case.user_limit) if policy.honor_lower_user_limit else policy.max_total_attempts
    for outer in range(1, plan.max_outer_calls + 1):
        for inner in range(1, plan.sdk_max_attempts + 1):
            if policy and policy_limit is not None:
                if attempts >= policy_limit:
                    trace.append({"event": "guard_stop", "reason": "shared_budget_exhausted", "attempts_used": attempts, "limit": policy_limit, "outer_call": outer, "sdk_attempt": inner})
                    return _execution(plan, policy, trace, attempts, "guard_budget_exhausted", terminal_status)
            if attempts >= 6:
                trace.append({"event": "experiment_stop", "reason": "six_attempt_safety_ceiling"})
                return _execution(plan, policy, trace, attempts, "experiment_safety_ceiling", terminal_status)
            outcome = case.outcomes[min(attempts, len(case.outcomes) - 1)]
            attempts += 1
            terminal_status = outcome
            trace.append({"event": "simulated_paid_attempt", "number": attempts, "outer_call": outer, "sdk_attempt": inner, "outcome": outcome})
            if outcome == "success":
                if plan.stop_on_success or (policy and policy.stop_on_success):
                    return _execution(plan, policy, trace, attempts, "success", outcome)
                break
            if outcome == "nonretryable_error":
                if plan.stop_on_nonretryable_error or (policy and policy.stop_on_nonretryable):
                    return _execution(plan, policy, trace, attempts, "nonretryable_error", outcome)
                break
    return _execution(plan, policy, trace, attempts, termination, terminal_status)


def _execution(plan: RetryPlan, policy: RetryPolicy | None, trace: list, attempts: int, termination: str, terminal_status: str | None) -> dict:
    return {"plan": asdict(plan), "shadow_policy": asdict(policy) if policy else None, "trace": trace, "simulated_paid_attempts": attempts, "termination": termination, "terminal_status": terminal_status}


def evaluate(case: RetryCase, execution: dict) -> dict:
    """Evaluate actual observable effects, without inspecting plan/rule wording.

    The oracle independently enumerates the permitted prefix of the hidden
    outcome stream. It never calls the model, policy compiler or interpreter.
    """
    expected = []
    for outcome in case.outcomes[:min(3, case.user_limit)]:
        expected.append(outcome)
        if outcome != "retryable_error":
            break
    observed = [event["outcome"] for event in execution["trace"] if event["event"] == "simulated_paid_attempt"]
    expected_count = len(expected)
    success_available = "success" in expected
    success_observed = "success" in observed[:expected_count]
    failures: list[str] = []
    if len(observed) > min(3, case.user_limit):
        failures.append("total_budget_exceeded")
    if observed != expected:
        if len(observed) > expected_count and expected[-1] != "retryable_error":
            failures.append("attempt_after_terminal_result")
        elif len(observed) < expected_count:
            failures.append("premature_stop")
        elif observed[:expected_count] != expected:
            failures.append("unexpected_outcome_trace")
    false_block = success_available and not success_observed
    if false_block:
        failures.append("valid_success_blocked")
    return {"passed": observed == expected, "failures": failures, "false_block": false_block, "positive_control": case.positive_control, "expected_paid_attempts": expected_count, "observed_paid_attempts": len(observed), "success_available_within_budget": success_available, "success_reached": success_observed}
