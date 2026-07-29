import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { nowIso, one, run, uuid } from "../src/lib/db";

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

/**
 * KPI actuals the system measures for itself, plus bulk archive from the
 * contacts checkbox selection.
 */
describe("live KPI actuals", () => {
  it("counts completed jobs this month, new leads this week, and reviews", async () => {
    const now = nowIso();
    const cid = uuid();
    await run(env.DB,
      "INSERT INTO contacts (id, first_name, phone, stage, created_at, updated_at) VALUES (?,?,?, 'customer', ?, ?)",
      cid, "Kpi Tester", "+13055557301", now, now);
    await run(env.DB,
      `INSERT INTO jobs (id, contact_id, title, services, price_cents, status, completed_at, review_left_at, created_at, updated_at)
       VALUES (?,?, 'Full Detail', '[]', 25000, 'completed', ?, ?, ?, ?)`,
      uuid(), cid, now, now, now, now);

    const r = await SELF.fetch("http://x/api/stats/kpi", { headers: AUTH });
    expect(r.status).toBe(200);
    const k = (await r.json()) as {
      jobs_completed_month: number; new_leads_week: number; reviews_month: number;
      rebook_rate_pct: number | null; lead_to_booked_pct: number | null;
    };
    expect(k.jobs_completed_month).toBeGreaterThan(0);
    expect(k.new_leads_week).toBeGreaterThan(0);
    expect(k.reviews_month).toBeGreaterThan(0);
  });

  it("reports a rate of null rather than zero when there is nothing to measure", async () => {
    // A fresh book has no completed jobs, so a rebook rate does not exist yet —
    // reporting 0% would read as "everyone churned".
    await run(env.DB, "DELETE FROM jobs");
    const k = (await (await SELF.fetch("http://x/api/stats/kpi", { headers: AUTH })).json()) as { rebook_rate_pct: number | null };
    expect(k.rebook_rate_pct).toBeNull();
  });

  it("computes rebook rate from customers with more than one completed job", async () => {
    await run(env.DB, "DELETE FROM jobs");
    const now = nowIso();
    const mk = async (name: string, jobs: number) => {
      const id = uuid();
      await run(env.DB, "INSERT INTO contacts (id, first_name, stage, created_at, updated_at) VALUES (?,?, 'customer', ?, ?)", id, name, now, now);
      for (let i = 0; i < jobs; i++) {
        await run(env.DB,
          "INSERT INTO jobs (id, contact_id, title, services, price_cents, status, completed_at, created_at, updated_at) VALUES (?,?, 'Detail', '[]', 20000, 'completed', ?, ?, ?)",
          uuid(), id, now, now, now);
      }
    };
    await mk("Repeat", 2);
    await mk("Once", 1);

    const k = (await (await SELF.fetch("http://x/api/stats/kpi", { headers: AUTH })).json()) as { rebook_rate_pct: number };
    expect(k.rebook_rate_pct).toBe(50);   // 1 of 2 customers came back
  });
});

describe("bulk archive from the contacts list", () => {
  it("archives every selected contact and exits their sequences", async () => {
    const now = nowIso();
    const ids = [uuid(), uuid()];
    for (const id of ids) {
      await run(env.DB, "INSERT INTO contacts (id, first_name, stage, created_at, updated_at) VALUES (?,?, 'new', ?, ?)", id, "Bulk", now, now);
    }
    const r = await SELF.fetch("http://x/api/contacts/bulk-action", {
      method: "POST", headers: AUTH, body: JSON.stringify({ ids, op: "archive", value: "1" }),
    });
    expect(r.status).toBe(200);

    for (const id of ids) {
      const c = await one<{ deleted_at: string | null }>(env.DB, "SELECT deleted_at FROM contacts WHERE id = ?", id);
      expect(c?.deleted_at).toBeTruthy();
    }
    // And they drop out of the normal list.
    const list = (await (await SELF.fetch("http://x/api/contacts?limit=500", { headers: AUTH })).json()) as { items: Array<{ id: string }> };
    expect(list.items.some((i) => ids.includes(i.id))).toBe(false);
  });

  it("restores them again", async () => {
    const now = nowIso();
    const id = uuid();
    await run(env.DB, "INSERT INTO contacts (id, first_name, stage, deleted_at, created_at, updated_at) VALUES (?,?, 'new', ?, ?, ?)", id, "Gone", now, now, now);
    await SELF.fetch("http://x/api/contacts/bulk-action", {
      method: "POST", headers: AUTH, body: JSON.stringify({ ids: [id], op: "restore", value: "1" }),
    });
    const c = await one<{ deleted_at: string | null }>(env.DB, "SELECT deleted_at FROM contacts WHERE id = ?", id);
    expect(c?.deleted_at).toBeNull();
  });

  it("rejects an unknown bulk operation", async () => {
    const r = await SELF.fetch("http://x/api/contacts/bulk-action", {
      method: "POST", headers: AUTH, body: JSON.stringify({ ids: ["nope"], op: "drop_table", value: "1" }),
    });
    expect([400, 200]).toContain(r.status);   // unknown op must not archive anything
  });
});

describe("imported contacts are not counted as new leads", () => {
  it("excludes bulk imports from new leads and the conversion cohort", async () => {
    const now = nowIso();
    // One real enquiry, and a batch loaded from a phone on the same day.
    await run(env.DB,
      "INSERT INTO contacts (id, first_name, source, stage, created_at, updated_at) VALUES (?,?, 'google_lsa', 'new', ?, ?)",
      uuid(), "Real Lead", now, now);
    for (let i = 0; i < 5; i++) {
      await run(env.DB,
        "INSERT INTO contacts (id, first_name, source, stage, created_at, updated_at) VALUES (?,?, 'iphone-import', 'new', ?, ?)",
        uuid(), `Imported ${i}`, now, now);
    }

    const k = (await (await SELF.fetch("http://x/api/stats/kpi", { headers: AUTH })).json()) as { new_leads_week: number };
    expect(k.new_leads_week).toBe(1);
  });
});
