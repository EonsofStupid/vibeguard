import 'dotenv/config';
import fs from 'node:fs';
import { MongoClient } from 'mongodb';
import { contentHash } from './dist/agent_rrflow/harnessReview.js';

// Independent majority reads only. This script cannot submit a human decision.
const proposalId = process.argv[2] || 'context-replay-20261011T224404Z-proposal-v1';
if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/.test(proposalId)) throw new Error('Invalid proposal identifier.');
if (!process.env.MONGODB_URI) throw new Error('Saved MONGODB_URI is required.');
const client = new MongoClient(process.env.MONGODB_URI, {
  appName: 'RRFlow-decision-verification', readConcern: { level: 'majority' },
  serverSelectionTimeoutMS: 8000, connectTimeoutMS: 8000, socketTimeoutMS: 15000,
});
try {
  const db = client.db('vibeguard');
  const proposal = await db.collection('harness_proposals').findOne({ _id: proposalId });
  if (!proposal) throw new Error('The proposal does not exist.');
  const receipt = proposal.decision_receipt_id
    ? await db.collection('audit').findOne({ _id: proposal.decision_receipt_id })
    : null;
  const policyId = proposal.policy.kind === 'memory_recall_cooldown' ? 'memory-recall-cooldown' : 'retry-budget';
  const active = await db.collection('harness_policies').findOne({ _id: policyId });
  const checks = receipt ? {
    proposal_status_matches: proposal.status === receipt.status,
    proposal_version_advanced: proposal.version === receipt.version + 1,
    proposal_hash_matches: contentHash(proposal.policy) === proposal.policy_hash && proposal.policy_hash === receipt.policy_hash,
    receipt_links_proposal: receipt.rule_id === proposalId && receipt.experiment_id === proposal.experiment_id,
    human_label_recorded: typeof receipt.actor === 'string' && receipt.actor.startsWith('human:'),
    active_policy_matches: receipt.status !== 'approved' || (!!active && active.proposal_id === proposalId && active.policy_hash === receipt.policy_hash && contentHash(active.policy) === receipt.policy_hash && active.version === receipt.active_policy_version && active.approved_by === receipt.actor),
    rejected_policy_not_activated: receipt.status !== 'rejected' || active?.proposal_id !== proposalId,
  } : null;
  const evidence = {
    checked_at: new Date().toISOString(), source: 'independent Atlas majority reads',
    proposal_id: proposalId, proposal_status: proposal.status,
    policy_hash: proposal.policy_hash, policy: proposal.policy,
    human_decision_present: !!receipt,
    verified: !!checks && Object.values(checks).every(Boolean), checks,
    receipt: receipt ? { id: receipt._id, at: receipt.at, status: receipt.status, actor: receipt.actor, reviewer_notes: receipt.reviewer_notes, service_user_id: receipt.service_user_id, session_id: receipt.session_id, version: receipt.version, active_policy_version: receipt.active_policy_version } : null,
    active_policy: active ? { id: active._id, version: active.version, proposal_id: active.proposal_id, policy_hash: active.policy_hash } : null,
  };
  fs.writeFileSync('decision-checkpoint.json', JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify(evidence));
  if (receipt && !evidence.verified) process.exitCode = 1;
} finally { await client.close(); }
