import { createHash } from "node:crypto";
import { MongoClient, type ClientSession, type Document } from "mongodb";
import { z } from "zod";

const identifier = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const RetryPolicySchema = z.object({
  kind: z.literal("retry_budget"), max_total_attempts: z.number().int().min(1).max(20),
  honor_lower_user_limit: z.literal(true), stop_on_success: z.literal(true), stop_on_nonretryable: z.literal(true),
}).strict();
const RecallPolicySchema = z.object({
  kind: z.literal("memory_recall_cooldown"), cooldown_seconds: z.number().int().min(5).max(60),
  scope: z.literal("user_session_provider"), trigger: z.literal("embedding_rate_limit"),
  fallback: z.literal("current_thread_only"), record_turns: z.literal(true), disclose_unavailable_recall: z.literal(true),
}).strict();
export const PolicySchema = z.discriminatedUnion("kind", [RetryPolicySchema, RecallPolicySchema]);
type Policy = z.infer<typeof PolicySchema>;
function policyId(policy: Policy): string { return policy.kind === "retry_budget" ? "retry-budget" : "memory-recall-cooldown"; }
function loosens(candidate: Policy, active: Policy): boolean {
  if (candidate.kind !== active.kind) throw new Error("Active policy kind does not match this proposal.");
  return candidate.kind === "retry_budget" && active.kind === "retry_budget"
    ? candidate.max_total_attempts > active.max_total_attempts
    : candidate.kind === "memory_recall_cooldown" && active.kind === "memory_recall_cooldown" && candidate.cooldown_seconds < active.cooldown_seconds;
}
const PromotionSchema = z.object({
  eligible: z.boolean(), before: z.number().int().min(0), after: z.number().int().min(0),
  total: z.number().int().positive(), regressions: z.array(z.string()),
  false_blocks: z.number().int().min(0), reason: z.string(),
}).passthrough();
const ProposalSchema = z.object({
  _id: identifier, experiment_id: identifier, version: z.number().int().positive(),
  status: z.enum(["proposed", "approved", "rejected"]), policy: PolicySchema, policy_hash: hash,
  created_at: z.string(), evidence_summary: PromotionSchema,
}).passthrough();
const ExperimentSchema = z.object({
  _id: identifier, candidate: z.object({ policy: PolicySchema, policy_hash: hash }).passthrough(),
  promotion: PromotionSchema,
}).passthrough();
const ActivePolicySchema = z.object({
  _id: z.enum(["retry-budget", "memory-recall-cooldown"]), version: z.number().int().positive(), policy: PolicySchema, policy_hash: hash,
  proposal_id: identifier, approved_by: z.string(), approved_at: z.string(),
}).passthrough();
const RequestSchema = z.object({ proposal_id: identifier, version: z.number().int().positive(), policy_hash: hash }).strict();
const DecisionSchema = z.object({
  decision: z.enum(["approved", "denied"]), reviewer_name: z.string().trim().min(1).max(200),
  reviewer_notes: z.string().max(4000).optional(),
}).strict();

export type ReviewRequest = z.infer<typeof RequestSchema>;
export type ReviewDecision = z.infer<typeof DecisionSchema>;
type Proposal = z.infer<typeof ProposalSchema>;
export type ReviewSnapshot = { proposal: Proposal; experiment_hash: string; base_policy_version: number; base_policy_hash: string | null };
type Receipt = Document & {
  _id: string; event: "harness_policy_approved" | "harness_policy_rejected"; rule_id: string;
  version: number; status: "approved" | "rejected"; actor: string; policy_hash: string;
  experiment_id: string; active_policy_version: number;
};

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, val]) => [key, canonical(val)]));
  }
  return value;
}
export function contentHash(value: unknown): string { return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex"); }
export function parseReviewRequest(message: string): ReviewRequest {
  let data: unknown;
  try { data = JSON.parse(message); } catch { throw new Error("Review request must be a JSON object."); }
  return RequestSchema.parse(data);
}
export function parseReviewDecision(answer: unknown): ReviewDecision { return DecisionSchema.parse(answer); }

function validateEvidence(proposal: Proposal, experimentValue: unknown) {
  const experiment = ExperimentSchema.parse(experimentValue);
  const promotion = experiment.promotion;
  if (experiment._id !== proposal.experiment_id || contentHash(proposal.policy) !== proposal.policy_hash ||
      experiment.candidate.policy_hash !== proposal.policy_hash || contentHash(experiment.candidate.policy) !== proposal.policy_hash) {
    throw new Error("Proposal policy does not match the measured experiment.");
  }
  if (contentHash(proposal.evidence_summary) !== contentHash(promotion)) throw new Error("Proposal evidence does not match the measured experiment.");
  if (!promotion.eligible || promotion.after <= promotion.before || promotion.after > promotion.total ||
      promotion.before > promotion.total || promotion.regressions.length || promotion.false_blocks !== 0) {
    throw new Error("This proposal is ineligible: require measured improvement, zero regressions and zero false blocks.");
  }
  return experiment;
}

export function reviewPayload(snapshot: ReviewSnapshot) {
  return {
    action: "review_harness_policy", task_id: `RRFlow-${snapshot.proposal._id}-v${snapshot.proposal.version}`,
    proposal_id: snapshot.proposal._id, proposal_version: snapshot.proposal.version,
    policy_hash: snapshot.proposal.policy_hash, experiment_id: snapshot.proposal.experiment_id,
    policy: snapshot.proposal.policy, evidence: snapshot.proposal.evidence_summary,
    replaces_active_policy_version: snapshot.base_policy_version,
    message: "Review this measured harness policy. Approval activates only this exact version and writes an Atlas receipt. Denial leaves the current harness unchanged.",
    identity_note: "Reviewer name is a prototype human label; platform service-account identity is recorded separately.",
    response_schema: {
      type: "object", required: ["decision", "reviewer_name"],
      properties: {
        decision: { type: "string", enum: ["approved", "denied"], title: "Decision" },
        reviewer_name: { type: "string", title: "Your name" },
        reviewer_notes: { type: "string", title: "Review notes" },
      }, additionalProperties: false,
    },
  };
}

export class HarnessReviewStore {
  private readonly client: MongoClient;
  private initialized: Promise<void> | undefined;
  constructor(client?: MongoClient) {
    const uri = process.env.MONGODB_URI;
    if (!client && !uri) throw new Error("MONGODB_URI must be a configured project secret.");
    this.client = client ?? new MongoClient(uri!, { appName: "RRFlow-human-review", serverSelectionTimeoutMS: 8000, connectTimeoutMS: 8000, socketTimeoutMS: 15000, timeoutMS: 20000 });
  }
  private get db() { return this.client.db("vibeguard"); }
  private async initialize(): Promise<void> {
    this.initialized ??= (async () => {
      const names = new Set((await this.db.listCollections({}, { nameOnly: true }).toArray()).map((item) => item.name));
      for (const name of ["harness_policies", "audit"]) {
        if (!names.has(name)) {
          try { await this.db.createCollection(name); }
          catch (error) { if ((error as { code?: number }).code !== 48) throw error; }
        }
      }
    })();
    try { await this.initialized; } catch (error) { this.initialized = undefined; throw error; }
  }
  async load(request: ReviewRequest): Promise<ReviewSnapshot> {
    await this.initialize();
    const proposal = ProposalSchema.parse(await this.db.collection("harness_proposals").findOne({ _id: request.proposal_id } as Document));
    if (proposal.status !== "proposed" || proposal.version !== request.version || proposal.policy_hash !== request.policy_hash) throw new Error("The proposal is no longer the pending version requested. Reload it before review.");
    const experiment = validateEvidence(proposal, await this.db.collection("harness_experiments").findOne({ _id: proposal.experiment_id } as Document));
    const activeValue = await this.db.collection("harness_policies").findOne({ _id: policyId(proposal.policy) } as Document);
    const active = activeValue ? ActivePolicySchema.parse(activeValue) : null;
    if (active && loosens(proposal.policy, active.policy)) throw new Error("This improvement proposal would loosen the existing boundary. A separate human-requested change is required.");
    return { proposal, experiment_hash: contentHash(experiment), base_policy_version: active?.version ?? 0, base_policy_hash: active?.policy_hash ?? null };
  }
  async decide(snapshot: ReviewSnapshot, answer: ReviewDecision, context: { service_user_id?: string; session_id?: string }): Promise<Receipt> {
    const decision = DecisionSchema.parse(answer);
    const proposalAtReview = ProposalSchema.parse(snapshot.proposal);
    const status = decision.decision === "approved" ? "approved" : "rejected";
    const receiptId = `rrflow:${proposalAtReview._id}:v${proposalAtReview.version}`;
    const actor = `human:${decision.reviewer_name}`;
    const session = this.client.startSession();
    try {
      const receipt = await session.withTransaction(async (transaction: ClientSession): Promise<Receipt> => {
        const receipts = this.db.collection<Receipt>("audit");
        const prior = await receipts.findOne({ _id: receiptId }, { session: transaction });
        if (prior) {
          if (prior.status !== status || prior.actor !== actor || prior.policy_hash !== proposalAtReview.policy_hash) throw new Error("A different decision already committed for this proposal version.");
          return prior;
        }
        const proposal = ProposalSchema.parse(await this.db.collection("harness_proposals").findOne({ _id: proposalAtReview._id } as Document, { session: transaction }));
        if (proposal.status !== "proposed" || proposal.version !== proposalAtReview.version || proposal.policy_hash !== proposalAtReview.policy_hash || contentHash(proposal) !== contentHash(proposalAtReview)) throw new Error("The proposal changed after human review. No policy was activated.");
        const experiment = validateEvidence(proposal, await this.db.collection("harness_experiments").findOne({ _id: proposal.experiment_id } as Document, { session: transaction }));
        if (contentHash(experiment) !== snapshot.experiment_hash) throw new Error("Experiment evidence changed after review.");
        const activeValue = await this.db.collection("harness_policies").findOne({ _id: policyId(proposal.policy) } as Document, { session: transaction });
        const active = activeValue ? ActivePolicySchema.parse(activeValue) : null;
        if (status === "approved" && ((active?.version ?? 0) !== snapshot.base_policy_version || (active?.policy_hash ?? null) !== snapshot.base_policy_hash)) throw new Error("The active harness changed after review. Review this proposal against the current version.");
        if (status === "approved" && active && loosens(proposal.policy, active.policy)) throw new Error("An improvement proposal cannot loosen the approved boundary.");
        const at = new Date().toISOString();
        const activeVersion = status === "approved" ? snapshot.base_policy_version + 1 : active?.version ?? 0;
        const nextReceipt: Receipt = {
          _id: receiptId, at, event: status === "approved" ? "harness_policy_approved" : "harness_policy_rejected",
          rule_id: proposal._id, version: proposal.version, status, actor,
          reviewer_identity_mode: "prototype-human-label", ...context,
          reviewer_notes: decision.reviewer_notes ?? "", policy_hash: proposal.policy_hash,
          experiment_id: proposal.experiment_id, experiment_hash: snapshot.experiment_hash,
          active_policy_version: activeVersion,
          checks: { measured_improvement: true, zero_regressions: true, zero_false_blocks: true, exact_proposal_version: true },
        };
        const updated = await this.db.collection("harness_proposals").updateOne(
          { _id: proposal._id, version: proposal.version, status: "proposed", policy_hash: proposal.policy_hash } as Document,
          { $set: { status, decision_receipt_id: receiptId, reviewed_by: actor, reviewed_at: at }, $inc: { version: 1 } },
          { session: transaction },
        );
        if (updated.modifiedCount !== 1) throw new Error("Proposal version changed before the decision committed.");
        if (status === "approved") {
          const nextPolicy = { _id: policyId(proposal.policy), version: activeVersion, policy: proposal.policy, policy_hash: proposal.policy_hash, proposal_id: proposal._id, approved_by: actor, approved_at: at, receipt_id: receiptId };
          if (active) {
            const changed = await this.db.collection("harness_policies").replaceOne({ _id: policyId(proposal.policy), version: snapshot.base_policy_version, policy_hash: snapshot.base_policy_hash } as Document, nextPolicy, { session: transaction });
            if (changed.modifiedCount !== 1) throw new Error("Active policy version changed before the decision committed.");
          } else { await this.db.collection<Document & { _id: string }>("harness_policies").insertOne(nextPolicy, { session: transaction }); }
        }
        await receipts.insertOne(nextReceipt, { session: transaction });
        return nextReceipt;
      }, { writeConcern: { w: "majority" }, readConcern: { level: "snapshot" }, maxCommitTimeMS: 10000 });
      if (!receipt) throw new Error("Atlas did not return a committed decision receipt.");
      return receipt;
    } finally { await session.endSession(); }
  }
  async close(): Promise<void> { await this.client.close(); }
}
