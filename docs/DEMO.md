# Demo script

Three minutes on stage, plus a one-minute self-serve run. Read every number off the screen: scores come only from runs executed in the current checkout (see [`RESULTS.md`](RESULTS.md)).

## Before you go on (5 minutes)

1. Fresh state: point `VIBEGUARD_WIKI` at an empty folder so Run 1 is a true baseline.
2. Start the judges' view: `uvicorn --factory vibeguard.api:create_app --port 8000`, open http://localhost:8000.
3. Start the operator workbench (other surface) per `python -m vibeguard.web --help`.
4. Pre-type the COSTAR prompt: `make it take payments`.
5. Have the backup video open in a tab in case the network drops.

## The 3-minute pitch

**0:00–0:20 · The problem.**
"Vibecoders pay for every retry. An agent that loops on a paid API, hardcodes a key, or runs `rm -rf` costs them money and hours. Most guardrails police the model. VibeGuard's guardrails protect the user, and it writes its own."

**0:20–0:50 · The loop.**
"Every prompt gets a COSTAR check: if context or audience is missing, it asks at most two plain questions. The agent's output passes a guard of approved rules, then a deterministic judge. When a training task fails, VibeGuard proposes a new rule with provenance. A human approves it. The next run loads it. Agents may tighten their own leash; only humans loosen it."

**0:50–1:50 · Live.**
1. Click **Run evaluation**. Read the baseline held-out score off the KPI tile.
2. Open **Rule queue → Proposed**. Point at the provenance line: which run and task wrote this rule.
3. Click **Approve** as `human:<you>`. Click **Run evaluation** again. The held-out line moves.
4. Approve the next proposal, run again. Say: "Held-out tasks never write rules. They only measure."
5. Paste `make it take payments` into **COSTAR check**. "Two questions, most expensive gap first, and it teaches the engineering term: payment integration, hosted checkout."

**1:50–2:30 · The proof.**
"Here's the curve. Whiskers are Wilson 95% intervals, because six tasks is a small sample and we say so. False blocks: zero, so tightening didn't break good code. And training stops at nine of ten on purpose: a double-click bug can't be caught by a pattern rule, and we don't pretend otherwise."

**2:30–2:50 · Governance and platform.**
Click **Revert** on one rule with a reason. "Reverting loosens the leash, so only a human can do it. Nothing is deleted: the rule stays on the record and the audit log shows who, when and why." Then: "Rules are procedural memory, runs are episodic, the lexicon is semantic, failure categories are taxonomic: Atlas Agent Engine's four memory types."

**2:50–3:00 · Close.**
"Recursive self-improvement with a human-held ratchet: measurable, reversible, and every change on the record."

## Lines for each judge

| Judge | Line |
| --- | --- |
| MongoDB | "Native guardrails are written by hand. Ours are written by failed evals, stored as procedural memory, and gated by a human." |
| Raindrop | "Every failure category is a binary signal. The self-improvement is the held-out curve, measured, not claimed." |
| AWS | "It runs as one small Python service; the judge is deterministic, so a run is reproducible anywhere." |
| Modelence | "The workbench is the product surface: propose, review, approve, re-run, in one loop." |

## Questions you'll get, and honest answers

- **"Is the agent a real model?"** No. Today it's a scripted agent replaying recorded candidates so every run is reproducible. An LLM plugs into the same `attempt()` call; the harness doesn't change.
- **"Doesn't the judge share detectors with the rules?"** Yes. This demo validates the harness mechanics: propose, approve, enforce, measure. Independent judging is the next step.
- **"Does it save money?"** We don't claim a dollar figure. A block costs one retry; it stops shipping a runaway loop, a leaked key or a destructive command.
- **"What did you build before today?"** Research only: the governance framing comes from the author's RRFlow ADR-0002. Every line of code here was written today; see the README's prior-work section.

## One-minute self-serve run (for the submission)

```bash
pip install -e ".[dev,api]"
python -m vibeguard --wiki /tmp/vg demo --approver human:you
uvicorn --factory vibeguard.api:create_app --port 8000   # with VIBEGUARD_WIKI=/tmp/vg
```
