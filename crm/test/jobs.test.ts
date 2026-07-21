import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

const AUTH = { Authorization: "Bearer dev-agent-key", "Content-Type": "application/json" };

async function makeContact(first = "Job", email = "job@x.com") {
  const r = await SELF.fetch("http://x/api/contacts", {
    method: "POST", headers: AUTH, body: JSON.stringify({ first_name: first, email }),
  });
  return ((await r.json()) as { id: string }).id;
}

describe("jobs API", () => {
  it("creates a job and logs job_created", async () => {
    const cid = await makeContact("Alpha", "alpha@x.com");
    const res = await SELF.fetch("http://x/api/jobs", {
      method: "POST", headers: AUTH,
      body: JSON.stringify({ contact_id: cid, title: "Ceramic coating", price_cents: 75000, status: "quoted" }),
    });
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: string };
    const got = (await (await SELF.fetch(`http://x/api/jobs/${id}`, { headers: AUTH })).json()) as { title: string; price_cents: number; contact: { id: string } };
    expect(got.title).toBe("Ceramic coating");
    expect(got.price_cents).toBe(75000);
    expect(got.contact.id).toBe(cid);
    const acts = (await (await SELF.fetch(`http://x/api/contacts/${cid}/activities`, { headers: AUTH })).json()) as { items: Array<{ type: string }> };
    expect(acts.items.some((a) => a.type === "job_created")).toBe(true);
  });

  it("rejects missing contact and bad status", async () => {
    expect((await SELF.fetch("http://x/api/jobs", { method: "POST", headers: AUTH, body: JSON.stringify({ title: "x" }) })).status).toBe(400);
    const cid = await makeContact("Beta", "beta@x.com");
    expect((await SELF.fetch("http://x/api/jobs", { method: "POST", headers: AUTH, body: JSON.stringify({ contact_id: cid, title: "x", status: "nope" }) })).status).toBe(400);
    expect((await SELF.fetch("http://x/api/jobs", { method: "POST", headers: AUTH, body: JSON.stringify({ contact_id: "missing", title: "x" }) })).status).toBe(404);
  });

  it("PATCH status logs job_status_changed; scheduling logs job_scheduled", async () => {
    const cid = await makeContact("Gamma", "gamma@x.com");
    const { id } = (await (await SELF.fetch("http://x/api/jobs", { method: "POST", headers: AUTH, body: JSON.stringify({ contact_id: cid, title: "Detail" }) })).json()) as { id: string };
    await SELF.fetch(`http://x/api/jobs/${id}`, { method: "PATCH", headers: AUTH, body: JSON.stringify({ status: "scheduled", scheduled_start: "2026-08-01T14:00:00.000Z", scheduled_end: "2026-08-01T16:00:00.000Z" }) });
    const acts = (await (await SELF.fetch(`http://x/api/contacts/${cid}/activities`, { headers: AUTH })).json()) as { items: Array<{ type: string }> };
    expect(acts.items.some((a) => a.type === "job_status_changed")).toBe(true);
    expect(acts.items.some((a) => a.type === "job_scheduled")).toBe(true);
  });

  it("lists jobs filtered by date range", async () => {
    const cid = await makeContact("Delta", "delta@x.com");
    await SELF.fetch("http://x/api/jobs", { method: "POST", headers: AUTH, body: JSON.stringify({ contact_id: cid, title: "Aug job", status: "scheduled", scheduled_start: "2026-08-15T14:00:00.000Z" }) });
    const res = await SELF.fetch("http://x/api/jobs?from=2026-08-01&to=2026-08-31", { headers: AUTH });
    const { items } = (await res.json()) as { items: Array<{ title: string; first_name: string }> };
    expect(items.some((j) => j.title === "Aug job" && j.first_name === "Delta")).toBe(true);
  });

  it("requires auth", async () => {
    expect((await SELF.fetch("http://x/api/jobs")).status).toBe(401);
  });
});
