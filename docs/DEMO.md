# VibeGuard — one-minute demo

Demo URL: https://vibeguard.shippin.ai/  
Existing Modelence app: `vibeguard-mv4df1w6qok` / `prod`.  
Repository: https://github.com/EonsofStupid/vibeguard

**Current evidence:** a live model proposed a context policy; a frozen incident replay improved. Human approval, activation and the approved-version rerun are still pending. This is progress toward a complete RSI cycle, not a claim that the cycle has finished.

## Before recording

1. Verify the deployed page shows **Make the next attempt better**, chat, and **RRFlow · human review**. The old page with **Reset** and **29 paid attempts** is the recorded-fixture release; a GitHub push alone does not prove the new release is live.
2. Send: **“What is our VibeGuard goal, and what must happen before a proposed policy becomes active?”** Wait for the actual reply. Open its memory receipt and check that both turns were saved. If recall is unavailable, show that state and do not describe it as successful recall.
3. Refresh evidence. Confirm experiment `context-replay-20261011T224404Z` and the status actually displayed. Preserve the existing experiment and receipts; do not reset or approve anything for the sake of the recording.

## Walkthrough

| Time | Show | Say |
| --- | --- | --- |
| 0–10s | Chat reply and saved-turn receipt. | “VibeGuard helps a builder keep their goal and improve how their agent works. Atlas stores the conversation and evidence.” |
| 10–20s | A relevant learning card; the memory-rate-limit example. | “We observed memory retrieval hit a rate limit. A live model proposed pausing repeated retrieval for sixty seconds, within the same user, session and provider.” |
| 20–35s | Before/trial results and evidence details. | “On seven frozen replay scenarios, avoidable retrieval attempts fell from eight to zero. All fifty-one simulated turns stayed recorded. Held-out cases improved from one of four to four of four.” |
| 35–50s | The exact proposal, version and fingerprint in RRFlow review. | “This is a shadow trial. It has not changed the running policy. A human reviews this exact version; the decision needs an Atlas receipt before later chats can use it.” |
| 50–60s | Pending status and source of results. | “This adapts the harness and protects goal continuity. The next proof is an approved-version rerun. We have not demonstrated billion-token scale or live cost savings.” |

If the human chooses to approve during the demo, show the returned receipt and active version. Only describe the cycle as completed after a rerun tied to that same policy fingerprint succeeds. Approval alone is not a measured rerun. If no decision is made, end with the pending status above.

## Evidence and limits

Source: [`context-replay-20261011T224404Z.json`](../artifacts/improvement/context-replay-20261011T224404Z.json).

| Measurement | Baseline | Candidate trial |
| --- | ---: | ---: |
| Training cases passed | 1/3 | 3/3 |
| Held-out cases passed | 1/4 | 4/4 |
| Avoidable retrieval attempts, all cases | 8 | 0 |
| Total simulated retrieval calls | 26 | 18 |
| Simulated turns recorded | 51 | 51 |

The candidate had zero recorded regressions and zero false blocks. The policy fingerprint is `800fe2e7e50fc730b6c252c758cba7509edf1b0d1e8683cd31418895395b92df`.

- **Real:** the [source rate-limit incident](../artifacts/hosted-memory-search-limited.json), one completed model request proposing the policy, and earlier independently verified Atlas chat/memory persistence.
- **Simulated:** follow-up request timing, provider responses, turn writes and replies in this experiment. The real incident recorded one failure and no recovery duration or `Retry-After` value. Sixty seconds is a proposed bounded tradeoff.
- **Provenance:** the initial transport failure and subsequent proposal-validation failure remain in their artifacts. The completed replay reused the model response verbatim after allowing cited training controls alongside failing cases; it made no new model request. Fixtures, behavioral judge and model input were unchanged.
- **Not claimed:** model-weight training, live throughput or money saved, automatic extraction of all memory types, a billion-token session, or active self-improvement before human approval and rerun. The retry-budget baseline passed 3/3 training and 4/4 held-out cases already; it supplied no improvement claim.

## Research and problem statements

**Statement 1 — adaptive harness:** a measured failure produces a proposed, versioned context policy; human review governs activation. **Statement 2 — long-term coherence:** scoped memory, saved turns, goal recall and outcome receipts preserve continuity; rate-limit handling keeps the current conversation usable while long-term recall is unavailable.

The governance design draws on RRFlow's “adaptive reasoning, governed durable effects,” as attributed in the [prior-work section](../README.md#prior-work--rrflow). That section cites [`rrflow/rrflow-development` at `cfa0e80`](https://github.com/rrflow/rrflow-development/tree/cfa0e80) and ADR-0002. The cited ADR file was not independently located in this checkout during this demo-doc update. VibeGuard applies the research; it does not import the Rust engine.

## Submission status

- [ ] Latest combined chat/review UI verified on the custom domain.
- [ ] Real chat reply and saved-turn receipt visible in that deployment.
- [ ] One-minute recording with audio and accurate proposal status.
- [ ] If claiming a completed cycle: human receipt, matching active policy fingerprint and measured rerun attached.
- [ ] Public repository and recording links checked before submission.
