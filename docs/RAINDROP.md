# Raindrop capture

This integration supports Statement 1's measured harness improvements and Statement 2's memory failure signals. Atlas remains authoritative for experiments, policy versions and RRFlow human receipts. Raindrop receives observations and feedback; telemetry never activates a policy.

Set `RAINDROP_WRITE_KEY` in the server environment; optionally set `RAINDROP_PROJECT_ID` to an existing Raindrop project slug. These values are server-only. Without a write key, capture returns `not_configured` and chat continues.

The adapter uses Raindrop's [official HTTP API](https://www.raindrop.ai/docs/sdk/http-api/). Each event or signal gets one three-second attempt. HTTP 204 produces `acknowledged`. The live event endpoint also returned HTTP 200 with `events: [{event_id: ...}]` on October 11, 2026; that response is accepted only when the submitted event ID matches. A bare HTTP 200 or timeout is unconfirmed delivery. An acknowledgement establishes ingest acceptance, not dashboard indexing or quality improvement.

- Live chat events contain the actual model request, completed output, model response ID, user/session scope, Atlas turn IDs, and the active policy hash/version when applicable. Failed model requests are marked as failures.
- Explicit Helpful / Missed goal feedback links only to a recent acknowledged reply in the same server session. It never approves a policy. Server restart expires this prototype's in-memory feedback binding.
- A memory rate limit or approved cooldown produces a named runtime signal. A cooldown signal reports execution of a policy, not measured savings.
- RRFlow proposal snapshots carry exact policy, evidence, proposal ID/version and hash. Human decision feedback is sent only after reading the matching committed Atlas receipt, and only against an acknowledged snapshot event. Approval does not become an unrelated chat thumbs-up.
- `npx tsx tools/capture-raindrop-evidence.ts` explicitly imports the existing replay artifact and its eligibility signal. It makes no new model calls or approvals; simulated metrics remain labeled as historical incident replay.

The current resource guide describes Raindrop monitoring and links its docs. The submission form separately asks whether the project enters the Raindrop RSI Prize. Neither inspected source specifies an additional detailed eligibility contract. Do not claim prize eligibility has been confirmed merely because capture succeeds.
