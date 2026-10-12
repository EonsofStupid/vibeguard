# VibeGuard submission draft

Submission page: https://cerebralvalley.ai/e/mongodb-sftw-hackathon/hackathon/submit

The actual signed-in form was inspected on October 11, 2026. Nothing was entered,
saved or submitted. The event guide lists a 5:00 PM PT deadline.

## Team Name

VibeGuard

## Team Members

The form currently shows Jesse Hall / Jessay. Add any actual teammates before
submission; the event allows at most four members. Do not invent team members.

## Project Description

VibeGuard is an agent harness that learns from observed failures while keeping
humans in control of durable changes. Inspired by RRFlow's adaptive reasoning
and governed effects, it combines a Modelence chat workbench, MongoDB Atlas
records, Atlas Agent Engine memory and a version-bound human review workflow.
Relevant facts and terminology help users learn as they build.

A real memory-recall rate limit motivated a live-model-authored 60-second
cooldown policy. Frozen incident replay improved held-out cases from 1/4 to 4/4
and training from 1/3 to 3/3. Avoidable recall attempts fell from 8 to 0; all 51
simulated conversation turns were retained, with zero regressions or false
blocks. These are replay results, not live throughput measurements. The exact
proposal reached RRFlow's human-review interrupt. Human approval is recorded,
but its corresponding audit receipt is missing, so activation is unverified
and an approved-version rerun is not yet established.

Raindrop accepted the historical replay event and its eligible-for-human-review
signal. Live-chat capture and feedback are integrated in the code; their current
production deployment is still being verified. Atlas remains authoritative for
policy versions and audit receipts. Telemetry and successful evaluations cannot
approve a change. This is a concrete step toward recursive harness improvement
and memory across sessions, not a claim of autonomous or billion-token operation.

## Public GitHub Repository

https://github.com/eonsofstupid/vibeguard

## Demo Video

REQUIRED: paste the accessible public or unlisted video URL after upload.

The form requires a one-minute demo. The event announcement accepts YouTube,
Loom or Google Drive. The video must demonstrate only features built during this
hackathon and clearly distinguish prior research. A local MP4 path is not an
accessible video link. Verify the final link without relying on the uploader's
private access.

## Partner technologies

Select **Modelence** and **Raindrop**.

Modelence provides the React/TypeScript workbench and cloud deployment. Raindrop
is integrated through its official HTTP API. The accepted historical replay
capture and linked eligibility signal are recorded in
[raindrop-capture-checkpoint.json](raindrop-capture-checkpoint.json).

Available choices also include AWS, Elevenlabs and Cursor. No separate AWS,
ElevenLabs or Cursor integration is claimed.

## Are you submitting for the Raindrop RSI Prize?

**Yes** - recursive self-improvement of the agent harness.

The accepted signal means the proposal passed VibeGuard's checks for human
review. It does not establish activation or confirm the organizers' prize
eligibility. Select the prize separately from the Raindrop partner checkbox.

## Raindrop evidence

On October 11 at 23:40 UTC, Raindrop acknowledged the historical replay event
with HTTP 200 and a matching event ID, then its
`incident_replay_eligible_for_human_review` signal with HTTP 204. The capture
links experiment `context-replay-20261011T224404Z`, the source artifact's SHA-256,
the exact proposal and the policy hash. Dashboard indexing was not inspected.
This imports existing simulated replay evidence; it is not a new model run,
human approval or live savings measurement.

Live model input/output capture, reply feedback, memory-limit signals and
receipt-bound review feedback are integrated. Their production deployment and
live capture must be verified before claiming them in the demo.

## MongoDB products and Atlas sandbox usage

We use the hackathon Atlas sandbox's existing M10 cluster for durable application
evidence: immutable experiments, versioned proposals, approved policies, scoped
cooldown state and audit receipts. RRFlow uses an Atlas majority transaction to
bind the exact human-reviewed proposal to its active policy and receipt; stale
versions cannot silently activate. The chat uses Atlas Agent Engine's hosted
memory service, scoped by user and session, with Voyage-backed semantic context.
Real turns and a project-goal fact were stored, retrieved in another session and
independently checked in Atlas. Atlas Agent Engine also hosts the deployed RRFlow
review workflow and its native human interrupt/resume boundary. Service-account
OAuth connects the workbench to those services. We reuse the existing sandbox
cluster rather than substitute an unrelated database.

## Feedback on MongoDB products

Atlas gave us one durable place for experiment evidence, policy versions and
transactional receipts. Hosted memory and the native human-review interrupt were
useful building blocks. Setup would benefit from clearer distinctions between
project-scoped secrets, workspace secrets and database-user credentials, plus
more direct readiness diagnostics when orchestration is waiting on a provider
key. Voyage rate-limit errors also need to remain visible without stopping turn
recording; that observed failure became our improvement example.

## Feedback on partner products

Modelence kept the React workbench and typed server methods together. Clearer
guidance separating local builds, Git pushes and actual uploaded deployment
state would help teams working under a deadline.

Raindrop's event and signal API let us connect replay evidence to a specific
review-eligibility signal. The live event endpoint returned HTTP 200 with a
matching event ID, while signal ingestion returned HTTP 204; documenting both
acknowledgements together would make integration easier. Ingestion success
remains distinct from improvement quality and human approval.

## Problem statement

Select **Recursive Harnessing** as the primary statement. The form accepts one
choice: Recursive Harnessing or Long Horizon Engineering.

The concrete adaptation is a measured change to the context policy around the
agent. Long Horizon Engineering is a secondary fit through persistent goals,
conversation memory, decision receipts and learned policies across sessions.
No billion-token session capacity or prevention of all compaction is claimed.

## Stack and original contribution

Modelence, React, TypeScript, Node.js, MongoDB Atlas M10, Atlas Agent Engine hosted
memory and review runtime, Voyage-backed embeddings, an OpenAI model, Python
experiment tooling, a LangGraph review workflow and Raindrop HTTP event/signal capture.

The new work is VibeGuard's measured proposal/promotion loop, incident-replay
evaluation, Atlas policy/receipt boundary, hosted review integration, memory-backed
chat, contextual explanations and evidence-linked Raindrop capture. RRFlow research is cited as prior work; its
Rust engine is not imported. In particular:

- [ADR-0002](https://github.com/rrflow/rrflow-development/blob/cfa0e8073c1a5479427beb29c7c88ee0a71f2f01/docs/decisions/0002-adaptive-reasoning-governed-effects.md): adaptive reasoning with governed durable effects.
- [Context assembly contract](https://github.com/rrflow/rrflow-development/blob/cfa0e8073c1a5479427beb29c7c88ee0a71f2f01/docs/architecture/engine-data-flow.md#context-assembly-contract): bounded, provider-neutral context with evidence and explicit truncation.
- [Paired evaluation artifact](https://github.com/rrflow/rrflow-development/blob/cfa0e8073c1a5479427beb29c7c88ee0a71f2f01/eval/results/2026-08-18-summary.json): inspiration for comparisons, not VibeGuard measurements.

## Final factual boundary

The proposal demonstrably reached the deployed RRFlow human-review interrupt.
Human approval is recorded, but the corresponding audit receipt is missing.
Activation remains unverified, and an approved-version rerun is not established.
Update that statement only when matching Atlas receipt and rerun evidence exist. Do not describe an eligible proposal as
already active. The event requires a public repository, accessible demo link,
all actual teammates, Atlas sandbox use for finalists and a clear distinction
between new hackathon work and prior research.

Source: [official participant guide](https://cerebralvalley.ai/e/mongodb-sftw-hackathon/details)
and the actual submission form linked above.
