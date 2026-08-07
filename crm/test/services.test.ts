import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

const AUTH = { Authorization: "Bearer dev-agent-key", "Content-Type": "application/json" };

async function createContact(body: Record<string, unknown>) {
  const res = await SELF.fetch("http://x/api/contacts", { method: "POST", headers: AUTH, body: JSON.stringify(body) });
  return (await res.json()) as { id: string };
}

describe("services + quotes", () => {
  it("seeds the BH service menu with per-size pricing", async () => {
    const res = await SELF.fetch("http://x/api/services", { headers: AUTH });
    const { items } = (await res.json()) as { items: Array<{ name: string; size_pricing: Record<string, number> }> };
    expect(items.length).toBeGreaterThanOrEqual(6);
    const ceramic = items.find((s) => s.name === "Ceramic Coating")!;
    expect(ceramic.size_pricing.suv).toBe(80000);
  });

  it("creates a service and lists it", async () => {
    const res = await SELF.fetch("http://x/api/services", {
      method: "POST", headers: AUTH,
      body: JSON.stringify({ name: "Headlight Restoration", size_pricing: { sedan: 8000, suv: 8000 } }),
    });
    expect(res.status).toBe(201);
    const list = (await (await SELF.fetch("http://x/api/services?active=1", { headers: AUTH })).json()) as { items: Array<{ name: string; base_price_cents: number }> };
    const svc = list.items.find((s) => s.name === "Headlight Restoration")!;
    expect(svc.base_price_cents).toBe(8000); // falls back to sedan price
  });

  it("mints a shareable quote link and serves it publicly with accept", async () => {
    const { id: contactId } = await createContact({ first_name: "Quote", email: "quote@x.com" });
    const jobRes = await SELF.fetch("http://x/api/jobs", {
      method: "POST", headers: AUTH,
      body: JSON.stringify({
        contact_id: contactId, title: "Ceramic Coating", status: "quoted", price_cents: 80000,
        services: [{ name: "Ceramic Coating", price_cents: 80000, qty: 1 }],
      }),
    });
    const { id: jobId } = (await jobRes.json()) as { id: string };

    const sent = (await (await SELF.fetch(`http://x/api/jobs/${jobId}/send-quote`, { method: "POST", headers: AUTH })).json()) as { token: string; path: string };
    expect(sent.token).toBeTruthy();
    expect(sent.path).toBe(`/quote/${sent.token}`);

    // Public view — no auth header.
    const pub = await SELF.fetch(`http://x/api/quote/${sent.token}`);
    expect(pub.status).toBe(200);
    const quote = (await pub.json()) as { title: string; total_cents: number; customer_first: string; accepted: boolean; items: unknown[] };
    expect(quote.title).toBe("Ceramic Coating");
    expect(quote.total_cents).toBe(80000);
    expect(quote.customer_first).toBe("Quote");
    expect(quote.accepted).toBe(false);
    expect(quote.items.length).toBe(1);

    // Accept publicly.
    const acc = await SELF.fetch(`http://x/api/quote/${sent.token}/accept`, { method: "POST" });
    expect(acc.status).toBe(200);
    const after = (await (await SELF.fetch(`http://x/api/quote/${sent.token}`)).json()) as { accepted: boolean };
    expect(after.accepted).toBe(true);
  });

  it("returns 404 for an unknown quote token", async () => {
    const res = await SELF.fetch("http://x/api/quote/nope-not-real");
    expect(res.status).toBe(404);
  });
});
