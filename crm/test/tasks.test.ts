import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

const AUTH = { Authorization: "Bearer dev-agent-key", "Content-Type": "application/json" };

describe("tasks API", () => {
  it("creates, lists, completes, deletes", async () => {
    const res = await SELF.fetch("http://x/api/tasks", { method: "POST", headers: AUTH, body: JSON.stringify({ title: "Call Jorge back", due_at: "2026-08-01T12:00:00.000Z" }) });
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: string };
    const list = (await (await SELF.fetch("http://x/api/tasks?status=open", { headers: AUTH })).json()) as { items: Array<{ id: string; status: string }> };
    expect(list.items.some((t) => t.id === id)).toBe(true);
    const done = await SELF.fetch(`http://x/api/tasks/${id}`, { method: "PATCH", headers: AUTH, body: JSON.stringify({ status: "done" }) });
    expect(done.status).toBe(200);
    const openAfter = (await (await SELF.fetch("http://x/api/tasks?status=open", { headers: AUTH })).json()) as { items: Array<{ id: string }> };
    expect(openAfter.items.some((t) => t.id === id)).toBe(false);
    expect((await SELF.fetch(`http://x/api/tasks/${id}`, { method: "DELETE", headers: AUTH })).status).toBe(200);
  });

  it("requires a title and validates status", async () => {
    expect((await SELF.fetch("http://x/api/tasks", { method: "POST", headers: AUTH, body: JSON.stringify({ notes: "x" }) })).status).toBe(400);
    const { id } = (await (await SELF.fetch("http://x/api/tasks", { method: "POST", headers: AUTH, body: JSON.stringify({ title: "t" }) })).json()) as { id: string };
    expect((await SELF.fetch(`http://x/api/tasks/${id}`, { method: "PATCH", headers: AUTH, body: JSON.stringify({ status: "banana" }) })).status).toBe(400);
  });
});
