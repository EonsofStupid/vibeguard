import { afterEach, describe, expect, it, vi } from "vitest";
import { modelChat, readMessages } from "@/lib/model-chat";
import { restoreEnvironmentVariable } from "@/test/environment";
const originalKey = process.env.VIBEGUARD_MODEL_API_KEY;
afterEach(() => { restoreEnvironmentVariable("VIBEGUARD_MODEL_API_KEY", originalKey); vi.unstubAllGlobals(); });
const messages = [{ role: "user" as const, parts: [{ type: "text", text: "Hi" }] }];
describe("live model chat", () => {
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
