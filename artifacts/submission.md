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

VibeGuard is an agent harness that turns observed failures into measured changes
to its own behavior. A real memory-recall rate limit motivated a live-model-authored
60-second cooldown policy. Frozen incident-replay cases improved from 1/3 to 3/3
training and 1/4 to 4/4 held-out passes. Avoidable recall attempts fell from 8 to 0,
while all 51 simulated conversation turns were retained, with zero regressions
or false blocks. These are replay measurements, not live throughput claims.

Atlas stores the experiment, exact proposal, active policy and audit trail. A
deployed RRFlow agent checks the version and policy hash and pauses for a human
decision before activation. Future chats apply the approved scope automatically.
The workbench combines actual chat, hosted Agent Engine memory, contextual
terminology and a visible failure → proposal → evaluation → review → activation
→ rerun cycle. The interface exposes the underlying service behavior; the
project's core is the governed adaptive harness.

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

Select **Modelence** (used for the React/TypeScript workbench and deployment).

The available choices are AWS, Elevenlabs, Raindrop, Modelence and Cursor. Atlas
runs on AWS, but that is infrastructure provided through Atlas; do not imply a
separate AWS integration. Do not select Raindrop merely because entering its RSI
prize. No ElevenLabs, Raindrop SDK or Cursor integration is claimed here.

## Are you submitting for the Raindrop RSI Prize?

**Yes** — the intended prize entry is recursive self-improvement of the harness.

The form offers Yes / No. Selecting the prize does not claim use of Raindrop's SDK.

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

Modelence let us keep the React workbench and typed server methods together.
Clearer guidance separating local build success, Git pushes and actual uploaded
deployment state would help time-constrained teams. We kept the working chat and
human review in the main product flow and made deployment verification a separate
checkpoint.

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
experiment tooling and a LangGraph review workflow.

The new work is VibeGuard's measured proposal/promotion loop, incident-replay
evaluation, Atlas policy/receipt boundary, hosted review integration, memory-backed
chat and contextual explanations. RRFlow research is cited as prior work; its
Rust engine is not imported. In particular:

- [ADR-0002](https://github.com/rrflow/rrflow-development/blob/cfa0e8073c1a5479427beb29c7c88ee0a71f2f01/docs/decisions/0002-adaptive-reasoning-governed-effects.md): adaptive reasoning with governed durable effects.
- [Context assembly contract](https://github.com/rrflow/rrflow-development/blob/cfa0e8073c1a5479427beb29c7c88ee0a71f2f01/docs/architecture/engine-data-flow.md#context-assembly-contract): bounded, provider-neutral context with evidence and explicit truncation.
- [Paired evaluation artifact](https://github.com/rrflow/rrflow-development/blob/cfa0e8073c1a5479427beb29c7c88ee0a71f2f01/eval/results/2026-08-18-summary.json): inspiration for comparisons, not VibeGuard measurements.

## Final factual boundary

The proposal demonstrably reached the deployed RRFlow human-review interrupt.
Claim approval, activation and approved-version rerun only when their matching
Atlas receipt and rerun evidence exist. Do not describe an eligible proposal as
already active. The event requires a public repository, accessible demo link,
all actual teammates, Atlas sandbox use for finalists and a clear distinction
between new hackathon work and prior research.

Source: [official participant guide](https://cerebralvalley.ai/e/mongodb-sftw-hackathon/details)
and the actual submission form linked above.
