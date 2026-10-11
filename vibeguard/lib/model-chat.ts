import "server-only";
import { createUIMessageStream, createUIMessageStreamResponse } from "ai";
import { generateUUID } from "@/lib/utils";

export type TextMessage = { role: "user" | "assistant"; parts: { type: string; text?: string }[] };

export function readMessages(body: unknown): TextMessage[] | null {
  if (!body || typeof body !== "object" || !("messages" in body) || !Array.isArray(body.messages) || !body.messages.length || body.messages.length > 32) return null;
  let size = 0;
  for (const message of body.messages) {
    if (!message || typeof message !== "object" || !["user", "assistant"].includes(message.role) || !Array.isArray(message.parts)) return null;
    for (const part of message.parts) {
      if (!part || typeof part !== "object" || typeof part.type !== "string") return null;
      if (part.type === "text") {
        if (typeof part.text !== "string") return null;
        size += part.text.length;
      }
    }
  }
  return size <= 48_000 ? body.messages : null;
}

export async function modelChat(messages: TextMessage[], request: Request): Promise<Response> {
  const key = process.env.VIBEGUARD_MODEL_API_KEY;
  if (!key) return new Response("The live model key is not configured.", { status: 503 });
  let response: Response;
  try {
    response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(45_000)]),
      body: JSON.stringify({
        model: process.env.VIBEGUARD_MODEL || "gpt-5.6-luna",
        max_output_tokens: 2048,
        instructions: "You are VibeGuard, a practical coding collaborator. Help the user build and test working examples. Apply RRFlow's governed-effects principle: reasoning and proposals can adapt, but durable changes require a real authorization decision, a check and a receipt. Respect the user's stated time, spend and retry budgets. Use bounded retries, environment-based secrets and scoped destructive actions. Ask at most two concrete questions when context is missing. You currently have chat only, with no execution or memory tools. Never claim to have run code, changed files, approved a rule, deployed an engine or saved durable memory. Distinguish a proposed improvement from an approved active rule. Be concise and concrete.",
        input: messages.map(message => ({ role: message.role,
          content: message.parts.filter(part => part.type === "text").map(part => part.text || "").join("") })),
      }),
    });
  } catch (error) {
    const cause = error instanceof Error ? error.cause as { code?: string; syscall?: string } | undefined : undefined;
    console.error("Model connection failed", { name: error instanceof Error ? error.name : "UnknownError", code: cause?.code, syscall: cause?.syscall });
    if (cause?.code === "EACCES" || cause?.code === "EPERM") {
      return new Response("This server is blocked from reaching the model. Launch the chat from your normal terminal to enable outbound access.", { status: 503 });
    }
    return new Response(error instanceof Error && error.name === "TimeoutError"
      ? "The model request timed out. No successful reply was received."
      : "The model connection failed. No successful reply was received.", { status: 503 });
  }
  if (!response.ok) return new Response("Model request failed with HTTP " + response.status + ".", { status: 502 });
  const result = await response.json().catch(() => null);
  const text = Array.isArray(result?.output) ? result.output.flatMap((item: { content?: unknown[] } | null) => item && Array.isArray(item.content) ? item.content : [])
    .filter((part: unknown) => part !== null && typeof part === "object" && "type" in part && part.type === "output_text" && "text" in part && typeof part.text === "string")
    .map((part: { text: string }) => part.text).join("\n") : "";
  if (result?.status !== "completed" || !text.trim()) return new Response("The model did not complete a text reply.", { status: 502 });
  return createUIMessageStreamResponse({ stream: createUIMessageStream({ execute: ({ writer }) => {
    const id = generateUUID();
    writer.write({ type: "text-start", id });
    writer.write({ type: "text-delta", id, delta: text });
    writer.write({ type: "text-end", id });
  } }) });
}
