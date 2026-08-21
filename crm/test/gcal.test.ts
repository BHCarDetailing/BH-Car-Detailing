import { env, fetchMock } from "cloudflare:test";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { getAccessToken, listCalendars } from "../src/lib/gcal";

beforeAll(() => { fetchMock.activate(); fetchMock.disableNetConnect(); });
afterEach(() => fetchMock.assertNoPendingInterceptors());

async function connect(expiresAt: number, accessToken: string | null = "cached-at") {
  await env.DB.prepare("DELETE FROM oauth_tokens").run();
  await env.DB.prepare(
    `INSERT INTO oauth_tokens (provider, refresh_token, access_token, expires_at, account_email, created_at, updated_at)
     VALUES ('google', 'rt-123', ?, ?, 'a@b.com', '2027-01-01T00:00:00.000Z', '2027-01-01T00:00:00.000Z')`
  ).bind(accessToken, expiresAt).run();
}

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

describe("google access tokens", () => {
  it("returns null when no account is connected", async () => {
    await env.DB.prepare("DELETE FROM oauth_tokens").run();
    expect(await getAccessToken(env)).toBeNull();
  });

  it("reuses a cached token that has more than 60s left", async () => {
    await connect(Date.now() + 300_000);
    expect(await getAccessToken(env)).toBe("cached-at");
  });

  it("refreshes an expired token and stores the new one", async () => {
    await connect(Date.now() - 1000);
    fetchMock.get("https://oauth2.googleapis.com").intercept({ path: "/token", method: "POST" })
      .reply(200, { access_token: "fresh-at", expires_in: 3600 });

    expect(await getAccessToken(env)).toBe("fresh-at");
    const row = await env.DB.prepare("SELECT access_token FROM oauth_tokens WHERE provider='google'").first();
    expect(row?.access_token).toBe("fresh-at");
  });

  it("fails open and records the error when the refresh is rejected", async () => {
    await connect(Date.now() - 1000);
    fetchMock.get("https://oauth2.googleapis.com").intercept({ path: "/token", method: "POST" })
      .reply(400, { error: "invalid_grant" });

    expect(await getAccessToken(env)).toBeNull();
    const row = await env.DB.prepare("SELECT value FROM settings WHERE key='gcal_last_error'").first();
    expect(String(row?.value)).toMatch(/invalid_grant/);
  });

  it("lists calendars", async () => {
    await connect(Date.now() + 300_000);
    fetchMock.get("https://www.googleapis.com").intercept({ path: /\/calendar\/v3\/users\/me\/calendarList/ })
      .reply(200, { items: [{ id: "a@b.com", summary: "a@b.com", primary: true }, { id: "hol", summary: "Holidays" }] });

    const cals = await listCalendars(env);
    expect(cals.map((c) => c.id)).toEqual(["a@b.com", "hol"]);
  });
});
