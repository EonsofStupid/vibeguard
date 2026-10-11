import type { ActivePolicy, Experiment, ExperimentMetrics, ImprovementStatus, Proposal, Rerun, ReviewReceipt } from '../../shared/improvement';
import { evidenceRead } from '../storage/atlas';

function comparison(value: ExperimentMetrics, hasCandidate: boolean) {
  return {
    before: { passed: value.before, total: value.total },
    // A perfect baseline has no candidate, even if the artifact repeats its score.
    after: hasCandidate ? { passed: value.after, total: value.total } : null,
  };
}

type RecallMetrics = ExperimentMetrics & Required<Pick<ExperimentMetrics,
  'avoidable_recalls_before' | 'avoidable_recalls_after' | 'recorded_turns_before' | 'recorded_turns_after'>>;

function hasRecallMetrics(metrics: ExperimentMetrics): metrics is RecallMetrics {
  return [metrics.avoidable_recalls_before, metrics.avoidable_recalls_after,
    metrics.recorded_turns_before, metrics.recorded_turns_after]
    .every(value => typeof value === 'number' && Number.isFinite(value));
}

export async function improvementStatus(): Promise<ImprovementStatus> {
  const experiment = await evidenceRead((db, options) => db.collection<Experiment>('harness_experiments').findOne(
    { status: 'completed' },
    { sort: { started_at: -1 }, projection: {
      experiment_id: 1, started_at: 1, model: 1, 'model_calls.model': 1, evidence_type: 1,
      metrics: 1, promotion: 1, 'candidate.policy': 1,
    }, maxTimeMS: 5000, ...options },
  ));
  if (!experiment) return { experiment: null, proposal: null, review: { url: null, ready: false } };
  const proposal = await evidenceRead((db, options) => db.collection<Proposal>('harness_proposals').findOne(
    { experiment_id: experiment.experiment_id },
    { sort: { version: -1 }, projection: {
      version: 1, status: 1, policy_hash: 1, policy: 1, evidence_summary: 1,
      review_url: 1, review_state: 1,
    }, maxTimeMS: 5000, ...options },
  ));
  const hasCandidate = !!experiment.candidate?.policy;
  const rerun = await evidenceRead((db, options) => db.collection<Rerun>('harness_reruns').findOne({ experiment_id: experiment.experiment_id }, { sort: { finished_at: -1 }, maxTimeMS: 5000, ...options }));
  const active = proposal?.status === 'approved' ? await evidenceRead((db, options) => db.collection<ActivePolicy>('harness_policies').findOne({
    proposal_id: String(proposal._id), policy_hash: proposal.policy_hash,
  }, { maxTimeMS: 5000, ...options })) : null;
  const receipt = active && typeof active.approved_by === 'string' && active.approved_by.startsWith('human:')
    ? await evidenceRead((db, options) => db.collection<ReviewReceipt>('audit').findOne({
      event: 'harness_policy_approved', rule_id: String(proposal!._id),
      policy_hash: active.policy_hash, active_policy_version: active.version, actor: active.approved_by,
    }, { projection: { _id: 1 }, maxTimeMS: 5000, ...options })) : null;
  const ready = !!proposal?.review_url && ['awaiting_review', 'completed'].includes(proposal.review_state ?? '');
  return {
    experiment: {
      experiment_id: experiment.experiment_id,
      at: experiment.started_at,
      model: experiment.model || experiment.model_calls?.[0]?.model || 'Not recorded',
      evidence_kind: experiment.evidence_type,
      metrics: {
        train: comparison(experiment.metrics.train, hasCandidate),
        heldout: comparison(experiment.metrics.heldout, hasCandidate),
      },
      promotion: experiment.promotion,
      effect: hasRecallMetrics(experiment.metrics.train) && hasRecallMetrics(experiment.metrics.heldout) ? {
        before: experiment.metrics.train.avoidable_recalls_before + experiment.metrics.heldout.avoidable_recalls_before,
        after: experiment.metrics.train.avoidable_recalls_after + experiment.metrics.heldout.avoidable_recalls_after,
        turnsBefore: experiment.metrics.train.recorded_turns_before + experiment.metrics.heldout.recorded_turns_before,
        turnsAfter: experiment.metrics.train.recorded_turns_after + experiment.metrics.heldout.recorded_turns_after,
      } : null,
    },
    proposal: proposal ? {
      _id: String(proposal._id), version: proposal.version, status: proposal.status,
      policy_hash: proposal.policy_hash, policy: proposal.policy, evidence_summary: proposal.evidence_summary,
    } : null,
    review: { url: ready ? proposal!.review_url ?? null : null, ready },
    activation: active && receipt ? { receipt_id: String(receipt._id), policy_hash: active.policy_hash, version: active.version } : null,
    rerun: rerun ? { id: String(rerun._id), passed: rerun.passed, policy_hash: rerun.policy_hash, evidence_type: rerun.evidence_type } : null,
  };
}
