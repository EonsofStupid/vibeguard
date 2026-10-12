/**
 * Raindrop AI instrumentation for the RSI loop.
 *   proposed rule  -> trackAi  (eventId = rule_id; input = the evidence; output = the rule the agent wrote)
 *   approve/revert -> trackSignal on that eventId (the human's verdict, POSITIVE / NEGATIVE)
 *   run            -> trackAi  (input = rules active; output = held-out metric)
 * No-op when RAINDROP_API_KEY is unset; never throws into the loop.
 */
import type { GuardrailRule, RunResult } from './schemas';

type Client = {
  trackAi: (e: Record<string, unknown>) => unknown;
  trackSignal: (s: Record<string, unknown>) => Promise<unknown> | unknown;
};
let client: Client | null | undefined;
const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

async function get(): Promise<Client | null> {
  if (client !== undefined) return client;
  const key = (process.env.RAINDROP_API_KEY || '').trim();
  if (!key) { client = null; return client; }
  try {
    const mod: any = await import('raindrop-ai');
    client = new mod.Raindrop({ writeKey: key }) as Client;
  } catch (e) {
    console.warn('[raindrop] disabled:', (e as Error).message);
    client = null;
  }
  return client;
}

const safe = async (fn: (c: Client) => unknown) => {
  try { const c = await get(); if (c) await fn(c); } catch (e) { console.warn('[raindrop]', (e as Error).message); }
};

export const raindrop = {
  enabled: () => Boolean((process.env.RAINDROP_API_KEY || '').trim()),

  proposed: (rule: GuardrailRule) => safe((c) => c.trackAi({
    eventId: rule.rule_id, event: 'rule_proposed', userId: rule.proposed_by, model: 'vibeguard-harness/regex-judge',
    input: rule.origin.evidence ? `${rule.origin.evidence.prompt}\n\n${rule.origin.evidence.snippet}` : `${rule.origin.run_id}/${rule.origin.task_id}`,
    output: `${rule.rule_id} v${rule.version} [${rule.category}] ${rule.user_message}`,
    properties: { category: rule.category, pattern: rule.trigger.pattern, run_id: rule.origin.run_id, task_id: rule.origin.task_id, direction: rule.direction, action: rule.action, derived_from: rule.origin.derived_from ?? '' },
  })),

  decided: (rule: GuardrailRule, decision: 'approve' | 'revert', actor: string, reason = '') => safe(async (c) => { await sleep(1500); return c.trackSignal({
    eventId: rule.rule_id, name: decision === 'approve' ? 'rule_approved' : 'rule_reverted',
    sentiment: decision === 'approve' ? 'POSITIVE' : 'NEGATIVE',
    comment: `${actor}${reason ? `: ${reason}` : ''} (v${rule.version})`,
  }); }),

  /** The harness grades its own run against the previous one: POSITIVE = held-out improved with no false blocks. */
  selfGrade: (r: RunResult, prev: RunResult) => safe(async (c) => {
    await sleep(1500);
    const improved = r.heldout.pass_rate > prev.heldout.pass_rate, regressed = r.heldout.pass_rate < prev.heldout.pass_rate;
    const name = r.false_blocks > 0 ? 'false_block' : improved ? 'heldout_improved' : regressed ? 'heldout_regressed' : 'heldout_flat';
    return c.trackSignal({ eventId: r.run_id, name, sentiment: r.false_blocks > 0 || regressed ? 'NEGATIVE' : 'POSITIVE',
      comment: `held-out ${prev.heldout.passed}/${prev.heldout.total} -> ${r.heldout.passed}/${r.heldout.total}; false blocks ${r.false_blocks}` });
  }),

  run: (r: RunResult) => safe((c) => c.trackAi({
    eventId: r.run_id, event: 'harness_run', userId: 'agent:vibeguard', model: 'vibeguard-harness/scripted-replay',
    input: `rules active: ${r.rules_active.join(', ') || 'none'}`,
    output: `held-out ${r.heldout.passed}/${r.heldout.total} (CI ${r.heldout.ci95.join('-')}), train ${r.train.passed}/${r.train.total}, false blocks ${r.false_blocks}`,
    properties: { heldout_pass_rate: r.heldout.pass_rate, train_pass_rate: r.train.pass_rate, false_blocks: r.false_blocks, blocks: r.blocks,
      paid_attempts: r.paid_attempts, rules_active: r.rules_active.length, proposed: r.proposed.join(',') },
  })),
};
