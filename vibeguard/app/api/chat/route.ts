import { modelChat, readMessages } from "@/lib/model-chat";
import {
  createUIMessageStream,
  createUIMessageStreamResponse,
} from "ai";
import { generateUUID } from "@/lib/utils";
import { getAgentEngineHeaders } from "@/lib/agent-engine-auth";
import { getAgentEngineTarget, isSafeSessionId } from "@/lib/agent-engine-api";
import { SUSPENDED_CHAT_RESPONSE } from "@/lib/session";

export const maxDuration = 60;

type AgentEngineStreamEvent = {
  suspended: boolean;
  failed: boolean;
  text?: string;
};

function parseAgentEngineStreamEvent(raw: string): AgentEngineStreamEvent | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const payload = trimmed.startsWith("data: ") ? trimmed.slice(6) : trimmed;

  try {
    const event: unknown = JSON.parse(payload);
    if (event === null || typeof event !== "object" || Array.isArray(event)) {
      return null;
    }
    const chunk = event as Record<string, unknown>;
    const metadata =
      chunk.metadata !== null &&
      typeof chunk.metadata === "object" &&
      !Array.isArray(chunk.metadata)
        ? (chunk.metadata as Record<string, unknown>)
        : null;
    return {
      failed: chunk.chunk_type === "error" || (chunk.chunk_type === "done" && ["error", "failed"].includes(String(metadata?.status))),
      suspended:
        chunk.chunk_type === "done" && metadata?.status === "suspended",
      ...(chunk.chunk_type === "text" &&
      typeof chunk.content === "string" &&
      chunk.content.length > 0
        ? { text: chunk.content }
        : {}),
    };
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  let body: Record<string, unknown>;

  try {
    body = await request.json();
  } catch {
    return new Response("Invalid request body", { status: 400 });
  }

  const messages = readMessages(body);
  if (!messages) return new Response("Invalid messages or context exceeds 48,000 characters.", { status: 400 });
  const userText = messages.filter(message => message.role === "user").at(-1)?.parts
    .filter(part => part.type === "text").map(part => part.text).join("") || "";
  if (!userText.trim()) return new Response("No message provided", { status: 400 });
  if (process.env.VIBEGUARD_CHAT_BACKEND === "model") return modelChat(messages, request);

  const userId = typeof body.user_id === "string" ? body.user_id : undefined;
  const sessionId =
    typeof body.session_id === "string" && isSafeSessionId(body.session_id)
      ? body.session_id
      : undefined;
  const threadId =
    typeof body.thread_id === "string" && isSafeSessionId(body.thread_id)
      ? body.thread_id
      : undefined;

  let streamUrl: URL;
  let headers: Headers;
  try {
    const target = getAgentEngineTarget(process.env.MONGODB_AGENTIC_API_URL);
    streamUrl = target.streamUrl;
    headers = await getAgentEngineHeaders(target, sessionId);
  } catch (error) {
    return new Response(
      error instanceof Error ? error.message : "Invalid Agent Engine API configuration.",
      { status: 500 }
    );
  }

  let mongoResponse: Response;
  try {
    mongoResponse = await fetch(streamUrl, {
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(45_000)]),
      method: "POST",
      headers,
      body: JSON.stringify({
        message: userText,
        ...(userId && { user_id: userId }),
        ...(sessionId && { session_id: sessionId }),
        ...(threadId && { thread_id: threadId }),
      }),
    });
  } catch {
    return new Response("The Agent Engine connection failed or timed out. No successful reply was received.", { status: 503 });
  }
  if (!mongoResponse.ok || !mongoResponse.body) return new Response("Agent Engine request failed with HTTP " + mongoResponse.status + ".", { status: 502 });

  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      const responseSessionId = mongoResponse.headers.get("X-Session-ID")?.trim();
      if (responseSessionId && isSafeSessionId(responseSessionId)) {
        writer.write({
          type: "data-session",
          data: { session_id: responseSessionId },
          transient: true,
        });
      }

      const reader = mongoResponse.body!.getReader();
      const decoder = new TextDecoder();

      const partId = generateUUID();
      writer.write({ type: "text-start", id: partId });

      let hasContent = false;
      let suspended = false;
      let failed = false;
      let buffer = "";

      const writeEvent = (raw: string) => {
        const event = parseAgentEngineStreamEvent(raw);
        if (!event) return;
        if (event.text) {
          writer.write({ type: "text-delta", delta: event.text, id: partId });
          hasContent = true;
        }
        if (event.suspended) suspended = true;
        if (event.failed) failed = true;
      };

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          const lines = buffer.split("\n");
          buffer = lines.pop()!;

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || !trimmed.startsWith("data: ")) continue;
            writeEvent(trimmed);
          }
        }
      } catch {
        failed = true;
      }

      if (buffer.trim()) writeEvent(buffer);

      if (failed) {
        writer.write({ type: "error", errorText: "The engine stream failed. This response is incomplete." });
      } else if (suspended) {
        writer.write({
          type: "text-delta",
          delta: `${hasContent ? "\n\n" : ""}${SUSPENDED_CHAT_RESPONSE}`,
          id: partId,
        });
      } else if (!hasContent) {
        writer.write({
          type: "error",
          errorText: "The agent did not return a response. Please try again.",
        });
      }

      writer.write({ type: "text-end", id: partId });
      if (suspended) {
        writer.write({ type: "data-suspension", data: {} });
      }
    },
    onError: (error) => {
      console.error("[Stream error]", error);
      return "An error occurred while processing your request.";
    },
  });

  return createUIMessageStreamResponse({ stream });
}
