# RRFlow harness review service

RRFlow is the human decision service for VibeGuard's first RSI checkpoint: a measured retry-budget improvement. It runs a deterministic LangGraph workflow on MongoDB Atlas Agent Engine. A model cannot approve a proposal or choose to skip review.

The workflow reads a proposed policy and its immutable experiment from Atlas, verifies measured improvement without regressions or false blocks, snapshots the exact version and hashes, and interrupts for a human. The decision commits the proposal status, active policy and append-only receipt together with majority write concern. Denial changes no active policy. A stale review fails closed; repeating the same committed decision returns its existing receipt.

Application records use the `vibeguard` database: `harness_experiments`, `harness_proposals`, `harness_policies`, and `audit`. Agent Engine owns the durable workflow checkpoint. The existing hosted memory configuration is independent and must not be replaced by the old parent configuration.

## Invocation

Invoke the deployed workspace with a fresh session for each proposal:

```json
{
  "session_id": "rrflow-review-PROPOSAL_ID-v1",
  "message": "{\"proposal_id\":\"PROPOSAL_ID\",\"version\":1,\"policy_hash\":\"SHA256_OF_CANONICAL_POLICY\"}"
}
```

The service requires an existing eligible proposal. Ordinary chat text is not a review request. Once the execution suspends, show its interrupt payload in the human review interface. Preserve the proposal and experiment unchanged while review is pending.

Only the human sends the continuation, using the exact returned interrupt ID and the same session:

```json
{
  "session_id": "rrflow-review-PROPOSAL_ID-v1",
  "resume_map": {
    "RETURNED_INTERRUPT_ID": {
      "decision": "approved",
      "reviewer_name": "The actual reviewer",
      "reviewer_notes": "The reviewed reason"
    }
  }
}
```

The decision may be `approved` or `denied`. Reviewer name is a prototype human label, not authenticated individual identity. The runtime service identity and session are separately included in the receipt when available. Do not generate a review decision during a demo run.

## Local validation

```powershell
pnpm install
pnpm run build
node --test dist/agent_rrflow/harnessReview.test.js
```

The six tests use an isolated in-memory database double. They do not write approvals to Atlas and are not live RSI evidence.

## Deployment

From this directory, use the repository's `agentengine.exe` with context `hack`. Run `init` only when no workspace is bound, then build. Deploy the explicit successful build ID so the CLI does not launch the Atlas setup wizard. Do not run `memory configure` here.

The previous insurance-template modules remain as unused scaffold reference. The active entrypoint is `src/agent_rrflow/main.ts`; the review contract and Atlas transaction are in `harnessReview.ts`. Research inspiration is RRFlow's governed durable effects principle, without importing its Rust engine.
