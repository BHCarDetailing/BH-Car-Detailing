import type { Env } from "../types";
import { all, one, run, nowIso } from "./db";
import { zonedToUtcIso } from "./booking";

// Two scopes, and both are needed:
//   calendar.events   - read AND write events (job push, manual blocks)
//   calendar.readonly - read the user's calendarList
// calendar.events alone 403s on /users/me/calendarList; it covers events on a
// calendar, not the list of calendars. Neither grants creating or deleting
// whole calendars — that would be the broader `calendar` scope.
export const GOOGLE_SCOPE = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.readonly",
].join(" ");
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
    // Google puts the actual cause in the body ("insufficient authentication
    // scopes", "API has not been used in project…"). Without it a 403 is
    // indistinguishable from a dozen unrelated problems.
    const detail = res ? (await res.text().catch(() => "")).slice(0, 200) : "network error";
    await setGcalError(env, `api_error ${res?.status ?? "network"} on ${path.split("?")[0]}: ${detail}`);
    return null;
  }
  return (await res.json()) as T;
}

export async function listCalendars(env: Env): Promise<GCalendar[]> {
  const body = await gapi<{ items?: GCalendar[] }>(env, "/users/me/calendarList?minAccessRole=reader&maxResults=250");
  return body?.items ?? [];
}

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
      if (job.gcal_event_id) await deleteJobEvent(env, jobId);
      return;
    }

    const cal = await writeCalendar(env);
    const token = await getAccessToken(env);
    if (!cal || !token) return;

    const name = [job.first_name, job.last_name].filter(Boolean).join(" ");
    const endIso = job.scheduled_end
      ?? new Date(Date.parse(job.scheduled_start) + 2 * 3600_000).toISOString();
    const body = {
      summary: name ? `${job.title} — ${name}` : job.title,
      location: job.address ?? undefined,
      description: [
        `Status: ${job.status}`,
        job.price_cents ? `Price: $${(job.price_cents / 100).toFixed(2)}` : "",
        job.phone ? `Phone: ${job.phone}` : "",
      ].filter(Boolean).join("\n"),
      start: { dateTime: new Date(job.scheduled_start).toISOString() },
      end: { dateTime: new Date(endIso).toISOString() },
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

/**
 * A busy event owned by the CRM but not tied to a job. Tagged bh_block so the
 * inbound sync keeps it — unlike job events, there is no jobs row behind it,
 * so gcal_busy is the only place its time is recorded.
 */
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

/** Re-push jobs whose last write failed. Returns how many were attempted. */
export async function retryFailedPushes(env: Env): Promise<number> {
  const rows = await all<{ id: string }>(env.DB,
    "SELECT id FROM jobs WHERE gcal_error IS NOT NULL AND scheduled_start IS NOT NULL LIMIT 25");
  for (const r of rows) await pushJobEvent(env, r.id);
  return rows.length;
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
