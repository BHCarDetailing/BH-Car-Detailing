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

// Registered before the auth middleware below, so it stays reachable: Google's
// redirect is a top-level browser navigation and carries no admin cookie or
// bearer token. The signed state is what authenticates it.
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
    return c.text(
      "Google did not return a refresh token. Remove this app at myaccount.google.com/permissions and try again.", 400);
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
