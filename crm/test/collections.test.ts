import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

const AUTH = { Authorization: "Bearer dev-agent-key", "Content-Type": "application/json" };

async function post(name: string, body: Record<string, unknown>) {
  return SELF.fetch(`http://x/api/c/${name}`, { method: "POST", headers: AUTH, body: JSON.stringify(body) });
}

describe("generic collections engine", () => {
  it("requires auth", async () => {
    const res = await SELF.fetch("http://x/api/c/clients");
    expect(res.status).toBe(401);
  });

  it("rejects unknown collections", async () => {
    const res = await SELF.fetch("http://x/api/c/robots", { headers: AUTH });
    expect(res.status).toBe(404);
  });

  it("creates, lists, patches and deletes a client", async () => {
    const created = await post("clients", { name: "Miami Exotics", type: "fleet", stage: "active", email: "ops@x.com" });
    expect(created.status).toBe(201);
    const { item } = (await created.json()) as { item: { id: string; name: string; type: string } };
    expect(item.name).toBe("Miami Exotics");
    expect(item.type).toBe("fleet");

    const list = (await (await SELF.fetch("http://x/api/c/clients", { headers: AUTH })).json()) as { items: Array<{ id: string }> };
    expect(list.items.some((c) => c.id === item.id)).toBe(true);

    const patched = await SELF.fetch(`http://x/api/c/clients/${item.id}`, {
      method: "PATCH", headers: AUTH, body: JSON.stringify({ stage: "recurring" }),
    });
    expect(patched.status).toBe(200);
    expect(((await patched.json()) as { item: { stage: string } }).item.stage).toBe("recurring");

    const del = await SELF.fetch(`http://x/api/c/clients/${item.id}`, { method: "DELETE", headers: AUTH });
    expect(del.status).toBe(200);
  });

  it("enforces required fields and enum whitelists", async () => {
    const noName = await post("clients", { type: "fleet" });
    expect(noName.status).toBe(400);

    const badEnum = await post("clients", { name: "X", stage: "not-a-stage" });
    expect(badEnum.status).toBe(400);

    const badStatus = await post("revenue", { label: "Deal", amount_cents: 100, status: "bogus" });
    expect(badStatus.status).toBe(400);
  });

  it("coerces ints and booleans", async () => {
    const rev = await post("revenue", { label: "Dealership contract", amount_cents: 250000, status: "paid" });
    const { item } = (await rev.json()) as { item: { amount_cents: number } };
    expect(item.amount_cents).toBe(250000);

    const up = await post("updates", { body: "Pinned note", category: "win", pinned: true });
    const { item: u } = (await up.json()) as { item: { pinned: number; category: string } };
    expect(u.pinned).toBe(1);
    expect(u.category).toBe("win");
  });

  it("stores revenue-event fields and validates status", async () => {
    const ok = await post("revenue", { label: "Full detail — 911", amount_cents: 30000, occurred_at: "2026-07-27", customer: "Alex", service: "Full Detail", status: "pending" });
    expect(ok.status).toBe(201);
    const { item } = (await ok.json()) as { item: { occurred_at: string; customer: string; status: string } };
    expect(item.occurred_at).toBe("2026-07-27");
    expect(item.customer).toBe("Alex");
    expect(item.status).toBe("pending");

    const bad = await post("revenue", { label: "X", amount_cents: 100, status: "bogus" });
    expect(bad.status).toBe(400);
  });

  it("supports the GTM collections (prospects, campaigns, content)", async () => {
    const p = await post("prospects", { name: "Miami Exotics", source: "LSA", status: "follow_up" });
    expect(p.status).toBe(201);
    expect(((await p.json()) as { item: { status: string } }).item.status).toBe("follow_up");

    const c = await post("campaigns", { name: "July LSA", channel: "google_lsa", spend_cents: 50000, leads: 12 });
    expect(c.status).toBe(201);
    const cj = (await c.json()) as { item: { channel: string; leads: number } };
    expect(cj.item.channel).toBe("google_lsa");
    expect(cj.item.leads).toBe(12);

    const ct = await post("content", { title: "Ceramic reel", channel: "instagram", status: "scheduled", scheduled_for: "2026-08-01" });
    expect(ct.status).toBe(201);
    expect(((await ct.json()) as { item: { status: string } }).item.status).toBe("scheduled");

    const badChannel = await post("campaigns", { name: "X", channel: "tiktok" }); // tiktok not a campaign channel
    expect(badChannel.status).toBe(400);
  });
});
