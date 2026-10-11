import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { captureEvent, captureSignal } from '../web/src/server/observability/raindrop';

// Explicit historical import: this does not run a model, replay tasks or approve a policy.
async function main() {
  process.loadEnvFile('web/.env');
  const artifactPath = 'artifacts/improvement/context-replay-20261011T224404Z.json';
  const bytes = readFileSync(artifactPath);
  const artifact = JSON.parse(bytes.toString('utf8'));
  const eventId = `vibeguard-replay-import-${artifact.experiment_id}`;
  const properties = {
    evidence_type: 'historical_incident_replay_import', source_artifact: artifactPath,
    source_sha256: createHash('sha256').update(bytes).digest('hex'),
    experiment_id: artifact.experiment_id, proposal_id: `${artifact.experiment_id}-proposal-v1`,
    policy_hash: artifact.candidate.policy_hash, original_started_at: artifact.started_at,
    captured_at: new Date().toISOString(), policy: artifact.candidate.policy,
    metrics: artifact.metrics, promotion: artifact.promotion,
    simulation_notice: 'Provider responses, timelines, turn writes and replies were simulated. This imports earlier evidence; no new model run, live savings or approval is claimed.',
  };
  const event = await captureEvent({ eventId, userId: process.env.VIBEGUARD_MEMORY_USER_ID || 'vibeguard-operator', event: 'vibeguard.improvement.historical_replay_import', properties });
  const signal = await captureSignal(event, { name: 'incident_replay_eligible_for_human_review', sentiment: 'POSITIVE', type: 'standard', properties });
  const result = { checked_at: new Date().toISOString(), event, signal, evidence_type: properties.evidence_type,
    source_artifact: artifactPath, source_sha256: properties.source_sha256, experiment_id: properties.experiment_id,
    proposal_id: properties.proposal_id, policy_hash: properties.policy_hash, dashboard_inspected: false,
    limitations: properties.simulation_notice };
  writeFileSync('artifacts/raindrop-capture-checkpoint.json', JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
  if (event.status !== 'acknowledged' || signal.status !== 'acknowledged') process.exitCode = 1;
}
void main();
