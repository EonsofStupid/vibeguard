/**
 * RRFlow timeline: the harness's self-improvement, run by run, computed in Atlas.
 *   $setWindowFields  — delta vs the previous run (held-out passed, rules active)
 *   $lookup audit     — the human decisions that happened between the previous run and this one (what changed the leash)
 *   $lookup rules     — the proposals this run wrote (with provenance)
 *   $lookup raindrop  — every Raindrop emission for this run (interaction, diagnoses, grade, eval run, comparison)
 * The page renders this as the "what improved, why, and where Raindrop recorded it" panel.
 */
import { dbRuns, dbRaindrop, dbFailures } from './db';
import { raindrop } from './raindrop';

export type Change = { at: string; event: string; rule_id: string; version: number; status: string; actor: string; reason?: string };
export type Emission = { at: string; kind: string; name: string; event_id: string; status: string; sentiment?: string; detail?: string; url?: string; error?: string; ref?: Record<string, unknown> };
export type Step = {
  run_id: string; at: string; rules_active: string[]; heldout: { passed: number; total: number; pass_rate: number; ci95: [number, number] };
  train: { passed: number; total: number }; false_blocks: number; blocks: number; paid_attempts: number; proposed: string[];
  prev_run: string | null; delta: number | null; rules_delta: number | null;
  changes: Change[]; proposals: { rule_id: string; category: string; status: string; action: string; derived_from?: string }[];
  diagnoses: { category: string; count: number }[]; grade: string | null; emissions: Emission[];
  raindrop: { interaction_id?: string; eval_status: string; eval_run_id?: string; eval_url?: string; compare_url?: string; compare_with?: string; verdicts?: { passed: number; failed: number; total: number }; error?: string };
};

export async function selfImprovement() {
  const coll = dbRuns.rawCollection();
  const rows: any[] = await coll.aggregate([
    { $sort: { 'record.at': 1 } },
    { $setWindowFields: { sortBy: { 'record.at': 1 }, output: {
      prev_run: { $shift: { output: '$_id', by: -1, default: null } },
      prev_at: { $shift: { output: '$record.at', by: -1, default: null } },
      prev_passed: { $shift: { output: '$record.heldout.passed', by: -1, default: null } },
      prev_rules: { $shift: { output: { $size: '$record.rules_active' }, by: -1, default: null } },
    } } },
    { $lookup: { from: 'audit', let: { from: '$prev_at', to: '$record.at' }, pipeline: [
      { $match: { $expr: { $and: [{ $in: ['$event', ['approve', 'revert']] }, { $lte: ['$at', '$$to'] }, { $or: [{ $eq: ['$$from', null] }, { $gt: ['$at', '$$from'] }] }] } } },
      { $sort: { at: 1 } }, { $project: { _id: 0 } },
    ], as: 'changes' } },
    { $lookup: { from: 'rules', let: { rid: '$_id' }, pipeline: [
      { $match: { $expr: { $eq: ['$record.origin.run_id', '$$rid'] } } },
      { $project: { _id: 0, rule_id: '$record.rule_id', category: '$record.category', status: '$record.status', action: '$record.action', derived_from: '$record.origin.derived_from' } },
    ], as: 'proposals' } },
    { $lookup: { from: 'raindrop_log', let: { rid: '$_id' }, pipeline: [
      { $match: { $expr: { $or: [{ $eq: ['$event_id', '$$rid'] }, { $eq: ['$ref.run_id', '$$rid'] }] } } },
      { $sort: { at: 1 } }, { $project: { _id: 0 } },
    ], as: 'emissions' } },
    { $project: {
      _id: 0, run_id: '$_id', at: '$record.at', rules_active: '$record.rules_active', heldout: '$record.heldout',
      train: { passed: '$record.train.passed', total: '$record.train.total' }, false_blocks: '$record.false_blocks', blocks: '$record.blocks',
      paid_attempts: '$record.paid_attempts', proposed: '$record.proposed', raindrop: { $ifNull: ['$record.raindrop', { eval_status: 'off' }] },
      prev_run: 1, delta: { $cond: [{ $eq: ['$prev_passed', null] }, null, { $subtract: ['$record.heldout.passed', '$prev_passed'] }] },
      rules_delta: { $cond: [{ $eq: ['$prev_rules', null] }, null, { $subtract: [{ $size: '$record.rules_active' }, '$prev_rules'] }] },
      changes: 1, proposals: 1, emissions: 1,
      diagnoses: { $map: { input: { $setUnion: [{ $map: { input: { $filter: { input: '$emissions', as: 'e', cond: { $eq: ['$$e.kind', 'self_diagnosis'] } } }, as: 'e', in: '$$e.name' } }, []] }, as: 'c', in: {
        category: '$$c', count: { $size: { $filter: { input: '$emissions', as: 'e', cond: { $and: [{ $eq: ['$$e.kind', 'self_diagnosis'] }, { $eq: ['$$e.name', '$$c'] }] } } } } } } },
      grade: { $let: { vars: { g: { $filter: { input: '$emissions', as: 'e', cond: { $and: [{ $eq: ['$$e.kind', 'signal'] }, { $in: ['$$e.name', ['heldout_improved', 'heldout_flat', 'heldout_regressed', 'false_block']] }] } } } }, in: { $ifNull: [{ $arrayElemAt: ['$$g.name', -1] }, null] } } },
    } },
  ]).toArray();

  const steps = rows as Step[];
  const first = steps[0], last = steps[steps.length - 1];
  const totals = {
    runs: steps.length,
    first: first ? { run_id: first.run_id, passed: first.heldout.passed, total: first.heldout.total } : null,
    last: last ? { run_id: last.run_id, passed: last.heldout.passed, total: last.heldout.total } : null,
    improvement: first && last ? last.heldout.passed - first.heldout.passed : 0,
    decisions: steps.reduce((a, s) => a + s.changes.length, 0),
    approved: steps.reduce((a, s) => a + s.changes.filter((c) => c.event === 'approve').length, 0),
    reverted: steps.reduce((a, s) => a + s.changes.filter((c) => c.event === 'revert').length, 0),
    narrowed: steps.reduce((a, s) => a + s.proposals.filter((p) => p.derived_from).length, 0),
    diagnoses: steps.reduce((a, s) => a + s.diagnoses.reduce((b, d) => b + d.count, 0), 0),
    false_blocks: steps.reduce((a, s) => a + s.false_blocks, 0),
    eval_runs: steps.filter((s) => s.raindrop?.eval_run_id).length,
    comparisons: steps.filter((s) => s.raindrop?.compare_url).length,
  };
  const [status, feed, failures, kinds] = await Promise.all([
    raindrop.status(), raindrop.feed(40), dbFailures.fetch({}),
    dbRaindrop.rawCollection().aggregate([{ $group: { _id: { kind: '$kind', status: '$status' }, n: { $sum: 1 } } }]).toArray(),
  ]);
  // taxonomic memory as tooltips: category -> what it is, why it matters (the operator learns the term where it bites)
  const glosses = Object.fromEntries(failures.map((f: any) => [f.record?.category_id ?? f._id, { title: f.record?.title ?? '', why: f.record?.why_it_matters ?? '', severity: f.record?.severity ?? '' }]));
  return { status, totals, steps, feed, glosses, kinds: kinds.map((k: any) => ({ kind: k._id.kind, status: k._id.status, n: k.n })) };
}
