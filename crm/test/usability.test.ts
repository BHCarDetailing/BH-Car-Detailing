import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

const AUTH = { Authorization: "Bearer dev-agent-key", "Content-Type": "application/json" };

async function newContact(first: string): Promise<string> {
  const r = await SELF.fetch("http://x/api/contacts", { method: "POST", headers: AUTH, body: JSON.stringify({ first_name: first, email: `${first}@x.com` }) });
  return ((await r.json()) as { id: string }).id;
}
async function listIds(archived = false): Promise<string[]> {
  const r = await SELF.fetch(`http://x/api/contacts?limit=200${archived ? "&archived=1" : ""}`, { headers: AUTH });
  return ((await r.json()) as { items: Array<{ id: string }> }).items.map((c) => c.id);
}
async function revenue(): Promise<{ all_time_cents: number; pipeline_cents: number }> {
  const s = (await (await SELF.fetch("http://x/api/stats", { headers: AUTH })).json()) as { revenue: { all_time_cents: number; pipeline_cents: number } };
  return s.revenue;
}

describe("contact soft-delete / archive / restore", () => {
  it("archives on delete, hides from the list, shows under ?archived=1, and restores", async () => {
    const id = await newContact("Archie");
    expect(await listIds()).toContain(id);

    const del = await SELF.fetch(`http://x/api/contacts/${id}`, { method: "DELETE", headers: AUTH });
    expect(((await del.json()) as { archived: boolean }).archived).toBe(true);

    expect(await listIds()).not.toContain(id);      // hidden from the normal list
    expect(await listIds(true)).toContain(id);       // visible in the archive
    // still fetchable directly (for the archive/restore UI)
    expect((await SELF.fetch(`http://x/api/contacts/${id}`, { headers: AUTH })).status).toBe(200);

    const restore = await SELF.fetch(`http://x/api/contacts/${id}/restore`, { method: "POST", headers: AUTH });
    expect(restore.status).toBe(200);
    expect(await listIds()).toContain(id);
    expect(await listIds(true)).not.toContain(id);
  });

  it("archived contacts drop out of stats byStage", async () => {
    const id = await newContact("Statless");
    const before = (await (await SELF.fetch("http://x/api/stats", { headers: AUTH })).json()) as { byStage: { new: number } };
    await SELF.fetch(`http://x/api/contacts/${id}`, { method: "DELETE", headers: AUTH });
    const after = (await (await SELF.fetch("http://x/api/stats", { headers: AUTH })).json()) as { byStage: { new: number } };
    expect(after.byStage.new).toBe(before.byStage.new - 1);
  });
});

describe("revenue ↔ contact link", () => {
  it("stores contact_id and surfaces the event + paid total on the contact", async () => {
    const id = await newContact("Payer");
    const rev = await SELF.fetch("http://x/api/c/revenue", {
      method: "POST", headers: AUTH,
      body: JSON.stringify({ label: "Full detail", amount_cents: 25000, status: "paid", contact_id: id, customer: "Payer" }),
    });
    expect(rev.status).toBe(201);
    expect(((await rev.json()) as { item: { contact_id: string } }).item.contact_id).toBe(id);

    const c = (await (await SELF.fetch(`http://x/api/contacts/${id}`, { headers: AUTH })).json()) as {
      revenue: Array<{ label: string }>; related: { jobs: number; paid_revenue_cents: number };
    };
    expect(c.revenue.some((r) => r.label === "Full detail")).toBe(true);
    expect(c.related.paid_revenue_cents).toBe(25000);
    expect(c.related.jobs).toBe(0);
  });
});

describe("deposits flow into cash metrics", () => {
  it("a paid deposit on a scheduled job counts as realized revenue and nets out of pipeline", async () => {
    const id = await newContact("Depositor");
    const before = await revenue();
    // Scheduled job worth $600.
    const jobRes = await SELF.fetch("http://x/api/jobs", {
      method: "POST", headers: AUTH,
      body: JSON.stringify({ contact_id: id, title: "Ceramic coating", status: "scheduled", price_cents: 60000 }),
    });
    const jobId = ((await jobRes.json()) as { id: string }).id;
    const afterJob = await revenue();
    // Full unpaid value is in pipeline, nothing realized yet.
    expect(afterJob.pipeline_cents).toBe(before.pipeline_cents + 60000);
    expect(afterJob.all_time_cents).toBe(before.all_time_cents);

    // Collect a $150 deposit.
    const pay = await SELF.fetch(`http://x/api/jobs/${jobId}/mark-paid`, {
      method: "POST", headers: AUTH, body: JSON.stringify({ amount_cents: 15000, method: "deposit" }),
    });
    expect(pay.status).toBe(200);
    const afterDep = await revenue();
    expect(afterDep.all_time_cents).toBe(before.all_time_cents + 15000);        // deposit = cash in
    expect(afterDep.pipeline_cents).toBe(before.pipeline_cents + 60000 - 15000); // remainder still in flight
  });
});

describe("email history + sequence send-log endpoints", () => {
  it("email-channel thread and sequence sends return arrays", async () => {
    const id = await newContact("Emailer");
    const thread = await SELF.fetch(`http://x/api/messages?contact_id=${id}&channel=email`, { headers: AUTH });
    expect(Array.isArray(((await thread.json()) as { items: unknown[] }).items)).toBe(true);

    const seq = await SELF.fetch("http://x/api/sequences", { method: "POST", headers: AUTH, body: JSON.stringify({ name: "S", steps: [{ delay_hours: 0, subject: "Hi {first_name}", body_text: "Body" }] }) });
    const seqId = ((await seq.json()) as { id: string }).id;
    const sends = await SELF.fetch(`http://x/api/sequences/${seqId}/sends`, { headers: AUTH });
    expect(Array.isArray(((await sends.json()) as { items: unknown[] }).items)).toBe(true);
  });
});
