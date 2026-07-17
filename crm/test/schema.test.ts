import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { all, one, run, uuid, nowIso } from "../src/lib/db";

describe("schema", () => {
  it("has all phase-1 tables", async () => {
    const rows = await all<{ name: string }>(
      env.DB,
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    );
    const names = rows.map((r) => r.name);
    for (const t of ["contacts", "vehicles", "activities", "custom_field_defs", "settings", "rl_events"]) {
      expect(names).toContain(t);
    }
  });

  it("inserts and reads a contact via helpers", async () => {
    const id = uuid();
    const now = nowIso();
    await run(env.DB, "INSERT INTO contacts (id, first_name, stage, created_at, updated_at) VALUES (?,?,?,?,?)",
      id, "Test", "new", now, now);
    const row = await one<{ id: string; stage: string; tags: string }>(
      env.DB, "SELECT id, stage, tags FROM contacts WHERE id = ?", id);
    expect(row?.stage).toBe("new");
    expect(row?.tags).toBe("[]"); // default applied
  });
});
