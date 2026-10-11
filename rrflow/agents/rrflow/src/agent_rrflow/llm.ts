import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { ChatOpenAI } from "@langchain/openai";

const MODEL = "gpt-5.6-luna";

export function buildLLM(opts: { temperature?: number } = {}): BaseChatModel {
  const apiKey = process.env.LLM_API_KEY ?? "";
  if (!apiKey) {
    throw new Error("LLM_API_KEY is missing; add it to .env or project secrets");
  }
  return new ChatOpenAI({
    model: MODEL,
    apiKey,
    useResponsesApi: true,
  });
}
