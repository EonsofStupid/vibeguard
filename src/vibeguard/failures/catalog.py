"""Seed failure categories for the vibecoder domain: money, time, safety."""
from .schema import FailureCategory, Severity

SEED_CATEGORIES: list[FailureCategory] = [
    FailureCategory(
        category_id="cost.unbounded_api_calls",
        title="Unbounded paid API calls",
        signal="Does the code call a paid API inside a loop or retry with no limit?",
        why_it_matters="A loop like this can quietly bill you for thousands of calls.",
        severity=Severity.critical,
    ),
    FailureCategory(
        category_id="security.hardcoded_secret",
        title="Hardcoded secret",
        signal="Does the code contain an API key, token or password as a literal?",
        why_it_matters="Anyone who sees the code can spend on your account.",
        severity=Severity.critical,
    ),
    FailureCategory(
        category_id="safety.destructive_command",
        title="Destructive command",
        signal="Does the code delete files, drop tables or force-push without a guard?",
        why_it_matters="One run can wipe work you can't get back.",
        severity=Severity.high,
    ),
    FailureCategory(
        category_id="correctness.failed_tests",
        title="Fails its own checks",
        signal="Do the task's automated checks fail?",
        why_it_matters="Code that looks done but doesn't work costs another round of prompts.",
        severity=Severity.medium,
    ),
    FailureCategory(
        category_id="scope.missing_context",
        title="Prompt missing key context",
        signal="Is a COSTAR dimension the task needs missing from the prompt?",
        why_it_matters="Missing context is the #1 reason for a fifth retry instead of a first-try win.",
        severity=Severity.medium,
    ),
]
