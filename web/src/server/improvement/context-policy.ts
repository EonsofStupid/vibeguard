import { createHash, randomUUID } from 'node:crypto';
import z from 'zod';
import type { ActivePolicy, ReviewReceipt } from '../../shared/improvement';
import { evidenceDatabase, evidenceRead } from '../storage/atlas';

export const CooldownPolicy = z.object({
  kind: z.literal('memory_recall_cooldown'),
  cooldown_seconds: z.number().int().min(5).max(60),
  scope: z.literal('user_session_provider'),
  trigger: z.literal('embedding_rate_limit'),
  fallback: z.literal('current_thread_only'),
  record_turns: z.literal(true),
  disclose_unavailable_recall: z.literal(true),
}).strict();

export type ActiveCooldown = {
  id: string; version: number; hash: string; proposalId: string;
  policy: z.infer<typeof CooldownPolicy>;
};
type Decision = 'recalled' | 'rate_limited' | 'cooldown';
type RecallInput<T> = {
  sessionId: string; userId: string; provider: string;
  recall: () => Promise<T>; isRateLimit: (error: unknown) => boolean;
};
type State = {
  until: (key: string) => Promise<number>;
  pause: (key: string, until: number) => Promise<void>;
  record: (decision: Decision) => Promise<string>;
};

export function policyHash(policy: z.infer<typeof CooldownPolicy>) {
  return createHash('sha256').update(JSON.stringify(Object.fromEntries(Object.entries(policy).sort(([a], [b]) => a.localeCompare(b))))).digest('hex');
}

async function approvedPolicy(): Promise<ActiveCooldown | null> {
  const active = await evidenceRead((db, options) => db.collection<ActivePolicy>('harness_policies')
    .findOne({ _id: 'memory-recall-cooldown' }, { maxTimeMS: 5000, ...options }));
  if (!active) return null;
  const parsed = CooldownPolicy.safeParse(active.policy);
  if (!parsed.success || active.policy_hash !== policyHash(parsed.data) || !active.approved_by.startsWith('human:')) {
    throw new Error('The active context policy is invalid; it was not applied.');
  }
  const receipt = await evidenceRead((db, options) => db.collection<ReviewReceipt>('audit').findOne({
    event: 'harness_policy_approved', rule_id: active.proposal_id,
    policy_hash: active.policy_hash, active_policy_version: active.version,
    actor: active.approved_by,
  }, { projection: { _id: 1 }, maxTimeMS: 5000, ...options }));
  if (!receipt) throw new Error('The active context policy has no matching human approval receipt.');
  return { id: active._id, version: active.version, hash: active.policy_hash, proposalId: active.proposal_id, policy: parsed.data };
}

/** The same enforcement path is exercised in focused tests and by actual chat. */
export async function evaluateRecall<T>(input: RecallInput<T>, active: ActiveCooldown | null, state: State, now?: number) {
  const observedAt = () => now ?? Date.now();
  const key = createHash('sha256').update(JSON.stringify([input.userId, input.sessionId, input.provider, active?.hash])).digest('hex');
  const finish = async (decision: Decision, context: T | null, recallLimited: string | null) => ({
    context, recallLimited,
    policy: active ? { id: active.id, version: active.version, hash: active.hash, decision, eventId: await state.record(decision) } : null,
  });
  if (active && await state.until(key) > observedAt()) {
    return finish('cooldown', null, 'Long-term recall is paused briefly after a rate limit. This reply uses the current conversation. Turn recording remains enabled.');
  }
  try {
    return finish('recalled', await input.recall(), null);
  } catch (error) {
    if (!input.isRateLimit(error)) throw error;
    if (active) await state.pause(key, observedAt() + active.policy.cooldown_seconds * 1000);
    return finish('rate_limited', null, 'Long-term recall reached its rate limit. This reply uses the current conversation. Turn recording remains enabled.');
  }
}

export async function recallWithApprovedPolicy<T>(input: RecallInput<T>) {
  const active = await approvedPolicy();
  const db = await evidenceDatabase();
  const cooldowns = db.collection<{ _id: string; until: Date }>('harness_recall_cooldowns');
  return evaluateRecall(input, active, {
    until: async key => (await evidenceRead((readDb, options) => readDb.collection<{ _id: string; until: Date }>('harness_recall_cooldowns').findOne({ _id: key }, { maxTimeMS: 5000, ...options })))?.until.getTime() || 0,
    pause: async (key, until) => {
      await cooldowns.updateOne({ _id: key }, { $max: { until: new Date(until) } }, { upsert: true, writeConcern: { w: 'majority' } });
    },
    record: async decision => {
      const id = randomUUID();
      await db.collection<{ _id: string; [key: string]: unknown }>('harness_context_events').insertOne({
        _id: id, at: new Date().toISOString(), user_id: input.userId, session_id: input.sessionId,
        provider: input.provider, policy_id: active!.id, policy_version: active!.version,
        policy_hash: active!.hash, proposal_id: active!.proposalId, decision,
      }, { writeConcern: { w: 'majority' } });
      return id;
    },
  });
}
