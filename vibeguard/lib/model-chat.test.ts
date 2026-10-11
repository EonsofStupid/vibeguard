import { afterEach, describe, expect, it, vi } from "vitest";
import { modelChat, readMessages } from "@/lib/model-chat";
import { restoreEnvironmentVariable } from "@/test/environment";
import { resetAgentEngineAuthForTests } from "@/lib/agent-engine-auth";
const originalKey = process.env.VIBEGUARD_MODEL_API_KEY;
afterEach(() => { restoreEnvironmentVariable("VIBEGUARD_MODEL_API_KEY", originalKey); vi.unstubAllGlobals(); vi.unstubAllEnvs(); resetAgentEngineAuthForTests(); });
const messages = [{ role: "user" as const, parts: [{ type: "text", text: "Hi" }] }];
describe("live model chat", () => {
  it("keeps saving turns during recall rate limits and tells the UI recall was unavailable", async () => {
    process.env.VIBEGUARD_MODEL_API_KEY = "test-key";
    vi.stubEnv("VIBEGUARD_MEMORY_MODE", "hosted");
    vi.stubEnv("VIBEGUARD_MEMORY_URL", "https://agentengine.mongodb.com");
    vi.stubEnv("MONGODB_AGENTIC_PROJECT_ID", "6acbc84c07e49c5b0f33c510");
    vi.stubEnv("MONGODB_AGENTIC_CLIENT_ID", "test-client");
    vi.stubEnv("MONGODB_AGENTIC_CLIENT_SECRET", "test-secret");
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ access_token: "test-token", expires_in: 3600 }))
      .mockResolvedValueOnce(Response.json({ id: "user-turn", session_id: "session-1", turn_seq: 1, acknowledged: true }))
      .mockResolvedValueOnce(Response.json({ detail: "Embedding service rate limit exceeded; retry later" }, { status: 429 }))
      .mockResolvedValueOnce(Response.json({ status: "completed", output: [{ content: [{ type: "output_text", text: "I can continue with this conversation." }] }] }))
      .mockResolvedValueOnce(Response.json({ id: "assistant-turn", session_id: "session-1", turn_seq: 2, acknowledged: true }));
    vi.stubGlobal("fetch", fetchMock);
    const response = await modelChat(messages, new Request("http://localhost/api/chat"), "session-1");
    const stream = await response.text();
    expect(response.status).toBe(200);
    expect(stream).toContain('"saved":true');
    expect(stream).toContain('"recall_limited":true');
    expect(fetchMock).toHaveBeenCalledTimes(5);
    const modelRequest = JSON.parse(fetchMock.mock.calls[3][1].body);
    expect(modelRequest.instructions).toContain("do not invent memories");
    expect(JSON.parse(fetchMock.mock.calls[4][1].body).role).toBe("assistant");
  });
  it("rejects malformed and oversized context", () => {
    for (const body of [null, [], { messages: {} }, { messages: [{ role: "user", parts: [null] }] },
      { messages: [{ role: "system", parts: [] }] },
      { messages: [{ role: "user", parts: [{ type: "text", text: "x".repeat(48_001) }] }] }]) expect(readMessages(body)).toBeNull();
  });
  it("returns a real completed reply in the UI stream", async () => {
    process.env.VIBEGUARD_MODEL_API_KEY = "test-key";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ status: "completed", output: [{ content: [{ type: "output_text", text: "Working" }] }] })));
    const response = await modelChat(messages, new Request("http://localhost/api/chat"));
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("Working");
  });
  it("does not retry or mark an upstream failure successful", async () => {
    process.env.VIBEGUARD_MODEL_API_KEY = "test-key";
    const fetchMock = vi.fn().mockResolvedValue(new Response("failed", { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);
    const response = await modelChat(messages, new Request("http://localhost/api/chat"));
    expect(response.status).toBe(502);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("rejects an incomplete model response even if HTTP is 200", async () => {
    process.env.VIBEGUARD_MODEL_API_KEY = "test-key";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ status: "incomplete", output: [{ content: [{ type: "output_text", text: "Partial" }] }] })));
    const response = await modelChat(messages, new Request("http://localhost/api/chat"));
    expect(response.status).toBe(502);
  });
  it("rejects malformed successful response payloads", async () => {
    process.env.VIBEGUARD_MODEL_API_KEY = "test-key";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ status: "completed", output: [null, {}] })));
    const response = await modelChat(messages, new Request("http://localhost/api/chat"));
    expect(response.status).toBe(502);
  });
  it("identifies blocked outbound access without claiming a reply", async () => {
    process.env.VIBEGUARD_MODEL_API_KEY = "test-key";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed", { cause: { code: "EACCES" } })));
    const response = await modelChat(messages, new Request("http://localhost/api/chat"));
    expect(response.status).toBe(503);
    expect(await response.text()).toContain("blocked from reaching the model");
  });
  it("reports a network failure with a non-success status", async () => {
    process.env.VIBEGUARD_MODEL_API_KEY = "test-key";
    const fetchMock = vi.fn().mockRejectedValue(new Error("blocked"));
    vi.stubGlobal("fetch", fetchMock);
    const response = await modelChat(messages, new Request("http://localhost/api/chat"));
    expect(response.status).toBe(503);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
