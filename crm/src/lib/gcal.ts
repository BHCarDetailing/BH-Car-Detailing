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
