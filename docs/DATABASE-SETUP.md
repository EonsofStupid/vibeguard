# Database and Agent Engine account setup

Updated 2026-10-11. These are two separate credentials.

| Connection | Credential | Current status |
| --- | --- | --- |
| Application / memory runtime to Atlas | Database user clyffy and its password in MONGODB_URI | Authenticated ping, majority transaction, fact readback and audit receipt verified. |
| Application server to Agent Engine | Project service-account client ID and client secret | vibeguard-service exists; OAuth HTTP 200, hosted memory ready, and real chat memory write/read are verified. |

## Atlas database configuration

Cluster: vibeguard (M10). Host: vibeguard.qyf6cd.mongodb.net. Project: 6acbc84c07e49c5b0f33c510. Application facts and receipts use database vibeguard. Agent Engine memory uses database mdb_memory_6acbc84c07e49c5b0f33c510 in the same Atlas cluster; these are separate namespaces.

The supplied database credentials are saved as MONGODB_URI in these ignored files:
- .env (Python harness)
- vibeguard/.env.local (Next.js / Prisma)
- rrflow/agents/rrflow/.env (local RRFlow agent)

The password is URL-encoded, including its at sign. The saved URI includes /vibeguard, authSource=admin, retryWrites=true and w=majority. The URI itself must not be copied into documentation or logs. Prisma reads MONGODB_URI; there is no separate DATABASE_URL.

Hosted secrets are separate from these files. The same working URI was uploaded to the Agent Engine project's MONGODB_URI secret, version 2, on 2026-10-11 at 20:52 UTC. A local env edit does not update it.

Prisma and @prisma/client 6.19.3 are installed and generated. Schema validation passed. The fresh unrestricted Python process passed the Atlas round trip. Six project facts are saved in vibeguard.facts and all six plus their transaction receipt were read back. Evidence: artifacts/project-memory.json. Earlier sandbox DNS/socket failures do not describe the current process permissions.

From the repository root, the existing bounded check is:

~~~powershell
.\.tools\python\python.exe tools\check_atlas.py
~~~

Exit zero requires an authenticated ping, a facts write/read match, and an audit receipt. A timeout is a failure.

## Agent Engine service account

Created account: vibeguard-service, project vibeguard, role PROJECT_OWNER. OAuth HTTP 200 and a 3600-second token lifetime were verified; see artifacts/service-account-auth.json.

The database username/password cannot substitute for the service account credentials. The generated client ID and secret are saved in ignored root .env and vibeguard/.env.local under MONGODB_AGENTIC_CLIENT_ID and MONGODB_AGENTIC_CLIENT_SECRET, with a private recovery record in .runtime/agentengine-service-account.json. The application exchanges them for a token at /api/v1/oauth/token and refreshes automatically. No manual ACCESS_TOKEN entry is required.

A deployed agent chat would additionally need MONGODB_AGENTIC_API_URL from its actual workspace and VIBEGUARD_CHAT_BACKEND=agentengine. That is a separate future integration. The current direct-model chat works with the hosted standalone memory service and does not require a deployed agent workspace.

## Verified memory and chat checkpoint

Statement 2, resume-the-goal example, now has real service and database evidence:

- The hosted memory runtime reported ready after the user's configuration changes; hosted Atlas reads and writes succeeded.
- The official Python SDK 0.10.0 acknowledged a scoped turn and semantic goal fact. A new-session read matched that fact, and context retrieval returned its ID and 36 tokens of goal context. The default helper completed successfully at 21:33:12 UTC on 2026-10-11. Evidence: artifacts/hosted-memory-checkpoint.json, passed: true.
- Direct Atlas inspection confirmed the turn and semantic records, including the semantic fact's 1024-dimension voyage-code-4 embedding. Evidence: artifacts/atlas-agent-memory.json.
- The actual /api/chat endpoint returned HTTP 200, recalled the project goal, and emitted saved: true in hosted memory mode. Both the user and assistant turns exist in Atlas under session vibeguard-chat-memory-confirmed; the stored assistant text exactly matches the HTTP response. Evidence: artifacts/chat-memory-checkpoint.json and the chat section of artifacts/atlas-agent-memory.json.

The chat adapter uses server-side VIBEGUARD_MEMORY_MODE=hosted, VIBEGUARD_MEMORY_URL=https://agentengine.mongodb.com, MONGODB_AGENTIC_PROJECT_ID, and VIBEGUARD_MEMORY_USER_ID=vibeguard-operator. It retrieves bounded context and requires acknowledged turn receipts. Token exchange and memory calls remain server-side.

Next, complete the Statement 1 retry-budget example: real failure, proposed harness change, RRFlow human decision, auditable receipt, and measured rerun. A functioning chat and memory round trip do not establish this improvement cycle.

Account setup supports both problem statements by enabling durable memory and human-approved harness changes. Configuration and schema validation alone are not functional proof.

Official references:
- https://www.mongodb.com/docs/agentengine/api-keys-service-accounts/
- https://www.mongodb.com/docs/agentengine/add-features/memory-only/
- https://www.mongodb.com/docs/agentengine/deploy/human-in-the-loop/

## Hosted memory configuration and resolved network failure

The missing LLM key was fixed: LLM_API_KEY and OPENAI_API_KEY were imported at project scope and MONGOMEM_LLM_PROVIDER is openai. The later failed / orchestration_engine state cleared after the user's configuration changes. Successful hosted reads and writes now prove that the memory service reaches Atlas; the final access-list contents have not been independently reread.

The installed official CLI v0.1.119 maps production agentengine.mongodb.com to these exact data-plane entries:

~~~text
44.214.209.237/32
52.44.27.64/32
~~~

These are the production entries identified during diagnosis. CLI setup-ip-access requires a registered workspace, which this memory-only project does not have.

The hosted memory configuration is stored and read back as generation 2: voyage-code-4/1024, OpenAI gpt-5.6-luna using LLM_API_KEY, four extraction types, and a one-minute idle threshold. Evidence: artifacts/hosted-memory-config.json. The service is now ready and its core write/read/context path is verified. Enabling four extraction types does not prove all four are populated; the verified records are short-term turns and an explicitly saved semantic fact. Automatic extraction remains a separate observation.

## Observed rate limit

Rapid consecutive embedding requests triggered a Voyage rate-limit response during an additional search_semantic step. That failure is retained separately in artifacts/hosted-memory-search-limited.json; the default write/read/context helper now passes. An optional --with-search flag exercises the extra search. On the specific recall rate-limit response, chat continues using its current conversation, records both turns, and explicitly reports that long-term recall was unavailable. Other memory failures remain visible. Sustained request-rate reliability is not yet proven; a rate limit does not mean credentials or Atlas persistence failed.

Docker Desktop and its WSL2 Linux engine now work. The local memory fallback was stopped because CLI 0.1.119 generated a local MongoDB URI despite the external-Atlas configuration. No local memory containers or substitute local data were created. Hosted memory remains the active path.

Reference: https://www.mongodb.com/docs/agentengine/cli/agentengine_secret_set/
