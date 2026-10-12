# VibeGuard — presentation script

Live: https://vibeguard.shippin.ai · Repo: https://github.com/EonsofStupid/vibeguard

## 0:00 — `card-title.png`

VibeGuard. A self-tightening agent harness for vibecoders — people who ship with AI coding tools and pay for every retry, every runaway loop, every leaked key. Most guardrails police the model. These guardrails protect the user's money and time. And they are written by the harness itself, from its own failures.

## 0:18 — `card-loop.png`

The loop has five stages. The agent attempts sixteen frozen coding tasks, ten for training and six held out. A deterministic judge scores every attempt. Each failure category on a training task becomes a proposed guardrail rule. A human approves or reverts it. The next run loads only the approved rules. Held-out tasks are never used to write rules; they only get measured.

## 0:43 — `slide-01-overview.png`

This is the live system on MongoDB Atlas, deployed on Modelence. Run one, with no rules: one of six held-out tasks pass. Run two, with the first rule approved: three of six. Run three: five of six. Run four: six of six, and it stays there. Zero false blocks — the rules never stopped a correct answer. Every point carries a Wilson ninety-five percent interval, because N is small and we say so.

## 1:10 — `slide-02-gate-provenance.png`

This is the human gate. The agent proposed rule one from a runaway fetch loop: the exact failing attempt, the matched code, and the detector are attached to the rule as passive provenance. A human approved it; that approval is a receipt. The gate is a monotonic ratchet enforced server-side: an agent actor may propose tightening, but it can never approve, revert, or loosen. Nothing is ever deleted.

## 1:35 — `card-memory.png`

Memory maps one to one onto the Atlas Agent Engine types. Procedural memory is the versioned rules. Episodic memory is the run traces. Semantic memory is the vibecoder lexicon, embedded with Voyage and retrieved with Atlas Vector Search. Taxonomic memory is the failure categories. The loop mirrors all four into Agent Engine hosted memory, and build context hands the approved rules back as procedures: seventeen memories for one prompt. That is the context policy evolving with the rule set.

## 2:09 — `slide-03-traces.png`

Every run is episodic memory with per-task traces: which rule blocked which attempt, how many attempts were paid for, and whether a block was ever false. This is what makes the improvement auditable rather than claimed.

## 2:22 — `slide-04-costar.png`

Before any money is spent, the COSTAR check scores the prompt on context, objective, style, tone, audience and response, and emits a form: which two questions to ask, most expensive gap first. The lexicon resolves make it take payments to payment integration through vector search, with a teaching line for the builder. Every answer re-scores live.

## 2:45 — `card-raindrop.png`

Recursive self-improvement needs observability. Every proposed rule is sent to Raindrop as an AI event, with the failing attempt as input and the rule as output. Every human approval or revert is a signal on that event. Every run reports its held-out metric. So the harness's own improvement is a stream you can filter: which proposals got reverted, which runs produced false blocks, how long approvals take.

## 3:10 — `card-feedback.png`

Human feedback is a signal the harness learns from. When a human reverts a rule, held-out accuracy drops, because the gate loosened only by human action. The harness does not re-propose the same broad detector. It proposes a narrower rule built from the exact evidence that failed, marked as derived from the revert, with a softer action. Approved, the trade-off is visible: narrower, less general, zero false blocks. Two reverts in a category silence it.

## 3:40 — `slide-08-narrowed-rule.png`

Here is that loop on the live site. Run seven: VG-0001 reverted, held-out falls to four of six. Run eight: VG-0004, the narrowed rule, approved. The curve shows the cost of the human's choice, honestly.

## 3:55 — `card-dogfood.png`

The harness also indexes itself. Sixty-seven documented exports of its own code, tagged with SWEBOK knowledge areas, embedded with Voyage into Atlas Vector Search, together with its vocabulary and every rule it learns. Eighty units became eighty-one the moment VG-0004 was approved. The leash and the lesson are one record.

## 4:15 — `slide-09-learn.png`

Ask it in your own words: why did it block my retry loop? It answers with the engineering term, rate limiting, the rule it just learned, the failure category, the plain-language reason, and the file in its own codebase where that logic lives. Terminology taught at the moment it bites.

## 4:33 — `card-rsi.png`

Recursive self-improvement, governed. The harness rewrites its own rule set from its own evals, measures itself on held-out tasks, and commits only through a human. Proposals, verdicts and metrics are instrumented into Raindrop as AI events and signals. Honest limits: the agent is a scripted replay, the judge shares detectors with the rule writer, and the sample is small. What is real is a deployed, governed, measured loop. Agents tighten their own leash; only humans loosen it.

