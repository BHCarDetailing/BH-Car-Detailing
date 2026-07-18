import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

const AUTH = { Authorization: "Bearer dev-agent-key", "Content-Type": "application/json" };

describe("manual activities", () => {
  it("logs a note", async () => {
    const { id } = (await (await SELF.fetch("http://x/api/contacts", {
      method: "POST", headers: AUTH, body: JSON.stringify({ first_name: "Notey", email: "notey@x.com" }),
    })).json()) as { id: string };
    const res = await SELF.fetch(`http://x/api/contacts/${id}/activities`, {
      method: "POST", headers: AUTH, body: JSON.stringify({ type: "note", title: "Called, left VM" }),
    });
    expect(res.status).toBe(201);
    const list = (await (await SELF.fetch(`http://x/api/contacts/${id}/activities`, { headers: AUTH })).json()) as { items: Array<{ type: string; actor: string }> };
    const note = list.items.find((a) => a.type === "note");
    expect(note?.actor).toBe("agent");
  });

  it("rejects unknown manual type", async () => {
    const { id } = (await (await SELF.fetch("http://x/api/contacts", {
      method: "POST", headers: AUTH, body: JSON.stringify({ first_name: "T", email: "t-act@x.com" }),
    })).json()) as { id: string };
    const res = await SELF.fetch(`http://x/api/contacts/${id}/activities`, {
      method: "POST", headers: AUTH, body: JSON.stringify({ type: "email_sent", title: "nope" }),
    });
    expect(res.status).toBe(400);
  });

  it("activities POST with null JSON body returns 400", async () => {
    const { id } = (await (await SELF.fetch("http://x/api/contacts", {
      method: "POST", headers: AUTH, body: JSON.stringify({ first_name: "NB", email: "nb-act@x.com" }),
    })).json()) as { id: string };
    const res = await SELF.fetch(`http://x/api/contacts/${id}/activities`, { method: "POST", headers: AUTH, body: "null" });
    expect(res.status).toBe(400);
  });
});

describe("custom fields", () => {
  it("creates, lists, rejects dupes, deletes", async () => {
    const make = () => SELF.fetch("http://x/api/custom-fields", {
      method: "POST", headers: AUTH,
      body: JSON.stringify({ key: "gate_code", label: "Gate code", type: "text" }),
    });
    expect((await make()).status).toBe(201);
    expect((await make()).status).toBe(409);
    const list = (await (await SELF.fetch("http://x/api/custom-fields", { headers: AUTH })).json()) as { items: Array<{ key: string }> };
    expect(list.items.some((f) => f.key === "gate_code")).toBe(true);
    expect((await SELF.fetch("http://x/api/custom-fields/gate_code", { method: "DELETE", headers: AUTH })).status).toBe(200);
  });

  it("rejects bad key", async () => {
    const res = await SELF.fetch("http://x/api/custom-fields", {
      method: "POST", headers: AUTH, body: JSON.stringify({ key: "Bad Key!", label: "x", type: "text" }),
    });
    expect(res.status).toBe(400);
  });

  it("custom-fields POST with null JSON body returns 400", async () => {
    const res = await SELF.fetch("http://x/api/custom-fields", { method: "POST", headers: AUTH, body: "null" });
    expect(res.status).toBe(400);
  });
});

describe("bulk import", () => {
  it("creates and merges with per-row errors", async () => {
    const res = await SELF.fetch("http://x/api/contacts/bulk", {
      method: "POST", headers: AUTH,
      body: JSON.stringify({
        contacts: [
          { first_name: "Bulk", last_name: "One", email: "bulk1@x.com", source: "hubspot-import", vehicle: "SUV / Truck" },
          { first_name: "Bulk", email: "bulk1@x.com", phone: "3055550188" }, // merges into row 1
          { first_name: "NoContactInfo" }, // error row
        ],
      }),
    });
    expect(res.status).toBe(200);
    const out = (await res.json()) as { created: number; merged: number; errors: Array<{ index: number }> };
    expect(out.created).toBe(1);
    expect(out.merged).toBe(1);
    expect(out.errors.length).toBe(1);
    expect(out.errors[0].index).toBe(2);
  });

  it("bulk with null JSON body returns 400", async () => {
    const res = await SELF.fetch("http://x/api/contacts/bulk", { method: "POST", headers: AUTH, body: "null" });
    expect(res.status).toBe(400);
  });

  it("bulk row with numeric email becomes an error row, not a crash", async () => {
    const res = await SELF.fetch("http://x/api/contacts/bulk", {
      method: "POST", headers: AUTH,
      body: JSON.stringify({ contacts: [
        { first_name: "Good", email: "good-guard@x.com" },
        { first_name: "Bad", email: 12345 },
      ] }),
    });
    expect(res.status).toBe(200);
    const out = (await res.json()) as { created: number; errors: Array<{ index: number }> };
    expect(out.created).toBe(1);
    expect(out.errors.length).toBe(1);
    expect(out.errors[0].index).toBe(1);
  });
});
