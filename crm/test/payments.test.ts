import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

const AUTH = { Authorization: "Bearer dev-agent-key", "Content-Type": "application/json" };

async function quotedJob() {
  const cRes = await SELF.fetch("http://x/api/contacts", { method: "POST", headers: AUTH, body: JSON.stringify({ first_name: "Pay", email: "pay@x.com" }) });
  const { id: contactId } = (await cRes.json()) as { id: string };
  const jRes = await SELF.fetch("http://x/api/jobs", {
    method: "POST", headers: AUTH,
    body: JSON.stringify({ contact_id: contactId, title: "Ceramic Coating", status: "quoted", price_cents: 80000, services: [{ name: "Ceramic Coating", price_cents: 80000, qty: 1 }] }),
  });
  const { id: jobId } = (await jRes.json()) as { id: string };
  const sent = (await (await SELF.fetch(`http://x/api/jobs/${jobId}/send-quote`, { method: "POST", headers: AUTH })).json()) as { token: string };
  return sent.token;
}

describe("payments (dormant without Stripe key) + webchat widget", () => {
  it("serves the webchat widget as JavaScript", async () => {
    const res = await SELF.fetch("http://x/api/widget.js");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("javascript");
    const body = await res.text();
    expect(body).toContain("bhchat-root");
    expect(body).toContain("/api/lead");
  });

  it("reports Stripe as not connected", async () => {
    const res = await SELF.fetch("http://x/api/settings/integrations", { headers: AUTH });
    const j = (await res.json()) as { stripe: boolean };
    expect(j.stripe).toBe(false);
  });

  it("quote reports payments disabled and no deposit when Stripe is off", async () => {
    const token = await quotedJob();
    const q = (await (await SELF.fetch(`http://x/api/quote/${token}`)).json()) as { payments_enabled: boolean; deposit_cents: number };
    expect(q.payments_enabled).toBe(false);
    expect(q.deposit_cents).toBe(0);
  });

  it("checkout returns 503 when payments are unavailable", async () => {
    const token = await quotedJob();
    const res = await SELF.fetch(`http://x/api/quote/${token}/checkout`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "deposit" }) });
    expect(res.status).toBe(503);
  });

  it("stripe webhook rejects a missing/invalid signature", async () => {
    const res = await SELF.fetch("http://x/api/stripe/webhook", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "checkout.session.completed" }) });
    expect(res.status).toBe(400);
  });

  it("records a manual (Zelle) payment on a job", async () => {
    const cRes = await SELF.fetch("http://x/api/contacts", { method: "POST", headers: AUTH, body: JSON.stringify({ first_name: "Manual", email: "manual@x.com" }) });
    const { id: contactId } = (await cRes.json()) as { id: string };
    const jRes = await SELF.fetch("http://x/api/jobs", {
      method: "POST", headers: AUTH,
      body: JSON.stringify({ contact_id: contactId, title: "Full Detail", status: "quoted", price_cents: 20000 }),
    });
    const { id: jobId } = (await jRes.json()) as { id: string };

    const r = (await (await SELF.fetch(`http://x/api/jobs/${jobId}/mark-paid`, {
      method: "POST", headers: AUTH, body: JSON.stringify({ amount_cents: 20000, method: "zelle" }),
    })).json()) as { amount_paid_cents: number; paid_in_full: boolean };
    expect(r.amount_paid_cents).toBe(20000);
    expect(r.paid_in_full).toBe(true);

    const job = (await (await SELF.fetch(`http://x/api/jobs/${jobId}`, { headers: AUTH })).json()) as { amount_paid_cents: number; paid_in_full: number };
    expect(job.amount_paid_cents).toBe(20000);
    expect(job.paid_in_full).toBe(1);
  });

  it("rejects a manual payment with no amount", async () => {
    const cRes = await SELF.fetch("http://x/api/contacts", { method: "POST", headers: AUTH, body: JSON.stringify({ first_name: "NoAmt", email: "noamt@x.com" }) });
    const { id: contactId } = (await cRes.json()) as { id: string };
    const jRes = await SELF.fetch("http://x/api/jobs", { method: "POST", headers: AUTH, body: JSON.stringify({ contact_id: contactId, title: "X", status: "quoted", price_cents: 5000 }) });
    const { id: jobId } = (await jRes.json()) as { id: string };
    const res = await SELF.fetch(`http://x/api/jobs/${jobId}/mark-paid`, { method: "POST", headers: AUTH, body: JSON.stringify({ method: "cash" }) });
    expect(res.status).toBe(400);
  });

  it("webchat posts create a lead via /api/lead", async () => {
    const res = await SELF.fetch("http://x/api/lead", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Chat Visitor", phone: "3055559999", message: "need a quote", source: "webchat", website: "", ts: Date.now() - 5000 }),
    });
    expect(res.status).toBe(200);
    const found = await SELF.fetch("http://x/api/contacts?search=3055559999", { headers: AUTH });
    const { total } = (await found.json()) as { total: number };
    expect(total).toBeGreaterThanOrEqual(1);
  });
});
