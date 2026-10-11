# Working examples, then shared memory

## Problem and intended result

VibeGuard protects a builder's time, spend and control: paid API loops, embedded secrets and destructive actions are the first examples. The primary hackathon fit is Statement 1, Recursive Harnessing: failures drive proposed changes to the harness, the human approves, and the next run uses the change. Durable memory and hard metrics support Statement 2; billions of tokens or long-horizon performance are not demonstrated by the current fixture set.

The resource guide requires use of the provided Atlas Hackathon Sandbox, original work, a public GitHub repository, an accessible one-minute on-site demo with audio/video, a concise submission through Cerebral Valley and at most four team members. RRFlow research is cited; its existing Rust engine is not copied. MongoDB starter code is attributed in the generated client README.

Source: https://docs.google.com/document/d/1iMfdEg304T1r25RRRhJW3hDTjjYlSNnEpYj2qXA2CLo/edit

## Ownership

| Component | Responsibility |
| --- | --- |
| VibeGuard chat | Main user entry point, goal capture, candidate responses, failure detection and proposals |
| RRFlow review | Present a concrete proposal, suspend for an actual human, return a decision tied to the proposal version |
| Atlas application records | Authoritative rules, versions, approval decisions and append-only receipts |
| Shared Agent Engine memory service | Conversation context, preferences, run recollections and failure taxonomy; approved-rule context derived from authoritative records |
| Dashboard | Chat plus a linked review queue, memory readiness, and before/after evidence |

Chat messages can suggest preferences and rules; they cannot authorize activation or reversal. A recall result can be stale, so all active rules must be read from the authoritative store and enforced independently of semantic retrieval. An extracted procedural memory is a suggestion until an approval receipt exists. A service account is not a verified human identity.

If the agents share a platform project, use its existing project-scoped memory runtime. External clients can use the standalone Memory SDK with explicit user_id and session_id. Different projects require explicit integration to one chosen memory service; they do not share memory automatically. Do not create a second Atlas cluster or duplicate platform project for this first example.

## 1. Execute the examples now

From normal PowerShell:

~~~powershell
cd D:\localdev\vibeguard
.\.tools\python\python.exe tools/preview_examples.py
.\.tools\python\python.exe -m vibeguard costar "make it take payments"
~~~

The preview uses temporary memory, makes zero model calls and performs zero approvals. It verifies three detected failures, three eligible proposed rules and zero active rules. Its evidence is artifacts/example-first.json. The COSTAR example asks two questions. This is recorded harness validation, not live RSI performance.

Start the current evidence workbench in another terminal:

~~~powershell
cd D:\localdev\vibeguard
powershell -NoProfile -ExecutionPolicy Bypass -File .\run.ps1
~~~

Open http://127.0.0.1:8765. Run frozen eval, inspect the proposal and its training evidence, personally approve ONE rule, then rerun. Check draft t01 before and after the cost rule; it should be blocked only after approval. Do the secret and destructive-action cases next. Restart and confirm approved rules reload. Existing workbench approvals are local prototype identities; this flow is not yet integrated with RRFlow.

In a separate terminal, verify actual app embedding connectivity:

~~~powershell
cd D:\localdev\vibeguard
.\.tools\python\python.exe tools/verify_checkpoint.py
~~~

This command must exit 0 and report HTTP 200, ok embedding metadata and passed=true. HTTP 503, WinError 10013, timeout or a pending request is failure. A separate curl success does not pass the workbench check. The process-scoped execution policy flag above permits this local script only in that PowerShell invocation; it does not change the machine policy.

## 2. Connect the existing engine clients

The generated client is in vibeguard/, not the root Python workbench. Its dependencies are installed. Add the actual invocation URLs to its ignored vibeguard/.env.local:

~~~dotenv
VIBEGUARD_CHAT_API_URL=<VibeGuard invocation URL>
RRFLOW_REVIEW_API_URL=<RRFlow invocation URL>
MONGODB_AGENTIC_CLIENT_ID=<existing project service account ID>
MONGODB_AGENTIC_CLIENT_SECRET=<existing project service account secret>
~~~

For hosted engines, use https://agentengine.mongodb.com/api/v1/projects/PROJECT/workspaces/WORKSPACE/invokeStream. For local engines, use the playground UI port printed by agentengine dev up, including any workspace query parameter. Local URLs do not need the hosted service account fields. Credentials belong in the file, not chat or screenshots.

Run each client in its own PowerShell terminal:

~~~powershell
cd D:\localdev\vibeguard
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\run-dashboard.ps1 -Role Chat
~~~

~~~powershell
cd D:\localdev\vibeguard
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\run-dashboard.ps1 -Role Review
~~~

Chat: http://127.0.0.1:3001/ . RRFlow review: http://127.0.0.1:3002/reviews . Separate build directories allow both clients to run. These are initial workspace clients; launching them alone does not wire VibeGuard proposals to RRFlow, persist rule receipts, or activate rules.

Acceptance: chat receives an actual engine response with session/execution provenance; RRFlow suspends for review; a real decision resumes that execution. Do not call an HTTP-success envelope a completed execution when its status is error or suspended. Preserve both engines' execution and session IDs when linking the review back to the originating VibeGuard conversation.

## 3. Configure and provision shared memory

Browser inspection of project 6acbc84c07e49c5b0f33c510 on Oct 11 shows Memory isn't configured yet. The CLI exists at D:/localdev/vibeguard/agentengine.exe, but its user-profile login state is inaccessible from the agent sandbox. Run these in your normal PowerShell:

~~~powershell
cd D:\localdev\vibeguard
.\agentengine.exe auth status
.\agentengine.exe workspace list --project-id 6acbc84c07e49c5b0f33c510 --org-id 69ef9daf03d2ce35c2657862 --base-url https://agentengine.mongodb.com
.\agentengine.exe memory status --project-id 6acbc84c07e49c5b0f33c510 --org-id 69ef9daf03d2ce35c2657862 --base-url https://agentengine.mongodb.com
~~~

Before configure/apply: confirm this is the engines' target project, provide its database connection through project secrets, and allow its data plane to reach the existing M10. The runtime database user must support the memory service's collections and Search/Vector Search index provisioning. The root application's MONGODB_URI is currently empty.

memory/project-config.yaml is a deployment candidate using the code model that passed the US endpoint probe. The memory runtime's endpoint routing has NOT been verified; do not substitute the documented voyage-4-large default for a key whose verified endpoint only supports voyage-code-4. Confirm supported memory embedding configuration or supply a compatible memory credential before uploading. Keep secrets out of YAML.

Once those prerequisites pass, upload the required project secrets interactively, then configure and apply the prepared file to the EXISTING project:

~~~powershell
cd D:\localdev\vibeguard
.\agentengine.exe secret set MONGODB_URI --project-scope --project-id 6acbc84c07e49c5b0f33c510 --org-id 69ef9daf03d2ce35c2657862 --base-url https://agentengine.mongodb.com
.\agentengine.exe secret set VOYAGE_API_KEY --project-scope --project-id 6acbc84c07e49c5b0f33c510 --org-id 69ef9daf03d2ce35c2657862 --base-url https://agentengine.mongodb.com
.\agentengine.exe memory configure .\memory\project-config.yaml --project-id 6acbc84c07e49c5b0f33c510 --org-id 69ef9daf03d2ce35c2657862 --base-url https://agentengine.mongodb.com
.\agentengine.exe memory apply --wait --project-id 6acbc84c07e49c5b0f33c510 --org-id 69ef9daf03d2ce35c2657862 --base-url https://agentengine.mongodb.com
.\agentengine.exe memory status --project-id 6acbc84c07e49c5b0f33c510 --org-id 69ef9daf03d2ce35c2657862 --base-url https://agentengine.mongodb.com
~~~

Stop after any nonzero command. Success requires state: ready followed by actual memory writes and reads. A waiting stage or context-deadline timeout is not success. Start with direct memory writes, since extraction.enabled=[] in the prepared file. After a verified round trip, configure the deployed extraction provider and its project secret, then enable semantic, episodic and taxonomic extraction. Keep automatic extraction out of the rule activation path.

For native app.memory, enable features.memory in each actual agent.yaml and rebuild/redeploy that manifest change. For an external standalone client, use the published SDK's Memory(service_account_token=..., project_id=...) constructor, bind a server-resolved user identity and session, and refresh expiring tokens. The older pasted guide omits project_id in its hosted constructor; the current SDK reference requires it. Local SDK connections use the OE URL and omit the hosted project ID.

## 4. Prove memory and human control before scale

Use a harmless preference: 'Ask me before exceeding three paid API attempts.' Record a turn, explicitly save/read the preference, restart the client, and recall it in a new session for the same user. Check another user cannot retrieve it. Inspect asynchronous consolidation separately: recorded does not imply available in long-term search.

Then VibeGuard proposes the bounded-retry rule from a training failure. RRFlow presents rule ID/version, originating run/task, training evidence, regressions and false blocks. The human approves or denies. Approval writes the rule transition and receipt atomically, verifies the reviewed version and rejects duplicate/stale decisions. Denial leaves the rule inactive. Revert preserves the rule and appends a reason; an agent cannot revert.

The unified dashboard should show one chat entry point, a review-required link with matching IDs, a return to the originating conversation, actual memory status, active rule version, the decision receipt and before/after metrics. The current independent clients and Python workbench are preparation, not this integrated workflow.

## 5. Live RSI and scaling boundary

Replace recorded candidates with live VibeGuard calls. Keep frozen training and held-out splits, independent correctness checks, all active guards enforced, and explicit attempt/cost budgets. One approved rule per measured cycle. Report pass rate, false blocks, regressions, attempts, latency and actual usage when supplied. Preserve model/config/dataset/rule-version provenance.

Alignment means improvement toward your stated preferences and constraints while useful behavior remains intact. General RSI, model-weight improvement, monetary savings and long-horizon claims need their own evidence. Scale concurrency, background extraction and search after one complete live approve/deny/rerun/restart example works.

## Current validation

34 Python checks passed; one optional FastAPI module is skipped. 64 generated client checks passed. TypeScript checking passed. Three pre-approval examples passed in isolated temporary memory. Launcher configuration was checked for both roles without network calls. Hosted memory has not been provisioned or verified, and no live engine handoff is claimed.

Platform references: [Memory configuration](https://www.mongodb.com/docs/agentengine/add-features/memory/), [Standalone memory](https://www.mongodb.com/docs/agentengine/add-features/memory-only/), [Memory SDK](https://www.mongodb.com/docs/agentengine/sdk/python/packages/agent-engine-sdk-memory/), [Agent-to-agent communication](https://www.mongodb.com/docs/agentengine/add-features/agent-to-agent/).
