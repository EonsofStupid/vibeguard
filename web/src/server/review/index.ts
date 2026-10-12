import { Module } from 'modelence/server';
import { z } from 'zod';
import type { Proposal, ReviewReceipt } from '@/shared/improvement';
import { getAgentMemoryHeaders } from '@/server/chat/auth';
import { evidenceDatabase } from '@/server/storage/atlas';
import { captureEvent, captureSignal } from '@/server/observability/raindrop';

const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const requestSchema = z.object({ proposal_id: id, version: z.number().int().positive(), policy_hash: hash }).strict();
const decisionSchema = z.object({
  execution_id: id, session_id: id, interrupt_id: z.string().min(1).max(512),
  proposal_id: id, version: z.number().int().positive(), policy_hash: hash,
  decision: z.enum(['approved', 'denied']), reviewer_name: z.string().trim().min(1).max(200),
  reviewer_notes: z.string().max(4000).optional(),
}).strict();
const payloadSchema = z.object({
  action: z.literal('review_harness_policy'), proposal_id: id,
  proposal_version: z.number().int().positive(), policy_hash: hash, experiment_id: id,
  policy: z.record(z.string(), z.unknown()),
  evidence: z.object({ eligible: z.boolean(), before: z.number(), after: z.number(), total: z.number(), regressions: z.array(z.string()), false_blocks: z.number(), reason: z.string() }).passthrough(),
  replaces_active_policy_version: z.number().int().min(0),
}).passthrough();
const pendingRequests = new Map<string, Promise<unknown>>();

function captureReview(review: z.infer<typeof payloadSchema>, sessionId: string) {
  return captureEvent({
    eventId: `rrflow-review-${review.proposal_id}-v${review.proposal_version}-${review.policy_hash}`,
    userId: process.env.VIBEGUARD_MEMORY_USER_ID?.trim() || 'vibeguard-operator',
    event: 'rrflow.review.proposal_snapshot',
    properties: {
      evidence_type: 'review_snapshot', source: 'existing_atlas_proposal', captured_at: new Date().toISOString(),
      session_id: sessionId, proposal_id: review.proposal_id, proposal_version: review.proposal_version,
      policy_hash: review.policy_hash, experiment_id: review.experiment_id,
      policy: review.policy, evidence: review.evidence,
      note: 'Snapshot of an existing proposal. This is not a new model response or a live improvement measurement.',
    },
  });
}

function target() {
  const configured = process.env.RRFLOW_INVOKE_URL || process.env.MONGODB_AGENTIC_API_URL;
  if (!configured) throw new Error('RRFlow review endpoint is not configured yet.');
  const invoke = new URL(configured);
  const parts = invoke.pathname.match(/^\/api\/v1\/projects\/([^/]+)\/workspaces\/([^/]+)\/invoke(?:Stream)?\/?$/);
  if (invoke.origin !== 'https://agentengine.mongodb.com' || !parts || invoke.username || invoke.password || invoke.search || invoke.hash) throw new Error('RRFlow needs its deployed Agent Engine workspace invoke URL.');
  invoke.pathname = invoke.pathname.replace(/invokeStream\/?$/, 'invoke');
  const pending = new URL(`/api/v1/projects/${parts[1]}/executions`, invoke.origin);
  pending.searchParams.set('workspace_id', parts[2]);
  pending.searchParams.set('status', 'suspended');
  pending.searchParams.set('limit', '50');
  return { invoke, pending };
}

async function platform(url: URL, body?: unknown, sessionId?: string) {
  const headers = await getAgentMemoryHeaders('hosted', url.origin);
  if (sessionId) headers.set('X-Session-ID', sessionId);
  const response = await fetch(url, {
    method: body === undefined ? 'GET' : 'POST', headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(body === undefined ? 15000 : 90000),
  });
  const result: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = result && typeof result === 'object' && 'error' in result && typeof result.error === 'string' ? result.error : `RRFlow returned HTTP ${response.status}.`;
    throw new Error(message);
  }
  return result;
}

export async function pendingReviews() {
  const result = await platform(target().pending);
  const envelope = z.object({ executions: z.array(z.object({
    execution_id: id, session_id: id.optional(), status: z.string(),
    suspend_context: z.object({ interrupts: z.array(z.object({ id: z.string(), value: z.unknown() })).optional() }).passthrough().optional(),
  }).passthrough()) }).parse(result);
  return envelope.executions.flatMap((execution) => {
    if (execution.status !== 'suspended' || !execution.session_id) return [];
    return (execution.suspend_context?.interrupts ?? []).flatMap((interrupt) => {
      const parsed = payloadSchema.safeParse(interrupt.value);
      if (!parsed.success) return [];
      return [{ execution_id: execution.execution_id, session_id: execution.session_id!, interrupt_id: interrupt.id, ...parsed.data }];
    });
  });
}

async function requestReview(value: unknown) {
  const request = requestSchema.parse(value);
  const sessionId = `rrflow-${request.proposal_id}-v${request.version}`;
  const inflight = pendingRequests.get(sessionId);
  if (inflight) return inflight;
  const job = (async () => {
    const pending = await pendingReviews();
    const existing = pending.find((review) => review.proposal_id === request.proposal_id && review.proposal_version === request.version && review.policy_hash === request.policy_hash);
    if (existing) return { status: 'awaiting_review', review: existing, telemetry: await captureReview(existing, sessionId) };
    const db = await evidenceDatabase();
    const proposal = await db.collection<Proposal>('harness_proposals').findOne({ _id: request.proposal_id });
    if (!proposal || proposal.status !== 'proposed' || proposal.version !== request.version || proposal.policy_hash !== request.policy_hash) throw new Error('This proposal changed or was already reviewed. Refresh the evidence.');
    await platform(target().invoke, { session_id: sessionId, message: JSON.stringify(request) }, sessionId);
    const reviews = await pendingReviews();
    const review = reviews.find((item) => item.session_id === sessionId && item.proposal_id === request.proposal_id);
    if (!review) throw new Error('RRFlow has not exposed a pending review yet. Refresh reviews before sending another request.');
    return { status: 'awaiting_review', review, telemetry: await captureReview(review, sessionId) };
  })();
  pendingRequests.set(sessionId, job);
  try { return await job; } finally { pendingRequests.delete(sessionId); }
}

async function decideReview(value: unknown) {
  const request = decisionSchema.parse(value);
  // Check the current trusted interrupt before forwarding a human continuation.
  const pending = await pendingReviews();
  const review = pending.find((item) => item.execution_id === request.execution_id && item.interrupt_id === request.interrupt_id && item.session_id === request.session_id);
  if (!review || review.proposal_id !== request.proposal_id || review.proposal_version !== request.version || review.policy_hash !== request.policy_hash) throw new Error('The reviewed version is no longer pending. Refresh the review before deciding.');
  const telemetryEvent = await captureReview(review, request.session_id);
  await platform(target().invoke, {
    session_id: request.session_id,
    resume_map: { [request.interrupt_id]: { decision: request.decision, reviewer_name: request.reviewer_name, reviewer_notes: request.reviewer_notes ?? '' } },
  }, request.session_id);
  const db = await evidenceDatabase();
  const receiptId = `rrflow:${request.proposal_id}:v${request.version}`;
  const receipt = await db.collection<ReviewReceipt>('audit').findOne({ _id: receiptId } as never);
  if (!receipt || receipt.policy_hash !== request.policy_hash || receipt.status !== (request.decision === 'approved' ? 'approved' : 'rejected')) {
    return { completed: false, message: 'The decision was submitted. RRFlow has not returned a matching committed receipt yet.' };
  }
  const telemetrySignal = await captureSignal(telemetryEvent, {
    name: receipt.event, sentiment: receipt.status === 'approved' ? 'POSITIVE' : 'NEGATIVE', type: 'feedback',
    properties: { receipt_id: receiptId, proposal_id: request.proposal_id, proposal_version: request.version,
      policy_hash: receipt.policy_hash, active_policy_version: receipt.active_policy_version, experiment_id: receipt.experiment_id,
      actor: receipt.actor, reviewed_at: receipt.at, reviewer_notes: receipt.reviewer_notes ?? '',
      meaning: 'Human authorization decision. Approval is not itself evidence of better model quality.' },
  });
  return { completed: true, telemetry: { event: telemetryEvent, signal: telemetrySignal }, receipt: { id: receiptId, status: receipt.status, actor: receipt.actor, at: receipt.at, policy_hash: receipt.policy_hash, version: receipt.version, active_policy_version: receipt.active_policy_version } };
}

export default new Module('review', {
  queries: { pending: async () => ({ reviews: await pendingReviews() }) },
  mutations: { request: requestReview, decide: decideReview },
});
