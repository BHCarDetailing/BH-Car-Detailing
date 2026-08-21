import { env, fetchMock } from "cloudflare:test";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getAccessToken, listCalendars, syncGoogleBusy } from "../src/lib/gcal";

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

// The sync window is now..now+60d, so fixtures must be relative to today —
// a hard-coded future date would fall outside the window and the stale-row
// cleanup could never match it.
const DAY = 86_400_000;
const at = (offsetDays: number, utcHour: number): string => {
  const d = new Date(Date.now() + offsetDays * DAY);
  d.setUTCHours(utcHour, 0, 0, 0);
  return d.toISOString();
};
const ymd = (offsetDays: number): string => new Date(Date.now() + offsetDays * DAY).toISOString().slice(0, 10);

function gEvent(over: Record<string, unknown> = {}) {
  return {
    id: "e1", status: "confirmed", summary: "Dentist",
    start: { dateTime: at(7, 15) },
    end: { dateTime: at(7, 16) },
    ...over,
  };
}

function mockEvents(items: unknown[]) {
  fetchMock.get("https://www.googleapis.com")
    .intercept({ path: /\/calendar\/v3\/calendars\/.*\/events/ })
    .reply(200, { items });
}

const countBusy = async (): Promise<number> =>
  Number((await env.DB.prepare("SELECT COUNT(*) n FROM gcal_busy").first<{ n: number }>())?.n ?? -1);

describe("inbound sync", () => {
  beforeEach(async () => {
    await env.DB.prepare("DELETE FROM gcal_busy").run();
    await env.DB.prepare(
      "INSERT INTO settings (key, value) VALUES ('gcal_calendars', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
    ).bind(JSON.stringify(["a@b.com"])).run();
    await connect(Date.now() + 300_000);
  });

  it("stores a confirmed busy event", async () => {
    mockEvents([gEvent()]);
    await syncGoogleBusy(env);
    const row = await env.DB.prepare("SELECT summary, starts_at FROM gcal_busy").first();
    expect(row?.summary).toBe("Dentist");
    expect(row?.starts_at).toBe(at(7, 15));
  });

  it("skips events marked Free", async () => {
    mockEvents([gEvent({ transparency: "transparent" })]);
    await syncGoogleBusy(env);
    expect(await countBusy()).toBe(0);
  });

  it("keeps events with no transparency field — the API default is busy", async () => {
    mockEvents([gEvent()]);
    await syncGoogleBusy(env);
    expect(await countBusy()).toBe(1);
  });

  it("skips cancelled events", async () => {
    mockEvents([gEvent({ status: "cancelled" })]);
    await syncGoogleBusy(env);
    expect(await countBusy()).toBe(0);
  });

  it("skips events the owner declined", async () => {
    mockEvents([gEvent({ attendees: [{ self: true, responseStatus: "declined" }] })]);
    await syncGoogleBusy(env);
    expect(await countBusy()).toBe(0);
  });

  it("skips events the CRM itself created — loop prevention", async () => {
    mockEvents([gEvent({ extendedProperties: { private: { bh_job_id: "job_1" } } })]);
    await syncGoogleBusy(env);
    expect(await countBusy()).toBe(0);
  });

  it("keeps CRM manual blocks and flags them", async () => {
    mockEvents([gEvent({ extendedProperties: { private: { bh_block: "1" } } })]);
    await syncGoogleBusy(env);
    const row = await env.DB.prepare("SELECT is_block FROM gcal_busy").first();
    expect(row?.is_block).toBe(1);
  });

  it("expands an all-day event to a full local day and marks all_day", async () => {
    mockEvents([gEvent({ start: { date: ymd(7) }, end: { date: ymd(8) } })]);
    await syncGoogleBusy(env);
    const row = await env.DB.prepare("SELECT all_day, starts_at, ends_at FROM gcal_busy").first<
      { all_day: number; starts_at: string; ends_at: string }>();
    expect(row?.all_day).toBe(1);

    // Local midnight in HOME_TZ, whichever side of a DST boundary we land on.
    const localHour = new Intl.DateTimeFormat("en-US",
      { timeZone: "America/New_York", hour: "numeric", hour12: false }).format(new Date(row!.starts_at));
    expect(Number(localHour) % 24).toBe(0);

    const spanHours = (Date.parse(row!.ends_at) - Date.parse(row!.starts_at)) / 3_600_000;
    expect(spanHours).toBeGreaterThanOrEqual(23);
    expect(spanHours).toBeLessThanOrEqual(25);
  });

  it("removes rows for events deleted in Google", async () => {
    mockEvents([gEvent()]);
    await syncGoogleBusy(env);
    expect(await countBusy()).toBe(1);

    mockEvents([]);
    await syncGoogleBusy(env);
    expect(await countBusy()).toBe(0);
  });

  it("keeps the warm cache when Google errors", async () => {
    mockEvents([gEvent()]);
    await syncGoogleBusy(env);

    fetchMock.get("https://www.googleapis.com")
      .intercept({ path: /\/calendar\/v3\/calendars\/.*\/events/ }).reply(500, "boom");
    expect(await syncGoogleBusy(env)).toBeNull();
    expect(await countBusy()).toBe(1);
  });
});
