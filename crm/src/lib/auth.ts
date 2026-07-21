import type { MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";
import type { Env } from "../types";

const enc = new TextEncoder();

async function hmacHex(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Constant-time-ish string compare: hash both sides, compare digests. Fails closed on missing/empty input. */
export async function timingSafeEqualStr(a: unknown, b: unknown): Promise<boolean> {
  if (typeof a !== "string" || typeof b !== "string" || a.length === 0 || b.length === 0) return false;
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(a)),
    crypto.subtle.digest("SHA-256", enc.encode(b)),
  ]);
  const va = new Uint8Array(ha);
  const vb = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < va.length; i++) diff |= va[i] ^ vb[i];
  return diff === 0;
}

export async function signSession(secret: string, expiresAtMs: number): Promise<string> {
  return `${expiresAtMs}.${await hmacHex(secret, "session:" + expiresAtMs)}`;
}

export async function verifySession(secret: string, cookieVal?: string): Promise<boolean> {
  if (!cookieVal) return false;
  const dot = cookieVal.indexOf(".");
  if (dot < 1) return false;
  const exp = Number(cookieVal.slice(0, dot));
  if (!Number.isFinite(exp) || exp < Date.now()) return false;
  const expected = await hmacHex(secret, "session:" + exp);
  return timingSafeEqualStr(cookieVal.slice(dot + 1), expected);
}

export function requireAuth(): MiddlewareHandler<{ Bindings: Env }> {
  return async (c, next) => {
    const bearer = c.req.header("Authorization");
    if (bearer?.startsWith("Bearer ") && (await timingSafeEqualStr(bearer.slice(7), c.env.AGENT_API_KEY))) {
      return next();
    }
    if (await verifySession(c.env.SESSION_SECRET, getCookie(c, "bh_session"))) return next();
    return c.json({ error: "unauthorized" }, 401);
  };
}

export async function loginRateLimited(db: D1Database, ip: string): Promise<boolean> {
  const cutoff = Date.now() - 15 * 60 * 1000;
  const row = await db
    .prepare("SELECT COUNT(*) AS n FROM rl_events WHERE bucket = ? AND ts > ?")
    .bind("login:" + ip, cutoff)
    .first<{ n: number }>();
  return (row?.n ?? 0) >= 5;
}

export async function recordAttempt(db: D1Database, bucket: string): Promise<void> {
  await db.prepare("INSERT INTO rl_events (bucket, ts) VALUES (?, ?)").bind(bucket, Date.now()).run();
}
