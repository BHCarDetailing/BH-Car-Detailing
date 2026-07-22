import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { all } from "../src/lib/db";

const AUTH = { Authorization: "Bearer dev-agent-key", "Content-Type": "application/json" };

async function contactWithJob() {
  const cid = ((await (await SELF.fetch("http://x/api/contacts", { method: "POST", headers: AUTH, body: JSON.stringify({ first_name: "Rev", phone: "3055554321", email: "rev@x.com" }) })).json()) as { id: string }).id;
  const jid = ((await (await SELF.fetch("http://x/api/jobs", { method: "POST", headers: AUTH, body: JSON.stringify({ contact_id: cid, title: "Detail", status: "completed" }) })).json()) as { id: string }).id;
  return { cid, jid };
}

describe("review requests", () => {
  it("400 without review_url, then sends (logs) with it", async () => {
    const { cid, jid } = await contactWithJob();
    expect((await SELF.fetch(`http://x/api/jobs/${jid}/request-review`, { method: "POST", headers: AUTH })).status).toBe(400);

    await SELF.fetch("http://x/api/settings", { method: "PUT", headers: AUTH, body: JSON.stringify({ key: "review_url", value: "https://g.page/bh/review" }) });
    const res = await SELF.fetch(`http://x/api/jobs/${jid}/request-review`, { method: "POST", headers: AUTH });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { status: string }).status).toBe("sent");

    const acts = (await (await SELF.fetch(`http://x/api/contacts/${cid}/activities`, { headers: AUTH })).json()) as { items: Array<{ title: string }> };
    expect(acts.items.some((a) => a.title === "Review requested")).toBe(true);
    const msgs = await all(env.DB, "SELECT * FROM messages WHERE contact_id = ? AND channel = 'sms'", cid);
    expect(msgs.length).toBeGreaterThanOrEqual(1);
  });
});
