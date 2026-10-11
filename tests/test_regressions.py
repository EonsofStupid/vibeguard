from datetime import datetime, timezone
import pytest
from vibeguard.evals import EvalTask, Split, load_tasks
from vibeguard.loop.agent import ScriptedAgent
from vibeguard.loop.run import run_task
from vibeguard.loop.promotion import check_promotion
from vibeguard.rules import GuardrailRule, Origin, RuleGate, RuleStatus, Trigger, GateError
from vibeguard.storage import FlatFileStore
from vibeguard.web.server import Workbench

def rule(pattern='fetch'):
    now = datetime.now(timezone.utc)
    return GuardrailRule(rule_id='VG-0001', category='cost.unbounded_api_calls',
        trigger=Trigger(type='keyword', pattern=pattern), user_message='Add a limit.',
        origin=Origin(run_id='r', task_id='t01', failure_category='cost.unbounded_api_calls'),
        created_at=now, updated_at=now)

def test_proposal_cannot_replace_approved_rule(tmp_path):
    gate=RuleGate(FlatFileStore(tmp_path))
    gate.propose(rule(), 'agent:test')
    approved=gate.approve('VG-0001', 'human:test')
    with pytest.raises(GateError):
        gate.propose(rule('anything'), 'agent:test')
    assert gate.approved() == [approved]

def test_blocked_exhausted_draft_is_never_shipped():
    task=EvalTask(task_id='x', split=Split.train, prompt='Build', stack='typescript', candidates=['fetch(url)'])
    trace=run_task(task, ScriptedAgent(), [rule()])
    assert not trace.shipped and not trace.verdict.passed
    assert trace.termination=='candidates_exhausted'

def test_repeating_agent_obeys_attempt_budget():
    class Repeater:
        def attempt(self, task, n, feedback): return 'fetch(url)'
    task=EvalTask(task_id='x', split=Split.train, prompt='Build', stack='typescript', candidates=[])
    trace=run_task(task, Repeater(), [rule()], max_attempts=3)
    assert trace.attempts==3 and trace.termination=='budget_exhausted'
    assert not trace.shipped

def test_promotion_rejects_broad_false_blocking_rule():
    check=check_promotion(rule(''), load_tasks(), [])
    assert not check.eligible and check.false_blocks > 0

def test_promotion_never_reads_heldout_candidates():
    class HeldOut:
        split=Split.heldout
        @property
        def candidates(self): raise AssertionError('held-out cannot select a rule')
    train=[t for t in load_tasks() if t.split==Split.train]
    assert check_promotion(rule(''), [*train, HeldOut()], []).total==len(train)

def test_blank_human_identity_is_rejected(tmp_path):
    gate=RuleGate(FlatFileStore(tmp_path));gate.propose(rule(),'agent:test')
    with pytest.raises(GateError): gate.approve('VG-0001','human:   ')

def test_workbench_approval_requires_confirmation_and_check(tmp_path, monkeypatch):
    monkeypatch.delenv('MONGODB_URI', raising=False)
    app=Workbench(tmp_path)
    result=app.action('/api/run', {})
    with pytest.raises(GateError): app.action('/api/approve', {'rule_id':result['proposed'][0]})
    assert not app.gate.approved()
    # Explicit synthetic human identity is used only in this isolated test store.
    app.action('/api/approve', {'rule_id':result['proposed'][0], 'confirmed':True})
    rerun=app.action('/api/run', {})
    assert rerun['heldout']['passed'] > result['heldout']['passed']

def test_invalid_atlas_configuration_does_not_silently_fallback(tmp_path, monkeypatch):
    monkeypatch.setenv('MONGODB_URI','invalid://uri')
    with pytest.raises(Exception): Workbench(tmp_path)
