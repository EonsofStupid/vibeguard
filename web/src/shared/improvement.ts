/** Canonical improvement records. This module has no runtime or server dependencies. */
export type Policy = {
  kind: 'memory_recall_cooldown'; cooldown_seconds: number;
  scope: 'user_session_provider'; trigger: 'embedding_rate_limit';
  fallback: 'current_thread_only'; record_turns: true; disclose_unavailable_recall: true;
} | {
  kind: 'retry_budget'; max_total_attempts: number;
  honor_lower_user_limit: true; stop_on_success: true; stop_on_nonretryable: true;
};

export type Promotion = {
  eligible: boolean; before: number; after: number; total: number;
  regressions: string[]; false_blocks: number; reason: string;
};
export type ExperimentMetrics = {
  before: number; after: number; total: number;
  avoidable_recalls_before?: number; avoidable_recalls_after?: number;
  recorded_turns_before?: number; recorded_turns_after?: number;
};
export type Experiment = {
  _id: string; experiment_id: string; status: string; started_at: string;
  model?: string; model_calls?: { model: string }[]; evidence_type: string;
  metrics: { train: ExperimentMetrics; heldout: ExperimentMetrics };
  promotion: Promotion; candidate?: { policy: Policy; policy_hash: string } | null;
};
export type Proposal = {
  _id: string; experiment_id: string; version: number;
  status: 'proposed' | 'approved' | 'rejected'; policy: Policy; policy_hash: string;
  created_at: string; evidence_summary: Promotion;
  review_url?: string; review_state?: string; decision_receipt_id?: string;
};
export type ActivePolicy = {
  _id: string; version: number; policy: Policy; policy_hash: string;
  proposal_id: string; approved_by: string; approved_at: string; receipt_id?: string;
};
export type ReviewReceipt = {
  _id: string; event: 'harness_policy_approved' | 'harness_policy_rejected';
  rule_id: string; experiment_id: string; version: number;
  status: 'approved' | 'rejected'; actor: string; at: string;
  policy_hash: string; active_policy_version: number; reviewer_notes?: string;
};
export type Rerun = {
  _id: string; experiment_id: string; finished_at: string;
  passed: boolean; policy_hash: string; evidence_type: string;
};

export type Score = { passed: number; total: number };
export type Comparison = { before: Score; after?: Score | null };
/** Public projection returned by improvement.status; no credentials or raw turns. */
export type ImprovementStatus = {
  experiment: null | {
    experiment_id: string; at: string; model: string; evidence_kind: string;
    metrics: { train: Comparison; heldout: Comparison };
    effect?: { before: number; after: number; turnsBefore: number; turnsAfter: number } | null;
    promotion?: Promotion | null;
  };
  proposal: null | Pick<Proposal, '_id' | 'version' | 'status' | 'policy_hash' | 'policy' | 'evidence_summary'>;
  review: { url: string | null; ready: boolean };
  activation?: { receipt_id: string; policy_hash: string; version: number } | null;
  rerun?: { id: string; passed: boolean; policy_hash: string; evidence_type: string } | null;
};
