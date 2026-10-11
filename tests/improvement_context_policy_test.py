from copy import deepcopy
import json
from pathlib import Path

import pytest

from vibeguard.improvement.context_policy import (
    ContextPolicy, FIXTURES, is_embedding_rate_limit, judge, replay, run_context_experiment,
)

ROOT = Path(__file__).resolve().parents[1]
CASES = json.loads(FIXTURES.read_text())["cases"]
POLICY = {"kind": "memory_recall_cooldown", "cooldown_seconds": 30, "scope": "user_session_provider",
          "trigger": "embedding_rate_limit", "fallback": "current_thread_only", "record_turns": True,
          "disclose_unavailable_recall": True}


def test_baseline_preserves_replies_but_repeats_known_limited_recall():
    case = CASES[0]
    result = replay(case)
    score = judge(case, result)
    assert score["avoidable_recalls"] == 2
    assert score["produced_turns"] == score["recorded_turns"] == 8
    assert all(turn["assistant_produced"] for turn in result["trace"])
    assert not score["passed"]


def test_candidate_reduces_recall_without_losing_recorded_turns_or_healthy_recovery():
    policy = ContextPolicy.parse(POLICY)
    for case in CASES:
        before = judge(case, replay(case))
        result = replay(case, policy)
        after = judge(case, result)
        assert after["passed"], case["id"]
        assert after["avoidable_recalls"] == after["false_blocks"] == 0
        assert after["recorded_turns"] == before["recorded_turns"]
        assert after["produced_turns"] == before["produced_turns"]


def test_cooldown_does_not_cross_user_session_provider_scope():
    case = next(case for case in CASES if case["id"] == "heldout-scope-isolation")
    trace = replay(case, ContextPolicy.parse(POLICY))["trace"]
    assert [turn["recall_called"] for turn in trace] == [True, True, True, True, False, True]


def test_exact_expiry_allows_recall_and_unrelated_errors_never_start_cooldown():
    case = {"id": "boundary", "split": "heldout", "turns": [
        {"at": 0, "response": {"status": 429}, "oracle": "rate_limited"},
        {"at": 30, "response": {"status": 200, "facts": ["recovered"]}, "oracle": "healthy"},
    ]}
    result = replay(case, ContextPolicy.parse(POLICY))
    assert result["trace"][1]["recall_called"]
    assert judge(case, result)["passed"]
    other = next(case for case in CASES if case["id"] == "train-unrelated-error")
    result = replay(other, ContextPolicy.parse(POLICY))
    assert result["trace"][0]["memory_error_status"] == 503
    assert result["trace"][1]["recall_called"]
    assert "cooldown_until" not in result["trace"][0]


def test_judge_penalizes_early_provider_recovery_false_block():
    case = {"id": "early-recovery-tradeoff", "split": "heldout", "turns": [
        {"at": 0, "response": {"status": 429}, "oracle": "rate_limited"},
        {"at": 2, "response": {"status": 200, "facts": ["healthy already"]}, "oracle": "healthy"},
    ]}
    score = judge(case, replay(case, ContextPolicy.parse(POLICY)))
    assert score["false_blocks"] == 1
    assert not score["passed"]


def test_judge_rejects_lost_recording_and_invented_context():
    case = CASES[0]
    result = replay(case, ContextPolicy.parse(POLICY))
    result["trace"][1]["assistant_turn_recorded"] = False
    result["trace"][1]["retrieved_facts"] = ["unsupported model guess"]
    score = judge(case, result)
    assert set(score["failures"]) == {"produced_turn_not_recorded", "unavailable_memory_injected"}


@pytest.mark.parametrize("response,expected", [
    ({"status": 429}, True),
    ({"status": 400, "detail": "Embedding service rate limit exceeded; retry later"}, True),
    ({"status": 502, "detail": "Upstream embedding provider rate limit reached"}, True),
    ({"status": 401, "detail": "Embedding service token expired"}, False),
    ({"status": 503, "detail": "Memory runtime unavailable"}, False),
    ({"status": 200, "detail": "No embedding rate limit"}, False),
])
def test_adapter_direct_and_wrapped_rate_limit_detection(response, expected):
    assert is_embedding_rate_limit(response) is expected


class FakeClient:
    def __init__(self):
        self.calls = []

    def generate(self, **kwargs):
        self.calls.append({"purpose": kwargs["purpose"], "input": deepcopy(kwargs["payload"]),
                           "http_status": 200, "status": "completed", "response_id": "fake-not-live",
                           "usage": {"input_tokens": 1, "output_tokens": 1, "total_tokens": 2}})
        return {**POLICY, "source_case_ids": ["train-wrapped-burst", "train-direct-burst", "train-unrelated-error"],
                "explanation": "Bound the cooldown to avoid repeat calls while preserving replies and writes."}


def test_train_only_generation_frozen_manifest_and_human_only_activation():
    client = FakeClient()
    checkpoints = []
    result = run_context_experiment(root=ROOT, client=client, on_checkpoint=lambda value: checkpoints.append(deepcopy(value)))
    assert result["status"] == "completed"
    assert checkpoints[0]["model_calls"] == []
    assert checkpoints[0]["fixture_sha256"] == result["fixture_sha256"]
    assert len(client.calls) == 1
    assert "heldout-" not in json.dumps(client.calls[0]["input"])
    assert len(client.calls[0]["input"]["training_results"]) == 3
    assert result["promotion"]["eligible"]
    assert result["metrics"]["train"]["before"] == 1
    assert result["metrics"]["train"]["after"] == 3
    assert result["metrics"]["heldout"]["before"] == 1
    assert result["metrics"]["heldout"]["after"] == 4
    assert result["metrics"]["heldout"]["avoidable_recalls_before"] == 4
    assert result["metrics"]["heldout"]["avoidable_recalls_after"] == 0
    assert result["activation"]["status"] == "not_activated"


@pytest.mark.parametrize("change", [{"cooldown_seconds": 0}, {"cooldown_seconds": 61}, {"record_turns": False}, {"disclose_unavailable_recall": False}, {"scope": "global"}])
def test_policy_bounds_and_memory_invariants_are_enforced(change):
    with pytest.raises(ValueError):
        ContextPolicy.parse({**POLICY, **change})
