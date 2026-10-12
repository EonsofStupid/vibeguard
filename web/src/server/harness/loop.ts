/** One harness run: attempt → guard → judge → (train only) propose rules. Writes an episodic record to `runs`. */
import { dbRuns } from './db';
import { judge, matches, DETECTORS } from './judge';
import { wilson } from './metrics';
import { approvedRules, allRules, nextId, propose } from './gate';
import { TASKS, SEED_FAILURES } from './seed';
import { raindrop, beginRun, AGENT } from './raindrop';
import { evalRun } from './raindrop-evals';
import { RunResult, type EvalTask, type GuardrailRule, type Verdict } from './schemas';

const NUDGE: Record<string, string> = {
  'cost.unbounded_api_calls': 'This keeps calling a paid service with no stopping point. Want a limit of a few tries?',
  'security.hardcoded_secret': "There's a key written straight into the code. Let's move it to an environment variable.",
  'safety.destructive_command': 'This deletes more than it needs to. Want to narrow it to just the target?',
};
const WHY = Object.fromEntries(SEED_FAILURES.map((c) => [c.category_id, c.why_it_matters]));

export interface Agent { attempt(task: EvalTask, n: number, feedback: string[]): string | null }
export const scriptedAgent: Agent = { attempt: (t, n) => (n < t.candidates.length ? t.candidates[n] : null) };

export function runTask(task: EvalTask, agent: Agent, rules: GuardrailRule[]) {
  const feedback: string[] = [], blocked: string[] = []; let falseBlocks = 0, n = 0, code = '';
  for (;;) {
    const cand = agent.attempt(task, n, feedback); if (cand === null) break;
    code = cand; n += 1;
    const hit = rules.find((r) => matches(r.trigger, cand)); if (!hit) break;
    blocked.push(hit.rule_id); feedback.push(hit.user_message);
    if (judge(task, cand).passed) falseBlocks += 1;
  }
  const verdict = judge(task, code);
  return { task_id: task.task_id, split: task.split, attempts: n, blocked_by: blocked, false_blocks: falseBlocks, verdict };
}

function split(traces: ReturnType<typeof runTask>[], s: 'train' | 'heldout') {
  const ts = traces.filter((t) => t.split === s); const k = ts.filter((t) => t.verdict.passed).length;
  return { passed: k, total: ts.length, pass_rate: ts.length ? +(k / ts.length).toFixed(3) : 0, ci95: wilson(k, ts.length) };
}

/** Passive provenance: locate the candidate + substring the detector fired on, so a human can see *why* before approving. */
function evidenceFor(task: EvalTask | undefined, category: string) {
  if (!task) return undefined;
  const re = new RegExp(DETECTORS[category], 'is');
  for (const cand of task.candidates) {
    const m = cand.match(re);
    if (m && m.index !== undefined) {
      const a = Math.max(0, m.index - 80), b = Math.min(cand.length, m.index + m[0].length + 80);
      return { prompt: task.prompt, matched: m[0].slice(0, 200), snippet: `${a > 0 ? '…' : ''}${cand.slice(a, b)}${b < cand.length ? '…' : ''}`, detector: DETECTORS[category] };
    }
  }
  return undefined;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Human feedback shapes the next proposal (RRFlow: signals -> proposal -> governed effect).
 * A reverted rule is a NEGATIVE signal on its category: the harness must not re-propose the same broad detector.
 * It proposes a NARROWER trigger instead — the exact evidence the judge fired on, as a literal pattern — and records
 * which revert it learned from. Reverting twice in a category silences proposals for it (the human has spoken).
 */
export async function proposeRules(runId: string, verdicts: Verdict[], maxNew = 1): Promise<GuardrailRule[]> {
  const rules = await allRules();
  const covered = new Set(rules.filter((r) => r.status !== 'reverted').map((r) => r.category));
  const reverted = new Map<string, GuardrailRule[]>();
  for (const r of rules) if (r.status === 'reverted') reverted.set(r.category, [...(reverted.get(r.category) ?? []), r]);
  const counts = new Map<string, number>();
  for (const v of verdicts) for (const c of v.failures) if (DETECTORS[c] && !covered.has(c) && (reverted.get(c)?.length ?? 0) < 2) counts.set(c, (counts.get(c) ?? 0) + 1);
  const out: GuardrailRule[] = [];
  for (const [category] of [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, maxNew)) {
    const first = verdicts.find((v) => v.failures.includes(category))!; const t = new Date().toISOString();
    const evidence = evidenceFor(TASKS.find((t) => t.task_id === first.task_id), category);
    const prior = reverted.get(category)?.slice(-1)[0];
    const narrowed = prior && evidence ? { type: 'regex' as const, pattern: escapeRe(evidence.matched) } : null;
    const rule = await propose({
      rule_id: await nextId(), version: 1, status: 'proposed', direction: 'tighten', category,
      trigger: narrowed ?? { type: 'regex', pattern: DETECTORS[category] }, action: narrowed ? 'warn' : 'block_and_explain',
      user_message: narrowed
        ? `${NUDGE[category]} (Narrower than ${prior!.rule_id}, which you reverted: this only matches the exact pattern that failed.)`
        : `${NUDGE[category]} ${WHY[category]}`,
      origin: { run_id: runId, task_id: first.task_id, failure_category: category, evidence, ...(prior ? { derived_from: `reverted:${prior.rule_id}` } : {}) },
      proposed_by: AGENT, approved_by: null, created_at: t, updated_at: t,
    }, AGENT);
    if (prior) void raindrop.narrowed(rule, prior.rule_id);   // RRFlow: the NEGATIVE signal shaped this edit
    out.push(rule);
  }
  return out;
}

export async function runOnce(runId: string, agent: Agent = scriptedAgent, maxNewRules = 1): Promise<RunResult> {
  const rules = await approvedRules();
  // one Raindrop interaction per run: a tool span per task, the judge's verdict on each, the metric as the output
  const trace = await beginRun(runId, rules);
  const traces: ReturnType<typeof runTask>[] = [];
  for (const t of TASKS) {
    const tr = await trace.task(t, () => runTask(t, agent, rules));
    trace.judge(t, tr.verdict, tr.attempts);
    traces.push(tr);
  }
  const trainFails = traces.filter((t) => t.split === 'train' && !t.verdict.passed).map((t) => t.verdict);
  const proposed = await proposeRules(runId, trainFails, maxNewRules);
  const result: RunResult = {
    run_id: runId, at: new Date().toISOString(), rules_active: rules.map((r) => r.rule_id),
    train: split(traces, 'train'), heldout: split(traces, 'heldout'),
    paid_attempts: traces.reduce((a, t) => a + t.attempts, 0), blocks: traces.reduce((a, t) => a + t.blocked_by.length, 0),
    false_blocks: traces.reduce((a, t) => a + t.false_blocks, 0), proposed: proposed.map((r) => r.rule_id), traces,
    raindrop: { interaction_id: runId, eval_status: raindrop.evalsEnabled() ? 'pending' : 'off' },
  };
  const body = `# ${runId}\n\n- rules active: ${result.rules_active.join(', ') || 'none'}\n- train: ${result.train.passed}/${result.train.total}\n- held-out: ${result.heldout.passed}/${result.heldout.total}\n- blocks: ${result.blocks} (false: ${result.false_blocks})`;
  await dbRuns.upsertOne({ _id: runId } as any, { $set: { record: result, body } });
  await trace.finish(result);
  // the agent diagnoses its own training failures, one signal per (task, category) — Raindrop's Self Diagnostics tab
  for (const t of traces) if (t.split === 'train' && !t.verdict.passed) {
    const task = TASKS.find((x) => x.task_id === t.task_id);
    for (const c of t.verdict.failures) {
      const ev = evidenceFor(task, c);
      void raindrop.diagnose(runId, c, `${t.task_id} "${task?.prompt ?? ''}": ${ev?.matched ?? (c === 'correctness.failed_tests' ? `missing ${task?.required.join(', ')}` : c)}`, { task_id: t.task_id, attempts: t.attempts, blocked_by: t.blocked_by.join(',') });
    }
  }
  // self-grading: compare with the previous run and emit the verdict as an agent signal (RSI you can chart)
  const prev: any = (await dbRuns.fetch({ _id: { $ne: runId } } as any, { sort: { 'record.at': -1 }, limit: 1 }))[0];
  if (prev?.record) void raindrop.selfGrade(result, RunResult.parse(prev.record));
  // replay the run as a Raindrop eval run (+ before/after comparison) in the background; the run record is patched when it lands
  void evalRun(runId, rules, agent, runTask);
  return result;
}
