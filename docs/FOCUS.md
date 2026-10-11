# VibeGuard focus — the two problem statements

This is the scope reference for every implementation and demo checkpoint. The user's direction is to build methodically, prove a few complete examples, and keep the interface educational without interrupting the builder.

## Statement 1: a self-improving agent harness

Build a self-improving agent harness that automatically evolves its own architecture: updating rules, context policies, guardrails, tool access and more. Agents should dynamically adapt their environment to a specific user, task or use case.

VibeGuard's application: detect a failure or unmet user preference, propose a versioned harness change, evaluate it against frozen tasks, route durable changes through RRFlow human review, then load the approved version in later attempts. The object being improved is the harness around the agent. Rule text, context selection and tool permissions must affect actual behavior to count as adaptation.

## Statement 2: coherent memory and long-term goals

The highest-value agentic work spans hours, days or weeks. Build a harness that sustains coherent memory across billions of tokens in one session, relentlessly optimizes toward long-term goals, and learns from metric signals to complete traditionally difficult tasks.

VibeGuard's application: keep a durable goal and its constraints, summarize and retrieve bounded context, preserve decisions and outcomes across sessions, and use measured failures to improve the next attempt. The demo proves continuity and a measured improvement cycle. Billion-token capacity remains a scale target until measured; a short example is not evidence of that capacity.

## One product path

VibeGuard chat -> contextual facts and terminology -> proposal or requested action -> policy check -> RRFlow human review when an auditable action requires approval -> version-bound decision and receipt -> execution or approved harness update -> measured rerun -> durable memory.

VibeGuard is the user's entry point. RRFlow is the human review service. Atlas application records are authoritative for active rules, versions and approval receipts. Agent Engine memory provides short-term turns and long-term facts, episodes, procedures and taxonomy. Prisma is an application database client, not a replacement for the hosted memory service.

## RRFlow research applied

Use the research from rrflow/rrflow-development at cfa0e80, without importing its Rust engine:
- ADR-0002: adaptive reasoning, governed durable effects. Every auditable effect carries authorization, a check and a receipt.
- Paired eval fixtures: compare baseline and changed harness on the same frozen tasks; keep held-out cases out of rule writing.
- Bounded context assembly: include the current goal, relevant facts and all applicable active rules within a defined context budget.

Reasoning and proposed improvements may be automatic. A proposed rule has no mutation authority. Human approval activates it; humans alone loosen or revert it. Reversion retains the rule and appends an audit receipt.

## Focused examples

| Example | User experience | Harness / memory proof | Completion evidence |
| --- | --- | --- | --- |
| Recall cooldown (active checkpoint) | A memory rate limit produces a plain-language explanation and one scoped improvement proposal. | A live model proposes a cooldown; frozen incident replays measure its effect; RRFlow review activates the exact version for future chats. | Real failure artifact, 1/3 to 3/3 training and 1/4 to 4/4 held-out replay scores, 8 to 0 avoidable recall calls, human receipt, active-version rerun. Replay timelines and turn writes are simulated. |
| Retry budget | User asks for an API workflow with at most three paid attempts. A small card explains retry budget and why it matters. | A failure produces a bounded-retry rule; human approval changes the next attempt. | Before/after output, training failure, proposal version, human receipt, held-out scores, false blocks and attempt count. |
| Auditable action | User requests a file or persistent-state change. Chat shows the exact scope and routes the concrete proposal to RRFlow. A card explains scope or approval receipt. | Tool access is constrained by the reviewed action and version. Denial does not execute it; approval permits only the reviewed scope. | Matching conversation/execution/action IDs, approve/deny behavior, checked result and receipt. Use a harmless sandbox action first. |
| Resume the goal | In a new session, the user asks to continue the same project. Chat recalls the goal, accepted retry budget and prior decision. | Bounded context uses durable memory plus authoritative active rules. | Saved and retrieved fact, correct user/session scope, restart/new-session recall, provenance and current rule version. |

Complete one example end to end before adding another integration or scale feature.

## Dynamic educational UI

Facts and terminology appear only when relevant to the current request, failure or review. Use small expandable cards alongside chat so learning is optional. A card includes a title, plain-language explanation, why it applies now and provenance. Distinguish a user-stated fact, a model suggestion and an approved rule. Do not present generated guesses as verified facts.

The UI is triggered by structured application events: context gap, classified failure, proposed change, review required, decision received and memory recalled. The model may propose card content; application state determines whether an approval control is available and whether an action is active. A generated card cannot grant tool authority.

## Method and scope control

Before accepting a task, name the statement it advances, the current failure it resolves and the evidence that will show completion. Keep one active acceptance checkpoint. If a request expands the design before that checkpoint passes, record it for later and explain the smaller route to the demo; the user retains the final scope decision.

Current order:
1. Reliable local lifecycle: OS-selected port, one owned instance, bounded startup, explicit status/stop, cleanup after supervisor loss. Distinguish stopping a local server from cancelling a hosted execution.
2. Service readiness: verify installed dependencies, actual chat reply, effective memory runtime/config and one durable write/read. Use the existing Atlas project and cluster.
3. Complete the recall-cooldown example with an actual human review, receipt, active enforcement, and rerun. The earlier live retry baseline was perfect and produced no improvement proposal.
4. Contextual cards, harmless auditable action and resumed-goal example through the same services.
5. Live before/after measurement and a concise demo. Scale after these work.

No checkpoint passes because a command was issued, a process printed Ready, a request timed out or a fixture replay improved. Report actual observed results and remaining blockers.

## Deferred additions

RRF fusion with per-resolver recall@K, additional clickable rule provenance, and a bounded context assembly preview are next candidates after the active improvement cycle passes. CI, canonical domain structure, and clear RSI presentation support this checkpoint. Extra integrations remain outside it.
