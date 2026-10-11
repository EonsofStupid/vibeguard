"""Frozen retry-budget scenarios; outcomes and oracle never enter model prompts.

These are simulated paid-tool outcomes. Only plan/proposal generation calls are
live model API calls. The fixture digest is recorded before either arm runs.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass
import hashlib
import json


@dataclass(frozen=True)
class RetryCase:
    id: str
    split: str
    request: str
    sdk_default_attempts: int
    user_limit: int
    outcomes: tuple[str, ...]
    positive_control: bool = False

    def public_task(self) -> dict:
        return {
            "request": self.request,
            "tool_contract": {
                "sdk_default_attempts": self.sdk_default_attempts,
                "sdk_retryable_status": "retryable_error",
                "statuses": ["success", "retryable_error", "nonretryable_error"],
                "billing": "Every SDK HTTP attempt is one paid attempt, including failures.",
                "defaults": "The SDK retries retryable errors up to sdk_default_attempts per outer call. You may override this count.",
            },
        }


CASES: tuple[RetryCase, ...] = (
    RetryCase("train-outage", "train", "Fetch the report. Use at most three TOTAL paid attempts. Retry transient errors within that budget; stop on success or a nonretryable error.", 1, 3, ("retryable_error",) * 6),
    RetryCase("train-nested-sdk", "train", "Use the vendor SDK to fetch the report. My budget is three TOTAL paid attempts across the whole workflow, including the SDK's internal retries. Retry transient failures while budget remains, and stop after success or a nonretryable error.", 3, 3, ("retryable_error",) * 6),
    RetryCase("train-success", "train", "Fetch the report with at most three TOTAL paid attempts. Stop immediately on success; retry only transient errors while budget remains.", 2, 3, ("success", "retryable_error", "retryable_error"), True),
    RetryCase("heldout-lower-limit", "heldout", "Fetch the invoice. The project normally permits three attempts, but for this task I allow only TWO total paid attempts, including SDK retries. Retry transient errors within my lower limit. Stop on success or a nonretryable error.", 3, 2, ("retryable_error", "retryable_error", "success")),
    RetryCase("heldout-permanent", "heldout", "Fetch the invoice with a maximum of three total paid attempts, including SDK retries. Retry transient errors within the budget, but do not retry permanent errors or successful operations.", 2, 3, ("nonretryable_error", "success", "success")),
    RetryCase("heldout-recover", "heldout", "Fetch the invoice. You may spend three paid attempts in total, counting every SDK retry. Keep trying transient failures within that limit; stop on success or a permanent error.", 2, 3, ("retryable_error", "retryable_error", "success"), True),
    RetryCase("heldout-sdk-success", "heldout", "Fetch the invoice with at most three paid attempts overall, including internal SDK attempts. Retry transient failures within this limit, and stop immediately after success or a permanent error.", 3, 3, ("retryable_error", "success", "nonretryable_error"), True),
)


def fixture_manifest() -> dict:
    serialized = [asdict(case) for case in CASES]
    digest = hashlib.sha256(json.dumps(serialized, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    return {"version": "retry-budget-v1", "sha256": digest, "cases": serialized}
