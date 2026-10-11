import assert from "node:assert/strict";
import test from "node:test";
import type { MongoClient } from "mongodb";
import { HarnessReviewStore, contentHash, parseReviewDecision, parseReviewRequest, PolicySchema } from "./harnessReview.js";

// Isolated in-memory database double. These tests never write decisions to Atlas.
function fixture(policyOverride?: Record<string, unknown>) {
  const policy = policyOverride ?? { kind: "retry_budget", max_total_attempts: 3, honor_lower_user_limit: true, stop_on_success: true, stop_on_nonretryable: true };
  const promotion = { eligible: true, before: 2, after: 4, total: 4, regressions: [], false_blocks: 0, reason: "Improvement measured on frozen cases" };
  const proposal = { _id: "test-proposal", experiment_id: "test-experiment", version: 1, status: "proposed", policy, policy_hash: contentHash(policy), created_at: "2026-10-11T00:00:00Z", evidence_summary: promotion };
  let rows: Record<string, Record<string, any>> = {
    harness_proposals: { [proposal._id]: proposal },
    harness_experiments: { "test-experiment": { _id: "test-experiment", candidate: { policy, policy_hash: proposal.policy_hash }, promotion } },
    harness_policies: {}, audit: {},
  };
  let failAudit = false;
  const clone = <T>(value: T): T => structuredClone(value);
  const matches = (record: Record<string, unknown>, filter: Record<string, unknown>) => record && Object.entries(filter).every(([key, value]) => record[key] === value);
  const db = {
    listCollections: () => ({ toArray: async () => Object.keys(rows).map((name) => ({ name })) }),
    collection: (name: string) => ({
      findOne: async (filter: Record<string, unknown>) => clone(Object.values(rows[name]).find((row) => matches(row, filter)) ?? null),
      updateOne: async (filter: Record<string, unknown>, update: { $set: object; $inc: Record<string, number> }) => {
        const row = Object.values(rows[name]).find((item) => matches(item, filter));
        if (!row) return { modifiedCount: 0 };
        Object.assign(row, update.$set);
        for (const [key, value] of Object.entries(update.$inc)) row[key] += value;
        return { modifiedCount: 1 };
      },
      replaceOne: async (filter: Record<string, unknown>, value: any) => {
        const row = Object.values(rows[name]).find((item) => matches(item, filter));
        if (!row) return { modifiedCount: 0 };
        rows[name][value._id] = clone(value);
        return { modifiedCount: 1 };
      },
      insertOne: async (value: any) => {
        if (name === "audit" && failAudit) throw new Error("receipt write failed");
        if (rows[name][value._id]) throw new Error("duplicate key");
        rows[name][value._id] = clone(value);
      },
    }),
  };
  const client = {
    db: () => db,
    startSession: () => ({
      withTransaction: async (fn: (session: unknown) => Promise<unknown>) => {
        const prior = clone(rows);
        try { return await fn({}); } catch (error) { rows = prior; throw error; }
      },
      endSession: async () => {},
    }),
  } as unknown as MongoClient;
  return { store: new HarnessReviewStore(client), request: { proposal_id: proposal._id, version: 1, policy_hash: proposal.policy_hash }, rows: () => rows, failAudit: () => { failAudit = true; } };
}

test("review input cannot carry its own decision or weaken mandatory policy controls", () => {
  const f = fixture();
  assert.throws(() => parseReviewRequest(JSON.stringify({ ...f.request, decision: "approved" })));
  assert.throws(() => parseReviewDecision({ decision: "approved", reviewer_name: " " }));
  assert.throws(() => PolicySchema.parse({ ...f.rows().harness_proposals["test-proposal"].policy, stop_on_success: false }));
  assert.equal(contentHash({ b: 2, a: 1 }), contentHash({ a: 1, b: 2 }));
});

test("approval atomically activates the reviewed policy and replay writes no duplicate receipt", async () => {
  const f = fixture();
  const snapshot = await f.store.load(f.request);
  const answer = { decision: "approved" as const, reviewer_name: "test human" };
  const receipt = await f.store.decide(snapshot, answer, { session_id: "unit-only" });
  assert.equal(f.rows().harness_policies["retry-budget"].version, 1);
  assert.equal(f.rows().harness_proposals["test-proposal"].status, "approved");
  assert.equal(f.rows().harness_proposals["test-proposal"].version, 2);
  assert.equal((await f.store.decide(snapshot, answer, {}))._id, receipt._id);
  assert.equal(Object.keys(f.rows().audit).length, 1);
  await assert.rejects(f.store.decide(snapshot, { decision: "denied", reviewer_name: "test human" }, {}), /different decision/);
});

test("denial records a rejection and does not activate any policy", async () => {
  const f = fixture();
  const receipt = await f.store.decide(await f.store.load(f.request), { decision: "denied", reviewer_name: "test human" }, {});
  assert.equal(receipt.status, "rejected");
  assert.equal(Object.keys(f.rows().harness_policies).length, 0);
  assert.equal(f.rows().harness_proposals["test-proposal"].status, "rejected");
});

test("failed receipt insertion rolls back the proposal and policy change", async () => {
  const f = fixture();
  const snapshot = await f.store.load(f.request);
  f.failAudit();
  await assert.rejects(f.store.decide(snapshot, { decision: "approved", reviewer_name: "test human" }, {}), /receipt write failed/);
  assert.equal(f.rows().harness_proposals["test-proposal"].status, "proposed");
  assert.equal(Object.keys(f.rows().harness_policies).length, 0);
});

test("stale proposal, changed experiment and changed active version fail closed", async () => {
  for (const mutation of ["proposal", "experiment", "active"]) {
    const f = fixture();
    const snapshot = await f.store.load(f.request);
    if (mutation === "proposal") f.rows().harness_proposals["test-proposal"].version++;
    if (mutation === "experiment") f.rows().harness_experiments["test-experiment"].extra = "changed after review";
    if (mutation === "active") f.rows().harness_policies["retry-budget"] = { _id: "retry-budget", version: 1, policy: snapshot.proposal.policy, policy_hash: snapshot.proposal.policy_hash, proposal_id: "other", approved_by: "human:other", approved_at: "now" };
    await assert.rejects(f.store.decide(snapshot, { decision: "approved", reviewer_name: "test human" }, {}));
    assert.equal(Object.keys(f.rows().audit).length, 0);
  }
});

test("ineligible promotion and stale requested hash cannot enter human review", async () => {
  const f = fixture();
  await assert.rejects(f.store.load({ ...f.request, policy_hash: "0".repeat(64) }), /pending version/);
  f.rows().harness_experiments["test-experiment"].promotion.false_blocks = 1;
  await assert.rejects(f.store.load(f.request), /ineligible/);
});

test("memory recall cooldown preserves scoped fallback and activates its own policy record", async () => {
  const policy = { kind: "memory_recall_cooldown", cooldown_seconds: 30, scope: "user_session_provider", trigger: "embedding_rate_limit", fallback: "current_thread_only", record_turns: true, disclose_unavailable_recall: true };
  for (const invalid of [{ cooldown_seconds: 4 }, { cooldown_seconds: 61 }, { record_turns: false }, { scope: "global" }, { disclose_unavailable_recall: false }]) {
    assert.throws(() => PolicySchema.parse({ ...policy, ...invalid }));
  }
  const f = fixture(policy);
  const snapshot = await f.store.load(f.request);
  await f.store.decide(snapshot, { decision: "approved", reviewer_name: "test human" }, {});
  assert.equal(f.rows().harness_policies["memory-recall-cooldown"].policy.cooldown_seconds, 30);
  assert.equal(f.rows().harness_policies["retry-budget"], undefined);
});
