# Google Calendar Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Google Calendar events marked Busy block public booking slots and render in the CRM Calendar; CRM jobs push to Google as real API events; the owner can block time from the CRM.

**Architecture:** A new `crm/src/lib/gcal.ts` owns all Google I/O (OAuth token refresh, event read, event write). `crm/src/routes/google.ts` owns the OAuth handshake and admin endpoints. Inbound events land in a `gcal_busy` cache table; `crm/src/lib/booking.ts` unions that cache with the `jobs` table through one extracted `busyWindows()` helper that both `availableSlots()` and `slotIsFree()` call. Outbound job pushes run in `ctx.waitUntil` after the job row commits, so Google never blocks or fails a booking.

**Tech Stack:** Cloudflare Workers, Hono 4, D1 (SQLite), TypeScript, Vitest via `@cloudflare/vitest-pool-workers`, React 18 + Tailwind for the admin SPA.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-08-21-google-calendar-booking-block-design.md` rev 2. It is the authority; this plan implements it.
- **OAuth scope:** exactly `https://www.googleapis.com/auth/calendar.events`. Do not request `calendar` (calendar management) or `calendar.readonly`.
- **Deployed base URL:** `https://bh-crm.bhdev.workers.dev`. The registered redirect URI is `https://bh-crm.bhdev.workers.dev/api/settings/google/callback` — character-exact, no trailing slash.
- **Secrets already uploaded:** `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`. Never read, log, or echo their values.
- **Fail open, both directions.** A Google failure must never hide booking slots and must never roll back or reject a job write. Every Google call site needs a catch that degrades instead of throwing.
- **Refresh tokens are never returned to a client.** They live in `oauth_tokens`, which no route may select back out to the browser. `GET /api/settings` returns the whole `settings` table to the admin SPA — nothing Google-secret may go in there.
- **Loop prevention:** every event the CRM creates for a job carries `extendedProperties.private.bh_job_id`. The inbound sync skips any event carrying that key. Manual blocks carry `bh_block: "1"` and are **not** skipped.
- **Windows dev machine.** PowerShell 5.1 blocks `npx.ps1`. Use `npx.cmd` (or `npm test`, which works). `&&` is not a valid separator in PowerShell 5.1 — use `;` or separate lines.
- **Style:** match the surrounding code — 2-space indent, named exports, `one`/`all`/`run` from `crm/src/lib/db.ts` for D1, no ORM, comments only where the *why* is non-obvious.

## File Structure

**Created**

| File | Responsibility |
|---|---|
| `crm/migrations/0024_google_calendar.sql` | `gcal_busy`, `oauth_tokens`, three `jobs` columns |
| `crm/src/lib/gcal.ts` | All Google HTTP: token refresh, calendar list, event read, event write |
| `crm/src/routes/google.ts` | OAuth handshake + admin endpoints, mounted at `/api/settings/google` |
| `crm/test/gcal.test.ts` | Token refresh, sync filtering, loop prevention |
| `crm/test/gcal-blocking.test.ts` | Slot blocking, fail-open, `busyWindows` regression guard |
| `crm/test/gcal-push.test.ts` | Job lifecycle → Google, retry, manual blocks |

**Modified**

| File | Change |
|---|---|
| `crm/wrangler.jsonc` | Add `PUBLIC_BASE_URL` var |
| `crm/vitest.config.ts` | Add `PUBLIC_BASE_URL` + Google creds to miniflare test bindings |
| `crm/src/types.ts` | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` on `Env` |
| `crm/src/lib/booking.ts` | Extract `busyWindows()` + `overlaps()`; union `gcal_busy` |
| `crm/src/index.ts` | Mount `/api/settings/google`; add sync + push retry to the 5-min cron |
| `crm/src/routes/jobs.ts` | Push hooks on create / patch / delete |
| `crm/src/routes/quotebuilder.ts` | Push hook on the public booking job insert |
| `crm/src/routes/misc.ts` | `google_calendar` in the integrations presence map |
| `crm/admin/src/pages/Settings.tsx` | Google Calendar card |
| `crm/admin/src/pages/Calendar.tsx` | Grey Google chips + block-time control |

---

### Task 1: Schema and configuration

**Files:**
- Create: `crm/migrations/0024_google_calendar.sql`
- Modify: `crm/wrangler.jsonc`, `crm/vitest.config.ts`, `crm/src/types.ts`
- Test: `crm/test/gcal.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: tables `gcal_busy` and `oauth_tokens`; columns `jobs.gcal_event_id`, `jobs.gcal_synced_at`, `jobs.gcal_error`; `Env.GOOGLE_CLIENT_ID?: string`, `Env.GOOGLE_CLIENT_SECRET?: string`; `PUBLIC_BASE_URL` populated in dev, test, and production.

- [ ] **Step 1: Write the failing schema test**

Create `crm/test/gcal.test.ts`:

```ts
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
```

- [ ] **Step 2: Run it to confirm it fails**

```bash
cd crm && npm test -- test/gcal.test.ts
```

Expected: FAIL — `no such table: gcal_busy`.

- [ ] **Step 3: Write the migration**

Create `crm/migrations/0024_google_calendar.sql`:

```sql
-- Google Calendar two-way sync.
-- gcal_busy is a cache of Google events that block booking slots. It is
-- rebuilt from Google on every sync; nothing here is a source of truth.
CREATE TABLE gcal_busy (
  id          TEXT PRIMARY KEY,   -- "<google event id>@<calendar id>"
  calendar_id TEXT NOT NULL,
  summary     TEXT,
  starts_at   TEXT NOT NULL,
  ends_at     TEXT NOT NULL,
  all_day     INTEGER NOT NULL DEFAULT 0,
  is_block    INTEGER NOT NULL DEFAULT 0,
  synced_at   TEXT NOT NULL
);
CREATE INDEX gcal_busy_window ON gcal_busy (starts_at, ends_at);

-- Deliberately NOT in `settings`: GET /api/settings returns that whole table
-- to the admin browser, which would ship a long-lived Google credential to
-- the frontend on every page load.
CREATE TABLE oauth_tokens (
  provider      TEXT PRIMARY KEY,
  refresh_token TEXT NOT NULL,
  access_token  TEXT,
  expires_at    INTEGER,
  account_email TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

ALTER TABLE jobs ADD COLUMN gcal_event_id TEXT;
ALTER TABLE jobs ADD COLUMN gcal_synced_at TEXT;
ALTER TABLE jobs ADD COLUMN gcal_error TEXT;
```

- [ ] **Step 4: Add `PUBLIC_BASE_URL` to the Worker config**

In `crm/wrangler.jsonc`, extend the existing `vars` block:

```jsonc
  "vars": {
    "ALLOWED_ORIGINS": "https://bhcardetails.com,https://www.bhcardetails.com,http://localhost:4173,http://127.0.0.1:4173",
    "HOME_TZ": "America/New_York",
    // Absolute origin of the deployed Worker. The OAuth redirect URI is derived
    // from this and must match what is registered in Google Cloud Console.
    // Previously unset, which left sequences.ts falling back to a hostname that
    // does not resolve and missedcall.ts emitting domain-less links.
    "PUBLIC_BASE_URL": "https://bh-crm.bhdev.workers.dev"
  },
```

- [ ] **Step 5: Add test bindings**

In `crm/vitest.config.ts`, extend the `bindings` object:

```ts
            bindings: {
              TEST_MIGRATIONS: migrations,
              ADMIN_PASSWORD: "dev-password",
              SESSION_SECRET: "dev-session-secret-change-me-0123456789",
              AGENT_API_KEY: "dev-agent-key",
              STRIPE_WEBHOOK_SECRET: "whsec_test_secret",
              PUBLIC_BASE_URL: "https://bh-crm.bhdev.workers.dev",
              GOOGLE_CLIENT_ID: "test-client-id.apps.googleusercontent.com",
              GOOGLE_CLIENT_SECRET: "GOCSPX-test-secret",
            },
```

- [ ] **Step 6: Add the Google credentials to `Env`**

In `crm/src/types.ts`, after `STRIPE_WEBHOOK_SECRET`:

```ts
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
```

- [ ] **Step 7: Run the test to verify it passes**

```bash
cd crm && npm test -- test/gcal.test.ts
```

Expected: 4 passed.

- [ ] **Step 8: Run the whole suite — the migration must not break existing tests**

```bash
cd crm && npm test
```

Expected: all pre-existing tests still pass. `jobs-schema.test.ts` and `schema.test.ts` are the ones most likely to notice new columns; if either asserts an exact column list, update it to include the three new columns rather than removing the assertion.

- [ ] **Step 9: Commit**

```bash
git add crm/migrations/0024_google_calendar.sql crm/wrangler.jsonc crm/vitest.config.ts crm/src/types.ts crm/test/gcal.test.ts
git commit -m "feat(crm): schema and config for Google Calendar sync"
```

---

### Task 2: Google token refresh and calendar list

**Files:**
- Create: `crm/src/lib/gcal.ts`
- Test: `crm/test/gcal.test.ts` (extend)

**Interfaces:**
- Consumes: `oauth_tokens` from Task 1; `Env.GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`.
- Produces:
  - `getAccessToken(env: Env): Promise<string | null>` — null when disconnected or refresh fails.
  - `listCalendars(env: Env): Promise<GCalendar[]>` where `interface GCalendar { id: string; summary: string; primary?: boolean }`.
  - `setGcalError(env: Env, msg: string): Promise<void>` / `clearGcalError(env: Env): Promise<void>`.
  - `GOOGLE_SCOPE`, `TOKEN_URL`, `AUTH_URL`, `API_BASE` constants.

- [ ] **Step 1: Write the failing tests**

Append to `crm/test/gcal.test.ts`:

```ts
import { fetchMock } from "cloudflare:test";
import { beforeAll, afterEach } from "vitest";
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
```

- [ ] **Step 2: Run to confirm it fails**

```bash
cd crm && npm test -- test/gcal.test.ts
```

Expected: FAIL — cannot resolve `../src/lib/gcal`.

- [ ] **Step 3: Implement the auth half of `gcal.ts`**

Create `crm/src/lib/gcal.ts`:

```ts
import type { Env } from "../types";
import { one, run, nowIso } from "./db";

export const GOOGLE_SCOPE = "https://www.googleapis.com/auth/calendar.events";
export const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const TOKEN_URL = "https://oauth2.googleapis.com/token";
export const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
export const API_BASE = "https://www.googleapis.com/calendar/v3";

export interface GCalendar { id: string; summary: string; primary?: boolean }

interface TokenRow {
  refresh_token: string;
  access_token: string | null;
  expires_at: number | null;
}

export async function setGcalError(env: Env, msg: string): Promise<void> {
  await run(env.DB,
    "INSERT INTO settings (key, value) VALUES ('gcal_last_error', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    msg.slice(0, 300));
}

export async function clearGcalError(env: Env): Promise<void> {
  await run(env.DB,
    "INSERT INTO settings (key, value) VALUES ('gcal_last_error', '') ON CONFLICT(key) DO UPDATE SET value = ''");
}

/**
 * Access token for the connected account, or null when disconnected or when
 * Google refuses the refresh. Null is a normal return, not an exception: every
 * caller degrades rather than failing the request it is serving.
 */
export async function getAccessToken(env: Env): Promise<string | null> {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) return null;
  const row = await one<TokenRow>(env.DB,
    "SELECT refresh_token, access_token, expires_at FROM oauth_tokens WHERE provider = 'google'");
  if (!row) return null;

  // 60s of slack so a token cannot expire mid-flight.
  if (row.access_token && row.expires_at && row.expires_at - Date.now() > 60_000) return row.access_token;

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: row.refresh_token,
      grant_type: "refresh_token",
    }),
  }).catch(() => null);

  if (!res || !res.ok) {
    const detail = res ? await res.text().catch(() => "") : "network_error";
    await setGcalError(env, `token_refresh_failed: ${detail}`.slice(0, 300));
    return null;
  }

  const body = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!body.access_token) {
    await setGcalError(env, "token_refresh_failed: no access_token in response");
    return null;
  }
  const expiresAt = Date.now() + (body.expires_in ?? 3600) * 1000;
  await run(env.DB,
    "UPDATE oauth_tokens SET access_token = ?, expires_at = ?, updated_at = ? WHERE provider = 'google'",
    body.access_token, expiresAt, nowIso());
  await clearGcalError(env);
  return body.access_token;
}

/** GET against the Calendar API with the current token. Null on any failure. */
export async function gapi<T>(env: Env, path: string): Promise<T | null> {
  const token = await getAccessToken(env);
  if (!token) return null;
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  }).catch(() => null);
  if (!res || !res.ok) {
    await setGcalError(env, `api_error ${res?.status ?? "network"}: ${path}`);
    return null;
  }
  return (await res.json()) as T;
}

export async function listCalendars(env: Env): Promise<GCalendar[]> {
  const body = await gapi<{ items?: GCalendar[] }>(env, "/users/me/calendarList?minAccessRole=reader&maxResults=250");
  return body?.items ?? [];
}
```

- [ ] **Step 4: Run to verify it passes**

```bash
cd crm && npm test -- test/gcal.test.ts
```

Expected: 9 passed.

- [ ] **Step 5: Commit**

```bash
git add crm/src/lib/gcal.ts crm/test/gcal.test.ts
git commit -m "feat(crm): Google OAuth token refresh and calendar list"
```

---

### Task 3: Inbound event sync

**Files:**
- Modify: `crm/src/lib/gcal.ts`
- Test: `crm/test/gcal.test.ts` (extend)

**Interfaces:**
- Consumes: `gapi()`, `getAccessToken()`, `setGcalError()`, `clearGcalError()` from Task 2; `zonedToUtcIso()` from `crm/src/lib/booking.ts`.
- Produces:
  - `syncGoogleBusy(env: Env): Promise<{ synced: number; skipped: number } | null>` — null when disconnected or Google failed.
  - `syncIfStale(env: Env, maxAgeMs?: number): Promise<void>` — default 5 minutes.
  - `selectedCalendars(env: Env): Promise<string[]>`.
  - `SYNC_WINDOW_DAYS = 60`.

- [ ] **Step 1: Write the failing tests**

Append to `crm/test/gcal.test.ts`:

```ts
import { syncGoogleBusy } from "../src/lib/gcal";

function gEvent(over: Record<string, unknown> = {}) {
  return {
    id: "e1", status: "confirmed", summary: "Dentist",
    start: { dateTime: "2027-01-04T15:00:00Z" },
    end: { dateTime: "2027-01-04T16:00:00Z" },
    ...over,
  };
}

async function mockEvents(items: unknown[]) {
  fetchMock.get("https://www.googleapis.com")
    .intercept({ path: /\/calendar\/v3\/calendars\/.*\/events/ })
    .reply(200, { items });
}

describe("inbound sync", () => {
  beforeEach(async () => {
    await env.DB.prepare("DELETE FROM gcal_busy").run();
    await env.DB.prepare(
      "INSERT INTO settings (key, value) VALUES ('gcal_calendars', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
    ).bind(JSON.stringify(["a@b.com"])).run();
    await connect(Date.now() + 300_000);
  });

  it("stores a confirmed busy event", async () => {
    await mockEvents([gEvent()]);
    await syncGoogleBusy(env);
    const row = await env.DB.prepare("SELECT summary, starts_at FROM gcal_busy").first();
    expect(row?.summary).toBe("Dentist");
    expect(row?.starts_at).toBe("2027-01-04T15:00:00.000Z");
  });

  it("skips events marked Free", async () => {
    await mockEvents([gEvent({ transparency: "transparent" })]);
    await syncGoogleBusy(env);
    expect((await env.DB.prepare("SELECT COUNT(*) n FROM gcal_busy").first())?.n).toBe(0);
  });

  it("keeps events with no transparency field — the API default is busy", async () => {
    await mockEvents([gEvent()]);
    await syncGoogleBusy(env);
    expect((await env.DB.prepare("SELECT COUNT(*) n FROM gcal_busy").first())?.n).toBe(1);
  });

  it("skips cancelled events", async () => {
    await mockEvents([gEvent({ status: "cancelled" })]);
    await syncGoogleBusy(env);
    expect((await env.DB.prepare("SELECT COUNT(*) n FROM gcal_busy").first())?.n).toBe(0);
  });

  it("skips events the owner declined", async () => {
    await mockEvents([gEvent({ attendees: [{ self: true, responseStatus: "declined" }] })]);
    await syncGoogleBusy(env);
    expect((await env.DB.prepare("SELECT COUNT(*) n FROM gcal_busy").first())?.n).toBe(0);
  });

  it("skips events the CRM itself created — loop prevention", async () => {
    await mockEvents([gEvent({ extendedProperties: { private: { bh_job_id: "job_1" } } })]);
    await syncGoogleBusy(env);
    expect((await env.DB.prepare("SELECT COUNT(*) n FROM gcal_busy").first())?.n).toBe(0);
  });

  it("keeps CRM manual blocks and flags them", async () => {
    await mockEvents([gEvent({ extendedProperties: { private: { bh_block: "1" } } })]);
    await syncGoogleBusy(env);
    const row = await env.DB.prepare("SELECT is_block FROM gcal_busy").first();
    expect(row?.is_block).toBe(1);
  });

  it("expands an all-day event to a full local day and marks all_day", async () => {
    await mockEvents([gEvent({ start: { date: "2027-01-04" }, end: { date: "2027-01-05" } })]);
    await syncGoogleBusy(env);
    const row = await env.DB.prepare("SELECT all_day, starts_at, ends_at FROM gcal_busy").first() as
      { all_day: number; starts_at: string; ends_at: string };
    expect(row.all_day).toBe(1);
    // America/New_York is UTC-5 in January.
    expect(row.starts_at).toBe("2027-01-04T05:00:00.000Z");
    expect(row.ends_at).toBe("2027-01-05T05:00:00.000Z");
  });

  it("removes rows for events deleted in Google", async () => {
    await mockEvents([gEvent()]);
    await syncGoogleBusy(env);
    expect((await env.DB.prepare("SELECT COUNT(*) n FROM gcal_busy").first())?.n).toBe(1);

    await mockEvents([]);
    await syncGoogleBusy(env);
    expect((await env.DB.prepare("SELECT COUNT(*) n FROM gcal_busy").first())?.n).toBe(0);
  });

  it("keeps the warm cache when Google errors", async () => {
    await mockEvents([gEvent()]);
    await syncGoogleBusy(env);

    fetchMock.get("https://www.googleapis.com")
      .intercept({ path: /\/calendar\/v3\/calendars\/.*\/events/ }).reply(500, "boom");
    expect(await syncGoogleBusy(env)).toBeNull();
    expect((await env.DB.prepare("SELECT COUNT(*) n FROM gcal_busy").first())?.n).toBe(1);
  });
});
```

Add `beforeEach` to the vitest import at the top of the file.

- [ ] **Step 2: Run to confirm it fails**

```bash
cd crm && npm test -- test/gcal.test.ts
```

Expected: FAIL — `syncGoogleBusy is not a function`.

- [ ] **Step 3: Implement the sync**

Append to `crm/src/lib/gcal.ts`:

```ts
import { zonedToUtcIso } from "./booking";
import { all } from "./db";

export const SYNC_WINDOW_DAYS = 60;

interface GEvent {
  id: string;
  status?: string;
  summary?: string;
  transparency?: string;
  start?: { date?: string; dateTime?: string };
  end?: { date?: string; dateTime?: string };
  attendees?: Array<{ self?: boolean; responseStatus?: string }>;
  extendedProperties?: { private?: Record<string, string> };
}

export async function selectedCalendars(env: Env): Promise<string[]> {
  const row = await one<{ value: string }>(env.DB, "SELECT value FROM settings WHERE key = 'gcal_calendars'");
  if (!row?.value) return [];
  try {
    const parsed = JSON.parse(row.value);
    return Array.isArray(parsed) ? parsed.filter((v) => typeof v === "string") : [];
  } catch { return []; }
}

/** True when this event should occupy time on the booking calendar. */
function blocks(ev: GEvent): boolean {
  if (ev.status === "cancelled") return false;
  // Absent transparency means "opaque" per the Calendar API — i.e. busy.
  if (ev.transparency === "transparent") return false;
  if (ev.attendees?.some((a) => a.self && a.responseStatus === "declined")) return false;
  // Events this CRM created for a job are already represented by the job row.
  // Counting them here would block the time twice and render two chips.
  if (ev.extendedProperties?.private?.bh_job_id) return false;
  return true;
}

/** UTC span for an event. All-day dates are local midnights; Google's end date is exclusive. */
function span(ev: GEvent, tz: string): { start: string; end: string; allDay: boolean } | null {
  if (ev.start?.dateTime && ev.end?.dateTime) {
    return {
      start: new Date(ev.start.dateTime).toISOString(),
      end: new Date(ev.end.dateTime).toISOString(),
      allDay: false,
    };
  }
  if (ev.start?.date && ev.end?.date) {
    return {
      start: zonedToUtcIso(ev.start.date, "00:00", tz),
      end: zonedToUtcIso(ev.end.date, "00:00", tz),
      allDay: true,
    };
  }
  return null;
}

/**
 * Refresh `gcal_busy` from Google. Returns null when disconnected or when any
 * calendar read fails — in that case the existing cache is left intact so the
 * last known-good busy times keep blocking.
 */
export async function syncGoogleBusy(env: Env): Promise<{ synced: number; skipped: number } | null> {
  const calendars = await selectedCalendars(env);
  if (calendars.length === 0) return null;

  const tz = env.HOME_TZ || "America/New_York";
  const now = Date.now();
  const timeMin = new Date(now).toISOString();
  const timeMax = new Date(now + SYNC_WINDOW_DAYS * 86_400_000).toISOString();

  const seen: string[] = [];
  const rows: Array<[string, string, string | null, string, string, number, number]> = [];
  let skipped = 0;

  for (const cal of calendars) {
    const qs = new URLSearchParams({
      singleEvents: "true", orderBy: "startTime", maxResults: "250",
      timeMin, timeMax,
    });
    const body = await gapi<{ items?: GEvent[] }>(env, `/calendars/${encodeURIComponent(cal)}/events?${qs}`);
    // A single failed calendar aborts the pass rather than half-wiping the cache.
    if (!body) return null;

    for (const ev of body.items ?? []) {
      if (!blocks(ev)) { skipped++; continue; }
      const s = span(ev, tz);
      if (!s) { skipped++; continue; }
      const id = `${ev.id}@${cal}`;
      seen.push(id);
      rows.push([id, cal, ev.summary ?? null, s.start, s.end, s.allDay ? 1 : 0,
        ev.extendedProperties?.private?.bh_block ? 1 : 0]);
    }
  }

  const syncedAt = nowIso();
  for (const r of rows) {
    await run(env.DB,
      `INSERT INTO gcal_busy (id, calendar_id, summary, starts_at, ends_at, all_day, is_block, synced_at)
       VALUES (?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET
         summary = excluded.summary, starts_at = excluded.starts_at, ends_at = excluded.ends_at,
         all_day = excluded.all_day, is_block = excluded.is_block, synced_at = excluded.synced_at`,
      ...r, syncedAt);
  }

  // Drop anything in the window Google no longer reports — handles deletions.
  const stale = await all<{ id: string }>(env.DB,
    "SELECT id FROM gcal_busy WHERE starts_at < ? AND ends_at > ?", timeMax, timeMin);
  const keep = new Set(seen);
  for (const s of stale) {
    if (!keep.has(s.id)) await run(env.DB, "DELETE FROM gcal_busy WHERE id = ?", s.id);
  }

  await run(env.DB,
    "INSERT INTO settings (key, value) VALUES ('gcal_last_sync', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    syncedAt);
  await clearGcalError(env);
  return { synced: rows.length, skipped };
}

/** Sync only if the cache is older than `maxAgeMs`. Never throws. */
export async function syncIfStale(env: Env, maxAgeMs = 5 * 60_000): Promise<void> {
  try {
    const row = await one<{ value: string }>(env.DB, "SELECT value FROM settings WHERE key = 'gcal_last_sync'");
    const last = row?.value ? Date.parse(row.value) : 0;
    if (Number.isFinite(last) && Date.now() - last < maxAgeMs) return;
    await syncGoogleBusy(env);
  } catch { /* fail open: stale or missing Google data never blocks a booking */ }
}
```

Merge the new `import { one, run, nowIso }` and `import { all }` lines into the single existing `./db` import at the top of the file rather than adding a second one.

- [ ] **Step 4: Run to verify it passes**

```bash
cd crm && npm test -- test/gcal.test.ts
```

Expected: 19 passed.

- [ ] **Step 5: Commit**

```bash
git add crm/src/lib/gcal.ts crm/test/gcal.test.ts
git commit -m "feat(crm): sync Google events into the busy cache"
```

---

### Task 4: Block booking slots on Google busy time

**Files:**
- Modify: `crm/src/lib/booking.ts`, `crm/src/routes/public.ts`
- Test: `crm/test/gcal-blocking.test.ts`

**Interfaces:**
- Consumes: `gcal_busy` from Task 1; `syncIfStale()` from Task 3.
- Produces:
  - `busyWindows(env: Env, fromIso: string, toIso: string): Promise<BusyWindow[]>` where `interface BusyWindow { start: number; end: number }`.
  - `overlaps(start: number, end: number, windows: BusyWindow[], bufferMs: number): boolean`.
  - `availableSlots()` and `slotIsFree()` keep their existing signatures.

- [ ] **Step 1: Write the failing tests**

Create `crm/test/gcal-blocking.test.ts`:

```ts
import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { availableSlots, slotIsFree } from "../src/lib/booking";

const DATE = "2027-02-01"; // a Monday

async function addBusy(startIso: string, endIso: string, over: { allDay?: boolean; isBlock?: boolean } = {}) {
  await env.DB.prepare(
    `INSERT INTO gcal_busy (id, calendar_id, summary, starts_at, ends_at, all_day, is_block, synced_at)
     VALUES (?,?,?,?,?,?,?,?)`
  ).bind(`b${startIso}`, "cal", "Busy thing", startIso, endIso,
    over.allDay ? 1 : 0, over.isBlock ? 1 : 0, new Date().toISOString()).run();
}

describe("google busy time blocks booking slots", () => {
  beforeEach(async () => { await env.DB.prepare("DELETE FROM gcal_busy").run(); });

  it("removes a slot overlapped by a Google event", async () => {
    const before = await availableSlots(env, DATE);
    expect(before.length).toBeGreaterThan(0);
    const target = before[0];

    await addBusy(target, new Date(Date.parse(target) + 3600_000).toISOString());
    const after = await availableSlots(env, DATE);
    expect(after).not.toContain(target);
    expect(after.length).toBe(before.length - 1);
  });

  it("applies the travel buffer around Google events, not just jobs", async () => {
    const before = await availableSlots(env, DATE);
    const target = before[1];
    // A 1-minute event ending just before the slot starts still collides via
    // the 30-minute buffer on each side.
    const evEnd = new Date(Date.parse(target) - 60_000).toISOString();
    const evStart = new Date(Date.parse(evEnd) - 60_000).toISOString();
    await addBusy(evStart, evEnd);

    expect(await availableSlots(env, DATE)).not.toContain(target);
  });

  it("an all-day busy span clears every slot that day", async () => {
    await addBusy(`${DATE}T05:00:00.000Z`, "2027-02-02T05:00:00.000Z", { allDay: true });
    expect(await availableSlots(env, DATE)).toEqual([]);
  });

  it("a multi-day busy span clears every day it covers", async () => {
    await addBusy(`${DATE}T05:00:00.000Z`, "2027-02-04T05:00:00.000Z", { allDay: true });
    expect(await availableSlots(env, DATE)).toEqual([]);
    expect(await availableSlots(env, "2027-02-02")).toEqual([]);
    expect(await availableSlots(env, "2027-02-03")).toEqual([]);
  });

  it("a CRM manual block behaves like any other busy time", async () => {
    const target = (await availableSlots(env, DATE))[0];
    await addBusy(target, new Date(Date.parse(target) + 3600_000).toISOString(), { isBlock: true });
    expect(await availableSlots(env, DATE)).not.toContain(target);
  });

  it("slotIsFree and availableSlots agree on the same fixture", async () => {
    const target = (await availableSlots(env, DATE))[0];
    expect(await slotIsFree(env, target)).toBe(true);

    await addBusy(target, new Date(Date.parse(target) + 3600_000).toISOString());
    expect(await slotIsFree(env, target)).toBe(false);
    expect(await availableSlots(env, DATE)).not.toContain(target);
  });

  it("fails open — an empty cache still returns job-derived slots", async () => {
    expect((await availableSlots(env, DATE)).length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run to confirm it fails**

```bash
cd crm && npm test -- test/gcal-blocking.test.ts
```

Expected: FAIL — the first test's `after.length` still equals `before.length`, because `gcal_busy` is not consulted yet.

- [ ] **Step 3: Extract the shared clash logic in `booking.ts`**

In `crm/src/lib/booking.ts`, replace the `JobWindow` interface and both copies of the inline clash test with one shared pair. Insert after `zonedToUtcIso`:

```ts
export interface BusyWindow { start: number; end: number }

interface JobRow { scheduled_start: string; scheduled_end: string | null }

/**
 * Every occupied window in [fromIso, toIso): CRM jobs plus cached Google busy
 * time. One source of truth so availableSlots() and slotIsFree() can never
 * disagree about what "taken" means.
 */
export async function busyWindows(env: Env, fromIso: string, toIso: string): Promise<BusyWindow[]> {
  const defaultLen = (await businessHours(env)).slot_min * 60_000;

  const jobs = await all<JobRow>(env.DB,
    `SELECT scheduled_start, scheduled_end FROM jobs
     WHERE status IN ('scheduled','in_progress') AND scheduled_start >= ? AND scheduled_start <= ?`,
    fromIso, toIso);

  const windows: BusyWindow[] = jobs.map((j) => {
    const start = Date.parse(j.scheduled_start);
    return { start, end: j.scheduled_end ? Date.parse(j.scheduled_end) : start + defaultLen };
  });

  // Google is advisory: a missing or empty cache simply contributes nothing.
  try {
    const gcal = await all<{ starts_at: string; ends_at: string }>(env.DB,
      "SELECT starts_at, ends_at FROM gcal_busy WHERE ends_at > ? AND starts_at < ?", fromIso, toIso);
    for (const g of gcal) windows.push({ start: Date.parse(g.starts_at), end: Date.parse(g.ends_at) });
  } catch { /* fail open */ }

  return windows.filter((w) => Number.isFinite(w.start) && Number.isFinite(w.end));
}

/** Does [start, end) collide with any window, once `bufferMs` is added to both sides? */
export function overlaps(start: number, end: number, windows: BusyWindow[], bufferMs: number): boolean {
  return windows.some((w) => start < w.end + bufferMs && w.start - bufferMs < end);
}
```

- [ ] **Step 4: Rewrite `availableSlots` to use them**

Replace the body of `availableSlots` in `crm/src/lib/booking.ts`:

```ts
export async function availableSlots(env: Env, dateStr: string): Promise<string[]> {
  const cfg = await businessHours(env);
  const tz = env.HOME_TZ || "America/New_York";
  const dow = new Date(`${dateStr}T12:00:00Z`).getUTCDay();
  if (!cfg.days.includes(dow)) return [];

  const dayStart = Date.parse(zonedToUtcIso(dateStr, cfg.start, tz));
  const dayEnd = Date.parse(zonedToUtcIso(dateStr, cfg.end, tz));
  // Widened either side so a multi-day or overnight window still overlaps this day.
  const windows = await busyWindows(env,
    new Date(dayStart - 72 * 3600_000).toISOString(),
    new Date(dayEnd + 72 * 3600_000).toISOString());

  const slotMs = cfg.slot_min * 60_000;
  const buffer = cfg.buffer_min * 60_000;
  const now = Date.now();
  const out: string[] = [];
  for (let t = dayStart; t + slotMs <= dayEnd + 1; t += slotMs) {
    if (t < now) continue;
    if (!overlaps(t, t + slotMs, windows, buffer)) out.push(new Date(t).toISOString());
  }
  return out;
}
```

Note the widened lookback: the old query filtered on `scheduled_start` within ±6h, which cannot see a multi-day Google span that began days earlier. `busyWindows` filters Google rows on `ends_at > from`, so the span is caught, but the bound still has to be wide enough to include it.

- [ ] **Step 5: Rewrite `slotIsFree` to use them**

```ts
export async function slotIsFree(env: Env, startIso: string): Promise<boolean> {
  const cfg = await businessHours(env);
  const s = Date.parse(startIso);
  if (!Number.isFinite(s)) return false;
  const e = s + cfg.slot_min * 60_000;
  const windows = await busyWindows(env,
    new Date(s - 72 * 3600_000).toISOString(),
    new Date(e + 72 * 3600_000).toISOString());
  return !overlaps(s, e, windows, cfg.buffer_min * 60_000);
}
```

- [ ] **Step 6: Refresh Google before answering availability**

In `crm/src/routes/public.ts`, add `import { syncIfStale } from "../lib/gcal";` alongside the existing booking import, then add one line to the availability handler after the date validation:

```ts
  await syncIfStale(c.env);
  const cfg = await businessHours(c.env);
```

And in the booking submit handler, immediately before the existing `slotIsFree` check at roughly line 431:

```ts
    await syncIfStale(c.env);
    if (!(await slotIsFree(c.env, slot))) return c.json({ ok: false, error: "slot_taken" }, 409, h);
```

- [ ] **Step 7: Run the new tests**

```bash
cd crm && npm test -- test/gcal-blocking.test.ts
```

Expected: 7 passed.

- [ ] **Step 8: Run the full suite — this task rewrote shared booking logic**

```bash
cd crm && npm test
```

Expected: all pass, `booking.test.ts` and `booking-funnel.test.ts` included. If a pre-existing booking test fails, the extraction changed behaviour and must be fixed — do not edit the old test to match.

- [ ] **Step 9: Commit**

```bash
git add crm/src/lib/booking.ts crm/src/routes/public.ts crm/test/gcal-blocking.test.ts
git commit -m "feat(crm): block booking slots on Google busy time"
```

---

### Task 5: OAuth routes

**Files:**
- Create: `crm/src/routes/google.ts`
- Modify: `crm/src/index.ts`, `crm/src/routes/misc.ts`
- Test: `crm/test/gcal-oauth.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 2–3; `requireAuth()` from `crm/src/lib/auth.ts`; `timingSafeEqualStr` from the same.
- Produces: `googleRoutes` (a Hono router) mounted at `/api/settings/google`; endpoints `GET /connect`, `GET /callback`, `GET /status`, `GET /events`, `PUT /calendars`, `POST /sync`, `POST /disconnect`.

- [ ] **Step 1: Write the failing tests**

Create `crm/test/gcal-oauth.test.ts`:

```ts
import { env, SELF, fetchMock } from "cloudflare:test";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

const AUTH = { Authorization: "Bearer dev-agent-key", "Content-Type": "application/json" };

beforeAll(() => { fetchMock.activate(); fetchMock.disableNetConnect(); });
afterEach(() => fetchMock.assertNoPendingInterceptors());

describe("google oauth routes", () => {
  beforeEach(async () => { await env.DB.prepare("DELETE FROM oauth_tokens").run(); });

  it("every endpoint except the callback requires auth", async () => {
    for (const p of ["/connect", "/status", "/events", "/sync", "/disconnect"]) {
      expect((await SELF.fetch(`http://x/api/settings/google${p}`)).status).toBe(401);
    }
  });

  it("connect returns a consent URL with offline access and the events scope", async () => {
    const res = await SELF.fetch("http://x/api/settings/google/connect", { headers: AUTH });
    expect(res.status).toBe(200);
    const { url } = await res.json() as { url: string };
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(u.searchParams.get("access_type")).toBe("offline");
    expect(u.searchParams.get("prompt")).toBe("consent");
    expect(u.searchParams.get("scope")).toBe("https://www.googleapis.com/auth/calendar.events");
    expect(u.searchParams.get("redirect_uri")).toBe("https://bh-crm.bhdev.workers.dev/api/settings/google/callback");
    expect(u.searchParams.get("state")).toBeTruthy();
  });

  it("the callback rejects a forged state", async () => {
    const res = await SELF.fetch("http://x/api/settings/google/callback?code=abc&state=forged");
    expect(res.status).toBe(400);
    expect((await env.DB.prepare("SELECT COUNT(*) n FROM oauth_tokens").first())?.n).toBe(0);
  });

  it("a real state round-trips into a stored refresh token", async () => {
    const { url } = await (await SELF.fetch("http://x/api/settings/google/connect", { headers: AUTH })).json() as { url: string };
    const state = new URL(url).searchParams.get("state")!;

    fetchMock.get("https://oauth2.googleapis.com").intercept({ path: "/token", method: "POST" })
      .reply(200, { access_token: "at", refresh_token: "rt-new", expires_in: 3600 });
    fetchMock.get("https://www.googleapis.com").intercept({ path: /calendarList/ })
      .reply(200, { items: [{ id: "a@b.com", summary: "a@b.com", primary: true }] });

    const res = await SELF.fetch(`http://x/api/settings/google/callback?code=abc&state=${encodeURIComponent(state)}`, { redirect: "manual" });
    expect(res.status).toBe(302);

    const row = await env.DB.prepare("SELECT refresh_token, account_email FROM oauth_tokens WHERE provider='google'").first();
    expect(row?.refresh_token).toBe("rt-new");
    expect(row?.account_email).toBe("a@b.com");
  });

  it("status never leaks the refresh token", async () => {
    await env.DB.prepare(
      `INSERT INTO oauth_tokens (provider, refresh_token, access_token, expires_at, account_email, created_at, updated_at)
       VALUES ('google','SUPERSECRET','at',?, 'a@b.com','x','x')`
    ).bind(Date.now() + 300_000).run();
    fetchMock.get("https://www.googleapis.com").intercept({ path: /calendarList/ })
      .reply(200, { items: [{ id: "a@b.com", summary: "a@b.com", primary: true }] });

    const res = await SELF.fetch("http://x/api/settings/google/status", { headers: AUTH });
    const text = await res.text();
    expect(text).not.toContain("SUPERSECRET");
    expect(JSON.parse(text).connected).toBe(true);
  });

  it("GET /api/settings never leaks the refresh token either", async () => {
    await env.DB.prepare(
      `INSERT INTO oauth_tokens (provider, refresh_token, created_at, updated_at)
       VALUES ('google','SUPERSECRET','x','x')`
    ).run();
    const res = await SELF.fetch("http://x/api/settings", { headers: AUTH });
    expect(await res.text()).not.toContain("SUPERSECRET");
  });

  it("disconnect revokes at Google and clears local state", async () => {
    await env.DB.prepare(
      `INSERT INTO oauth_tokens (provider, refresh_token, created_at, updated_at) VALUES ('google','rt','x','x')`
    ).run();
    await env.DB.prepare(
      `INSERT INTO gcal_busy (id, calendar_id, starts_at, ends_at, all_day, is_block, synced_at)
       VALUES ('e@c','c','2027-01-01T00:00:00.000Z','2027-01-01T01:00:00.000Z',0,0,'x')`
    ).run();
    fetchMock.get("https://oauth2.googleapis.com").intercept({ path: /revoke/, method: "POST" }).reply(200, "");

    const res = await SELF.fetch("http://x/api/settings/google/disconnect", { method: "POST", headers: AUTH });
    expect(res.status).toBe(200);
    expect((await env.DB.prepare("SELECT COUNT(*) n FROM oauth_tokens").first())?.n).toBe(0);
    expect((await env.DB.prepare("SELECT COUNT(*) n FROM gcal_busy").first())?.n).toBe(0);
  });
});
```

- [ ] **Step 2: Run to confirm it fails**

```bash
cd crm && npm test -- test/gcal-oauth.test.ts
```

Expected: FAIL — every route 404s.

- [ ] **Step 3: Implement the routes**

Create `crm/src/routes/google.ts`:

```ts
import { Hono } from "hono";
import type { Env } from "../types";
import { requireAuth, timingSafeEqualStr } from "../lib/auth";
import { all, one, run, nowIso } from "../lib/db";
import {
  AUTH_URL, TOKEN_URL, REVOKE_URL, GOOGLE_SCOPE,
  listCalendars, selectedCalendars, syncGoogleBusy, getAccessToken,
} from "../lib/gcal";

export const googleRoutes = new Hono<{ Bindings: Env }>();

const enc = new TextEncoder();

function redirectUri(env: Env, reqUrl: string): string {
  const base = (env.PUBLIC_BASE_URL || new URL(reqUrl).origin).replace(/\/$/, "");
  return `${base}/api/settings/google/callback`;
}

async function sign(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(payload));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** state = "<expiryMs>.<hmac>". Proves the callback follows this admin's own /connect. */
async function makeState(secret: string): Promise<string> {
  const exp = Date.now() + 10 * 60_000;
  return `${exp}.${await sign(secret, "gcal:" + exp)}`;
}

async function checkState(secret: string, state: string | undefined): Promise<boolean> {
  if (!state) return false;
  const dot = state.indexOf(".");
  if (dot < 1) return false;
  const exp = Number(state.slice(0, dot));
  if (!Number.isFinite(exp) || exp < Date.now()) return false;
  return timingSafeEqualStr(state.slice(dot + 1), await sign(secret, "gcal:" + exp));
}

// The callback is a top-level browser navigation from Google, so it cannot carry
// the admin cookie or bearer token. The signed state is what authenticates it.
googleRoutes.get("/callback", async (c) => {
  const code = c.req.query("code");
  if (!code || !(await checkState(c.env.SESSION_SECRET, c.req.query("state")))) {
    return c.text("Invalid or expired authorization request. Start again from Settings.", 400);
  }
  if (!c.env.GOOGLE_CLIENT_ID || !c.env.GOOGLE_CLIENT_SECRET) return c.text("Google credentials not configured.", 500);

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: c.env.GOOGLE_CLIENT_ID,
      client_secret: c.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri(c.env, c.req.url),
      grant_type: "authorization_code",
    }),
  }).catch(() => null);

  if (!res || !res.ok) return c.text("Google rejected the authorization. Start again from Settings.", 400);
  const body = (await res.json()) as { access_token?: string; refresh_token?: string; expires_in?: number };
  if (!body.refresh_token) {
    return c.text("Google did not return a refresh token. Disconnect the app at myaccount.google.com/permissions and try again.", 400);
  }

  const now = nowIso();
  await run(c.env.DB,
    `INSERT INTO oauth_tokens (provider, refresh_token, access_token, expires_at, created_at, updated_at)
     VALUES ('google', ?, ?, ?, ?, ?)
     ON CONFLICT(provider) DO UPDATE SET
       refresh_token = excluded.refresh_token, access_token = excluded.access_token,
       expires_at = excluded.expires_at, updated_at = excluded.updated_at`,
    body.refresh_token, body.access_token ?? null, Date.now() + (body.expires_in ?? 3600) * 1000, now, now);

  // The primary calendar's id is the account email — no extra scope needed.
  const cals = await listCalendars(c.env);
  const primary = cals.find((x) => x.primary);
  if (primary) {
    await run(c.env.DB, "UPDATE oauth_tokens SET account_email = ? WHERE provider = 'google'", primary.id);
    const existing = await selectedCalendars(c.env);
    if (existing.length === 0) {
      await run(c.env.DB,
        "INSERT INTO settings (key, value) VALUES ('gcal_calendars', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        JSON.stringify([primary.id]));
      await run(c.env.DB,
        "INSERT INTO settings (key, value) VALUES ('gcal_write_calendar', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        primary.id);
    }
  }

  return c.redirect("/settings?google=connected", 302);
});

googleRoutes.use("*", requireAuth());

googleRoutes.get("/connect", async (c) => {
  if (!c.env.GOOGLE_CLIENT_ID) return c.json({ error: "google_not_configured" }, 400);
  const u = new URL(AUTH_URL);
  u.searchParams.set("client_id", c.env.GOOGLE_CLIENT_ID);
  u.searchParams.set("redirect_uri", redirectUri(c.env, c.req.url));
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", GOOGLE_SCOPE);
  u.searchParams.set("access_type", "offline");
  // Without prompt=consent a reconnect returns no refresh_token.
  u.searchParams.set("prompt", "consent");
  u.searchParams.set("state", await makeState(c.env.SESSION_SECRET));
  return c.json({ url: u.toString() });
});

googleRoutes.get("/status", async (c) => {
  const row = await one<{ account_email: string | null }>(c.env.DB,
    "SELECT account_email FROM oauth_tokens WHERE provider = 'google'");
  const settings = await all<{ key: string; value: string }>(c.env.DB,
    "SELECT key, value FROM settings WHERE key IN ('gcal_last_sync','gcal_last_error','gcal_write_calendar')");
  const get = (k: string) => settings.find((s) => s.key === k)?.value ?? "";

  return c.json({
    configured: !!(c.env.GOOGLE_CLIENT_ID && c.env.GOOGLE_CLIENT_SECRET),
    connected: !!row,
    account_email: row?.account_email ?? null,
    calendars: row ? await listCalendars(c.env) : [],
    selected: await selectedCalendars(c.env),
    write_calendar: get("gcal_write_calendar"),
    last_sync: get("gcal_last_sync"),
    last_error: get("gcal_last_error"),
  });
});

googleRoutes.get("/events", async (c) => {
  const from = c.req.query("from");
  const to = c.req.query("to");
  if (!from || !to) return c.json({ error: "from_and_to_required" }, 400);
  const items = await all(c.env.DB,
    `SELECT id, summary, starts_at, ends_at, all_day, is_block FROM gcal_busy
     WHERE ends_at > ? AND starts_at < ? ORDER BY starts_at ASC`,
    from, to);
  return c.json({ items });
});

googleRoutes.put("/calendars", async (c) => {
  const b = ((await c.req.json().catch(() => null)) ?? {}) as { selected?: unknown; write_calendar?: unknown };
  const selected = Array.isArray(b.selected) ? b.selected.filter((v) => typeof v === "string") : [];
  await run(c.env.DB,
    "INSERT INTO settings (key, value) VALUES ('gcal_calendars', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    JSON.stringify(selected));
  if (typeof b.write_calendar === "string") {
    await run(c.env.DB,
      "INSERT INTO settings (key, value) VALUES ('gcal_write_calendar', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      b.write_calendar);
  }
  await syncGoogleBusy(c.env);
  return c.json({ ok: true });
});

googleRoutes.post("/sync", async (c) => c.json({ ok: true, result: await syncGoogleBusy(c.env) }));

googleRoutes.post("/disconnect", async (c) => {
  const token = await getAccessToken(c.env);
  if (token) {
    await fetch(REVOKE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }),
    }).catch(() => null);
  }
  await run(c.env.DB, "DELETE FROM oauth_tokens WHERE provider = 'google'");
  await run(c.env.DB, "DELETE FROM gcal_busy");
  await run(c.env.DB, "DELETE FROM settings WHERE key IN ('gcal_last_sync','gcal_last_error')");
  return c.json({ ok: true });
});
```

- [ ] **Step 4: Mount the router**

In `crm/src/index.ts`, add the import and mount it **before** the existing `/api/settings` route so the more specific prefix wins:

```ts
import { googleRoutes } from "./routes/google";
```

```ts
app.route("/api/settings/google", googleRoutes);
app.route("/api/settings", settingsRoutes);
```

- [ ] **Step 5: Surface Google in the integrations map**

In `crm/src/routes/misc.ts`, inside `settingsRoutes.get("/integrations", ...)`:

```ts
    google_calendar: !!(c.env.GOOGLE_CLIENT_ID && c.env.GOOGLE_CLIENT_SECRET),
```

- [ ] **Step 6: Run the tests**

```bash
cd crm && npm test -- test/gcal-oauth.test.ts
```

Expected: 7 passed.

- [ ] **Step 7: Commit**

```bash
git add crm/src/routes/google.ts crm/src/index.ts crm/src/routes/misc.ts crm/test/gcal-oauth.test.ts
git commit -m "feat(crm): Google Calendar OAuth handshake and admin endpoints"
```

---

### Task 6: Cron sync

**Files:**
- Modify: `crm/src/index.ts`
- Test: `crm/test/gcal.test.ts` (extend)

**Interfaces:**
- Consumes: `syncGoogleBusy()` from Task 3.
- Produces: the 5-minute cron refreshes `gcal_busy`.

- [ ] **Step 1: Add the sync to the 5-minute tick**

In `crm/src/index.ts`, add `import { syncGoogleBusy } from "./lib/gcal";` and extend the non-daily branch:

```ts
    const work = event.cron === "0 13 * * *"
      ? [runRebook(env, now), runTimeTriggers(env, now), runReviewFollowUps(env, now)]
      : [runReminders(env, now), runSequences(env, now), syncGoogleBusy(env).then(() => undefined)];
```

`syncGoogleBusy` returns null rather than throwing on failure, so it cannot reject the `Promise.all`.

- [ ] **Step 2: Verify the whole suite still passes**

```bash
cd crm && npm test
```

Expected: all pass.

- [ ] **Step 3: Commit**

```bash
git add crm/src/index.ts
git commit -m "feat(crm): refresh Google busy cache on the 5-minute cron"
```

---

### Task 7: Settings card

**Files:**
- Modify: `crm/admin/src/pages/Settings.tsx`

**Interfaces:**
- Consumes: `GET/PUT/POST /api/settings/google/*` from Task 5.
- Produces: no exports beyond the page itself.

- [ ] **Step 1: Add the component**

Add to `crm/admin/src/pages/Settings.tsx`, and render `<GoogleCalendarCard />` alongside the existing integration cards:

```tsx
interface GStatus {
  configured: boolean; connected: boolean; account_email: string | null;
  calendars: Array<{ id: string; summary: string; primary?: boolean }>;
  selected: string[]; write_calendar: string; last_sync: string; last_error: string;
}

function GoogleCalendarCard() {
  const [s, setS] = useState<GStatus | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api<GStatus>("/api/settings/google/status").then(setS).catch(() => setS(null));
  }, []);
  useEffect(load, [load]);

  async function connect() {
    const { url } = await api<{ url: string }>("/api/settings/google/connect");
    location.assign(url);
  }

  async function saveCalendars(selected: string[], write: string) {
    setBusy(true);
    await api("/api/settings/google/calendars", {
      method: "PUT", body: JSON.stringify({ selected, write_calendar: write }),
    }).catch(() => {});
    setBusy(false);
    load();
  }

  if (!s) return null;

  return (
    <section className="rounded-xl border border-neutral-200 bg-white p-4">
      <h3 className="font-semibold">Google Calendar</h3>

      {!s.configured && (
        <p className="mt-2 text-sm text-neutral-500">
          Not configured — GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are not set on the Worker.
        </p>
      )}

      {s.configured && !s.connected && (
        <>
          <p className="mt-2 text-sm text-neutral-600">
            Connect your Google account so events marked Busy block customer booking times,
            and CRM jobs appear on your calendar straight away.
          </p>
          <Button className="mt-3" onClick={connect}>Connect Google Calendar</Button>
        </>
      )}

      {s.connected && (
        <>
          {s.last_error && (
            <div className="mt-2 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
              Reconnect needed — {s.last_error}
            </div>
          )}
          <p className="mt-2 text-sm text-neutral-600">Connected as {s.account_email}</p>

          <p className="mt-3 text-xs font-semibold uppercase text-neutral-500">Block booking times from</p>
          {s.calendars.map((c) => (
            <label key={c.id} className="mt-1 flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={s.selected.includes(c.id)}
                disabled={busy}
                onChange={(e) => saveCalendars(
                  e.target.checked ? [...s.selected, c.id] : s.selected.filter((x) => x !== c.id),
                  s.write_calendar)}
              />
              {c.summary}
            </label>
          ))}

          <p className="mt-3 text-xs font-semibold uppercase text-neutral-500">Write CRM jobs to</p>
          <select
            className="mt-1 w-full rounded-md border border-neutral-300 px-2 py-1 text-sm"
            value={s.write_calendar}
            disabled={busy}
            onChange={(e) => saveCalendars(s.selected, e.target.value)}
          >
            {s.calendars.map((c) => <option key={c.id} value={c.id}>{c.summary}</option>)}
          </select>

          <p className="mt-3 text-xs text-neutral-500">
            Last synced: {s.last_sync ? new Date(s.last_sync).toLocaleString() : "never"}
          </p>
          <div className="mt-3 flex gap-2">
            <Button onClick={async () => { setBusy(true); await api("/api/settings/google/sync", { method: "POST" }); setBusy(false); load(); }}>
              Sync now
            </Button>
            <Button
              onClick={async () => {
                if (!confirm("Disconnect Google Calendar? Booking times will stop respecting your calendar.")) return;
                await api("/api/settings/google/disconnect", { method: "POST" });
                load();
              }}
            >
              Disconnect
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
```

- [ ] **Step 2: Typecheck the admin bundle**

```bash
cd crm/admin && npx.cmd tsc --noEmit
```

Expected: no errors. If `useCallback`/`useEffect`/`useState` are not already imported at the top of `Settings.tsx`, add them to the existing React import.

- [ ] **Step 3: Commit**

```bash
git add crm/admin/src/pages/Settings.tsx
git commit -m "feat(crm): Google Calendar settings card"
```

- [ ] **Step 4: Deploy and prove the handshake end-to-end**

```bash
cd crm && npx.cmd wrangler deploy
```

Then open `https://bh-crm.bhdev.workers.dev/settings`, click Connect, grant access, and confirm the card shows the connected account with the calendar list. **Stop and report before continuing** — Tasks 8–9 depend on a working connection.

---

### Task 8: Push CRM jobs to Google

**Files:**
- Modify: `crm/src/lib/gcal.ts`, `crm/src/routes/jobs.ts`, `crm/src/routes/quotebuilder.ts`, `crm/src/index.ts`
- Test: `crm/test/gcal-push.test.ts`

**Interfaces:**
- Consumes: `getAccessToken()`, `API_BASE`, `setGcalError()` from Task 2.
- Produces:
  - `pushJobEvent(env: Env, jobId: string): Promise<void>` — creates or patches; records failure in `jobs.gcal_error`.
  - `deleteJobEvent(env: Env, jobId: string): Promise<void>`.
  - `retryFailedPushes(env: Env): Promise<number>`.

- [ ] **Step 1: Write the failing tests**

Create `crm/test/gcal-push.test.ts`:

```ts
import { env, fetchMock } from "cloudflare:test";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { pushJobEvent, deleteJobEvent, retryFailedPushes } from "../src/lib/gcal";

beforeAll(() => { fetchMock.activate(); fetchMock.disableNetConnect(); });
afterEach(() => fetchMock.assertNoPendingInterceptors());

async function seedJob(id: string, over: Record<string, string | null> = {}) {
  await env.DB.prepare("DELETE FROM jobs WHERE id = ?").bind(id).run();
  await env.DB.prepare("DELETE FROM contacts WHERE id = 'c_push'").run();
  await env.DB.prepare(
    "INSERT OR IGNORE INTO contacts (id, first_name, last_name, created_at, updated_at) VALUES ('c_push','Sam','Booker','x','x')"
  ).run();
  await env.DB.prepare(
    `INSERT INTO jobs (id, contact_id, title, status, price_cents, scheduled_start, scheduled_end, address, created_at, updated_at)
     VALUES (?, 'c_push', 'Full Detail', 'scheduled', 25000, ?, ?, '1 Ocean Dr', 'x', 'x')`
  ).bind(id, over.start ?? "2027-03-01T15:00:00.000Z", over.end ?? "2027-03-01T17:00:00.000Z").run();
}

async function connected() {
  await env.DB.prepare("DELETE FROM oauth_tokens").run();
  await env.DB.prepare(
    `INSERT INTO oauth_tokens (provider, refresh_token, access_token, expires_at, created_at, updated_at)
     VALUES ('google','rt','at',?, 'x','x')`
  ).bind(Date.now() + 300_000).run();
  await env.DB.prepare(
    "INSERT INTO settings (key, value) VALUES ('gcal_write_calendar','a@b.com') ON CONFLICT(key) DO UPDATE SET value='a@b.com'"
  ).run();
}

describe("job push", () => {
  beforeEach(connected);

  it("creates an event tagged with the job id and stores the event id", async () => {
    await seedJob("job_1");
    fetchMock.get("https://www.googleapis.com")
      .intercept({ path: /\/calendars\/.*\/events$/, method: "POST" })
      .reply(200, { id: "gev_1" });

    await pushJobEvent(env, "job_1");
    const row = await env.DB.prepare("SELECT gcal_event_id, gcal_error FROM jobs WHERE id='job_1'").first();
    expect(row?.gcal_event_id).toBe("gev_1");
    expect(row?.gcal_error).toBeNull();
  });

  it("patches the existing event on reschedule instead of creating a second one", async () => {
    await seedJob("job_2");
    await env.DB.prepare("UPDATE jobs SET gcal_event_id='gev_2' WHERE id='job_2'").run();
    fetchMock.get("https://www.googleapis.com")
      .intercept({ path: /\/calendars\/.*\/events\/gev_2$/, method: "PATCH" })
      .reply(200, { id: "gev_2" });

    await pushJobEvent(env, "job_2");
    const row = await env.DB.prepare("SELECT gcal_event_id FROM jobs WHERE id='job_2'").first();
    expect(row?.gcal_event_id).toBe("gev_2");
  });

  it("records the failure on the job and leaves the job intact", async () => {
    await seedJob("job_3");
    fetchMock.get("https://www.googleapis.com")
      .intercept({ path: /\/calendars\/.*\/events$/, method: "POST" }).reply(500, "boom");

    await pushJobEvent(env, "job_3");
    const row = await env.DB.prepare("SELECT status, gcal_error FROM jobs WHERE id='job_3'").first();
    expect(row?.status).toBe("scheduled");
    expect(String(row?.gcal_error)).toMatch(/500/);
  });

  it("the retry pass clears the error on a later success", async () => {
    await seedJob("job_4");
    await env.DB.prepare("UPDATE jobs SET gcal_error='api_error 500' WHERE id='job_4'").run();
    fetchMock.get("https://www.googleapis.com")
      .intercept({ path: /\/calendars\/.*\/events$/, method: "POST" }).reply(200, { id: "gev_4" });

    expect(await retryFailedPushes(env)).toBe(1);
    const row = await env.DB.prepare("SELECT gcal_error, gcal_event_id FROM jobs WHERE id='job_4'").first();
    expect(row?.gcal_error).toBeNull();
    expect(row?.gcal_event_id).toBe("gev_4");
  });

  it("deletes the event and clears the id when a job is cancelled", async () => {
    await seedJob("job_5");
    await env.DB.prepare("UPDATE jobs SET gcal_event_id='gev_5' WHERE id='job_5'").run();
    fetchMock.get("https://www.googleapis.com")
      .intercept({ path: /\/calendars\/.*\/events\/gev_5$/, method: "DELETE" }).reply(204, "");

    await deleteJobEvent(env, "job_5");
    const row = await env.DB.prepare("SELECT gcal_event_id FROM jobs WHERE id='job_5'").first();
    expect(row?.gcal_event_id).toBeNull();
  });

  it("does nothing for an unscheduled job", async () => {
    await seedJob("job_6");
    await env.DB.prepare("UPDATE jobs SET scheduled_start=NULL WHERE id='job_6'").run();
    await pushJobEvent(env, "job_6");
    const row = await env.DB.prepare("SELECT gcal_event_id FROM jobs WHERE id='job_6'").first();
    expect(row?.gcal_event_id).toBeNull();
  });
});
```

- [ ] **Step 2: Run to confirm it fails**

```bash
cd crm && npm test -- test/gcal-push.test.ts
```

Expected: FAIL — `pushJobEvent is not a function`.

- [ ] **Step 3: Implement the write path**

Append to `crm/src/lib/gcal.ts`:

```ts
interface PushJob {
  id: string; title: string; status: string;
  scheduled_start: string | null; scheduled_end: string | null;
  address: string | null; price_cents: number;
  gcal_event_id: string | null;
  first_name: string | null; last_name: string | null; phone: string | null;
}

const PUSHABLE = new Set(["scheduled", "in_progress", "completed", "paid"]);

async function writeCalendar(env: Env): Promise<string | null> {
  const row = await one<{ value: string }>(env.DB, "SELECT value FROM settings WHERE key = 'gcal_write_calendar'");
  return row?.value || null;
}

async function loadPushJob(env: Env, jobId: string): Promise<PushJob | null> {
  return one<PushJob>(env.DB,
    `SELECT j.id, j.title, j.status, j.scheduled_start, j.scheduled_end, j.address,
            j.price_cents, j.gcal_event_id, ct.first_name, ct.last_name, ct.phone
     FROM jobs j LEFT JOIN contacts ct ON ct.id = j.contact_id WHERE j.id = ?`, jobId);
}

/**
 * Create or update the Google event mirroring a job. Never throws: a Google
 * failure is recorded on the job row and retried by cron, because a customer
 * booking must never fail because Google is unreachable.
 */
export async function pushJobEvent(env: Env, jobId: string): Promise<void> {
  try {
    const job = await loadPushJob(env, jobId);
    if (!job) return;
    // Unscheduled or cancelled work has no place on the calendar.
    if (!job.scheduled_start || !PUSHABLE.has(job.status)) {
      if (job?.gcal_event_id) await deleteJobEvent(env, jobId);
      return;
    }

    const cal = await writeCalendar(env);
    const token = await getAccessToken(env);
    if (!cal || !token) return;

    const name = [job.first_name, job.last_name].filter(Boolean).join(" ");
    const body = {
      summary: name ? `${job.title} — ${name}` : job.title,
      location: job.address ?? undefined,
      description: [
        `Status: ${job.status}`,
        job.price_cents ? `Price: $${(job.price_cents / 100).toFixed(2)}` : "",
        job.phone ? `Phone: ${job.phone}` : "",
      ].filter(Boolean).join("\n"),
      start: { dateTime: new Date(job.scheduled_start).toISOString() },
      end: {
        dateTime: new Date(job.scheduled_end ?? new Date(Date.parse(job.scheduled_start) + 2 * 3600_000).toISOString()).toISOString(),
      },
      // Invisible in the Google UI, survives edits, and is what the inbound
      // sync keys on to avoid counting this job's time twice.
      extendedProperties: { private: { bh_job_id: job.id } },
    };

    const base = `${API_BASE}/calendars/${encodeURIComponent(cal)}/events`;
    const url = job.gcal_event_id ? `${base}/${encodeURIComponent(job.gcal_event_id)}` : base;
    const res = await fetch(url, {
      method: job.gcal_event_id ? "PATCH" : "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => null);

    if (!res || !res.ok) {
      await run(env.DB, "UPDATE jobs SET gcal_error = ? WHERE id = ?",
        `api_error ${res?.status ?? "network"}`, jobId);
      return;
    }

    const created = (await res.json()) as { id?: string };
    await run(env.DB,
      "UPDATE jobs SET gcal_event_id = ?, gcal_synced_at = ?, gcal_error = NULL WHERE id = ?",
      created.id ?? job.gcal_event_id, nowIso(), jobId);
  } catch { /* fail open */ }
}

export async function deleteJobEvent(env: Env, jobId: string): Promise<void> {
  try {
    const job = await loadPushJob(env, jobId);
    if (!job?.gcal_event_id) return;
    const cal = await writeCalendar(env);
    const token = await getAccessToken(env);
    if (!cal || !token) return;

    await fetch(`${API_BASE}/calendars/${encodeURIComponent(cal)}/events/${encodeURIComponent(job.gcal_event_id)}`, {
      method: "DELETE", headers: { Authorization: `Bearer ${token}` },
    }).catch(() => null);

    await run(env.DB,
      "UPDATE jobs SET gcal_event_id = NULL, gcal_synced_at = ?, gcal_error = NULL WHERE id = ?", nowIso(), jobId);
  } catch { /* fail open */ }
}

/** Re-push jobs whose last write failed. Returns how many were attempted. */
export async function retryFailedPushes(env: Env): Promise<number> {
  const rows = await all<{ id: string }>(env.DB,
    "SELECT id FROM jobs WHERE gcal_error IS NOT NULL AND scheduled_start IS NOT NULL LIMIT 25");
  for (const r of rows) await pushJobEvent(env, r.id);
  return rows.length;
}
```

- [ ] **Step 4: Hook the admin job lifecycle**

In `crm/src/routes/jobs.ts`, add `import { pushJobEvent, deleteJobEvent } from "../lib/gcal";` and fire the push after each write commits, using `waitUntil` so Google never delays the response:

- At the end of `jobRoutes.post("/")`, before the success return:
  ```ts
  c.executionCtx.waitUntil(pushJobEvent(c.env, id));
  ```
- At the end of `jobRoutes.patch("/:id")`, before the success return:
  ```ts
  c.executionCtx.waitUntil(pushJobEvent(c.env, id));
  ```
- In `jobRoutes.delete("/:id")`, **before** the row is deleted (the helper reads the job to find its event id):
  ```ts
  await deleteJobEvent(c.env, id);
  ```

`pushJobEvent` already deletes the Google event when a job's status leaves the pushable set or loses its start time, so cancel and unschedule need no extra branch in the PATCH handler.

- [ ] **Step 5: Hook the public booking path**

In `crm/src/routes/quotebuilder.ts`, add the same import. After the `INSERT INTO jobs` at roughly line 226 completes and the surrounding transaction/flow finishes, add:

```ts
  c.executionCtx.waitUntil(pushJobEvent(c.env, jobId));
```

using whatever local variable holds the new job's id. If `completeQuote()` is a plain function without a Hono context, return the job id to the route handler and call `waitUntil` there — do not `await` the push inside the booking path.

- [ ] **Step 6: Add the retry to cron**

In `crm/src/index.ts`, extend the 5-minute branch:

```ts
      : [runReminders(env, now), runSequences(env, now),
         syncGoogleBusy(env).then(() => undefined),
         retryFailedPushes(env).then(() => undefined)];
```

Add `retryFailedPushes` to the existing `./lib/gcal` import.

- [ ] **Step 7: Run the tests**

```bash
cd crm && npm test -- test/gcal-push.test.ts
```

Expected: 6 passed.

- [ ] **Step 8: Run the full suite**

```bash
cd crm && npm test
```

Expected: all pass. `jobs.test.ts` and `quotebuilder.test.ts` exercise the modified handlers; with no Google account connected in those fixtures, `pushJobEvent` returns early and changes nothing.

- [ ] **Step 9: Commit**

```bash
git add crm/src/lib/gcal.ts crm/src/routes/jobs.ts crm/src/routes/quotebuilder.ts crm/src/index.ts crm/test/gcal-push.test.ts
git commit -m "feat(crm): push CRM jobs to Google Calendar as real events"
```

---

### Task 9: Calendar page — Google chips and manual blocks

**Files:**
- Modify: `crm/src/lib/gcal.ts`, `crm/src/routes/google.ts`, `crm/admin/src/pages/Calendar.tsx`
- Test: `crm/test/gcal-push.test.ts` (extend)

**Interfaces:**
- Consumes: `GET /api/settings/google/events` from Task 5; `getAccessToken()`, `API_BASE` from Task 2.
- Produces:
  - `createBlock(env: Env, opts: { start: string; end: string; title: string }): Promise<string | null>` — returns the Google event id.
  - `deleteBlock(env: Env, eventId: string): Promise<void>`.
  - `POST /api/settings/google/blocks`, `DELETE /api/settings/google/blocks/:id`.

- [ ] **Step 1: Write the failing test**

Append to `crm/test/gcal-push.test.ts`:

```ts
import { createBlock } from "../src/lib/gcal";

describe("manual blocks", () => {
  beforeEach(connected);

  it("creates a block tagged bh_block so the sync keeps it", async () => {
    let sent: Record<string, unknown> = {};
    fetchMock.get("https://www.googleapis.com")
      .intercept({ path: /\/calendars\/.*\/events$/, method: "POST" })
      .reply(200, (opts) => { sent = JSON.parse(String(opts.body)); return { id: "gev_block" }; });

    const id = await createBlock(env, {
      start: "2027-03-02T15:00:00.000Z", end: "2027-03-02T17:00:00.000Z", title: "Blocked",
    });
    expect(id).toBe("gev_block");
    expect((sent.extendedProperties as { private: Record<string, string> }).private.bh_block).toBe("1");
    expect((sent.extendedProperties as { private: Record<string, string> }).private.bh_job_id).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to confirm it fails**

```bash
cd crm && npm test -- test/gcal-push.test.ts
```

Expected: FAIL — `createBlock is not a function`.

- [ ] **Step 3: Implement blocks in `gcal.ts`**

```ts
/** A busy event owned by the CRM but not tied to a job. Tagged bh_block so the
 *  inbound sync keeps it — unlike job events, there is no jobs row behind it. */
export async function createBlock(
  env: Env, opts: { start: string; end: string; title: string }
): Promise<string | null> {
  const cal = await writeCalendar(env);
  const token = await getAccessToken(env);
  if (!cal || !token) return null;

  const res = await fetch(`${API_BASE}/calendars/${encodeURIComponent(cal)}/events`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      summary: opts.title || "Blocked",
      start: { dateTime: opts.start },
      end: { dateTime: opts.end },
      transparency: "opaque",
      extendedProperties: { private: { bh_block: "1" } },
    }),
  }).catch(() => null);

  if (!res || !res.ok) { await setGcalError(env, `block_create_failed ${res?.status ?? "network"}`); return null; }
  const body = (await res.json()) as { id?: string };
  return body.id ?? null;
}

export async function deleteBlock(env: Env, eventId: string): Promise<void> {
  const cal = await writeCalendar(env);
  const token = await getAccessToken(env);
  if (!cal || !token) return;
  await fetch(`${API_BASE}/calendars/${encodeURIComponent(cal)}/events/${encodeURIComponent(eventId)}`, {
    method: "DELETE", headers: { Authorization: `Bearer ${token}` },
  }).catch(() => null);
  await run(env.DB, "DELETE FROM gcal_busy WHERE id LIKE ?", `${eventId}@%`);
}
```

- [ ] **Step 4: Add the block routes**

In `crm/src/routes/google.ts`, add `createBlock, deleteBlock` to the `../lib/gcal` import and append:

```ts
googleRoutes.post("/blocks", async (c) => {
  const b = ((await c.req.json().catch(() => null)) ?? {}) as { start?: string; end?: string; title?: string };
  if (!b.start || !b.end || !Number.isFinite(Date.parse(b.start)) || !Number.isFinite(Date.parse(b.end))) {
    return c.json({ error: "start_and_end_required" }, 400);
  }
  const id = await createBlock(c.env, {
    start: new Date(b.start).toISOString(),
    end: new Date(b.end).toISOString(),
    title: typeof b.title === "string" ? b.title.slice(0, 120) : "Blocked",
  });
  if (!id) return c.json({ error: "google_unavailable" }, 502);
  await syncGoogleBusy(c.env);
  return c.json({ ok: true, id });
});

googleRoutes.delete("/blocks/:id", async (c) => {
  await deleteBlock(c.env, c.req.param("id"));
  return c.json({ ok: true });
});
```

- [ ] **Step 5: Render Google chips on the Calendar page**

In `crm/admin/src/pages/Calendar.tsx`, add the type and chip component:

```tsx
interface GEventRow {
  id: string; summary: string | null; starts_at: string; ends_at: string;
  all_day: number; is_block: number;
}

function GoogleChip({ ev, onRemove }: { ev: GEventRow; onRemove?: () => void }) {
  return (
    <div className="w-full rounded-md border border-dashed border-neutral-400 bg-neutral-100 px-2 py-1.5 text-left text-xs text-neutral-600">
      <div className="flex items-center justify-between gap-1">
        <span className="font-semibold">{ev.all_day ? "All day" : timeLabel(ev.starts_at)}</span>
        {ev.is_block === 1 && onRemove && (
          <button onClick={onRemove} className="text-[10px] font-semibold text-neutral-500 hover:text-red-600">
            remove
          </button>
        )}
      </div>
      <div className="truncate">{ev.summary ?? "Busy"}</div>
    </div>
  );
}
```

In the existing `load` callback, fetch Google events for the same week alongside jobs and store them in a `gevents` state array:

```tsx
    api<{ items: GEventRow[] }>(`/api/settings/google/events?from=${from}T00:00:00.000Z&to=${to}T23:59:59.999Z`)
      .then((r) => setGevents(r.items ?? []))
      .catch(() => setGevents([]));
```

In the per-day column, render Google chips under the job chips, filtered with the existing `isOnDay` helper:

```tsx
    {gevents.filter((g) => isOnDay(g.starts_at, day) || (g.all_day === 1 && Date.parse(g.starts_at) <= day.getTime() && Date.parse(g.ends_at) > day.getTime()))
      .map((g) => (
        <GoogleChip
          key={g.id}
          ev={g}
          onRemove={async () => {
            await api(`/api/settings/google/blocks/${encodeURIComponent(g.id.split("@")[0])}`, { method: "DELETE" });
            load();
          }}
        />
      ))}
```

Add a "Block time" button in the page header that opens a `Modal` with two `datetime-local` inputs and a title field, POSTing to `/api/settings/google/blocks` and calling `load()` on success — mirroring the existing `newOpen` / `NEW_EVENT` modal pattern already in this file.

- [ ] **Step 6: Run the tests and typecheck**

```bash
cd crm && npm test
```

```bash
cd crm/admin && npx.cmd tsc --noEmit
```

Expected: all tests pass, no type errors.

- [ ] **Step 7: Commit**

```bash
git add crm/src/lib/gcal.ts crm/src/routes/google.ts crm/admin/src/pages/Calendar.tsx crm/test/gcal-push.test.ts
git commit -m "feat(crm): Google event chips and manual time blocks on the Calendar page"
```

- [ ] **Step 8: Deploy and verify live**

```bash
cd crm && npm run build:admin
```

```bash
cd crm && npx.cmd wrangler deploy
```

Then verify by hand:
1. Add a **Busy** event to Google for a time the booking page currently offers. Wait 5 minutes or hit Sync now. Confirm that slot disappears from `https://bhcardetails.com/book`.
2. Change the same event to **Free**. Sync. Confirm the slot returns.
3. Book a job through `/book`. Confirm the event appears on Google Calendar within seconds, tagged to the right customer.
4. Reschedule that job in the CRM. Confirm the Google event moves rather than duplicating.
5. **Unsubscribe Google from the old `.ics` feed** — Google Calendar → Other calendars → the BH CRM subscription → unsubscribe. Without this, every job shows twice.

---

## Self-Review

**Spec coverage**

| Spec section | Task |
|---|---|
| `gcal_busy`, `oauth_tokens`, `jobs` columns | 1 |
| Token refresh, `listCalendars` | 2 |
| `syncGoogleBusy`, `syncIfStale`, behaviour contract, loop prevention | 3 |
| `busyWindows`/`overlaps` extraction, slot blocking, buffer | 4 |
| OAuth routes, scope, state HMAC, `/events` | 5 |
| 5-minute cron sync | 6 |
| Settings card | 7 |
| Job lifecycle push, retry, fail-open | 8 |
| Calendar chips, manual blocks | 9 |
| Unsubscribe the `.ics` feed | 9, step 8 |
| `PUBLIC_BASE_URL` fix | 1 |

**Known gaps, deliberate**

- The spec lists 19 test cases; this plan writes 30 across four files. The extra coverage is in OAuth (token-leak assertions) and push.
- Spec test #3 ("no `transparency` field blocks") is covered in Task 3 rather than `gcal-blocking.test.ts`, because it is a sync-filter behaviour, not a slot-math behaviour.
- Deferred two-way edit of non-CRM events is out of scope per the spec and has no task.
