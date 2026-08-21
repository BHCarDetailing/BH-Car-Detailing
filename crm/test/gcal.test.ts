import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("google calendar schema", () => {
  it("creates gcal_busy with a time-window index", async () => {
    await env.DB.prepare(
      `INSERT INTO gcal_busy (id, calendar_id, summary, starts_at, ends_at, all_day, is_block, synced_at)
       VALUES (?,?,?,?,?,?,?,?)`
    ).bind("evt1@cal", "cal", "Dentist", "2027-01-04T15:00:00.000Z", "2027-01-04T16:00:00.000Z", 0, 0, "2027-01-01T00:00:00.000Z").run();

    const row = await env.DB.prepare("SELECT summary, all_day FROM gcal_busy WHERE id = ?").bind("evt1@cal").first();
    expect(row?.summary).toBe("Dentist");
    expect(row?.all_day).toBe(0);
  });

  it("creates oauth_tokens keyed by provider", async () => {
    await env.DB.prepare(
      `INSERT INTO oauth_tokens (provider, refresh_token, access_token, expires_at, account_email, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?)`
    ).bind("google", "rt", "at", 0, "a@b.com", "2027-01-01T00:00:00.000Z", "2027-01-01T00:00:00.000Z").run();

    const row = await env.DB.prepare("SELECT account_email FROM oauth_tokens WHERE provider = 'google'").first();
    expect(row?.account_email).toBe("a@b.com");
  });

  it("adds the google sync columns to jobs", async () => {
    const info = await env.DB.prepare("PRAGMA table_info(jobs)").all();
    const cols = info.results.map((r) => (r as { name: string }).name);
    expect(cols).toContain("gcal_event_id");
    expect(cols).toContain("gcal_synced_at");
    expect(cols).toContain("gcal_error");
  });

  it("exposes PUBLIC_BASE_URL so the OAuth redirect can be derived", () => {
    expect(env.PUBLIC_BASE_URL).toMatch(/^https?:\/\//);
  });
});
