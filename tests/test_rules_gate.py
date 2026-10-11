from datetime import datetime, timezone

import pytest

from vibeguard.rules import Direction, GateError, GuardrailRule, Origin, RuleGate, RuleStatus, Trigger
from vibeguard.storage import FlatFileStore


def _rule(gate, direction=Direction.tighten):
    now = datetime.now(timezone.utc)
    return GuardrailRule(
        rule_id=gate.next_id(), direction=direction, category="cost.unbounded_api_calls",
        trigger=Trigger(pattern=r"while\s*\(?\s*true.*fetch\("),
        user_message="This loop could call a paid API forever. Add a limit?",
        origin=Origin(run_id="run_001", task_id="t01", failure_category="cost.unbounded_api_calls"),
        created_at=now, updated_at=now,
    )


@pytest.fixture
def gate(tmp_path):
    return RuleGate(FlatFileStore(tmp_path))


def test_agent_proposes_human_approves(gate):
    r = gate.propose(_rule(gate), actor="agent:vibeguard")
    assert r.status == RuleStatus.proposed
    a = gate.approve(r.rule_id, actor="human:jesse")
    assert a.status == RuleStatus.approved and a.version == 2
    assert [x.rule_id for x in gate.approved()] == [r.rule_id]


def test_agent_cannot_approve(gate):
    r = gate.propose(_rule(gate), actor="agent:vibeguard")
    with pytest.raises(GateError):
        gate.approve(r.rule_id, actor="agent:vibeguard")


def test_agent_cannot_loosen(gate):
    with pytest.raises(GateError):
        gate.propose(_rule(gate, Direction.loosen), actor="agent:vibeguard")


def test_revert_is_human_only_and_never_deletes(gate, tmp_path):
    r = gate.propose(_rule(gate), actor="agent:vibeguard")
    gate.approve(r.rule_id, actor="human:jesse")
    with pytest.raises(GateError):
        gate.revert(r.rule_id, actor="agent:vibeguard")
    v = gate.revert(r.rule_id, actor="human:jesse", reason="too many false blocks")
    assert v.status == RuleStatus.reverted
    assert (tmp_path / "rules" / f"{r.rule_id}.md").exists()
    log = (tmp_path / "audit" / "log.jsonl").read_text().splitlines()
    assert [l.split('"event": "')[1].split('"')[0] for l in log] == ["propose", "approve", "revert"]


def test_trigger_matches():
    t = Trigger(pattern=r"while\s*\(?\s*true.*fetch\(")
    assert t.matches("while (true) { await fetch(url) }")
    assert not t.matches("for (i=0;i<3;i++) fetch(url)")
