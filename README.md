# VibeGuard

**An agent harness that learns from failures, measures changes, and remembers the decisions.**

**Live:** https://vibeguard.shippin.ai (= https://vibeguard-mv4df1w6qok-prod.cloud.modelence.app) — deployed on Modelence Cloud, data in MongoDB Atlas, the loop observed and replayed in Raindrop. The deployed build is branch [`live`](https://github.com/EonsofStupid/vibeguard/tree/live); `main` additionally carries the chat panel and the RRFlow review gate (`web/src/server/review/`), not yet deployed.

**Demo video:** `docs/demo/vibeguard-demo.mp4` (55 s screen recording of the live loop) with `docs/demo/vibeguard-demo.srt` captions.

[Demo](https://vibeguard.shippin.ai) · [Walkthrough](docs/DEMO.md) · [Problem statements](docs/FOCUS.md) · [Delivery evidence](SCOPE.md) · [Contributing](CONTRIBUTING.md)

VibeGuard brings a working conversation, MongoDB Atlas memory, measured harness improvements, and RRFlow human review into one workbench. Contextual knowledge drops explain recall cooldowns and approval receipts while the user builds.

Built for the MongoDB Harness Engineering & Model Wrangling hackathon, October 11, 2026. Our two targets are **adaptive harness architecture** and **coherent memory with metric-driven progress toward long-term goals**. A short demo establishes a bounded improvement cycle; billion-token continuity remains an unmeasured scale goal.

## What is live right now (the guardrail loop)

The product is a loop, not a page: `attempt → deterministic judge → propose rule → human gate → next run loads it`. It runs headlessly through the harness API; the web page is the **human gate and the loop's instrumentation**. State lives in MongoDB Atlas as the Agent Engine's four memory types (procedural = versioned rules, episodic = run traces, semantic = vibecoder lexicon with Voyage embeddings + `$vectorSearch`, taxonomic = failure categories) plus an append-only audit log, and is mirrored into Atlas Agent Engine hosted memory, where `build_context()` returns the approved rules as procedures ([docs/RESULTS.md](docs/RESULTS.md)).

Numbers from the deployed loop (2026-10-11, 16 frozen tasks: 10 train / 6 held-out, scripted agent replay, Wilson 95% CI):

| Run | Rules active | Train | Held-out | Held-out CI | False blocks |
| --- | --- | --- | --- | --- | --- |
| run_001 | none | 1/10 | 1/6 | 3%–56% | 0 |
| run_002 | VG-0001 (cost) | 4/10 | 3/6 | 19%–81% | 0 |
| run_003 | + VG-0002 (secrets) | 7/10 | 5/6 | 44%–97% | 0 |
| run_004 | + VG-0003 (destructive) | 9/10 | 6/6 | 61%–100% | 0 |
| run_005 | same | 9/10 | 6/6 | 61%–100% | 0 |

Each rule was proposed by the agent from a *training* failure with passive provenance (the failing attempt, matched snippet, detector) and approved by a human before the next run; held-out tasks are only ever measured. The gate rejects any `agent:` actor that approves, reverts, or proposes `direction: loosen` — server-side, not in the page.

## RRFlow on Raindrop: the harness's own improvement as a first-class loop

The harness instruments itself with the Raindrop SDK (`raindrop-ai`), so its *own* improvement is observable, signalled and replayable — not asserted from a chart. Every emission is also mirrored to Atlas (`raindrop_log`) and the **Self-improvement** panel on the live page is one aggregation over it (`$setWindowFields` for run-over-run deltas, `$lookup` for the human decisions, proposals and Raindrop records of each run).

| Loop step | Raindrop primitive | What it carries |
| --- | --- | --- |
| harness run | `begin()` interaction `harness.run` (eventId = `run_00x`) | a `withTool` span per task (attempt → guard → judge), a `trackTool` judge span per task, the held-out metric as the output |
| training failure | `selfDiagnose` (Self Diagnostics tab) | category = failure category, description = task + the matched evidence |
| proposal | `trackAi` event `rule_proposed` (eventId = `VG-000x`) | input = the failing attempt, output = the rule, code attachments (evidence, trigger) |
| human verdict | `trackSignal` type `feedback` | `rule_approved` POSITIVE / `rule_reverted` NEGATIVE, actor + reason |
| narrowed re-proposal | `trackSignal` type `edit` on the reverted rule | `after` = the new literal trigger (the NEGATIVE signal shaped it) |
| self-grade | `trackSignal` type `agent` on the run | `heldout_improved` / `flat` / `regressed` / `false_block`, delta vs the previous run |
| COSTAR check | `trackAi` event `costar.check` + `selfDiagnose` `missing_context` per gap | what the agent would otherwise have had to guess |
| eval run (needs Query SDK key) | `publishEvalDataset` (16 frozen tasks) · `defineEvalSuite` with local evaluators (deterministic judge, false-block, paid attempts) · `runEvalSuite` · `compareEvalRuns` | the run replayed in Raindrop, graded by the same judge, compared before/after with the previous run |

Keys: `RAINDROP_API_KEY` (write key: traces, events, signals, diagnostics) and `RAINDROP_QUERY_KEY` (Query SDK key: datasets, eval runs, comparisons). Without the second, the page says `evals: needs Query SDK key` and everything else still runs. Raindrop has no read API for events, which is why the Atlas mirror exists — and why the loop's *feedback source* stays the human gate in Atlas, with Raindrop as the review surface.

```bash
U=https://vibeguard.shippin.ai/api/_internal/method
curl -X POST $U/harness.runEvaluation -H 'content-type: application/json' -d '{"args":{}}'                       # proposes VG-0001
curl -X POST $U/harness.approveRule   -H 'content-type: application/json' -d '{"args":{"ruleId":"VG-0001","actor":"human:you"}}'
curl -X POST $U/harness.runEvaluation -H 'content-type: application/json' -d '{"args":{}}'                       # loads VG-0001, held-out climbs
curl -X POST $U/harness.costar        -H 'content-type: application/json' -d '{"args":{"prompt":"make it take payments"}}'  # COSTAR form spec + lexicon recall
```

Honest limits: scripted agent (no live model calls), judge and rule writer share regex detectors (proves governance + held-out generalisation, not detector discovery), small N. Python reference harness: `VIBEGUARD_STORE=atlas python -m vibeguard demo --approver human:you --memory`.

## The improvement example

A real memory-recall request encountered an embedding rate limit. A live model proposed a scoped **60-second recall cooldown**: avoid repeated recall calls during that pause, continue recording turns, explain unavailable recall, and resume afterward. The proposal is evaluated against frozen cases before a human decides whether it becomes active.

| Recorded incident replay | Before | Proposed policy |
| --- | ---: | ---: |
| Training cases passed | 1 / 3 | 3 / 3 |
| Held-out cases passed | 1 / 4 | 4 / 4 |
| Avoidable recall attempts | 8 | 0 |
| Simulated conversation turns recorded | 51 | 51 |
| Regressions / false blocks | — | 0 / 0 |

**These are incident-derived replay results with simulated follow-up timings, not a live throughput or cost-savings measurement.** One successful live model request authored the candidate. Earlier transport and provenance-validation failures remain in the evidence history. Human approval, activation, and a rerun are distinct states in the UI; a good trial cannot approve itself.

[Exact experiment](artifacts/improvement/context-replay-20261011T224404Z.json) · proposal `context-replay-20261011T224404Z-proposal-v1` · policy hash `800fe2e7e50fc730b6c252c758cba7509edf1b0d1e8683cd31418895395b92df`.

The earlier live retry baseline passed all seven cases and generated **no improvement proposal**. Older scripted examples remain labeled fixture demonstrations.

## One path through the product

```mermaid
flowchart LR
    Chat[Chat and relevant knowledge] --> Memory[(Atlas Agent Engine memory)]
    Failure[Observed failure] --> Proposal[Versioned policy proposal]
    Proposal --> Trial[Frozen training and held-out evaluation]
    Trial --> Review[RRFlow human decision]
    Review --> Receipt[(Atlas policy and audit receipt)]
    Receipt --> Chat
    Receipt --> Rerun[Measured rerun]
    Rerun --> Memory
```

- **Modelence** serves the React workbench and server methods.
- **MongoDB Atlas** stores experiment evidence, proposals, active versions, cooldown state, and audit receipts. The application explicitly selects the existing Atlas database for this path.
- **Atlas Agent Engine** hosts conversation memory and the RRFlow review agent. Service-account OAuth connects the application to both services.
- **RRFlow** suspends execution for a real human decision, checks the exact proposal version and hash, and commits the policy with its receipt in a transaction.
- **Approved scope is reusable.** Future chats apply that version automatically. A new boundary requires a new decision; review notes alone cannot alter a policy.

## Verified evidence and limits

Hosted memory has acknowledged real turns and a semantic project-goal fact. That fact was retrieved in a different session, and an actual chat reply and its two turns were independently checked in Atlas. [SCOPE.md](SCOPE.md) records the checkpoint artifacts and remaining work.

The measured cooldown proposal and experiment were written to Atlas and independently read back. RRFlow is deployed and the actual proposal reached its native human-review interrupt. Read current approval and activation state from Atlas; the scores do not establish activation.

The domain serves a Modelence deployment. An uploaded source bundle is a separate deployment from a Git push. A local successful build alone does not verify production chat.

| Memory role | Application records |
| --- | --- |
| Procedural | Versioned rules and approved context policies |
| Episodic | Runs, experiments, and rerun measurements |
| Semantic | Project facts and terminology |
| Taxonomic | Failure categories |
| Audit | Human decisions and execution receipts |

These mappings alone do not prove that every type has been extracted or recalled by the hosted service. Replay measurements do not establish live throughput. Prototype reviewer names label receipts; they are not production identity verification.

## Run the workbench

Node.js 22 and Python 3.11+ are the development baseline. Local hooks and CI setup are in [CONTRIBUTING.md](CONTRIBUTING.md).

```powershell
cd web
npm ci
Copy-Item .env.example .env
# Fill existing Atlas, model and Agent Engine service-account values.
npm run build
cd ..
node tools/start-workbench.mjs
```

The launcher reads `web/.env`, selects an available port, verifies the built page, and prints its URL. Keep the terminal open. `node tools/start-workbench.mjs status` reports that owned workbench; `node tools/start-workbench.mjs stop` or Ctrl+C stops it and its workers. A second launch reuses the running instance. An explicit `--port` remains available. The launcher does not stop manually started servers.

The older Next.js development launcher remains available with `node tools/start-chat.mjs` and has its own ownership record. The Modelence workbench is the main submission UI.

For hosted memory, use the installed Agent Engine CLI. Docker is needed only for the separate local memory stack.

```powershell
.\agentengine.exe version
.\agentengine.exe memory status --context hack --no-log
.\.tools\python\python.exe tools\hosted_memory.py
```

## Deploy the existing Modelence app

```powershell
cd web
npx modelence deploy --app vibeguard-mv4df1w6qok --env prod
```

`web/modelence.config.json` declares build commands and runtime settings. Provide its required secrets in the existing Modelence environment, using the same Atlas and Agent Engine project as the local application. Keep credentials out of source and recordings.

After deployment, verify **App Started**, load the custom domain, send a real chat message, check both memory receipts, and refresh the RRFlow queue. Verify the displayed experiment and active version. A timeout, an HTTP 200 for the page shell, or a Git push does not verify that complete path.

## RRFlow research and original work

The design draws on [rrflow/rrflow-development at `cfa0e8073c1a5479427beb29c7c88ee0a71f2f01`](https://github.com/rrflow/rrflow-development/commit/cfa0e8073c1a5479427beb29c7c88ee0a71f2f01), verified through the public GitHub API and the files at that revision. The Rust engine is not imported.

- [ADR-0002: adaptive reasoning with governed durable effects](https://github.com/rrflow/rrflow-development/blob/cfa0e8073c1a5479427beb29c7c88ee0a71f2f01/docs/decisions/0002-adaptive-reasoning-governed-effects.md) separates adaptive exploration from authorized, checked and receipted durable changes. Drafts have no mutation authority. VibeGuard applies that principle through explicit human activation of an exact tested policy.
- [Context assembly contract](https://github.com/rrflow/rrflow-development/blob/cfa0e8073c1a5479427beb29c7c88ee0a71f2f01/docs/architecture/engine-data-flow.md#context-assembly-contract) defines `POST /v1/context/assemble`: one provider-neutral operation with request budgets, source evidence, a shared read stamp and explicit truncation. This guides VibeGuard's scoped memory and context-policy boundary; it does not establish that VibeGuard implements RRFlow's engine or its scale targets.
- [Paired evaluation prompts](https://github.com/rrflow/rrflow-development/tree/cfa0e8073c1a5479427beb29c7c88ee0a71f2f01/eval/prompts) and the [2026-08-18 result artifact](https://github.com/rrflow/rrflow-development/blob/cfa0e8073c1a5479427beb29c7c88ee0a71f2f01/eval/results/2026-08-18-summary.json) inform the before/after fixture pattern. That prior artifact reports a small controlled sample and explicitly rejects a universal efficiency claim. Its measurements are not VibeGuard results.

VibeGuard's contributions are the experiment/proposal loop, frozen evaluation and promotion checks, Atlas transactions and version-bound receipts, hosted RRFlow review implementation, memory-backed chat, and contextual explanations. The research boundary and claims are documented in [FOCUS.md](docs/FOCUS.md).

## Repository map

| Path | Responsibility |
| --- | --- |
| `web/` | Modelence chat, improvement UI, review integration, Atlas policy enforcement |
| `rrflow/agents/rrflow/` | Hosted review agent and independent decision verifier |
| `src/vibeguard/improvement/` | Experiments, frozen cases, proposal persistence, approved rerun |
| `src/vibeguard/{rules,evals,loop,storage}/` | Reference harness, fixture evaluator, rule gate, stores |
| `src/vibeguard/{memory,context,lexicon,failures,costar}/` | Memory bridge, retrieval, terminology, taxonomy, prompt context |
| `artifacts/` | Credential-free executed evidence, including failures |
| `docs/` | Scope, setup, demo, and architecture records |
| `wiki/` | Original Markdown research records |

Agents should read [AGENTS.md](AGENTS.md), [FOCUS.md](docs/FOCUS.md), and [SCOPE.md](SCOPE.md) before changing the product.
