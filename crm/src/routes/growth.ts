import { Hono } from "hono";
import type { Env } from "../types";
import { all, one } from "../lib/db";
import { requireAuth } from "../lib/auth";
import { canSend } from "../lib/guardrails";
import {
  DAILY_REACTIVATION_CAP, draftReactivationMessage, reactivationQueue,
  sendReactivation, sentToday, skipReactivation,
} from "../lib/reactivation";
import { markReviewLeft, reviewStats } from "../lib/reviews";

/** Working the existing book: reactivation, reviews, referrals. */
export const growthRoutes = new Hono<{ Bindings: Env }>();
growthRoutes.use("*", requireAuth());

/** Today's reactivation queue, with a drafted message and a send verdict per row. */
growthRoutes.get("/reactivation/queue", async (c) => {
  const now = Date.now();
  const used = await sentToday(c.env, now);
  const remaining = Math.max(0, DAILY_REACTIVATION_CAP - used);
  const rows = await reactivationQueue(c.env, now, remaining || DAILY_REACTIVATION_CAP);

  const items = [];
  for (const row of rows) {
    const verdict = await canSend(c.env, row.contact_id, now, { channel: "sms" });
    items.push({
      ...row,
      draft: draftReactivationMessage(c.env, row),
      can_send: verdict.ok && remaining > 0,
      blocked_reason: remaining > 0 ? verdict.reason ?? null : "daily_cap",
      blocked_detail: remaining > 0 ? verdict.detail ?? null : `Daily limit of ${DAILY_REACTIVATION_CAP} reached — pick this up tomorrow.`,
    });
  }
  return c.json({ items, sent_today: used, remaining_today: remaining, daily_cap: DAILY_REACTIVATION_CAP });
});

growthRoutes.post("/reactivation/:contactId/send", async (c) => {
  const b = ((await c.req.json().catch(() => null)) ?? {}) as { body?: unknown };
  const out = await sendReactivation(
    c.env, c.req.param("contactId"), typeof b.body === "string" ? b.body : undefined);
  return c.json(out, out.ok ? 200 : 409);
});

growthRoutes.post("/reactivation/:contactId/skip", async (c) => {
  await skipReactivation(c.env, c.req.param("contactId"));
  return c.json({ ok: true });
});

/** Mark that a customer left a review (Google offers no API for this). */
growthRoutes.post("/reviews/:jobId/left", async (c) => {
  const out = await markReviewLeft(c.env, c.req.param("jobId"));
  return c.json(out, out.ok ? 200 : 404);
});

growthRoutes.get("/reviews/stats", async (c) => {
  const days = Number(c.req.query("days")) > 0 ? Number(c.req.query("days")) : 30;
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  return c.json(await reviewStats(c.env, since));
});

/**
 * Referral attribution: who sends us work, and what that work was worth.
 * With this, "referral" stops being a guess and becomes a number.
 */
growthRoutes.get("/referrals", async (c) => {
  const items = await all(
    c.env.DB,
    `SELECT r.id AS contact_id, r.first_name, r.last_name,
            COUNT(c.id) AS referred_count,
            COALESCE(SUM(c.lifetime_value_cents), 0) AS referred_value_cents,
            SUM(CASE WHEN COALESCE(c.job_count,0) > 0 THEN 1 ELSE 0 END) AS referred_customers
       FROM contacts c JOIN contacts r ON r.id = c.referred_by_contact_id
      WHERE c.deleted_at IS NULL
      GROUP BY r.id
      ORDER BY referred_value_cents DESC, referred_count DESC
      LIMIT 100`
  );
  const totals = await one<{ n: number; value: number }>(
    c.env.DB,
    `SELECT COUNT(*) AS n, COALESCE(SUM(lifetime_value_cents), 0) AS value
       FROM contacts WHERE referred_by_contact_id IS NOT NULL AND deleted_at IS NULL`
  );
  return c.json({ items, total_referred: totals?.n ?? 0, total_value_cents: totals?.value ?? 0 });
});
