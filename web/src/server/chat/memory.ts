import { getAgentMemoryHeaders } from "./auth";

// Wire contract verified against agent-engine-sdk-memory/_http_runtime.py.
// Acknowledged STM writes do not imply that background long-term extraction finished.
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_RESPONSE_BYTES = 512_000;
const MAX_CONTEXT_CHARACTERS = 12_000;
const CONTEXT_TOKEN_BUDGET = 2_000;
const HOSTED_ORIGIN = "https://agentengine.mongodb.com";

export type AgentMemoryMode = "hosted" | "local";

type MemoryConfiguration = {
  mode: AgentMemoryMode;
  origin: string;
  prefix: string;
  userId: string;
};

type MemoryRequest = { sessionId: string; signal?: AbortSignal };

export type MemoryTurnReceipt = {
  id: string;
  sessionId: string;
  turnSequence: number;
  acknowledged: true;
};

export type RecalledMemory = {
  id: string;
  content: string;
  source: string;
  timestamp?: string;
};

export type MemoryContext = {
  formattedContext: string;
  metadata: {
    token_count: number;
    memory_counts: Record<string, number>;
    source_outcomes?: { source: string; count: number; failed: boolean }[];
  };
  selectedMemories: RecalledMemory[];
  truncated: boolean;
};

export class AgentMemoryError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "AgentMemoryError";
  }
}

export function getAgentMemoryMode(): AgentMemoryMode | null {
  const mode = process.env.VIBEGUARD_MEMORY_MODE?.trim();
  if (!mode) return null;
  if (mode !== "hosted" && mode !== "local") {
    throw new AgentMemoryError("VIBEGUARD_MEMORY_MODE must be hosted or local, or unset to disable memory.");
  }
  return mode;
}

function identifier(value: string, label: string): string {
  if (!value || value.length > 256 || value !== value.trim() || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new AgentMemoryError(`${label} must be a nonempty identifier of at most 256 characters.`);
  }
  return value;
}

function configuration(): MemoryConfiguration | null {
  const mode = getAgentMemoryMode();
  if (!mode) return null;
  const configuredUrl = process.env.VIBEGUARD_MEMORY_URL?.trim() || (mode === "hosted" ? HOSTED_ORIGIN : "");
  let url: URL;
  try {
    url = new URL(configuredUrl);
  } catch {
    throw new AgentMemoryError("VIBEGUARD_MEMORY_URL must contain the memory service origin.");
  }
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new AgentMemoryError("VIBEGUARD_MEMORY_URL must be an origin without credentials, path, query or fragment.");
  }
  if (mode === "hosted" && url.origin !== HOSTED_ORIGIN) {
    throw new AgentMemoryError("Hosted memory must use https://agentengine.mongodb.com.");
  }
  if (mode === "local" && (
    !["http:", "https:"].includes(url.protocol) ||
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
  )) {
    throw new AgentMemoryError("Local memory must use the loopback OE URL printed by agentengine dev up.");
  }
  const projectId = process.env.MONGODB_AGENTIC_PROJECT_ID?.trim();
  if (mode === "hosted" && (!projectId || !/^[a-fA-F0-9]{24}$/.test(projectId))) {
    throw new AgentMemoryError("Hosted memory requires MONGODB_AGENTIC_PROJECT_ID as the 24-character project ID.");
  }
  return {
    mode,
    origin: url.origin,
    // Explicit local mode deliberately ignores the hosted project variable.
    prefix: mode === "hosted" ? `/api/v1/projects/${projectId}/memory` : "/api/v1/memory",
    userId: identifier(process.env.VIBEGUARD_MEMORY_USER_ID?.trim() || "vibeguard-operator", "Memory operator ID"),
  };
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function readResponse(response: Response): Promise<Record<string, unknown>> {
  if (!response.body) throw new AgentMemoryError("Memory returned an empty response.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new AgentMemoryError("Memory response exceeded the bounded response size.");
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } finally {
    reader.releaseLock();
  }
  let parsed: unknown;
  try { parsed = JSON.parse(text); }
  catch { throw new AgentMemoryError("Memory returned an invalid JSON response."); }
  if (!object(parsed)) throw new AgentMemoryError("Memory returned an invalid response shape.");
  return parsed;
}

async function requestMemory(
  config: MemoryConfiguration,
  operation: "turns" | "context",
  body: Record<string, unknown>,
  callerSignal?: AbortSignal
): Promise<Record<string, unknown>> {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const signal = callerSignal ? AbortSignal.any([callerSignal, timeout]) : timeout;
  try {
    signal.throwIfAborted();
    let headers: Headers;
    try {
      headers = await getAgentMemoryHeaders(config.mode, config.origin);
    } catch (error) {
      const safeStatus = error instanceof Error ? /HTTP (\d{3})\./.exec(error.message)?.[1] : undefined;
      throw new AgentMemoryError(safeStatus
        ? `Memory service-account authentication failed with HTTP ${safeStatus}.`
        : "Memory service-account authentication could not complete. Verify the saved Agent Engine client ID and secret.");
    }
    const response = await fetch(`${config.origin}${config.prefix}/${operation}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal,
      cache: "no-store",
      redirect: "error",
    });
    if (!response.ok) {
      const problem = await readResponse(response).catch(() => null);
      const message = problem?.error || problem?.message || problem?.detail;
      if (response.status === 429 || (typeof message === "string" && /embedding.*rate limit/i.test(message))) {
        throw new AgentMemoryError("Memory embedding service is rate limited; semantic recall is temporarily unavailable.", 429);
      }
      const hint = [404, 502, 503].includes(response.status)
        ? " Check that the memory runtime is ready and the selected mode matches its URL."
        : [401, 403].includes(response.status)
          ? " Check the service account's project and access."
          : "";
      throw new AgentMemoryError(`Memory ${operation} request failed with HTTP ${response.status}.${hint}`, response.status);
    }
    return await readResponse(response);
  } catch (error) {
    if (callerSignal?.aborted) throw new AgentMemoryError("Memory request was cancelled; a pending write may already have been accepted.");
    if (timeout.aborted) throw new AgentMemoryError("Memory request timed out; no successful result was confirmed.");
    if (error instanceof AgentMemoryError) throw error;
    throw new AgentMemoryError("Memory connection failed; no successful result was confirmed.");
  }
}

export async function recordMemoryTurn(input: MemoryRequest & {
  role: "user" | "assistant";
  content: string;
  idempotencyKey: string;
  metadata?: Record<string, string | number | boolean | null>;
}): Promise<MemoryTurnReceipt | null> {
  const config = configuration();
  if (!config) return null;
  const sessionId = identifier(input.sessionId, "Memory session ID");
  const idempotencyKey = identifier(input.idempotencyKey, "Memory idempotency key");
  if (!["user", "assistant"].includes(input.role) || !input.content.trim() || input.content.length > 48_000) {
    throw new AgentMemoryError("Memory turn must contain a user or assistant message of at most 48000 characters.");
  }
  if (input.metadata && JSON.stringify(input.metadata).length > 4_000) {
    throw new AgentMemoryError("Memory turn metadata exceeds the bounded size.");
  }
  const result = await requestMemory(config, "turns", {
    session_id: sessionId,
    user_id: config.userId,
    role: input.role,
    content: input.content,
    idempotency_key: idempotencyKey,
    metadata: { ...input.metadata, source: "vibeguard-modelence-chat" },
  }, input.signal);
  if (result.acknowledged !== true || typeof result.id !== "string" || !result.id ||
      result.session_id !== sessionId || typeof result.turn_seq !== "number" ||
      !Number.isInteger(result.turn_seq) || result.turn_seq < 0) {
    throw new AgentMemoryError("Memory did not return a valid acknowledged turn receipt.");
  }
  return { id: result.id, sessionId, turnSequence: result.turn_seq, acknowledged: true };
}

export async function buildMemoryContext(input: MemoryRequest & {
  query: string;
}): Promise<MemoryContext | null> {
  const config = configuration();
  if (!config) return null;
  const sessionId = identifier(input.sessionId, "Memory session ID");
  if (!input.query.trim() || input.query.length > 48_000) {
    throw new AgentMemoryError("Memory query must contain at most 48000 characters.");
  }
  const result = await requestMemory(config, "context", {
    query: input.query,
    session_id: sessionId,
    user_id: config.userId,
    enabled_sources: ["stm", "semantic", "episodic"],
    max_tokens: CONTEXT_TOKEN_BUDGET,
    top_k: 10,
    format_style: "jinja2",
    include_memories: true,
  }, input.signal);
  if (typeof result.formatted_context !== "string" || !object(result.metadata)) {
    throw new AgentMemoryError("Memory did not return formatted text and context metadata.");
  }
  const meta = result.metadata;
  const memoryCounts: Record<string, number> = {};
  if (object(meta.memory_counts)) {
    for (const source of ["stm", "semantic", "episodic"]) {
      const count = meta.memory_counts[source];
      if (typeof count === "number" && Number.isInteger(count) && count >= 0) memoryCounts[source] = count;
    }
  }
  const selectedMemories: RecalledMemory[] = [];
  if (Array.isArray(result.selected_memories)) {
    for (const memory of result.selected_memories.slice(0, 30)) {
      if (object(memory) && typeof memory.id === "string" && typeof memory.content === "string" &&
          typeof memory.source === "string" && ["stm", "semantic", "episodic"].includes(memory.source)) {
        selectedMemories.push({
          id: memory.id.slice(0, 256), content: memory.content.slice(0, 1_600), source: memory.source,
          ...(typeof memory.timestamp === "string" ? { timestamp: memory.timestamp.slice(0, 64) } : {}),
        });
      }
    }
  }
  const sourceOutcomes = Array.isArray(meta.source_outcomes)
    ? meta.source_outcomes.filter(object).slice(0, 10).map(outcome => ({
      source: typeof outcome.source === "string" ? outcome.source.slice(0, 64) : "unknown",
      count: typeof outcome.count === "number" && Number.isInteger(outcome.count) && outcome.count >= 0 ? outcome.count : 0,
      failed: outcome.error != null,
    })) : undefined;
  return {
    formattedContext: result.formatted_context.slice(0, MAX_CONTEXT_CHARACTERS),
    metadata: {
      token_count: typeof meta.token_count === "number" && Number.isInteger(meta.token_count) && meta.token_count >= 0
        ? meta.token_count : 0,
      memory_counts: memoryCounts,
      ...(sourceOutcomes ? { source_outcomes: sourceOutcomes } : {}),
    },
    selectedMemories,
    truncated: result.formatted_context.length > MAX_CONTEXT_CHARACTERS,
  };
}
