from copy import deepcopy

import pytest

from vibeguard.improvement.behavior import RetryPlan, RetryPolicy, evaluate, execute_plan
from vibeguard.improvement.fixtures import CASES, fixture_manifest
from vibeguard.improvement.live_eval import ModelCallError, ResponsesClient, run_experiment


POLICY = {"kind": "retry_budget", "max_total_attempts": 3, "honor_lower_user_limit": True, "stop_on_success": True, "stop_on_nonretryable": True}


def test_shared_budget_counts_nested_sdk_attempts():
    case = next(case for case in CASES if case.id == "train-nested-sdk")
    plan = RetryPlan(3, 3, True, True)
    before = execute_plan(case, plan)
    after = execute_plan(case, plan, RetryPolicy.parse(POLICY))
    assert before["simulated_paid_attempts"] == 6
    assert "total_budget_exceeded" in evaluate(case, before)["failures"]
    assert after["simulated_paid_attempts"] == 3
    assert evaluate(case, after)["passed"]
    assert after["trace"][-1]["event"] == "guard_stop"


def test_user_lower_limit_and_terminal_conditions_override_outer_plan():
    plan = RetryPlan(6, 6, False, False)
    policy = RetryPolicy.parse(POLICY)
    counts = {}
    for case in CASES:
        result = execute_plan(case, plan, policy)
        counts[case.id] = result["simulated_paid_attempts"]
        assert evaluate(case, result)["passed"], case.id
    assert counts["heldout-lower-limit"] == 2
    assert counts["heldout-permanent"] == 1
    assert counts["heldout-recover"] == 3
    assert counts["heldout-sdk-success"] == 2


def test_too_tight_policy_is_counted_as_false_block():
    case = next(case for case in CASES if case.id == "heldout-recover")
    policy = RetryPolicy.parse({**POLICY, "max_total_attempts": 1})
    result = evaluate(case, execute_plan(case, RetryPlan(3, 3, True, True), policy))
    assert not result["passed"]
    assert result["false_block"]


def test_behavior_oracle_ignores_plan_text_and_counts_actual_attempts():
    case = next(case for case in CASES if case.id == "train-success")
    execution = {"plan": {"max_outer_calls": 999, "explanation": "I obey every rule"}, "trace": [{"event": "simulated_paid_attempt", "outcome": "success"}]}
    assert evaluate(case, execution)["passed"]
    execution["trace"].append({"event": "simulated_paid_attempt", "outcome": "retryable_error"})
    assert evaluate(case, execution)["failures"] == ["attempt_after_terminal_result"]


def test_model_prompt_does_not_expose_hidden_outcomes_or_labels():
    for case in CASES:
        public = case.public_task()
        assert set(public) == {"request", "tool_contract"}
        assert "outcomes" not in public
        assert "positive_control" not in public
        assert "split" not in public
    assert fixture_manifest() == fixture_manifest()


class FakeClient:
    def __init__(self, safe=False, tight=False):
        self.calls = []
        self.safe = safe
        self.tight = tight

    def generate(self, *, purpose, instructions, payload, schema):
        self.calls.append({"purpose": purpose, "input": deepcopy(payload), "usage": {"input_tokens": 10, "output_tokens": 20, "total_tokens": 30}})
        if purpose == "train-only-policy-proposal":
            return {**POLICY, "max_total_attempts": 1 if self.tight else 3, "source_case_ids": ["train-nested-sdk"], "explanation": "One shared counter includes every SDK attempt."}
        limit = 2 if purpose.endswith("heldout-lower-limit") else 3
        return {"max_outer_calls": limit, "sdk_max_attempts": 1 if self.safe else 3, "stop_on_success": True, "stop_on_nonretryable_error": True}


def test_experiment_freezes_before_calls_and_proposal_never_sees_heldout():
    client = FakeClient()
    checkpoints = []
    result = run_experiment(client=client, on_checkpoint=lambda value: checkpoints.append(deepcopy(value)))
    assert checkpoints[0]["model_calls"] == []
    assert result["status"] == "completed"
    assert result["actual_model_request_count"] == 8
    proposal_call = client.calls[3]
    assert proposal_call["purpose"] == "train-only-policy-proposal"
    assert all(task["case_id"].startswith("train-") for task in proposal_call["input"]["training_tasks"])
    assert "heldout" not in str(proposal_call["input"])
    assert result["promotion"]["eligible"]
    assert result["metrics"]["heldout"] == {"before": 3, "after": 4, "total": 4}
    assert result["activation"]["status"] == "not_activated"
    assert result["candidate"]["policy"] == POLICY
    for split in ("train", "heldout"):
        for baseline, candidate in zip(result["baseline"][split], result["candidate"][split]):
            assert baseline["execution"]["plan"] == candidate["execution"]["plan"]


def test_perfect_baseline_does_not_manufacture_a_proposal():
    result = run_experiment(client=FakeClient(safe=True))
    assert result["status"] == "completed"
    assert result["actual_model_request_count"] == 7
    assert result["proposal"] is None
    assert not result["promotion"]["eligible"]
    assert result["metrics"]["heldout"] == {"before": 4, "after": 4, "total": 4}


def test_false_blocks_prevent_promotion():
    result = run_experiment(client=FakeClient(tight=True))
    assert not result["promotion"]["eligible"]
    assert result["promotion"]["false_blocks"] == 2
    assert set(result["promotion"]["regressions"]) == {"heldout-recover", "heldout-sdk-success"}


def test_model_failure_preserves_incomplete_receipts_and_stops():
    client = FakeClient()

    def fail(**kwargs):
        client.calls.append({"purpose": kwargs["purpose"], "status": "timeout"})
        raise ModelCallError("Timed out")

    client.generate = fail
    result = run_experiment(client=client)
    assert result["status"] == "failed"
    assert result["actual_model_request_count"] == 1
    assert result["proposal"] is None
    assert "promotion" not in result


@pytest.mark.parametrize("value", [0, 25])
def test_generation_limits_are_enforced_before_network(value):
    with pytest.raises(ValueError):
        ResponsesClient("private-placeholder", max_model_calls=value)
