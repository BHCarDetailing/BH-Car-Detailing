import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

const AUTH = { Authorization: "Bearer dev-agent-key", "Content-Type": "application/json" };

interface StatsRevenue {
  all_time_cents: number; jobs_paid_all: number; pipeline_cents: number; pipeline_jobs: number;
}
async function revenue(): Promise<StatsRevenue> {
  const s = (await (await SELF.fetch("http://x/api/stats", { headers: AUTH })).json()) as { revenue: StatsRevenue };
  return s.revenue;
}

describe("stats folds in the revenue_entries ledger", () => {
  it("adds a paid revenue entry to all-time revenue and sale count", async () => {
    const before = await revenue();
    const res = await SELF.fetch("http://x/api/c/revenue", {
      method: "POST", headers: AUTH,
      body: JSON.stringify({ label: "Full detail — 911", amount_cents: 42000, status: "paid", occurred_at: "2026-07-15" }),
    });
    expect(res.status).toBe(201);
    const after = await revenue();
    expect(after.all_time_cents).toBe(before.all_time_cents + 42000);
    expect(after.jobs_paid_all).toBe(before.jobs_paid_all + 1);
  });

  it("counts pending revenue entries as pipeline, not realized revenue", async () => {
    const before = await revenue();
    await SELF.fetch("http://x/api/c/revenue", {
      method: "POST", headers: AUTH,
      body: JSON.stringify({ label: "Quoted ceramic", amount_cents: 90000, status: "pending", occurred_at: "2026-07-20" }),
    });
    const after = await revenue();
    expect(after.pipeline_cents).toBe(before.pipeline_cents + 90000);
    expect(after.pipeline_jobs).toBe(before.pipeline_jobs + 1);
    expect(after.all_time_cents).toBe(before.all_time_cents); // pending is not realized
  });
});
