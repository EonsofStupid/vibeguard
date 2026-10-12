# VibeGuard — presentation script (5:44)

Live: https://vibeguard.shippin.ai · Repo: https://github.com/EonsofStupid/vibeguard

## 0:00 — `card-title.png`

VibeGuard. A self-tightening agent harness for vibecoders: people who ship with AI coding tools and pay for every retry, every runaway loop, every leaked key. Most guardrails police the model. These protect the operator's money and time, and the harness writes them itself, from its own failures.

## 0:16 — `card-why.png`

I built this because I care about capturing expertise. Every senior engineer carries practices that never get written down: when to cap a retry, where a key must never live, what done has to prove. Vibecoders pay for that gap in tokens and leaked keys. VibeGuard turns practice into executable rules: a trigger, the exact evidence that earned it, and a plain-language lesson. Subject-matter expertise enters the same way, as questions, labels and categories, versioned in Atlas.

## 0:43 — `card-loop.png`

One loop, five stages. The agent attempts sixteen frozen coding tasks: ten for training, six held out. A deterministic judge scores every attempt. Each failure category on a training task becomes a proposed guardrail rule. A human approves or reverts it, and the next run loads only the approved rules. Held-out tasks are never used to write rules; they only get measured.

## 1:07 — `slide-01-overview.png`

This is the live system on MongoDB Atlas, deployed on Modelence. Run one, no rules: one of six held-out tasks pass. Run two, first rule approved: three of six. Run three: five of six. Run four: six of six, and it stays there. Zero false blocks; the rules never stopped a correct answer. Every point carries a Wilson ninety-five percent interval, because N is small and we say so.

## 1:30 — `slide-02-gate-provenance.png`

This is the human gate. The agent proposed rule one from a runaway fetch loop. The failing attempt, the matched code and the detector are attached to the rule as passive provenance. A human approved it, and that approval is a receipt. The gate is a monotonic ratchet enforced server-side: an agent may propose tightening; it can never approve, revert or loosen. Nothing is ever deleted.

## 1:51 — `card-memory.png`

Memory maps one to one onto the Atlas Agent Engine types. Procedural memory is the versioned rules. Episodic memory is the run traces. Semantic memory is the vibecoder lexicon, embedded with Voyage and retrieved with Atlas Vector Search. Taxonomic memory is the failure categories. All four are mirrored into Agent Engine hosted memory, and build context hands the approved rules back as procedures: seventeen memories for one prompt. The context policy evolves with the rule set.

## 2:21 — `card-teach.png`

The second thing I care about is educating the operator. A vibecoder says: it keeps charging me. The lexicon resolves that to unbounded API usage and rate limiting, with a one-line teaching note. Every failure category carries a plain-language gloss and a SWEBOK knowledge area. Every rule explains itself in plain language before it shows the regex. The COSTAR side-conversation asks what a senior developer would ask, most expensive gap first. The operator leaves each failure knowing the term for it.

## 2:50 — `slide-09-learn.png`

Ask it in your own words: why did it block my retry loop? It answers with the engineering term, rate limiting; the rule it just learned; the failure category; the plain-language reason; and the file in its own codebase where that logic lives. That index is the harness dogfooding itself: sixty-seven exports of its own code, its vocabulary and every rule it learns, embedded with Voyage into Atlas Vector Search. Eighty units became eighty-one the moment VG-0004 was approved. The leash and the lesson are one record.

## 3:19 — `slide-04-costar.png`

Before any money is spent, the COSTAR check scores the prompt on context, objective, style, tone, audience and response. The server emits a form spec: which two questions to ask, in priority order, with quick picks, and the client renders it from that spec. The lexicon resolves make it take payments to payment integration through vector search. Every answer re-scores live and is stored as a capture.

## 3:42 — `card-a2ui.png`

Which brings me to where this goes. Today the harness already generates its interface for one step: the server emits a declarative form spec and the client renders it with its own components. The goal is to extend that to A2UI, the open agent-to-user-interface protocol. The agent sends a component tree; trusted native components render it, with no code execution. Rule-review cards shaped by the evidence. Teaching cards shaped by the operator's gaps. UI specs stored as semantic memory and versioned like rules. Same gate: the agent proposes the interface, the human acts.

## 4:14 — `card-raindrop.png`

Recursive self-improvement needs observability. Every proposed rule goes to Raindrop as an AI event, with the failing attempt as input and the rule as output. Every human approval or revert is a signal on that event. Every run reports its held-out metric and a self-grade. The harness's own improvement becomes a stream you can filter: which proposals got reverted, which runs produced false blocks, how long approvals take.

## 4:39 — `card-feedback.png`

Human feedback is a signal the harness learns from. When a human reverts a rule, held-out accuracy drops, because only a human can loosen the gate. The harness does not re-propose the same broad detector. It proposes a narrower rule built from the exact evidence that failed, marked as derived from the revert, with a softer action. Two reverts in a category silence it.

## 5:01 — `slide-08-narrowed-rule.png`

Here is that loop on the live site. Run seven: VG-0001 reverted, held-out falls to four of six. Run eight: VG-0004, the narrowed rule, approved. The curve shows the cost of the human's choice, honestly.

## 5:14 — `card-rsi.png`

Recursive self-improvement, governed. The harness rewrites its own rule set from its own evals, measures itself on held-out tasks, and commits only through a human. Proposals, verdicts and metrics are instrumented into Raindrop as AI events and signals. Honest limits: the agent is a scripted replay, the judge shares detectors with the rule writer, and the sample is small. What is real is a deployed, governed, measured loop. Agents tighten their own leash; only humans loosen it.
