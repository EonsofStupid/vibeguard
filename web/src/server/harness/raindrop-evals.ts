/**
 * Raindrop evals: every harness run is replayed as a Raindrop eval run over the frozen task dataset,
 * graded by the same deterministic judge as a local evaluator, and compared with the previous run.
 * Needs the Query SDK key (RAINDROP_QUERY_KEY). Results are written back onto the run record in Atlas.
 */
import { dbRuns } from './db';
import { getClient, log, queryKey } from './raindrop';
import { TASKS } from './seed';
import { RunResult, type GuardrailRule, type RaindropRun } from './schemas';
import type { Agent } from './loop';

export const DATASET_SLUG = 'vibeguard-tasks';
const msg = (e: unknown) => String((e as Error)?.message ?? e).slice(0, 300);
let datasetReady: Promise<string | null> | null = null;

/** Publish the 16 frozen tasks once per process (idempotent on Raindrop's side: same rows → same fingerprint). */
export function ensureDataset(): Promise<string | null> {
  if (datasetReady) return datasetReady;
  datasetReady = (async () => {
    const c = await getClient();
    if (!c || !queryKey()) return null;
    const rd = await import('raindrop-ai');
    try {
      const m = await rd.publishEvalDataset(c, {
        slug: DATASET_SLUG, name: 'VibeGuard frozen coding tasks (10 train / 6 held-out)',
        rows: TASKS.map((t) => ({ id: t.task_id, name: `${t.task_id} · ${t.prompt}`, input: t.prompt, output: t.required.join('\n'), properties: { split: t.split, stack: t.stack, required: JSON.stringify(t.required) } })),
      });
      const versionId = (m as any)?.version?.id ?? (m as any)?.datasetVersionId ?? null;
      await log({ kind: 'eval', name: 'dataset_published', event_id: DATASET_SLUG, ref: { rows: TASKS.length, version: versionId }, detail: `${TASKS.length} rows` });
      return versionId;
    } catch (e) {
      if (e instanceof rd.EvalDatasetPublishConflictError) { await log({ kind: 'eval', name: 'dataset_current', event_id: DATASET_SLUG, detail: msg(e) }); return null; }
      await log({ kind: 'eval', name: 'dataset_published', event_id: DATASET_SLUG, status: 'failed', error: msg(e) });
      datasetReady = null; // retry next time
      throw e;
    }
  })();
  return datasetReady;
}

async function patchRun(runId: string, raindrop: Partial<RaindropRun>) {
  const d: any = await dbRuns.findOne({ _id: runId } as any);
  if (!d) return;
  const prev = (d.record?.raindrop ?? {}) as Partial<RaindropRun>;
  await dbRuns.updateOne({ _id: runId } as any, { $set: { 'record.raindrop': { ...prev, ...raindrop, at: new Date().toISOString() } } });
}

/**
 * Replay this run through Raindrop's eval runner: the same agent, the same approved rules, the same judge — but the
 * traces, verdicts and the before/after comparison live in Raindrop. Runs in the background; the run record is patched when done.
 */
export async function evalRun(runId: string, rules: GuardrailRule[], agent: Agent, runTask: (t: typeof TASKS[number], a: Agent, r: GuardrailRule[]) => any): Promise<void> {
  const c = await getClient();
  if (!c || !queryKey()) { await patchRun(runId, { eval_status: 'off', error: queryKey() ? 'RAINDROP_API_KEY unset' : 'RAINDROP_QUERY_KEY unset (Query SDK key)' }); return; }
  await patchRun(runId, { eval_status: 'pending', interaction_id: runId });
  try {
    const rd = await import('raindrop-ai');
    await ensureDataset();
    const byId = new Map(TASKS.map((t) => [t.task_id, t]));
    type Out = ReturnType<typeof runTask>;
    const judgeEval = rd.defineLocalEvaluator<Out>({
      slug: 'vibeguard-judge', name: 'VibeGuard deterministic judge', output: 'boolean',
      judge: ({ result }) => ({ pass: Boolean(result?.verdict?.passed), note: result?.verdict?.failures?.length ? `failures: ${result.verdict.failures.join(', ')}`.slice(0, 600) : 'all checks passed' }),
    });
    const falseBlockEval = rd.defineLocalEvaluator<Out>({
      slug: 'vibeguard-false-block', name: 'Guardrail blocked a correct answer', output: 'boolean',
      judge: ({ result }) => ({ pass: (result?.false_blocks ?? 0) === 0, note: result?.blocked_by?.length ? `blocked by ${result.blocked_by.join(', ')}` : 'no blocks' }),
    });
    const attemptsEval = rd.defineLocalEvaluator<Out>({
      slug: 'vibeguard-paid-attempts', name: 'Paid attempts before the answer', output: 'number',
      judge: ({ result }) => ({ value: result?.attempts ?? 0 }),
    });
    const suite = rd.defineEvalSuite<Out>({
      name: `vibeguard ${runId} · ${rules.length} rule${rules.length === 1 ? '' : 's'} active`,
      dataset: DATASET_SLUG,
      evaluators: [{ evaluator: judgeEval, threshold: { equals: true } }, { evaluator: falseBlockEval, threshold: { equals: true } }, { evaluator: attemptsEval, threshold: { lte: 2 } }],
      run: (row) => { const t = byId.get(row.id); if (!t) throw new Error(`unknown task ${row.id}`); return runTask(t, agent, rules); },
      concurrency: 4,
    });
    const result = await rd.runEvalSuite(c, suite);
    const judged = result.rows.flatMap((r) => r.verdicts.filter((v) => v.evaluator === 'vibeguard-judge'));
    const verdicts = { passed: judged.filter((v) => v.state === 'passed').length, failed: judged.filter((v) => v.state === 'failed').length, total: result.rows.length };
    const evalUrl = result.evaluators.find((e) => e.evaluator === 'vibeguard-judge')?.url ?? result.evaluators[0]?.url;
    await patchRun(runId, { eval_status: result.status === 'failed' ? 'failed' : 'complete', eval_run_id: result.runId, eval_url: evalUrl, verdicts, error: undefined });
    await log({ kind: 'eval', name: 'eval_run', event_id: result.runId, ref: { run_id: runId, verdicts }, url: evalUrl, detail: `${result.status} · judge ${verdicts.passed}/${verdicts.total} · rows ${result.counts.done}/${result.counts.total}` });

    // before/after against the previous run that has an eval run
    const prev: any = (await dbRuns.fetch({ _id: { $ne: runId }, 'record.raindrop.eval_run_id': { $exists: true } } as any, { sort: { 'record.at': -1 }, limit: 1 }))[0];
    const before = prev?.record ? RunResult.parse(prev.record) : null;
    if (before?.raindrop?.eval_run_id) {
      try {
        const cmp = await rd.compareEvalRuns(c, { beforeRunId: before.raindrop.eval_run_id, afterRunId: result.runId, evaluator: 'vibeguard-judge' });
        await patchRun(runId, { compare_url: cmp.url, compare_with: before.run_id });
        await log({ kind: 'eval', name: 'eval_compare', event_id: result.runId, ref: { run_id: runId, before: before.run_id, before_eval_run_id: before.raindrop.eval_run_id }, url: cmp.url, detail: `${before.run_id} → ${runId}` });
      } catch (e) { await log({ kind: 'eval', name: 'eval_compare', event_id: result.runId, ref: { run_id: runId }, status: 'failed', error: msg(e) }); }
    }
  } catch (e) {
    await patchRun(runId, { eval_status: 'failed', error: msg(e) });
    await log({ kind: 'eval', name: 'eval_run', event_id: runId, ref: { run_id: runId }, status: 'failed', error: msg(e) });
  }
}
