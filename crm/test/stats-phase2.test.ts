import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

const AUTH = { Authorization: "Bearer dev-agent-key", "Content-Type": "application/json" };

describe("stats phase 2", () => {
  it("returns todayJobs and openTasks arrays", async () => {
    const res = await SELF.fetch("http://x/api/stats", { headers: AUTH });
    const s = (await res.json()) as { todayJobs: unknown[]; openTasks: unknown[]; byStage: Record<string, number> };
    expect(Array.isArray(s.todayJobs)).toBe(true);
    expect(Array.isArray(s.openTasks)).toBe(true);
    expect(typeof s.byStage.new).toBe("number");
  });

  it("surfaces an open task", async () => {
    await SELF.fetch("http://x/api/tasks", { method: "POST", headers: AUTH, body: JSON.stringify({ title: "Dash task", due_at: "2026-08-01T12:00:00.000Z" }) });
    const s = (await (await SELF.fetch("http://x/api/stats", { headers: AUTH })).json()) as { openTasks: Array<{ title: string }> };
    expect(s.openTasks.some((t) => t.title === "Dash task")).toBe(true);
  });
});
