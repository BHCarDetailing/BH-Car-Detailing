import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

const AUTH = { Authorization: "Bearer dev-agent-key", "Content-Type": "application/json" };

async function createContact(body: Record<string, unknown>) {
  const res = await SELF.fetch("http://x/api/contacts", {
    method: "POST", headers: AUTH, body: JSON.stringify(body),
  });
  return res;
}

describe("contacts CRUD", () => {
  it("creates then fetches a contact with normalized fields", async () => {
    const res = await createContact({ first_name: "maria", last_name: "garcia", email: "Maria@X.com", phone: "3055550123" });
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: string };
    const got = await SELF.fetch(`http://x/api/contacts/${id}`, { headers: AUTH });
    const c = (await got.json()) as Record<string, unknown>;
    expect(c.email).toBe("maria@x.com");
    expect(c.phone).toBe("+13055550123");
    expect(c.stage).toBe("new");
    expect(Array.isArray(c.vehicles)).toBe(true);
  });

  it("rejects invalid stage", async () => {
    const res = await createContact({ first_name: "Bad", stage: "vip" });
    expect(res.status).toBe(400);
  });

  it("PATCH stage logs a stage_changed activity", async () => {
    const { id } = (await (await createContact({ first_name: "Stager", email: "stager@x.com" })).json()) as { id: string };
    const res = await SELF.fetch(`http://x/api/contacts/${id}`, {
      method: "PATCH", headers: AUTH, body: JSON.stringify({ stage: "contacted" }),
    });
    expect(res.status).toBe(200);
    const acts = await SELF.fetch(`http://x/api/contacts/${id}/activities`, { headers: AUTH });
    const list = (await acts.json()) as { items: Array<{ type: string; payload: string }> };
    const sc = list.items.find((a) => a.type === "stage_changed");
    expect(sc).toBeTruthy();
    expect(JSON.parse(sc!.payload)).toEqual({ from: "new", to: "contacted" });
  });

  it("PATCH custom shallow-merges", async () => {
    const { id } = (await (await createContact({ first_name: "Cust", email: "cust@x.com", custom: { referral: "yes" } })).json()) as { id: string };
    await SELF.fetch(`http://x/api/contacts/${id}`, {
      method: "PATCH", headers: AUTH, body: JSON.stringify({ custom: { gate_code: "1234" } }),
    });
    const c = (await (await SELF.fetch(`http://x/api/contacts/${id}`, { headers: AUTH })).json()) as { custom: Record<string, string> };
    expect(c.custom).toEqual({ referral: "yes", gate_code: "1234" });
  });

  it("list returns tags as a parsed array, not a JSON string", async () => {
    const { id } = (await (await createContact({ first_name: "Tagged", email: "tagged@x.com", tags: ["vip"] })).json()) as { id: string };
    const res = await SELF.fetch("http://x/api/contacts?search=Tagged", { headers: AUTH });
    const { items } = (await res.json()) as { items: Array<{ id: string; tags: unknown }> };
    const row = items.find((i) => i.id === id)!;
    expect(Array.isArray(row.tags)).toBe(true);
    expect(row.tags).toEqual(["vip"]);
  });

  it("search finds by partial name", async () => {
    await createContact({ first_name: "Zebulon", last_name: "Quartermain", email: "zq@x.com" });
    const res = await SELF.fetch("http://x/api/contacts?search=zebul", { headers: AUTH });
    const { items, total } = (await res.json()) as { items: unknown[]; total: number };
    expect(total).toBe(1);
    expect(items.length).toBe(1);
  });

  it("stats counts by stage", async () => {
    await createContact({ first_name: "S1", email: "s1@x.com" });
    const res = await SELF.fetch("http://x/api/stats", { headers: AUTH });
    const stats = (await res.json()) as { byStage: Record<string, number>; recent: unknown[] };
    expect(stats.byStage.new).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(stats.recent)).toBe(true);
  });

  it("DELETE removes the contact", async () => {
    const { id } = (await (await createContact({ first_name: "Gone", email: "gone@x.com" })).json()) as { id: string };
    await SELF.fetch(`http://x/api/contacts/${id}`, { method: "DELETE", headers: AUTH });
    const got = await SELF.fetch(`http://x/api/contacts/${id}`, { headers: AUTH });
    expect(got.status).toBe(404);
  });

  it("PATCH with null JSON body returns 400", async () => {
    const { id } = (await (await createContact({ first_name: "NullPatch", email: "np@x.com" })).json()) as { id: string };
    const res = await SELF.fetch(`http://x/api/contacts/${id}`, { method: "PATCH", headers: AUTH, body: "null" });
    expect(res.status).toBe(400);
  });
});
