# Database and Agent Engine account setup

Updated 2026-10-11. These are two separate credentials.

| Connection | Credential | Current status |
| --- | --- | --- |
| Application / memory runtime to Atlas | Database user clyffy and its password in MONGODB_URI | User exists with SCRAM and atlasAdmin @ admin. URI saved locally; live connection not verified. |
| Application server to Agent Engine | Project service-account client ID and client secret | No accounts in project inventory. Creation form prepared for vibeguard-service; awaiting final browser approval. |

## Atlas database configuration

Cluster: vibeguard (M10). Host: vibeguard.qyf6cd.mongodb.net. Database: vibeguard. Project: 6acbc84c07e49c5b0f33c510.

The supplied database credentials are saved as MONGODB_URI in these ignored files:
- .env (Python harness)
- vibeguard/.env.local (Next.js / Prisma)
- rrflow/agents/rrflow/.env (local RRFlow agent)

The password is URL-encoded, including its at sign. The saved URI includes /vibeguard, authSource=admin, retryWrites=true and w=majority. The URI itself must not be copied into documentation or logs. Prisma reads MONGODB_URI; there is no separate DATABASE_URL.

Hosted secrets are separate from these files. The Agent Engine project's MONGODB_URI secret still needs verification or updating with the same value. Do not assume a local env edit changes it.

Prisma and @prisma/client 6.19.3 are installed and the client is generated. Prisma schema validation passed with the saved local URI. The bounded Atlas connection check failed during DNS resolution, before database authentication. No successful Atlas write/read is claimed. Details: artifacts/atlas-checkpoint.json.

From the repository root, the existing bounded check is:

~~~powershell
.\.tools\python\python.exe tools\check_atlas.py
~~~

Exit zero requires an authenticated ping, a facts write/read match, and an audit receipt. A timeout is a failure.

## Agent Engine service account

Prepared account: vibeguard-service, project vibeguard, role PROJECT_OWNER, default secret lifetime 90 days. No account has been created at this checkpoint.

The database username/password cannot substitute for the service account credentials. Save the generated client ID and secret in vibeguard/.env.local under MONGODB_AGENTIC_CLIENT_ID and MONGODB_AGENTIC_CLIENT_SECRET. Creation displays the secret once. The application already exchanges these for a token at /api/v1/oauth/token, caches a one-hour token for 59 minutes, and refreshes on the next request. No manually maintained ACCESS_TOKEN is required by the Next client.

A deployed chat also needs MONGODB_AGENTIC_API_URL from its actual deployed workspace and VIBEGUARD_CHAT_BACKEND=agentengine. Those are not configured yet. Keep direct-model mode until the deployed endpoint is identified and verified.

## Completion sequence

1. Create the prepared project service account and save its generated credentials locally.
2. Verify an OAuth token exchange without logging the credentials or token.
3. Verify/update the hosted MONGODB_URI secret, inspect the effective memory configuration, and check memory readiness. Do not upload the root memory config blindly: local candidates differ and may disable extraction.
4. Record and retrieve a test turn through standalone memory with an explicit user_id and session_id. Long-term extraction is asynchronous and requires a separate recall check.
5. Set the real deployed workspace URL, verify a chat reply and then an auditable RRFlow review.

Account setup supports both problem statements by enabling durable memory and human-approved harness changes. Configuration and schema validation alone are not functional proof.

Official references:
- https://www.mongodb.com/docs/agentengine/api-keys-service-accounts/
- https://www.mongodb.com/docs/agentengine/add-features/memory-only/
- https://www.mongodb.com/docs/agentengine/deploy/human-in-the-loop/

## Current hosted memory blocker

The user reported state: failed, blocked_on: orchestration_engine, with a missing project-scoped LLM provider key. The existing OpenAI key is present locally as LLM_API_KEY in rrflow/agents/rrflow/.env, matching rrflow/project-config.yaml. It has not been verified uploaded to the project.

Run from the repository root in the authenticated normal terminal:

~~~powershell
node tools/fix-memory-provider.mjs
~~~

The helper reads only the existing LLM_API_KEY for upload, explicitly selects context hack and project 6acbc84c07e49c5b0f33c510 at project scope, then applies the existing hosted memory configuration and verifies state: ready. It stops on any command failure or timeout. It does not upload a local memory config or redeploy an agent. The --check option validates the local input without network calls. Installed CLI help confirmed the flags; local --check passed. Live execution remains pending because the agent process cannot make outbound connections.

Reference: https://www.mongodb.com/docs/agentengine/cli/agentengine_secret_set/
