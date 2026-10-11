# VibeGuard — 1-minute demo (live app)

URL: https://vibeguard-mv4df1w6qok-prod.cloud.modelence.app
Record on the live page with audio. Before recording: press **Reset** → **Confirm reset** → **Seed memory**, so the curve is built on camera.

| Time | Do | Say |
| --- | --- | --- |
| 0–8s | Page open, empty chart. | "VibeGuard is a harness that learns its own guardrails. The twist: the guardrails protect the *vibecoder's* money and time, and only a human can loosen them." |
| 8–20s | Click **Run evaluation**. Point at the first dot (1/6) and the amber **VG-0001** in the rule queue. | "The agent attempts 16 coding tasks. A deterministic judge scores them. One failure category — unbounded paid API calls — becomes a *proposed* rule. Nothing is enforced yet." |
| 20–30s | Click **Approve**. Point at the receipt. | "I approve it. That's the only way a rule goes live: agents propose, humans approve. Every transition writes a receipt. Nothing is ever deleted — a revert keeps the rule and the record." |
| 30–45s | **Run evaluation** → Approve → **Run evaluation** → Approve → **Run evaluation**. Point at the curve climbing with the CI whiskers. | "Each run loads the approved rules. Held-out pass rate goes 1 of 6 → 3 → 5 → 6 of 6, with Wilson intervals because N is small. Zero false blocks — the rules never stopped a correct answer." |
| 45–55s | Point at **Memory types**; paste a prompt in COSTAR, click **Check prompt**. | "Everything lives in MongoDB Atlas as the Agent Engine's four memory types: procedural rules, episodic runs, semantic lexicon with Voyage embeddings and `$vectorSearch`, taxonomic failure categories. The COSTAR check decides at runtime which two questions to ask a vibecoder before any money is spent." |
| 55–60s | Scroll to the footer. | "Limits are on the page: scripted agent, shared detectors, small N. What's real: a deployed, governed, measured self-improving loop. Agents tighten their own leash; only humans loosen it." |

## Judge lines (have ready)

- **Recursive harnessing:** the harness rewrites its own rule set from eval failures; the rule set is versioned, gated and reloaded on the next run. The context the agent sees also grows: `build_context()` on Agent Engine memory selects more procedural/episodic memories as rules are approved (`context_memories` per run).
- **Hard metric signal:** held-out pass rate with 95% Wilson CI, never training tasks; promotion requires train improvement, no held-out regression, zero false blocks.
- **Governance:** monotonic ratchet — `direction: loosen` and `revert` are rejected for any `agent:` actor; receipts are append-only.
- **MongoDB:** Atlas collections per memory type, transactions for rule+receipt, Atlas Vector Search on Voyage `voyage-code-4` 1024-d, Agent Engine hosted memory via the service-account SDK.
- **RSI (Raindrop):** the improvement signal comes from the harness's own evals; the loop proposes, measures and (with a human) commits. No model weights change — the *harness* does.

## Q&A

- *Why not an LLM judge?* Reproducibility. Every number re-runs identically; an LLM agent plugs into `attempt()` and the judge stays the same.
- *Isn't the detector the rule?* Yes — stated on the page. The loop proves governance + generalisation to held-out tasks, not detector discovery. Next: rules proposed from judge *explanations*, scored the same way.
- *Why Modelence?* TypeScript + React + MongoDB in one deploy; the harness module is 10 files; Cloud builds from source and injects the Atlas URI.
- *What's the vibecoder angle?* The lexicon maps "make it take payments" → `payment-integration`; COSTAR asks at most two plain questions, most expensive gap first; rules speak in money/time, not CVEs.

## Submission checklist

- [x] Public repo: https://github.com/EonsofStupid/vibeguard
- [x] Deployed URL (above), MongoDB Atlas data
- [ ] 1-minute video with audio (record off the live page)
- [ ] Short description (use the README's first two paragraphs)
