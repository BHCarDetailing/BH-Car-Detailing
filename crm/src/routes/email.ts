import { Hono } from "hono";
import type { Env } from "../types";
import { requireAuth } from "../lib/auth";
import { sendEmail } from "../lib/email";

/**
 * One-click test email — sends immediately via Resend (bypasses the sequence
 * cron + quiet-hours), so the owner can confirm email delivery in one shot.
 * Dormant (503) until RESEND_API_KEY is set.
 */
export const emailRoutes = new Hono<{ Bindings: Env }>();
emailRoutes.use("*", requireAuth());

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

emailRoutes.post("/test", async (c) => {
  if (!c.env.RESEND_API_KEY) return c.json({ error: "email_not_configured" }, 503);
  const b = ((await c.req.json().catch(() => null)) ?? {}) as { to?: string; subject?: string; body?: string };
  const to = (b.to ?? "").trim();
  if (!EMAIL_RE.test(to)) return c.json({ error: "invalid_email" }, 400);

  const subject = (b.subject?.trim() || "BH CRM test email").slice(0, 200);
  const bodyText = (b.body?.trim() || "This is a test email from your BH Car Detailing CRM. If you're reading this, email sending works. 🚗✨").slice(0, 4000);
  const html = `<div style="font-family:system-ui,Segoe UI,Arial,sans-serif;font-size:15px;color:#111">${bodyText.replace(/\n/g, "<br>")}</div><p style="font-size:12px;color:#888;margin-top:16px">— BH Car Detailing · sent from your CRM</p>`;

  const r = await sendEmail(c.env, { kind: "oneoff", toEmail: to, subject, html, text: bodyText });
  if (r.status === "sent") return c.json({ ok: true, status: "sent", id: r.id });
  if (r.status === "logged") return c.json({ error: "email_not_configured" }, 503);
  return c.json({ error: "send_failed", id: r.id }, 502);
});
