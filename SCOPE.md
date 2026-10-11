# VibeGuard delivery scope

Working folder: D:\localdev\vibeguard
GitHub target: https://github.com/eonsofstupid/vibeguard
Integration: MongoDB Atlas only. No Atlassian integration.
Cluster target: one M10 in the provided hackathon sandbox project.

## Outcome
A working harness that learns guardrails from failures, measures their effect, asks a human to activate durable changes, and remembers approved rules across restarts. A clean workbench makes the run -> review -> approve -> rerun flow visible.

## Delivery checkpoints

| Checkpoint | Work | Evidence required |
| --- | --- | --- |
| 1. App connectivity | Run Voyage from the actual workbench process | tools/verify_checkpoint.py exits 0 with HTTP 200 and a valid embedding result; alternate curl transport is not accepted for this checkpoint |
| 2. Atlas persistence | Database-scoped app user; rules, runs, lexicon, taxonomy and receipts persisted | Authenticated ping, write/read round trip, transactional rule receipt, reload after restart |
| 3. Workbench workflow | Draft review, COSTAR, run, proposal evidence, human approval, rerun, revert | Browser walkthrough against Atlas with accurate loading, empty and error states |
| 4. Relevant memory | Voyage code embeddings and Atlas Vector Search over approved rules and prior failures | Retrieval returns relevant records; active rules remain enforced independently of retrieval |
| 5. Live RSI evidence | Live candidate agent, frozen train/held-out tasks, independent evaluation and human-approved changes | Reproducible before/after results, provenance, regressions and false blocks reported; replay clearly labeled |
| 6. Submission | Public repo, prior-work citation, original contributions, one-minute demo | Public repo and accessible recording; Atlas-backed demo verified |

After each checkpoint, report what is built, what was tested, and outstanding decisions. A requested confirmation is a phase boundary, not a claim that untested work is complete.

## RSI claims
The original eval agent is ScriptedAgent: deterministic recorded candidate replay. Its judge and rule compiler share regex detectors, so those scores explain harness mechanics. The separate live experiment `retry-live-20261011T220933Z` made seven successful model requests and evaluated the resulting plans against frozen simulated tool responses. Its baseline passed 3/3 training and 4/4 held-out cases, with zero false blocks. No proposal was generated, no policy was activated, and no improvement or financial savings are claimed. Held-out tasks never write rules. Any quoted scores must come from executed runs in the current checkout, not earlier notes.

The current improvement candidate is `context-replay-20261011T224404Z`, advancing both statements through memory-recall rate-limit handling. One real model response proposed a 60-second cooldown scoped to user, session and provider. Frozen incident-derived replay improved training from 1/3 to 3/3 and held-out from 1/4 to 4/4; avoidable retrieval attempts fell 8 -> 0 and simulated recorded turns stayed 51 -> 51, with zero regressions or false blocks. Provider responses, follow-up timing, turn writes and replies were simulated. The source incident records one rate-limit failure, not a recovery duration. This is eligible evidence for human review, not activation, live savings or a completed RSI cycle. Policy fingerprint: `800fe2e7e50fc730b6c252c758cba7509edf1b0d1e8683cd31418895395b92df`.

The completed replay preserves the prior failed artifacts. It reuses the completed model response verbatim after fixing a validator to accept training controls alongside failing training cases; fixtures, behavioral judging and model input are unchanged, with zero new model requests for that replay. See `recovery_provenance` in the artifact. Human decision and activation receipt are still null, and the approved-version rerun remains pending.

## Governance
Agents can propose tighter rules. Human approval activates them. Agents cannot loosen or revert rules. A reverted rule remains present with an audit entry. Local prototype actors are labels, not production identity verification. Durable effects in Atlas should carry an authorization decision, a check and an audit receipt.

## RRFlow role and inspiration
Latest user direction: VibeGuard is the chat engine and RRFlow presents human review. Use a service handoff with a real human decision and version-bound receipt. Share Atlas-backed memory and keep authoritative rule transitions separate from extracted/recalled suggestions. Do not copy or depend on the existing Rust engine. Reference rrflow/rrflow-development at cfa0e80: ADR-0002 (adaptive reasoning with governed durable effects), paired eval fixtures and dated results, and bounded provider-neutral context assembly. The ADR and context assembly contract were verified against public commit cfa0e8073c1a5479427beb29c7c88ee0a71f2f01; exact citations and target-contract limits are recorded in docs/ARCHITECTURE.md.

## Current evidence - 2026-10-11

- Atlas direct persistence works: six project-context facts and their majority-transaction audit receipt were written and read back. Database vibeguard contains seven facts including the connectivity probe. Evidence: artifacts/project-memory.json.
- Project service account vibeguard-service exists. Real OAuth HTTP 200 returned a 3600-second token. Official Python memory SDK 0.10.0 is installed. Evidence: artifacts/service-account-auth.json.
- Hosted memory configuration generation 2 was uploaded and read back: explicit Voyage embeddings and OpenAI extraction with four memory types. Evidence: artifacts/hosted-memory-config.json. The hosted runtime now reports ready.
- The working MONGODB_URI is saved locally and uploaded as project secret version 2. LLM_API_KEY and OPENAI_API_KEY are uploaded at project scope; MONGOMEM_LLM_PROVIDER=openai.
- Hosted Agent Engine memory's orchestration_engine failure cleared after the user's configuration changes. The installed CLI identifies production data-plane addresses 44.214.209.237/32 and 52.44.27.64/32. Runtime connectivity is verified; final access-list contents have not been independently reread.
- Actual hosted memory works: a scoped turn and semantic project-goal fact were acknowledged, the fact was read in a new session, and context retrieval returned that goal. The default helper completed with passed: true at 21:33:12 UTC. Direct Atlas inspection confirmed both IDs and the semantic record's voyage-code-4 embedding with 1024 dimensions in mdb_memory_6acbc84c07e49c5b0f33c510. Evidence: artifacts/hosted-memory-checkpoint.json and artifacts/atlas-agent-memory.json. Automatic extraction and population of all four memory types are not yet proven.
- The actual chat recalled the saved goal and returned HTTP 200 with saved: true in hosted mode. Atlas holds both user and assistant turns for vibeguard-chat-memory-confirmed, and the assistant text exactly matches the response. Evidence: artifacts/chat-memory-checkpoint.json and artifacts/atlas-agent-memory.json.
- Rapid embedding requests hit a Voyage rate limit during an additional search_semantic step; that failure is retained in artifacts/hosted-memory-search-limited.json and is separate from the passing default helper. The optional --with-search flag exercises that extra search. For this specific recall rate limit, chat uses current conversation context, still records turns, and explicitly reports unavailable long-term recall. The chat memory example passed; sustained request-rate reliability remains unverified.
- Docker Desktop is installed and the WSL2 Linux engine responds. Local memory startup was stopped before containers or writes because CLI 0.1.119 selected local MongoDB despite external-Atlas configuration.
- The two old restricted Next servers were stopped after process ownership verification. The supervised launcher selected an available port automatically. The actual /api/chat request returned HTTP 200 with a completed model reply. Use node tools/start-chat.mjs status for the current URL; no fixed port is required.
- Prisma 6.19.3 is installed and generated. Standalone memory and Prisma are separate services.
- The deterministic eval replay remains fixture evidence, not live RSI. No rules have been activated by the memory setup.
- The live retry baseline is saved in Atlas `harness_experiments` with an atomic `harness_experiment_recorded` audit receipt and an independent majority read-back. Re-importing the same artifact creates no duplicates. Evidence: `artifacts/improvement/retry-live-20261011T220933Z.json`.
- The Modelence app compiles and builds locally, starts in production mode on an available port, returns HTTP 200, and renders actual Atlas experiment evidence plus contextual learning cards. The copied dependency tree was repaired with `npm ci`; `harness.liveImprovement` is connected. Fixture approval/revert/reset controls are disabled in the updated code, preserving rules and receipts. Chat and RRFlow review are integrated in the combined workbench; their actual deployed behavior is a separate acceptance check.
- The combined Modelence chat now passes a real local production walkthrough for Statement 2: session `chat-3a373e87-186a-40f7-ad67-9a9da974b0ae` recalls the saved Atlas project goal, explains memory recall and provides a next step. An independent majority Atlas read confirms user turn `6acc165420b7a8d67bfc1fb2` and assistant turn `6acc165920b7a8d67bfc1fb3`, correct identity/session scope and full saved text. The assistant text copied from the browser accessibility tree exactly matches Atlas, including whitespace; no HTTP-body comparison is claimed. Evidence: `artifacts/modelence-chat-memory-checkpoint.json` and `artifacts/modelence-real-chat-memory.png`. The browser-observed model response ID is distinguished from the database record; local success does not establish the custom-domain release.
- An earlier Modelence chat attempt failed before the model request on an 8000 ms Atlas TLS connection timeout. Transient evidence reads now have at most two attempts within one 18-second budget; paid model requests and writes are not automatically retried by that wrapper. The rebuilt process passed the subsequent new-session walkthrough above. The earlier timeout remains recorded as a failure in the checkpoint artifact.
- The existing cloud target is Modelence app `vibeguard-mv4df1w6qok`, environment `prod`, at https://vibeguard.shippin.ai/. The custom domain responds, but the last inspected deployment (#6) still served the older recorded-fixture UI. Updating this existing app and verifying the combined chat/review release remains required; a successful GitHub push is not deployment evidence.
- Context-policy trial evidence is in `artifacts/improvement/context-replay-20261011T224404Z.json`. The candidate is eligible for human review. No human approval, policy activation or approved-version rerun is established by that artifact.

## Active checkpoint

Statement 2's initial resume-the-goal checkpoint is complete for a bounded real example: the hosted service is ready, a scoped turn and semantic fact persist, new-session context retrieves the goal, and a real chat response plus both turns are saved to Atlas. Evidence comes from actual service responses and independent database reads. The additional standalone search rate-limit failure remains separately recorded; this does not establish unlimited throughput, all memory extraction types, or billion-token capacity.

The active acceptance checkpoint is the memory-recall cooldown example, advancing Statement 1's adaptive context policy and Statement 2's goal continuity. The real rate-limit incident supplied a failure to address; the retry-budget baseline had no failure and therefore generated no change. The completed candidate trial is ready for a human decision. Finish one path: updated Modelence chat -> relevant memory/learning card -> exact RRFlow proposal review -> version-bound Atlas decision receipt -> approved policy used in later chat -> measured rerun with the same fingerprint. Human approval is still pending; agents must not manufacture it.

Completion evidence must include the custom-domain release, an actual saved chat reply, the human decision and receipt, the active policy fingerprint, and a rerun tied to that version. A controlled replay can demonstrate policy enforcement but must remain labeled as simulated provider behavior; a live chat receipt separately proves service integration. Do not claim billion-token scale, sustained throughput or financial savings from these bounded examples. The recording script is `docs/DEMO.md`.

## Operation

From the repository root:

~~~powershell
node tools/start-chat.mjs
node tools/start-chat.mjs status
node tools/start-chat.mjs stop
.\.tools\python\python.exe tools\hosted_memory.py
~~~

The launcher owns one process tree, chooses an OS-assigned port, and supports explicit status/stop. The memory helper uses saved service-account credentials and explicit user/session scope; extraction into long-term memory is asynchronous.

The CLI context hack uses Agent Engine organization 6aa1ed66371c6468b4a49ac1 and project 6acbc84c07e49c5b0f33c510. Atlas organization 69ef9daf03d2ce35c2657862 is a separate service context. See docs/DATABASE-SETUP.md and docs/HOSTED-MEMORY-CLIENT.md for current configuration. Never treat a timeout, attempted apply, or Memory ON badge as readiness.
