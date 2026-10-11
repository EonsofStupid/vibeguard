# VibeGuard delivery scope

Working folder: D:\localdev\vibeguard
GitHub target: https://github.com/eonsofstupid/vibeguard
Integration: MongoDB Atlas only. No Atlassian integration.
Cluster target: one M10 in the provided hackathon sandbox project.

## Outcome
A working harness that learns guardrails from failures, measures their effect, asks a human to activate durable changes, and remembers approved rules across restarts. A clean workbench makes the run → review → approve → rerun flow visible.

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
Current agent is ScriptedAgent: deterministic recorded candidate replay. No live model calls, financial savings, or model training are demonstrated by this fixture run. Candidate attempts are simulated attempts. The current judge and rule compiler share regex detectors; this is harness validation, not an independent assessment of general model quality. Held-out tasks never write rules. Any quoted scores must come from executed runs in the current checkout, not earlier notes.

## Governance
Agents can propose tighter rules. Human approval activates them. Agents cannot loosen or revert rules. A reverted rule remains present with an audit entry. Local prototype actors are labels, not production identity verification. Durable effects in Atlas should carry an authorization decision, a check and an audit receipt.

## RRFlow role and inspiration
Latest user direction: VibeGuard is the chat engine and RRFlow presents human review. Use a service handoff with a real human decision and version-bound receipt. Share Atlas-backed memory and keep authoritative rule transitions separate from extracted/recalled suggestions. Do not copy or depend on the existing Rust engine. Reference rrflow/rrflow-development at cfa0e80: ADR-0002 (adaptive reasoning with governed durable effects), paired eval fixtures and dated results, and bounded provider-neutral context assembly. The specific ADR path has not yet been verified in this checkout.

## Current limits
Windows Python 3.13.9 and native pydantic-core/PyMongo wheels are installed. 34 active checks pass; the optional FastAPI test module is skipped because FastAPI is not installed. dnspython 2.8.0 is installed; SRV support is available in the portable runtime. The M10 is running with MongoDB 8.0.34 in AWS us-west-1 and active backups. Atlas Connect shows the current IP allowed and database user clyffy on vibeguard.qyf6cd.mongodb.net. The completed password-bearing MONGODB_URI still needs to be saved. The workbench is running at http://127.0.0.1:8765 using local .runtime/wiki records. Browser baseline and draft checking were verified, and records survived restart. Voyage is configured in ignored .env. An authenticated embedding request through the approved curl tool returned HTTP 200, voyage-code-4 and a 1024-dimension vector (artifacts/voyage-check.json). The initial selected model was rejected with HTTP 400 and has been corrected. The agent-launched workbench process still has Windows outbound socket restrictions; it is not verified connected. The client distinguishes this permission failure from a timeout. No database ping, Atlas record round trip, live reranking, search index or GitHub publish is claimed. Recorded replay evidence is in artifacts/replay-evidence.json and explicitly marks synthetic human approvals; held-out passes are 1,3,5,6,6 with zero false blocks. Actual workbench rules remain proposed pending a human.

## Active checkpoint

Checkpoint 1 is not passed. The app returns HTTP 503 with WinError 10013 from its outbound socket restriction. The user has been asked to run ./run.ps1 in their own PowerShell; dependent Atlas work remains pending. The new verification command writes artifacts/checkpoint-1.json and exits nonzero for any failure. Voyage status is observed per server process, retained across browser refresh, and reset to untested after restart. The status and client tests pass (14 targeted checks).

## Example-first execution path

See docs/EXAMPLE-FIRST.md for runnable examples, role-specific dashboard launchers and memory configuration/apply commands. Three pre-approval examples pass in temporary memory with zero synthetic approvals and zero active rules. The generated Next.js client dependencies are installed; 70 client checks and TypeScript checks pass. Role clients use ports 3001/3002 with separate build directories; live endpoints and credentials remain unconfigured. Browser inspection of the existing Agent Engine project shows Memory is not configured yet. memory/project-config.yaml is a deployment candidate; database credentials and memory embedding endpoint compatibility must be verified before configure/apply. No hosted memory readiness or live VibeGuard-to-RRFlow handoff is claimed.

## Chat stability checkpoint — current priority

Freeze new integration work until a real chat reply, multi-turn context and refresh restoration are verified. VibeGuard is the chat entry point; RRFlow owns human review; Atlas records own approved rule versions and receipts. Agent Engine memory supplies immediate conversation context and asynchronously extracted long-term knowledge. Turn recording alone does not prove long-term recall, and extracted procedural memories cannot activate rules.

Client failures now use non-success HTTP responses or stream errors, are visible in the UI, and do not automatically retry invocation POSTs. Explicit model chat supports bounded context and browser-local history. TypeScript and 71 client tests pass. A separate model probe returned HTTP 200 and completed; the browser request failed with a connection error. The server is now running on port 3001; page load and refresh return HTTP 200. The actual model request returns HTTP 503 with EACCES. The persistent launcher reuses a healthy instance and never stops it automatically. No working chat, RRFlow handoff, hosted memory readiness or live RSI improvement is claimed. See artifacts/chat-checkpoint.json and the active command in docs/EXAMPLE-FIRST.md.

The user-selected context is hack: organization 6aa1ed66371c6468b4a49ac1, project 6acbc84c07e49c5b0f33c510. This is the Agent Engine CLI context. The Atlas browser organization is separately identified as 69ef9daf03d2ce35c2657862; do not conflate the two service contexts.

Prisma setup is tracked in docs/DATABASE-SETUP.md. Packages remain uninstalled because the package-manager download was denied with EACCES; schema and install command are prepared. No database operation or memory deployment was performed.
