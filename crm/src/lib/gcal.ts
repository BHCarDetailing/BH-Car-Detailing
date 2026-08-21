import type { Env } from "../types";
import { all, one, run, nowIso } from "./db";
import { zonedToUtcIso } from "./booking";

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
