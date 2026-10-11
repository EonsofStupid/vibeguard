import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateRecall, type ActiveCooldown } from './context-policy';

const active: ActiveCooldown = {
  id: 'memory-recall-cooldown', version: 1, hash: 'fixture', proposalId: 'test-only',
  policy: { kind: 'memory_recall_cooldown', cooldown_seconds: 30, scope: 'user_session_provider',
    trigger: 'embedding_rate_limit', fallback: 'current_thread_only', record_turns: true, disclose_unavailable_recall: true },
};
function setup() {
  const pauses = new Map<string, number>();
  const decisions: string[] = [];
  const state = { until: async (key: string) => pauses.get(key) || 0,
    pause: async (key: string, until: number) => { pauses.set(key, until); },
    record: async (decision: string) => { decisions.push(decision); return String(decisions.length); } };
  return { state, pauses, decisions };
}
const identity = { sessionId: 'thread', userId: 'operator', provider: 'voyage', isRateLimit: (e: unknown) => e === '429' };

test('an approved cooldown skips only recall, and recovers at its expiry', async () => {
  const { state, decisions } = setup(); let calls = 0;
  const input = { ...identity, recall: async () => { if (++calls === 1) throw '429'; return 'remembered goal'; } };
  assert.equal((await evaluateRecall(input, active, state, 1000)).policy?.decision, 'rate_limited');
  const paused = await evaluateRecall(input, active, state, 2000);
  assert.equal(paused.context, null); assert.equal(paused.policy?.decision, 'cooldown');
  assert.match(paused.recallLimited!, /current conversation/); assert.equal(calls, 1);
  assert.equal((await evaluateRecall(input, active, state, 31000)).context, 'remembered goal');
  assert.equal(calls, 2); assert.deepEqual(decisions, ['rate_limited', 'cooldown', 'recalled']);
});

test('a proposal without active approval does not change request behavior', async () => {
  const { state, pauses } = setup(); let calls = 0;
  const input = { ...identity, recall: async () => { calls++; throw '429'; } };
  assert.equal((await evaluateRecall(input, null, state, 1000)).policy, null);
  await evaluateRecall(input, null, state, 2000);
  assert.equal(calls, 2); assert.equal(pauses.size, 0);
});

test('cooldown does not cross users, sessions, providers, or policy versions', async () => {
  const { state } = setup();
  await evaluateRecall({ ...identity, recall: async () => { throw '429'; } }, active, state, 1000);
  for (const changed of [{ userId: 'second' }, { sessionId: 'second' }, { provider: 'second' }]) {
    const result = await evaluateRecall({ ...identity, ...changed, recall: async () => 'isolated' }, active, state, 2000);
    assert.equal(result.context, 'isolated');
  }
  assert.equal((await evaluateRecall({ ...identity, recall: async () => 'new policy' }, { ...active, hash: 'new' }, state, 2000)).context, 'new policy');
});

test('unrelated provider failures stay visible and never create cooldown', async () => {
  const { state, pauses } = setup();
  await assert.rejects(evaluateRecall({ ...identity, recall: async () => { throw new Error('authentication failed'); } }, active, state, 1000), /authentication failed/);
  assert.equal(pauses.size, 0);
});
