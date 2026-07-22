import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

const AUTH = { Authorization: "Bearer dev-agent-key", "Content-Type": "application/json" };

async function makeContact(first: string, email: string) {
  const r = await SELF.fetch("http://x/api/contacts", { method: "POST", headers: AUTH, body: JSON.stringify({ first_name: first, email }) });
  return ((await r.json()) as { id: string }).id;
}

describe("labels", () => {
  it("creates, rejects dup, and delete strips the label from contacts", async () => {
    expect((await SELF.fetch("http://x/api/labels", { method: "POST", headers: AUTH, body: JSON.stringify({ key: "vip", label: "VIP", color: "#f00" }) })).status).toBe(201);
    expect((await SELF.fetch("http://x/api/labels", { method: "POST", headers: AUTH, body: JSON.stringify({ key: "vip", label: "VIP" }) })).status).toBe(409);

    const cid = await makeContact("Lab", "lab@x.com");
    await SELF.fetch(`http://x/api/contacts/${cid}`, { method: "PATCH", headers: AUTH, body: JSON.stringify({ tags: ["vip"] }) });
    let got = (await (await SELF.fetch(`http://x/api/contacts/${cid}`, { headers: AUTH })).json()) as { tags: string[] };
    expect(got.tags).toContain("vip");

    await SELF.fetch("http://x/api/labels/vip", { method: "DELETE", headers: AUTH });
    got = (await (await SELF.fetch(`http://x/api/contacts/${cid}`, { headers: AUTH })).json()) as { tags: string[] };
    expect(got.tags).not.toContain("vip");
  });
});

describe("contacts sort + bulk-action", () => {
  it("sorts by first_name asc", async () => {
    await makeContact("Zeb", "zeb@x.com");
    await makeContact("Abe", "abe@x.com");
    const r = (await (await SELF.fetch("http://x/api/contacts?order_by=first_name&order=asc&limit=200", { headers: AUTH })).json()) as { items: Array<{ first_name: string }> };
    const names = r.items.map((i) => i.first_name).filter(Boolean);
    const abe = names.indexOf("Abe"), zeb = names.indexOf("Zeb");
    expect(abe).toBeGreaterThanOrEqual(0);
    expect(abe).toBeLessThan(zeb);
  });

  it("bulk add_label and set_stage across ids", async () => {
    await SELF.fetch("http://x/api/labels", { method: "POST", headers: AUTH, body: JSON.stringify({ key: "lead2026", label: "Leads" }) });
    const a = await makeContact("BulkA", "ba@x.com");
    const b = await makeContact("BulkB", "bb@x.com");
    const res = await SELF.fetch("http://x/api/contacts/bulk-action", { method: "POST", headers: AUTH, body: JSON.stringify({ ids: [a, b], op: "add_label", value: "lead2026" }) });
    expect(((await res.json()) as { updated: number }).updated).toBe(2);
    const ca = (await (await SELF.fetch(`http://x/api/contacts/${a}`, { headers: AUTH })).json()) as { tags: string[] };
    expect(ca.tags).toContain("lead2026");

    await SELF.fetch("http://x/api/contacts/bulk-action", { method: "POST", headers: AUTH, body: JSON.stringify({ ids: [a, b], op: "set_stage", value: "quoted" }) });
    const cb = (await (await SELF.fetch(`http://x/api/contacts/${b}`, { headers: AUTH })).json()) as { stage: string };
    expect(cb.stage).toBe("quoted");

    expect((await SELF.fetch("http://x/api/contacts/bulk-action", { method: "POST", headers: AUTH, body: JSON.stringify({ ids: [a], op: "set_stage", value: "bogus" }) })).status).toBe(400);
  });
});
