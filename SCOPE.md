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
The eval agent is ScriptedAgent: deterministic recorded candidate replay. No live model improvement, financial savings, or model training is demonstrated by this fixture run. Candidate attempts are simulated attempts. The current judge and rule compiler share regex detectors; this is harness validation, not an independent assessment of general model quality. Live chat model calls now work, but they are separate from a measured RSI experiment. Held-out tasks never write rules. Any quoted scores must come from executed runs in the current checkout, not earlier notes.

## Governance
Agents can propose tighter rules. Human approval activates them. Agents cannot loosen or revert rules. A reverted rule remains present with an audit entry. Local prototype actors are labels, not production identity verification. Durable effects in Atlas should carry an authorization decision, a check and an audit receipt.

## RRFlow role and inspiration
Latest user direction: VibeGuard is the chat engine and RRFlow presents human review. Use a service handoff with a real human decision and version-bound receipt. Share Atlas-backed memory and keep authoritative rule transitions separate from extracted/recalled suggestions. Do not copy or depend on the existing Rust engine. Reference rrflow/rrflow-development at cfa0e80: ADR-0002 (adaptive reasoning with governed durable effects), paired eval fixtures and dated results, and bounded provider-neutral context assembly. The specific ADR path has not yet been verified in this checkout.

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

## Active checkpoint

Statement 2's initial resume-the-goal checkpoint is complete for a bounded real example: the hosted service is ready, a scoped turn and semantic fact persist, new-session context retrieves the goal, and a real chat response plus both turns are saved to Atlas. Evidence comes from actual service responses and independent database reads. The additional standalone search rate-limit failure remains separately recorded; this does not establish unlimited throughput, all memory extraction types, or billion-token capacity.

The next acceptance checkpoint is Statement 1's retry-budget example: real failure, proposed harness change, RRFlow human decision, auditable receipt, measured rerun. Do not expand to billion-token scale claims before this cycle works. Chat is currently direct-model mode with hosted standalone memory; a deployed RRFlow review endpoint and the approved improvement cycle remain to be completed.

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
