"""The governance gate: a one-way ratchet with human release.

- Agents may PROPOSE tightening rules.
- Only humans may APPROVE (in the demo every change is human-approved).
- Loosening (approving a loosen rule, or reverting an approved rule) always requires a human.
- Nothing is deleted: revert sets status=reverted, every transition is appended to the audit log.
"""
from __future__ import annotations

from datetime import datetime, timezone

from vibeguard.storage import FlatFileStore

from .schema import Direction, GuardrailRule, RuleStatus

KIND = "rules"
AUDIT = "audit"


class GateError(PermissionError):
    pass


def _is_human(actor: str) -> bool:
    return actor.startswith("human:") and bool(actor.removeprefix("human:").strip())


def _now() -> datetime:
    return datetime.now(timezone.utc)


class RuleGate:
    def __init__(self, store: FlatFileStore):
        self.store = store

    # ---- reads -------------------------------------------------------
    def all(self) -> list[GuardrailRule]:
        return list(self.store.list(KIND, GuardrailRule))

    def approved(self) -> list[GuardrailRule]:
        return [r for r in self.all() if r.status == RuleStatus.approved]

    def next_id(self) -> str:
        nums = [int(r.rule_id.split("-")[1]) for r in self.all()]
        return f"VG-{(max(nums) + 1) if nums else 1:04d}"

    # ---- transitions -------------------------------------------------
    def propose(self, rule: GuardrailRule, actor: str) -> GuardrailRule:
        if self.store.exists(KIND, rule.rule_id):
            raise GateError(f"{rule.rule_id} already exists; proposals cannot replace durable rules.")
        if rule.direction == Direction.loosen and not _is_human(actor):
            raise GateError("Agents may tighten their own leash; only humans loosen it.")
        rule = rule.model_copy(update={"status": RuleStatus.proposed, "version": 1, "approved_by": None, "proposed_by": actor, "updated_at": _now()})
        self._save(rule, "propose", actor)
        return rule

    def approve(self, rule_id: str, actor: str) -> GuardrailRule:
        if not _is_human(actor):
            raise GateError("Only a human can approve a rule change.")
        rule = self.store.read(KIND, rule_id, GuardrailRule)
        if rule.status != RuleStatus.proposed:
            raise GateError(f"{rule_id} is {rule.status.value}, not proposed.")
        rule = rule.model_copy(update={"status": RuleStatus.approved, "approved_by": actor,
                                       "version": rule.version + 1, "updated_at": _now()})
        self._save(rule, "approve", actor)
        return rule

    def revert(self, rule_id: str, actor: str, reason: str = "") -> GuardrailRule:
        if not _is_human(actor):
            raise GateError("Reverting loosens the leash; only a human can do it.")
        rule = self.store.read(KIND, rule_id, GuardrailRule)
        rule = rule.model_copy(update={"status": RuleStatus.reverted, "version": rule.version + 1, "updated_at": _now()})
        self._save(rule, "revert", actor, reason=reason)
        return rule

    def _save(self, rule: GuardrailRule, event: str, actor: str, **extra) -> None:
        body = f"# {rule.rule_id} — {rule.category}\n\n> {rule.user_message}\n"
        receipt = {"event": event, "rule_id": rule.rule_id, "version": rule.version,
                   "status": rule.status.value, "actor": actor, **extra}
        if hasattr(self.store, "write_rule_and_audit"):
            self.store.write_rule_and_audit(rule, body, receipt)
        else:
            self.store.write(KIND, rule.rule_id, rule, body=body)
            self.store.append_log(AUDIT, receipt)
