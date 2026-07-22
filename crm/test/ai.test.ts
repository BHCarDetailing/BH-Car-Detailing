import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { callClaude, generateDigest } from "../src/lib/ai";

const AUTH = { Authorization: "Bearer dev-agent-key", "Content-Type": "application/json" };

describe("AI layer (dormant without key)", () => {
  it("callClaude returns null when ANTHROPIC_API_KEY is unset", async () => {
    expect(await callClaude(env, { system: "s", user: "u" })).toBeNull();
  });

  it("draft endpoint returns 503 when AI is not configured", async () => {
    const cid = ((await (await SELF.fetch("http://x/api/contacts", { method: "POST", headers: AUTH, body: JSON.stringify({ first_name: "Ai", phone: "3055551212" }) })).json()) as { id: string }).id;
    const res = await SELF.fetch("http://x/api/ai/draft", { method: "POST", headers: AUTH, body: JSON.stringify({ contact_id: cid, channel: "sms" }) });
    expect(res.status).toBe(503);
  });

  it("digest returns computed stats with a null narrative when dormant", async () => {
    const d = await generateDigest(env);
    expect(typeof d.stats.new_leads).toBe("number");
    expect(typeof d.stats.open_tasks).toBe("number");
    expect(d.narrative).toBeNull();
  });

  it("draft requires a contact_id", async () => {
    expect((await SELF.fetch("http://x/api/ai/draft", { method: "POST", headers: AUTH, body: JSON.stringify({}) })).status).toBe(400);
  });
});
