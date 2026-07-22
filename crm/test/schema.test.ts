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

describe("migration 0006 — missed_call_textback", () => {
  it("creates missed_calls with all V1.1 columns", async () => {
    const cols = await all<{ name: string }>(env.DB, "PRAGMA table_info(missed_calls)");
    const names = cols.map((c) => c.name);
    for (const n of ["id","contact_id","from_phone","to_phone","call_sid","dial_status","texted","message_id","skip_reason","text_template_snapshot","duration_seconds","acknowledged_at","created_at"]) {
      expect(names).toContain(n);
    }
  });

  it("adds opt-out and lead-source columns to contacts", async () => {
    const cols = await all<{ name: string }>(env.DB, "PRAGMA table_info(contacts)");
    const names = cols.map((c) => c.name);
    for (const n of ["sms_opt_out_auto","lead_source","first_contact_method","acquisition_channel"]) {
      expect(names).toContain(n);
    }
  });

  it("defaults sms_opt_out_auto to 0", async () => {
    await run(env.DB, "INSERT INTO contacts (id, phone, stage, source, created_at, updated_at) VALUES ('optd','+13050000001','new','test',?,?)", new Date().toISOString(), new Date().toISOString());
    const row = await one<{ sms_opt_out_auto: number }>(env.DB, "SELECT sms_opt_out_auto FROM contacts WHERE id = 'optd'");
    expect(row?.sms_opt_out_auto).toBe(0);
  });
});
