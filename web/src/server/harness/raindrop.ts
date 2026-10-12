/**
 * RRFlow on Raindrop — the harness's own improvement as a first-class, observable loop.
 *
 *   interaction  harness.run        one per run; a tool span per task (attempt → guard → judge), properties = the metric
 *   event        rule_proposed      one per proposal (eventId = rule_id; input = the evidence, output = the rule the agent wrote)
 *   event        costar.check       one per prompt check (input = prompt, output = scores)
 *   self-diag    <failure category> one per training failure (Self Diagnostics tab); COSTAR gaps -> missing_context
 *   signal       feedback           the human's verdict on a proposal: rule_approved (+) / rule_reverted (−), with the reason
 *   signal       edit               rule_narrowed: the agent's narrowed re-proposal, `after` = the new trigger, on the reverted rule's event
 *   signal       agent              the harness grading its own run: heldout_improved / flat / regressed / false_block
 *   evals        dataset + suite    with a Query SDK key: every run is replayed as a Raindrop eval run and compared with the previous one
 *
 * Keys: RAINDROP_API_KEY (write key — events, traces, signals) and RAINDROP_QUERY_KEY (Query SDK key — evals, datasets, comparisons).
 * Every emission is mirrored to Atlas (`raindrop_log`) so the dashboard can show the stream without a Raindrop read API.
 * Never throws into the loop.
 */
import type { Raindrop, Interaction } from 'raindrop-ai';
import { dbRaindrop } from './db';
import type { EvalTask, GuardrailRule, RunResult } from './schemas';

export const AGENT = 'agent:vibeguard';
const MODEL = 'vibeguard-harness/scripted-replay';
export const DASHBOARD = 'https://app.raindrop.ai';

let client: Raindrop | null | undefined;
const writeKey = () => (process.env.RAINDROP_WRITE_KEY || process.env.RAINDROP_API_KEY || '').trim();
export const queryKey = () => (process.env.RAINDROP_QUERY_KEY || '').trim();
const now = () => new Date().toISOString();
const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));
const msg = (e: unknown) => String((e as Error)?.message ?? e).slice(0, 300);

export async function getClient(): Promise<Raindrop | null> {
  if (client !== undefined) return client;
  const key = writeKey();
  if (!key) { client = null; return client; }
  try {
    const mod = await import('raindrop-ai');
    client = new mod.Raindrop({ writeKey: key, apiKey: queryKey() || undefined, appGit: false, redactPii: false });
    client.setUserDetails({ userId: AGENT, traits: { kind: 'harness', model: MODEL } });
  } catch (e) {
    console.warn('[raindrop] disabled:', msg(e));
    client = null;
  }
  return client;
}

type LogEntry = { kind: string; name: string; event_id: string; ref?: Record<string, unknown>; sentiment?: string; detail?: string; url?: string };
export async function log(entry: LogEntry & { status?: string; error?: string }) {
  try { await dbRaindrop.insertOne({ at: now(), status: 'sent', ...entry } as any); } catch (e) { console.warn('[raindrop] log', msg(e)); }
}
/** Run an emission; mirror it (sent / failed / skipped) to Atlas. */
const emit = async (entry: LogEntry, fn: (c: Raindrop) => unknown | Promise<unknown>) => {
  const c = await getClient();
  if (!c) return log({ ...entry, status: 'skipped', error: 'RAINDROP_API_KEY unset' });
  try { await fn(c); await log(entry); } catch (e) { await log({ ...entry, status: 'failed', error: msg(e) }); }
};

/** One harness run as one Raindrop interaction: a tool span per task, the metric as the output. */
export type RunTrace = {
  task<T>(t: EvalTask, fn: () => T): Promise<T>;
  judge(t: EvalTask, verdict: { passed: boolean; failures: string[] }, attempts: number): void;
  finish(r: RunResult): Promise<void>;
};
export async function beginRun(runId: string, rules: GuardrailRule[]): Promise<RunTrace> {
  const c = await getClient();
  const input = `rules active: ${rules.map((r) => `${r.rule_id}@v${r.version}`).join(', ') || 'none'}`;
  if (!c) {
    void log({ kind: 'interaction', name: 'harness.run', event_id: runId, ref: { run_id: runId }, status: 'skipped', error: 'RAINDROP_API_KEY unset' });
    return { task: async (_t, fn) => fn(), judge: () => {}, finish: async () => {} };
  }
  let it: Interaction | null = null;
  try {
    it = c.begin({ event: 'harness.run', eventId: runId, userId: AGENT, convoId: 'vibeguard-loop', model: MODEL, input,
      properties: { run_id: runId, rules_active: rules.length, rules: rules.map((r) => r.rule_id).join(',') } });
    void log({ kind: 'interaction', name: 'harness.run', event_id: runId, ref: { run_id: runId }, detail: input });
  } catch (e) { void log({ kind: 'interaction', name: 'harness.run', event_id: runId, ref: { run_id: runId }, status: 'failed', error: msg(e) }); }
  return {
    task: async (t, fn) => {
      if (!it) return fn();
      try {
        return await it.withTool({ name: `attempt:${t.task_id}`, properties: { task_id: t.task_id, split: t.split, stack: t.stack }, inputParameters: { prompt: t.prompt } }, fn);
      } catch { return fn(); }
    },
    judge: (t, verdict, attempts) => {
      try { it?.trackTool({ name: `judge:${t.task_id}`, input: { task_id: t.task_id, attempts }, output: verdict, properties: { split: t.split, passed: String(verdict.passed) } }); } catch { /* observability never breaks the loop */ }
    },
    finish: async (r) => {
      if (!it) return;
      const output = `held-out ${r.heldout.passed}/${r.heldout.total} (CI ${r.heldout.ci95.join('–')}) · train ${r.train.passed}/${r.train.total} · blocks ${r.blocks} (false ${r.false_blocks}) · proposed ${r.proposed.join(', ') || 'none'}`;
      try {
        it.setProperties({ heldout_pass_rate: r.heldout.pass_rate, train_pass_rate: r.train.pass_rate, false_blocks: r.false_blocks, blocks: r.blocks, paid_attempts: r.paid_attempts, proposed: r.proposed.join(',') });
        await it.finish({ output });
        await c.forceFlush();
        void log({ kind: 'interaction', name: 'harness.run.finish', event_id: r.run_id, ref: { run_id: r.run_id }, detail: output });
      } catch (e) { void log({ kind: 'interaction', name: 'harness.run.finish', event_id: r.run_id, ref: { run_id: r.run_id }, status: 'failed', error: msg(e) }); }
    },
  };
}

export const raindrop = {
  enabled: () => Boolean(writeKey()),
  evalsEnabled: () => Boolean(queryKey()),

  status: async () => {
    const [sent, failed, skipped, last] = await Promise.all([
      dbRaindrop.countDocuments({ status: 'sent' } as any), dbRaindrop.countDocuments({ status: 'failed' } as any),
      dbRaindrop.countDocuments({ status: 'skipped' } as any), dbRaindrop.fetch({}, { sort: { at: -1 }, limit: 1 }),
    ]);
    return { tracing: Boolean(writeKey()), evals: Boolean(queryKey()), sent, failed, skipped, last_at: (last[0] as any)?.at ?? null, dashboard: DASHBOARD };
  },

  /** The agent's self-diagnosis: one signal per training failure, grouped by failure category (Self Diagnostics tab). */
  diagnose: (runId: string, category: string, description: string, props: Record<string, unknown> = {}) =>
    emit({ kind: 'self_diagnosis', name: category, event_id: runId, ref: { run_id: runId, ...props }, sentiment: 'NEGATIVE', detail: description },
      (c) => c.selfDiagnose({ eventId: runId, category, description: description.slice(0, 500), source: 'vibeguard-judge', sentiment: 'NEGATIVE', properties: props })),

  /** A proposal is an AI event: input = the evidence the judge fired on, output = the rule the agent wrote. */
  proposed: (rule: GuardrailRule) =>
    emit({ kind: 'event', name: 'rule_proposed', event_id: rule.rule_id, ref: { rule_id: rule.rule_id, run_id: rule.origin.run_id, category: rule.category }, detail: `${rule.rule_id} v${rule.version} ${rule.action} ${rule.trigger.pattern.slice(0, 80)}` },
      async (c) => {
        c.trackAi({
          eventId: rule.rule_id, event: 'rule_proposed', userId: rule.proposed_by, convoId: 'vibeguard-loop', model: 'vibeguard-harness/regex-judge',
          input: rule.origin.evidence ? `${rule.origin.evidence.prompt}\n\n${rule.origin.evidence.snippet}` : `${rule.origin.run_id}/${rule.origin.task_id}`,
          output: `${rule.rule_id} v${rule.version} [${rule.category}] ${rule.action}: ${rule.user_message}\n\ntrigger (${rule.trigger.type}): ${rule.trigger.pattern}`,
          attachments: rule.origin.evidence ? [{ type: 'code', name: 'failing attempt', value: rule.origin.evidence.snippet, role: 'input' }, { type: 'code', name: 'trigger', value: rule.trigger.pattern, role: 'output', language: 'regex' }] : undefined,
          properties: { category: rule.category, pattern: rule.trigger.pattern, run_id: rule.origin.run_id, task_id: rule.origin.task_id, direction: rule.direction, action: rule.action, derived_from: rule.origin.derived_from ?? '' },
        });
        await c.forceFlush();
      }),

  /** The human's verdict is a feedback signal on the proposal's event: approve = POSITIVE, revert = NEGATIVE (+ reason). */
  decided: (rule: GuardrailRule, decision: 'approve' | 'revert', actor: string, reason = '') =>
    emit({ kind: 'signal', name: decision === 'approve' ? 'rule_approved' : 'rule_reverted', event_id: rule.rule_id, ref: { rule_id: rule.rule_id, actor, category: rule.category }, sentiment: decision === 'approve' ? 'POSITIVE' : 'NEGATIVE', detail: `${actor}${reason ? `: ${reason}` : ''} (v${rule.version})` },
      async (c) => {
        await sleep(1200); // the proposal event must land before its signal
        c.trackSignal({ eventId: rule.rule_id, type: 'feedback', name: decision === 'approve' ? 'rule_approved' : 'rule_reverted', sentiment: decision === 'approve' ? 'POSITIVE' : 'NEGATIVE',
          comment: `${actor}${reason ? `: ${reason}` : ''} (v${rule.version}, ${rule.category})`, properties: { actor, version: rule.version, category: rule.category } });
        await c.forceFlush();
      }),

  /** The agent's narrowed re-proposal is an edit signal on the reverted rule: `after` = the new, literal trigger. */
  narrowed: (rule: GuardrailRule, priorId: string) =>
    emit({ kind: 'signal', name: 'rule_narrowed', event_id: priorId, ref: { rule_id: priorId, derived_rule: rule.rule_id, category: rule.category }, sentiment: 'POSITIVE', detail: `${rule.rule_id}: ${rule.trigger.pattern.slice(0, 100)}` },
      async (c) => {
        c.trackSignal({ eventId: priorId, type: 'edit', name: 'rule_narrowed', sentiment: 'POSITIVE', after: `${rule.rule_id} (${rule.action}) trigger: ${rule.trigger.pattern}`, properties: { derived_rule: rule.rule_id, category: rule.category } });
        await c.forceFlush();
      }),

  /** The harness grades its own run against the previous one: POSITIVE = held-out improved with no false blocks. */
  selfGrade: (r: RunResult, prev: RunResult) => {
    const improved = r.heldout.pass_rate > prev.heldout.pass_rate, regressed = r.heldout.pass_rate < prev.heldout.pass_rate;
    const name = r.false_blocks > 0 ? 'false_block' : improved ? 'heldout_improved' : regressed ? 'heldout_regressed' : 'heldout_flat';
    const sentiment = r.false_blocks > 0 || regressed ? 'NEGATIVE' : 'POSITIVE';
    const comment = `held-out ${prev.heldout.passed}/${prev.heldout.total} → ${r.heldout.passed}/${r.heldout.total}; false blocks ${r.false_blocks}; rules ${prev.rules_active.length} → ${r.rules_active.length}`;
    return emit({ kind: 'signal', name, event_id: r.run_id, ref: { run_id: r.run_id, previous: prev.run_id }, sentiment, detail: comment },
      async (c) => { await sleep(800); c.trackSignal({ eventId: r.run_id, type: 'agent', name, sentiment, properties: { comment, previous: prev.run_id, delta: r.heldout.passed - prev.heldout.passed, false_blocks: r.false_blocks } }); await c.forceFlush(); });
  },

  /** A COSTAR check is an event; each missing dimension is a missing_context self-diagnosis (what the agent would have had to guess). */
  costarCheck: (prompt: string, scores: { dimension: string; p_present: number }[], gaps: string[]) => {
    const id = `costar_${Date.now().toString(36)}`;
    return emit({ kind: 'event', name: 'costar.check', event_id: id, ref: { missing: gaps }, detail: `${6 - gaps.length}/6 present: ${prompt.slice(0, 80)}` },
      async (c) => {
        c.trackAi({ eventId: id, event: 'costar.check', userId: 'human:vibecoder', convoId: 'vibeguard-costar', model: 'vibeguard-harness/costar-classifier', input: prompt,
          output: scores.map((s) => `${s.dimension} ${s.p_present.toFixed(2)}`).join(' · '), properties: { present: 6 - gaps.length, missing: gaps.join(',') } });
        await c.forceFlush();
        for (const g of gaps) c.selfDiagnose({ eventId: id, category: 'missing_context', description: `COSTAR ${g} missing from the prompt: "${prompt.slice(0, 120)}"`, source: 'vibeguard-costar', sentiment: 'NEGATIVE', properties: { dimension: g } });
        await c.forceFlush();
      });
  },

  /** The last N emissions, newest first — the dashboard's live feed. */
  feed: async (limit = 30) => (await dbRaindrop.fetch({}, { sort: { at: -1 }, limit })).map(({ _id, ...d }: any) => d),
};
