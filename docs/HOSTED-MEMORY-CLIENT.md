# Hosted memory client

Statement 2, **resume the goal**: retain the VibeGuard project goal and retrieve it
under the same user in a new session. Rule activation remains a separate human
decision.

The `vibeguard-service` Agent Engine service account is created in project
`6acbc84c07e49c5b0f33c510` with `PROJECT_OWNER`, the role required for the future
human-review resume endpoint. Its one-time credentials are saved in the ignored
`.runtime/agentengine-service-account.json`; the chat also has the client ID and
secret in its ignored `.env.local`. This is separate from the Atlas database user.

The portable Python environment contains `agent-engine-sdk-memory==0.10.0`.
The helper exchanges the saved credentials for a fresh one-hour access token
without printing or persisting the token:

```powershell
.\.tools\python\python.exe tools/hosted_memory.py --auth-only
```

The hosted runtime is ready. Execute the real memory example:

```powershell
.\.tools\python\python.exe tools/hosted_memory.py
```

It records an idempotent user turn, upserts one semantic project-goal fact,
reads that fact under the same user in a new session, and retrieves it through
bounded context. It writes credential-free
evidence to `artifacts/hosted-memory-checkpoint.json` and exits nonzero on failure.
An OAuth success alone does not establish memory readiness or database access.
The actual semantic write, cross-session read and context recall were verified.
The chat also recalled the fact and persisted its user and assistant turns;
see artifacts/chat-memory-checkpoint.json and artifacts/atlas-agent-memory.json.
This does not claim automatic background extraction has completed.

Chat memory is enabled through VIBEGUARD_MEMORY_MODE=hosted with the existing
project ID and service account. Rapid embedding requests can be rate limited.
On that specific failure, chat continues using its current conversation and
still records turns; the UI explicitly says long-term recall was unavailable.
Other memory failures remain visible errors. An optional separate search check
is available with --with-search; its observed rate-limit failure is retained in
artifacts/hosted-memory-search-limited.json.

Application use:

```python
from tools.hosted_memory import HostedMemory

with HostedMemory() as hosted:
    chat = hosted.bind(user_id="vibeguard-operator", session_id="example-session")
    chat.record_turn(role="user", content="Keep the retry budget at three attempts.")
    context = chat.build_context(query="What retry budget applies?", max_tokens=2048)
```

Each `HostedMemory` instance is intended for a short operation or request; it gets
a fresh token when constructed. Do not retain an instance beyond the token's
one-hour lifetime. The helper passes `project_id` explicitly because SDK 0.10.0
uses its presence to choose the hosted routes. `Memory.bind` supplies explicit
user/session scope. Extraction runs asynchronously after turns are recorded.

Sources: [Service accounts](https://www.mongodb.com/docs/agentengine/api-keys-service-accounts/),
[Standalone memory](https://www.mongodb.com/docs/agentengine/add-features/memory-only/),
and the installed 0.10.0 SDK constructor and method signatures.
