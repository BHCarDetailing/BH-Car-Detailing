import { Hono } from "hono";
import { setCookie } from "hono/cookie";
import type { Env } from "../types";
import { loginRateLimited, recordAttempt, signSession, timingSafeEqualStr } from "../lib/auth";

export const authRoutes = new Hono<{ Bindings: Env }>();

authRoutes.post("/login", async (c) => {
  if (!c.env.ADMIN_PASSWORD || !c.env.SESSION_SECRET) return c.json({ error: "server_misconfigured" }, 500);
  const ip = c.req.header("CF-Connecting-IP") ?? "local";
  if (await loginRateLimited(c.env.DB, ip)) return c.json({ error: "too_many_attempts" }, 429);

  const body = (await c.req.json().catch(() => null)) as { password?: string } | null;
  if (typeof body?.password !== "string" || !(await timingSafeEqualStr(body.password, c.env.ADMIN_PASSWORD))) {
    await recordAttempt(c.env.DB, "login:" + ip);
    return c.json({ error: "invalid_password" }, 401);
  }

  const exp = Date.now() + 30 * 24 * 3600 * 1000;
  setCookie(c, "bh_session", await signSession(c.env.SESSION_SECRET, exp), {
    httpOnly: true,
    secure: true, // browsers accept Secure cookies on localhost
    sameSite: "Lax",
    path: "/",
    maxAge: 30 * 24 * 3600,
  });
  return c.json({ ok: true });
});

authRoutes.post("/logout", (c) => {
  setCookie(c, "bh_session", "", { httpOnly: true, secure: true, sameSite: "Lax", path: "/", maxAge: 0 });
  return c.json({ ok: true });
});
