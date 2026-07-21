import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { all } from "../src/lib/db";

describe("phase-2 schema", () => {
  it("has jobs, tasks, messages tables", async () => {
    const rows = await all<{ name: string }>(
      env.DB, "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name");
    const names = rows.map((r) => r.name);
    for (const t of ["jobs", "tasks", "messages"]) expect(names).toContain(t);
  });
});
