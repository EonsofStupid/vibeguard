# VibeGuard architecture and canonical names

VibeGuard is the chat and improvement workbench. RRFlow is the human decision
service. Atlas stores authoritative experiment evidence, proposals, active
policies and receipts. Hosted Agent Engine memory stores conversation context.
Retrieved memory cannot activate a policy.

This structure supports the two problem statements: adapting the agent's harness
from measured signals, and retaining goals, decisions and outcomes across work.
The working example is bounded memory-recall cooldown. Incident-derived replay
and actual service evidence remain separately labeled. This is not evidence of
billion-token capacity or measured production scale.

## Verified research lineage

The public RRFlow sources were checked at commit
[`cfa0e8073c1a5479427beb29c7c88ee0a71f2f01`](https://github.com/rrflow/rrflow-development/commit/cfa0e8073c1a5479427beb29c7c88ee0a71f2f01).
[ADR-0002](https://github.com/rrflow/rrflow-development/blob/cfa0e8073c1a5479427beb29c7c88ee0a71f2f01/docs/decisions/0002-adaptive-reasoning-governed-effects.md)
places authorization, validation and receipts at durable-effect boundaries;
VibeGuard's human approval and Atlas transaction are our application of that
principle, rather than imported engine code.

The [context assembly contract](https://github.com/rrflow/rrflow-development/blob/cfa0e8073c1a5479427beb29c7c88ee0a71f2f01/docs/architecture/engine-data-flow.md#context-assembly-contract)
specifies a provider-neutral operation, explicit budgets, source provenance and
truncation. It also identifies native incremental access paths as later roadmap
work. The separate [context-maintenance document](https://github.com/rrflow/rrflow-development/blob/cfa0e8073c1a5479427beb29c7c88ee0a71f2f01/docs/reference/context/context-maintenance.md)
is explicitly a target contract: reducing injected context while retaining
canonical knowledge is design guidance, not proof of completed compaction or
unbounded memory. Our demo claims remain tied to VibeGuard's own evidence.

## Domain map

| Path | Responsibility |
| --- | --- |
| `web/src/shared/improvement.ts` | Dependency-free canonical record types and the public `ImprovementStatus` projection. |
| `web/src/server/storage/atlas.ts` | Atlas connection, majority reads and bounded retry budget for reads. No UI or domain query dependency. |
| `web/src/server/improvement/` | Experiment status, approved context policy loading and enforcement, colocated policy tests. |
| `web/src/server/improvement/index.ts` | Modelence `improvement.status` query registration. |
| `web/src/server/review/` | Native RRFlow pending review, request and human continuation. It does not activate policies directly. |
| `web/src/server/chat/` | Chat, model access, scoped hosted memory, and application of the approved context policy. |
| `web/src/client/components/improvement/` | Six-stage RSI view and contextual explanations derived from recorded evidence. |
| `web/src/client/components/review/` | Explicit human decision form and committed receipt display. |
| `web/src/client/components/chat/` | Conversation and relevant memory/terminology presentation. |
| `rrflow/agents/rrflow/` | Deployed deterministic review graph, strict policy validation and transactional decision receipt. |
| `web/src/server/harness/` | Legacy fixture replay, COSTAR, lexicon and earlier rule records. It is not the owner of new improvement logic. |
| `src/vibeguard/improvement/` | Python experiment and rerun producers. |
| `artifacts/improvement/` | Reproducible experiment artifacts; distinguish live calls from simulated provider replay. |

Domain folders use lowercase singular names. TypeScript implementation files use
lowercase descriptive names with hyphens when needed; React components use
PascalCase. Tests are colocated as `*.test.ts`. Modelence methods use
`domain.operation`. New consumers call `improvement.status`; the old
`harness.liveImprovement` method is retained only as a compatibility alias to the
same implementation. It must not acquire a separate implementation.

## Canonical entities and identifiers

| Entity | Atlas collection | Identity and meaning |
| --- | --- | --- |
| `Experiment` | `harness_experiments` | Immutable `_id = experiment_id`; frozen task manifest, candidate, provenance and measured results. |
| `Proposal` | `harness_proposals` | `_id = proposal_id`; points to `experiment_id`, exact `policy_hash` and review `version`. |
| `ActivePolicy` | `harness_policies` | Stable policy-kind `_id`, currently `memory-recall-cooldown` or `retry-budget`; monotonic active `version`. |
| `ReviewReceipt` | `audit` | `_id = rrflow:<proposal_id>:v<reviewed_version>`; exact human decision, actor, hash and active version. |
| `Rerun` | `harness_reruns` | `_id = rerun_id`; references the experiment and approved `policy_hash`, records its own evidence type and result. |

Persisted field names use snake_case. `policy_hash` is SHA-256 of canonical JSON
with recursively sorted object keys. Proposal version and active policy version
are different counters: a decision advances the proposal version; an approval
also advances the active policy version. An experiment ID is never an execution
ID. Native Agent Engine `execution_id`, `session_id` and `interrupt_id` identify
the review workflow, not the policy.

Existing collection names and audit fields remain unchanged; this refactor does
not migrate or rewrite records. `ReviewReceipt.rule_id` is the legacy stored field
containing the proposal ID for `harness_policy_approved` and
`harness_policy_rejected` events. Do not introduce a second receipt by renaming it.
Reviewer names currently label prototype human decisions. Service identity is
recorded separately when available; a label is not verified individual identity.

## Lifecycle and authority

1. **Observed failure:** retain its source and distinguish an actual incident
   from controlled replay timing.
2. **Proposal:** evaluate a candidate policy and persist its exact experiment,
   policy hash and version. `status: proposed` grants no activation authority.
3. **Shadow results:** training and held-out results are separate. Eligibility
   requires measured gain, zero regressions and zero false blocks. Held-out
   cases do not write the proposal.
4. **Human review:** RRFlow loads the exact pending proposal and immutable
   experiment, then suspends with a native Agent Engine interrupt. The user
   explicitly approves or denies that version. Notes are preferences recorded
   in the receipt; notes alone do not modify a policy.
5. **Active policy:** approval commits proposal status, incremented active policy
   and append-only receipt in one majority transaction. Denial leaves the active
   policy unchanged. Repeated identical decisions return the same receipt;
   conflicting or stale decisions fail closed.
6. **Measured rerun:** execute with the approved policy and retain new evidence.
   The UI marks completion only when the receipt, active policy and passing
   rerun match the same policy hash. A better shadow score alone is incomplete.

`Proposal.status` is `proposed`, `approved` or `rejected`. RRFlow's input decision
`denied` maps to persisted `rejected`. The review execution may be `suspended`
without any policy being active. Do not use “deployed,” “ready,” “approved” and
“verified” as interchangeable states.

Chat imports policy enforcement from `server/improvement/context-policy.ts`.
Review imports Atlas storage directly. Neither depends on an improvement UI
query for infrastructure. The storage helper retries bounded reads only; it
does not retry writes or paid model calls. The cooldown state is scoped to user,
session, provider and policy hash, preserves turn recording, and discloses when
long-term recall is unavailable.

## Checks

From the repository root, `npm run typecheck` checks the Modelence source and
`npm run test:web` executes the colocated context-policy tests. `npm --prefix web
test` delegates to the same test command. Deployment readiness, actual chat,
memory persistence and human decisions require their separate service evidence;
type checks and unit tests do not establish them.
