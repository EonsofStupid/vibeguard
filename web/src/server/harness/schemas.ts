/**
 * VibeGuard typed contracts. One source of truth for records in Atlas and over the wire.
 * Collections mirror Agent Engine memory types: rules=procedural, runs=episodic,
 * lexicon=semantic, failures=taxonomic, audit=receipts.
 */
import z from 'zod';

export const RuleStatus = z.enum(['proposed', 'approved', 'reverted']);
export const Direction = z.enum(['tighten', 'loosen']);
export const RuleAction = z.enum(['block_and_explain', 'warn', 'ask']);
export const Split = z.enum(['train', 'heldout']);

export const Trigger = z.object({
  type: z.enum(['regex', 'keyword']).default('regex'),
  pattern: z.string().min(1).refine((p) => { try { new RegExp(p, 'is'); return true; } catch { return false; } }, 'pattern must compile'),
});

export const Evidence = z.object({
  prompt: z.string(),          // what the vibecoder asked
  matched: z.string(),         // the exact substring the detector fired on
  snippet: z.string(),         // a window of the candidate around the match
  detector: z.string(),        // the regex that fired (judge side)
});
export const Origin = z.object({
  run_id: z.string(),
  task_id: z.string(),
  failure_category: z.string(),
  judge_score: z.number().nullable().optional(),
  evidence: Evidence.optional(),   // passive provenance: why this rule exists, attached at proposal time
  derived_from: z.string().optional(),   // human-feedback provenance: "reverted:VG-0001" when a NEGATIVE signal shaped this proposal
});

export const GuardrailRule = z.object({
  rule_id: z.string().regex(/^VG-\d{4}$/),
  version: z.number().int().min(1).default(1),
  status: RuleStatus.default('proposed'),
  direction: Direction.default('tighten'),
  category: z.string(),
  trigger: Trigger,
  action: RuleAction.default('block_and_explain'),
  user_message: z.string(),
  origin: Origin,
  proposed_by: z.string().default('agent:vibeguard'),
  approved_by: z.string().nullable().optional(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type GuardrailRule = z.infer<typeof GuardrailRule>;

export const FailureCategory = z.object({
  category_id: z.string().regex(/^[a-z_]+\.[a-z_]+$/),
  title: z.string(),
  signal: z.string(),
  why_it_matters: z.string(),
  severity: z.enum(['low', 'medium', 'high', 'critical']).default('medium'),
});
export type FailureCategory = z.infer<typeof FailureCategory>;

export const LexiconEntry = z.object({
  entry_id: z.string(),
  phrase: z.string(),
  canonical_label: z.string(),
  stack: z.string().nullable().optional(),
  teach: z.string().default(''),
  source: z.string().default('seed'),
});
export type LexiconEntry = z.infer<typeof LexiconEntry>;

export const EvalTask = z.object({
  task_id: z.string(),
  split: Split,
  prompt: z.string(),
  stack: z.string(),
  candidates: z.array(z.string()).min(1),
  required: z.array(z.string()).default([]),
});
export type EvalTask = z.infer<typeof EvalTask>;

export const Verdict = z.object({ task_id: z.string(), passed: z.boolean(), failures: z.array(z.string()) });
export type Verdict = z.infer<typeof Verdict>;

export const SplitMetrics = z.object({ passed: z.number(), total: z.number(), pass_rate: z.number(), ci95: z.tuple([z.number(), z.number()]) });

export const TaskTrace = z.object({
  task_id: z.string(), split: Split, attempts: z.number(), blocked_by: z.array(z.string()), false_blocks: z.number(), verdict: Verdict,
});

export const RunResult = z.object({
  run_id: z.string(), at: z.string(), rules_active: z.array(z.string()),
  train: SplitMetrics, heldout: SplitMetrics,
  paid_attempts: z.number(), blocks: z.number(), false_blocks: z.number(),
  proposed: z.array(z.string()), traces: z.array(TaskTrace),
});
export type RunResult = z.infer<typeof RunResult>;

export const Actor = z.string().regex(/^(human|agent):[A-Za-z0-9._-]{1,40}$/);
export const isHuman = (actor: string) => actor.startsWith('human:');
