import { Hono } from "hono";
import type { Env } from "../types";
import { requireAuth } from "../lib/auth";
import { canSend } from "../lib/guardrails";
import {
  draftRebookMessage, dueList, recomputeAllDueDates, sendRebookOffer, snoozeRebook,
} from "../lib/rebook";

export const rebookRoutes = new Hono<{ Bindings: Env }>();
rebookRoutes.use("*", requireAuth());

/**
 * The due-this-week worklist. Each row carries its own send verdict so the UI
 * can show *why* a customer can't be texted rather than failing on tap.
 */
rebookRoutes.get("/due", async (c) => {
  const q = c.req.query();
  const now = Date.now();
  const rows = await dueList(c.env, now, {
    limit: Number(q.limit) > 0 ? Number(q.limit) : 50,
    horizonDays: Number(q.horizon_days) > 0 ? Number(q.horizon_days) : 7,
  });
  const items = [];
  for (const row of rows) {
    const verdict = await canSend(c.env, row.contact_id, now);
    items.push({
      ...row,
      draft: draftRebookMessage(c.env, row),
      can_send: verdict.ok,
      blocked_reason: verdict.reason ?? null,
      blocked_detail: verdict.detail ?? null,
    });
  }
  return c.json({
    items,
    total: items.length,
    potential_cents: items.reduce((sum, i) => sum + (i.last_job_price_cents ?? 0), 0),
  });
});

/** Human-initiated send. Guardrails still apply — see lib/guardrails.ts. */
rebookRoutes.post("/:contactId/send", async (c) => {
  const b = ((await c.req.json().catch(() => null)) ?? {}) as { body?: unknown };
  const out = await sendRebookOffer(
    c.env, c.req.param("contactId"),
    typeof b.body === "string" ? b.body : undefined
  );
  return c.json(out, out.ok ? 200 : 409);
});

rebookRoutes.post("/:contactId/snooze", async (c) => {
  const b = ((await c.req.json().catch(() => null)) ?? {}) as { days?: unknown };
  const days = Number.isFinite(Number(b.days)) ? Math.round(Number(b.days)) : 14;
  await snoozeRebook(c.env, c.req.param("contactId"), days);
  return c.json({ ok: true, days });
});

/** Re-derive every due date from real service cadences. Safe to re-run. */
rebookRoutes.post("/recompute", async (c) => c.json(await recomputeAllDueDates(c.env)));
