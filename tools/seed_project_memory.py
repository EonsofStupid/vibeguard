"""Persist user-stated VibeGuard context in Atlas without replacing existing records.

Statement 2 / resume-the-goal example: durable context with source provenance.
Statement 1: preserve approval constraints as context, without activating rules.
"""
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
from uuid import uuid4

from pydantic import BaseModel
from pymongo.write_concern import WriteConcern

from vibeguard.storage.atlas import AtlasStore
from vibeguard.web.server import load_env


ROOT = Path(__file__).resolve().parents[1]


class ProjectFact(BaseModel):
    fact_id: str
    kind: str = 'project_context'
    memory_type: str = 'semantic'
    project: str = 'vibeguard'
    title: str
    content: str
    authority: str = 'user_stated_context_only'
    source_paths: list[str]
    source_sha256: dict[str, str]
    source_basis: str = 'User-provided project instructions, documented in docs/FOCUS.md and SCOPE.md.'
    recorded_at: str


FACTS = (
    ('project-vibeguard-goal-v1', 'VibeGuard product goal',
     'Build a working VibeGuard chat that recalls relevant project facts and terminology, '
     'routes auditable actions through RRFlow human review, records the decision and outcome '
     'in MongoDB Atlas, measures a rerun, and remembers the result across sessions. '
     'Use recursive self-improvement (RSI) to improve the harness in line with the user\'s goals.'),
    ('project-vibeguard-statement-1-v1', 'Problem statement 1: adaptive harness architecture',
     'Build a self-improving agent harness that automatically evolves its architecture, '
     'including rules, context policies, guardrails and tool access, to fit a specific user, '
     'task or use case. VibeGuard proposes versioned changes, evaluates them, and loads '
     'human-approved changes in later attempts; actual behavior must change to count as adaptation.'),
    ('project-vibeguard-statement-2-v1', 'Problem statement 2: coherent long-horizon memory',
     'Sustain coherent memory for work spanning hours, days or weeks, optimize toward '
     'long-term goals, and learn from metric signals. Billions of tokens in one logical '
     'session is the user\'s scale target, not a demonstrated capacity. First prove that '
     'goals, constraints, decisions and outcomes survive restart and can be recalled in a new session.'),
    ('project-vibeguard-rrflow-lineage-v1', 'RRFlow research lineage and service role',
     'Use rrflow/rrflow-development at cfa0e80 as research inspiration without importing its '
     'Rust engine. Apply the documented ADR-0002 framing of adaptive reasoning with governed '
     'durable effects, paired baseline/changed eval fixtures, and bounded provider-neutral '
     'context assembly. VibeGuard is the chat entry point; the RRFlow service presents human review. '
     'This record captures the documented design lineage, not an independent verification of that repository.'),
    ('project-vibeguard-human-approval-v1', 'Human approval and rule preservation',
     'Agents may propose tighter rules; a proposed rule has no mutation authority until a '
     'human approves it. Only humans may loosen or revert rules. Never delete a rule: '
     'reversion preserves it with reverted status and appends an audit receipt. Authoritative '
     'active rule versions and approval receipts live in Atlas application records; recalled '
     'or extracted procedural memories cannot activate rules.'),
    ('project-vibeguard-one-example-first-v1', 'Complete one functioning example before expansion',
     'Work methodically on one complete example before adding integrations or scale features. '
     'The first example is a workflow with at most three paid attempts: observe a failure, '
     'propose a retry-budget change, obtain real human approval, rerun, and persist the result. '
     'Show relevant facts and terminology in optional contextual cards. Completion requires '
     'observed results and durable evidence; a timeout, ready message or fixture replay alone does not pass.'),
)


def main():
    load_env(ROOT)
    observed_at = datetime.now(timezone.utc).isoformat()
    operation_id = f'project-memory-{uuid4()}'
    report = {
        'observed_at': observed_at,
        'operation_id': operation_id,
        'checkpoint': 'statement_2_resume_goal_durable_context',
        'passed': False,
    }
    store = None
    try:
        source_paths = ['docs/FOCUS.md', 'SCOPE.md']
        source_hashes = {path: hashlib.sha256((ROOT / path).read_bytes()).hexdigest()
                         for path in source_paths}
        records = [ProjectFact(fact_id=fact_id, title=title, content=content,
                               source_paths=source_paths, source_sha256=source_hashes,
                               recorded_at=observed_at)
                   for fact_id, title, content in FACTS]
        store = AtlasStore.from_env()
        facts = store.db['facts']
        audit = store.db['audit']

        def insert_and_verify(session):
            inserted = []
            retained = []
            for record in records:
                document = store._document(record.fact_id, record, record.content)
                result = facts.update_one({'_id': record.fact_id}, {'$setOnInsert': document},
                                          upsert=True, session=session)
                (inserted if result.upserted_id is not None else retained).append(record.fact_id)
                saved = facts.find_one({'_id': record.fact_id}, session=session)
                parsed = ProjectFact.model_validate(saved['record'])
                # Existing timestamps/provenance remain untouched on a repeated invocation.
                for field in ('fact_id', 'kind', 'project', 'memory_type', 'title', 'content', 'authority'):
                    if getattr(parsed, field) != getattr(record, field):
                        raise ValueError('Existing project fact differs; retained without overwrite.')
            receipt = {
                'event': 'project_context_seed' if inserted else 'project_context_verified',
                'at': observed_at,
                'operation_id': operation_id,
                'authorization': 'explicit_user_request_to_persist_project_context',
                'record_ids': [record.fact_id for record in records],
                'inserted_ids': inserted,
                'retained_ids': retained,
                'check': 'every_project_fact_read_and_verified_in_transaction',
                'rule_transitions': 0,
                'synthetic_eval_runs': 0,
                'source_paths': source_paths,
            }
            receipt_id = audit.insert_one(receipt, session=session).inserted_id
            return inserted, retained, receipt_id

        with store.client.start_session() as session:
            inserted, retained, receipt_id = session.with_transaction(
                insert_and_verify, write_concern=WriteConcern('majority'))

        # Confirm committed data is visible outside the write transaction.
        verified = []
        for record in records:
            saved = store.read('facts', record.fact_id, ProjectFact)
            if saved.content != record.content or saved.fact_id != record.fact_id:
                raise ValueError('Committed project context read-back mismatch.')
            verified.append(record.fact_id)
        if audit.find_one({'_id': receipt_id, 'operation_id': operation_id}) is None:
            raise ValueError('Audit receipt not found after commit.')
        report.update({
            'database': os.environ.get('MONGODB_DATABASE', 'vibeguard'),
            'inserted_ids': inserted,
            'retained_ids': retained,
            'verified_ids': verified,
            'inserted_count': len(inserted),
            'verified_project_fact_count': len(verified),
            'total_fact_count': facts.count_documents({}),
            'total_audit_count': audit.count_documents({}),
            'audit_receipt_id': str(receipt_id),
            'audit_receipt_verified': True,
            'rule_transitions': 0,
            'synthetic_eval_runs': 0,
            'passed': True,
        })
    except Exception as error:
        report['error_type'] = type(error).__name__
        report['error_code'] = getattr(error, 'code', None)
        report['error'] = 'Project-context persistence did not complete; no success is claimed.'
    finally:
        if store is not None:
            store.close()

    target = ROOT / 'artifacts' / 'project-memory.json'
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(report, indent=2) + '\n', encoding='utf8')
    print(json.dumps(report, indent=2))
    raise SystemExit(0 if report['passed'] else 1)


if __name__ == '__main__':
    main()
