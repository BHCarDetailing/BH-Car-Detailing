import { Hono } from "hono";
import type { Env } from "../types";
import { STAGES } from "../types";
import { all, nowIso, one, run, uuid } from "../lib/db";
import { cleanName, normalizeEmail, normalizePhone } from "../lib/normalize";
import { logActivity } from "../lib/activity";
import { requireAuth } from "../lib/auth";
import { enrollContact } from "../lib/sequences";

const ORDER_COLS: Record<string, string> = {
  created_at: "c.created_at",
  last_activity_at: "c.last_activity_at",
  first_name: "c.first_name",
  stage: "c.stage",
};

export const contactRoutes = new Hono<{ Bindings: Env }>();
contactRoutes.use("*", requireAuth());

const PATCH_FIELDS = new Set([
  "first_name", "last_name", "email", "phone", "address", "city", "area_slug",
  "stage", "source", "source_detail", "tags", "custom",
  "email_opt_in", "sms_opt_in", "replied_flag", "ai_summary", "ai_next_action",
]);

function safeParse<T>(v: string | null | undefined, fallback: T): T {
  try { return JSON.parse(v || "") as T; } catch { return fallback; }
}

function actorOf(c: { req: { header: (n: string) => string | undefined } }): string {
  return c.req.header("Authorization")?.startsWith("Bearer ") ? "agent" : "human";
}

// Bridge touch-log: the tap-to-text / tap-to-call buttons fire this so the CRM
// records the outreach even though the actual send happens in the phone's apps.
contactRoutes.post("/:id/touch", async (c) => {
  const id = c.req.param("id");
  const b = ((await c.req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  const channel = b.channel === "call" ? "call" : "sms";
  const contact = await one<{ id: string; stage: string }>(c.env.DB, "SELECT id, stage FROM contacts WHERE id = ?", id);
  if (!contact) return c.json({ error: "not_found" }, 404);
  await logActivity(c.env.DB, {
    contactId: id,
    type: channel === "call" ? "call_logged" : "sms_logged",
    title: channel === "call" ? "Called (from CRM)" : "Texted (from CRM)",
    payload: { via: "bridge", direction: "outbound" },
    actor: actorOf(c),
  });
  if (contact.stage === "new") {
    await run(c.env.DB, "UPDATE contacts SET stage = 'contacted' WHERE id = ? AND stage = 'new'", id);
  }
  return c.json({ ok: true });
});

contactRoutes.get("/", async (c) => {
  const q = c.req.query();
  const limit = Math.min(Number(q.limit) > 0 ? Number(q.limit) : 50, 200);
  const offset = Number(q.offset) > 0 ? Number(q.offset) : 0;
  const where: string[] = [];
  const binds: unknown[] = [];
  // Archive filter: default hides soft-deleted contacts; ?archived=1 shows only them.
  where.push(q.archived === "1" ? "deleted_at IS NOT NULL" : "deleted_at IS NULL");
  if (q.search) {
    const term = `%${q.search.replace(/[%_]/g, "")}%`;
    where.push("(first_name LIKE ? OR last_name LIKE ? OR email LIKE ? OR phone LIKE ?)");
    binds.push(term, term, term, term);
  }
  if (q.stage) { where.push("stage = ?"); binds.push(q.stage); }
  if (q.source) { where.push("source = ?"); binds.push(q.source); }
  if (q.tag) { where.push("tags LIKE ?"); binds.push(`%"${q.tag.replace(/[%_"]/g, "")}"%`); }
  const w = where.length ? "WHERE " + where.join(" AND ") : "";
  const total = await one<{ n: number }>(c.env.DB, `SELECT COUNT(*) AS n FROM contacts ${w}`, ...binds);
  const orderCol = ORDER_COLS[q.order_by ?? ""] ?? "c.created_at";
  const orderDir = q.order === "asc" ? "ASC" : "DESC";
  const rows = await all<Record<string, unknown>>(
    c.env.DB,
    `SELECT c.*, (SELECT COUNT(*) FROM vehicles v WHERE v.contact_id = c.id) AS vehicle_count
     FROM contacts c ${w} ORDER BY ${orderCol} ${orderDir} LIMIT ? OFFSET ?`,
    ...binds, limit, offset
  );
  const items = rows.map((r) => ({
    ...r,
    tags: safeParse(r.tags as string, []),
    custom: safeParse(r.custom as string, {}),
  }));
  return c.json({ items, total: total?.n ?? 0 });
});

// Bulk actions across a set of contact ids (checkbox multi-select).
contactRoutes.post("/bulk-action", async (c) => {
  const b = ((await c.req.json().catch(() => null)) ?? {}) as { ids?: unknown; op?: string; value?: string };
  const ids = Array.isArray(b.ids) ? b.ids.filter((x): x is string => typeof x === "string").slice(0, 500) : [];
  if (!ids.length || !b.op) return c.json({ error: "ids_and_op_required" }, 400);
  if (b.op === "set_stage" && !STAGES.includes((b.value ?? "") as (typeof STAGES)[number])) {
    return c.json({ error: "invalid_stage" }, 400);
  }
  const now = nowIso();
  let updated = 0;
  for (const id of ids) {
    const row = await one<{ tags: string; stage: string }>(c.env.DB, "SELECT tags, stage FROM contacts WHERE id = ?", id);
    if (!row) continue;
    if (b.op === "add_label" || b.op === "remove_label") {
      const key = typeof b.value === "string" ? b.value : "";
      if (!key) continue;
      let tags: string[] = [];
      try { tags = JSON.parse(row.tags || "[]"); } catch { tags = []; }
      tags = b.op === "add_label" ? (tags.includes(key) ? tags : [...tags, key]) : tags.filter((t) => t !== key);
      await run(c.env.DB, "UPDATE contacts SET tags = ?, updated_at = ? WHERE id = ?", JSON.stringify(tags), now, id);
      updated++;
    } else if (b.op === "set_stage") {
      if (b.value !== row.stage) {
        await run(c.env.DB, "UPDATE contacts SET stage = ?, updated_at = ? WHERE id = ?", b.value, now, id);
        await logActivity(c.env.DB, { contactId: id, type: "stage_changed", title: `Stage: ${row.stage} → ${b.value}`, payload: { from: row.stage, to: b.value }, actor: actorOf(c) });
      }
      updated++;
    } else if (b.op === "enroll_sequence") {
      if (b.value) { await enrollContact(c.env, b.value, id); updated++; }
    } else if (b.op === "archive") {
      // Soft by default, matching single-contact delete: money history survives
      // and the contact can be restored from the Archived view.
      await run(c.env.DB, "UPDATE contacts SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL", now, now, id);
      await run(c.env.DB, "UPDATE enrollments SET status = 'exited', exit_reason = 'archived', completed_at = ? WHERE contact_id = ? AND status = 'active'", now, id);
      await logActivity(c.env.DB, { contactId: id, type: "note", title: "Archived (bulk)", actor: actorOf(c) });
      updated++;
    } else if (b.op === "restore") {
      await run(c.env.DB, "UPDATE contacts SET deleted_at = NULL, updated_at = ? WHERE id = ?", now, id);
      updated++;
    } else {
      return c.json({ error: "unknown_op" }, 400);
    }
  }
  return c.json({ updated });
});

contactRoutes.post("/", async (c) => {
  const b = ((await c.req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  const stage = (b.stage as string) ?? "new";
  if (!STAGES.includes(stage as (typeof STAGES)[number])) {
    return c.json({ error: "invalid_stage" }, 400);
  }
  const id = uuid();
  const now = nowIso();
  await run(
    c.env.DB,
    `INSERT INTO contacts
       (id, first_name, last_name, email, phone, address, city, stage, source, tags, custom,
        email_opt_in, email_opt_in_at, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,1,?,?,?)`,
    id,
    cleanName(b.first_name as string) ?? null,
    cleanName(b.last_name as string) ?? null,
    normalizeEmail(b.email as string) ?? null,
    normalizePhone(b.phone as string) ?? null,
    (b.address as string) ?? null,
    (b.city as string) ?? null,
    stage,
    (b.source as string) ?? "manual",
    JSON.stringify(Array.isArray(b.tags) ? b.tags : []),
    JSON.stringify(typeof b.custom === "object" && b.custom ? b.custom : {}),
    now, now, now
  );
  return c.json({ id }, 201);
});

contactRoutes.get("/:id", async (c) => {
  const row = await one<Record<string, unknown>>(
    c.env.DB, "SELECT * FROM contacts WHERE id = ?", c.req.param("id"));
  if (!row) return c.json({ error: "not_found" }, 404);
  const vehicles = await all(
    c.env.DB, "SELECT * FROM vehicles WHERE contact_id = ? ORDER BY created_at DESC", row.id);
  // Revenue events linked to this contact + summary counts (used for the
  // delete warning and the contact's Revenue panel).
  const revenue = await all(
    c.env.DB, "SELECT * FROM revenue_entries WHERE contact_id = ? ORDER BY COALESCE(occurred_at, created_at) DESC, created_at DESC LIMIT 100", row.id);
  const jobsRow = await one<{ n: number }>(c.env.DB, "SELECT COUNT(*) AS n FROM jobs WHERE contact_id = ?", row.id);
  const revRow = await one<{ cents: number }>(c.env.DB, "SELECT COALESCE(SUM(amount_cents),0) AS cents FROM revenue_entries WHERE contact_id = ? AND status = 'paid'", row.id);
  return c.json({
    ...row,
    tags: JSON.parse((row.tags as string) || "[]"),
    custom: JSON.parse((row.custom as string) || "{}"),
    vehicles,
    revenue,
    related: { jobs: jobsRow?.n ?? 0, paid_revenue_cents: revRow?.cents ?? 0 },
  });
});

contactRoutes.patch("/:id", async (c) => {
  const id = c.req.param("id");
  const existing = await one<Record<string, unknown>>(c.env.DB, "SELECT * FROM contacts WHERE id = ?", id);
  if (!existing) return c.json({ error: "not_found" }, 404);
  const b = ((await c.req.json().catch(() => null)) ?? {}) as Record<string, unknown>;

  const sets: string[] = [];
  const binds: unknown[] = [];
  for (const [k, v] of Object.entries(b)) {
    if (!PATCH_FIELDS.has(k)) continue;
    if (k === "stage") {
      if (!STAGES.includes(v as (typeof STAGES)[number])) return c.json({ error: "invalid_stage" }, 400);
      sets.push("stage = ?"); binds.push(v);
    } else if (k === "email") {
      sets.push("email = ?"); binds.push(normalizeEmail(v as string));
    } else if (k === "phone") {
      sets.push("phone = ?"); binds.push(normalizePhone(v as string));
    } else if (k === "tags") {
      sets.push("tags = ?"); binds.push(JSON.stringify(Array.isArray(v) ? v : []));
    } else if (k === "custom") {
      const merged = { ...JSON.parse((existing.custom as string) || "{}"), ...(typeof v === "object" && v ? v : {}) };
      sets.push("custom = ?"); binds.push(JSON.stringify(merged));
    } else {
      sets.push(`${k} = ?`); binds.push(v ?? null);
    }
  }
  if (!sets.length) return c.json({ error: "no_valid_fields" }, 400);
  sets.push("updated_at = ?"); binds.push(nowIso());
  await run(c.env.DB, `UPDATE contacts SET ${sets.join(", ")} WHERE id = ?`, ...binds, id);

  if (typeof b.stage === "string" && b.stage !== existing.stage) {
    await logActivity(c.env.DB, {
      contactId: id, type: "stage_changed",
      title: `Stage: ${existing.stage} → ${b.stage}`,
      payload: { from: existing.stage, to: b.stage },
      actor: actorOf(c),
    });
  }
  return c.json({ ok: true });
});

// Soft delete (archive): sets deleted_at so the contact is hidden but fully
// restorable — jobs, revenue, messages and timeline are preserved. ?purge=1
// hard-deletes (cascades jobs/tasks/messages via FK) for a permanent wipe from
// the Archive view.
contactRoutes.delete("/:id", async (c) => {
  const id = c.req.param("id");
  if (c.req.query("purge") === "1") {
    await run(c.env.DB, "DELETE FROM contacts WHERE id = ?", id);
    return c.json({ ok: true, purged: true });
  }
  await run(c.env.DB, "UPDATE contacts SET deleted_at = ?, updated_at = ? WHERE id = ?", nowIso(), nowIso(), id);
  return c.json({ ok: true, archived: true });
});

contactRoutes.post("/:id/restore", async (c) => {
  await run(c.env.DB, "UPDATE contacts SET deleted_at = NULL, updated_at = ? WHERE id = ?", nowIso(), c.req.param("id"));
  return c.json({ ok: true });
});

contactRoutes.get("/:id/activities", async (c) => {
  const items = await all(
    c.env.DB,
    "SELECT * FROM activities WHERE contact_id = ? ORDER BY id DESC LIMIT 100",
    c.req.param("id")
  );
  return c.json({ items });
});

export const statsRoutes = new Hono<{ Bindings: Env }>();
statsRoutes.use("*", requireAuth());

/**
 * KPI actuals that can be measured rather than typed in.
 *
 * Money KPIs are deliberately absent: revenue and average ticket already have a
 * canonical definition in GET /api/stats (jobs + deposits + the manual ledger,
 * netted so nothing double-counts), and the KPI page reads them from there. A
 * second definition here would drift from the Dashboard within a week.
 */
statsRoutes.get("/kpi", async (c) => {
  const monthStart = "date('now','start of month')";

  const jobsMonth = await one<{ n: number }>(
    c.env.DB,
    `SELECT COUNT(*) AS n FROM jobs
      WHERE status IN ('completed','paid')
        AND date(COALESCE(completed_at, scheduled_start, updated_at)) >= ${monthStart}`
  );

  const leadsWeek = await one<{ n: number }>(
    c.env.DB,
    `SELECT COUNT(*) AS n FROM contacts
      WHERE deleted_at IS NULL AND date(created_at) >= date('now','-7 days')`
  );

  // Lead → booked over a 30-day cohort: of the people who arrived, how many
  // ended up with a job on the calendar. Measured on the cohort's own contacts
  // so a busy month of old customers cannot flatter it.
  const cohort = await one<{ total: number; booked: number }>(
    c.env.DB,
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN EXISTS (
                  SELECT 1 FROM jobs j
                   WHERE j.contact_id = c.id
                     AND j.status IN ('scheduled','in_progress','completed','paid')
                ) THEN 1 ELSE 0 END) AS booked
       FROM contacts c
      WHERE c.deleted_at IS NULL AND date(c.created_at) >= date('now','-30 days')`
  );

  // Rebook rate: of everyone who has bought once, how many came back.
  const rebook = await one<{ once: number; again: number }>(
    c.env.DB,
    `SELECT COUNT(*) AS once, SUM(CASE WHEN n >= 2 THEN 1 ELSE 0 END) AS again
       FROM (
         SELECT j.contact_id, COUNT(*) AS n
           FROM jobs j JOIN contacts c ON c.id = j.contact_id
          WHERE j.status IN ('completed','paid') AND c.deleted_at IS NULL
          GROUP BY j.contact_id
       )`
  );

  const reviewsMonth = await one<{ n: number }>(
    c.env.DB,
    `SELECT COUNT(*) AS n FROM jobs
      WHERE review_left_at IS NOT NULL AND date(review_left_at) >= ${monthStart}`
  );

  const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : null);

  return c.json({
    jobs_completed_month: jobsMonth?.n ?? 0,
    new_leads_week: leadsWeek?.n ?? 0,
    // null, not zero: "no leads yet this month" is not "a 0% close rate".
    lead_to_booked_pct: pct(cohort?.booked ?? 0, cohort?.total ?? 0),
    rebook_rate_pct: pct(rebook?.again ?? 0, rebook?.once ?? 0),
    reviews_month: reviewsMonth?.n ?? 0,
  });
});

statsRoutes.get("/", async (c) => {
  const rows = await all<{ stage: string; n: number }>(
    c.env.DB, "SELECT stage, COUNT(*) AS n FROM contacts WHERE deleted_at IS NULL GROUP BY stage");
  const byStage: Record<string, number> = {};
  for (const s of STAGES) byStage[s] = 0;
  for (const r of rows) byStage[r.stage] = r.n;
  const recent = await all(
    c.env.DB,
    `SELECT a.id, a.type, a.title, a.created_at, a.contact_id, c.first_name, c.last_name
     FROM activities a JOIN contacts c ON c.id = a.contact_id
     WHERE c.deleted_at IS NULL
     ORDER BY a.id DESC LIMIT 20`
  );
  const todayJobs = await all(
    c.env.DB,
    `SELECT j.id, j.title, j.status, j.scheduled_start, j.contact_id, c.first_name, c.last_name, c.phone
     FROM jobs j JOIN contacts c ON c.id = j.contact_id
     WHERE j.status IN ('scheduled','in_progress')
       AND j.scheduled_start IS NOT NULL
       AND date(j.scheduled_start) = date('now')
       AND c.deleted_at IS NULL
     ORDER BY j.scheduled_start ASC`
  );
  const openTasks = await all(
    c.env.DB,
    `SELECT t.id, t.title, t.due_at, t.contact_id, c.first_name, c.last_name
     FROM tasks t LEFT JOIN contacts c ON c.id = t.contact_id
     WHERE t.status = 'open' AND (c.id IS NULL OR c.deleted_at IS NULL)
     ORDER BY (t.due_at IS NULL), t.due_at ASC LIMIT 10`
  );

  // --- Money influx. A "sale" is realized revenue from EITHER source:
  //   • a completed/paid job (dated by scheduled_start, falling back to update), or
  //   • a paid revenue_entries row (the manually-logged Revenue Events ledger).
  // Both are folded together so the Dashboard matches the Revenue page exactly.
  // Pipeline = money in flight = quoted/scheduled jobs + pending revenue entries. ---
  const EARNED = "status IN ('completed','paid')";
  const jobDate = "COALESCE(scheduled_start, updated_at)";
  const entDate = "COALESCE(occurred_at, created_at)";

  const jobTotals = await one<{ cents: number; n: number }>(
    c.env.DB, `SELECT COALESCE(SUM(price_cents),0) AS cents, COUNT(*) AS n FROM jobs WHERE ${EARNED}`);
  const jobMonth = await one<{ cents: number }>(
    c.env.DB, `SELECT COALESCE(SUM(price_cents),0) AS cents FROM jobs
               WHERE ${EARNED} AND strftime('%Y-%m', ${jobDate}) = strftime('%Y-%m','now')`);
  const jobWeek = await one<{ cents: number }>(
    c.env.DB, `SELECT COALESCE(SUM(price_cents),0) AS cents FROM jobs
               WHERE ${EARNED} AND strftime('%Y-%W', ${jobDate}) = strftime('%Y-%W','now')`);
  // Pipeline = the UNPAID remainder of in-flight jobs (a collected deposit is no
  // longer "in flight" — it's cash in hand, counted below).
  const jobPipe = await one<{ cents: number; n: number }>(
    c.env.DB, `SELECT COALESCE(SUM(price_cents - COALESCE(amount_paid_cents,0)),0) AS cents, COUNT(*) AS n FROM jobs
               WHERE status IN ('quoted','scheduled','in_progress')`);
  const jobSeries = await all<{ ym: string; cents: number; n: number }>(
    c.env.DB, `SELECT strftime('%Y-%m', ${jobDate}) AS ym, COALESCE(SUM(price_cents),0) AS cents, COUNT(*) AS n
               FROM jobs WHERE ${EARNED} AND ${jobDate} >= date('now','-6 months','start of month')
               GROUP BY ym ORDER BY ym ASC`);

  // Deposits collected on still-in-flight jobs — real cash received before the
  // job is finished. Dated by paid_at. Counted as realized revenue (the balance
  // is picked up when the job flips to completed/paid, so no double-count).
  const IN_FLIGHT = "status IN ('quoted','scheduled','in_progress') AND COALESCE(amount_paid_cents,0) > 0";
  const depDate = "COALESCE(paid_at, updated_at)";
  const depAll = await one<{ cents: number }>(
    c.env.DB, `SELECT COALESCE(SUM(amount_paid_cents),0) AS cents FROM jobs WHERE ${IN_FLIGHT}`);
  const depMonth = await one<{ cents: number }>(
    c.env.DB, `SELECT COALESCE(SUM(amount_paid_cents),0) AS cents FROM jobs WHERE ${IN_FLIGHT} AND strftime('%Y-%m', ${depDate}) = strftime('%Y-%m','now')`);
  const depWeek = await one<{ cents: number }>(
    c.env.DB, `SELECT COALESCE(SUM(amount_paid_cents),0) AS cents FROM jobs WHERE ${IN_FLIGHT} AND strftime('%Y-%W', ${depDate}) = strftime('%Y-%W','now')`);
  const depSeries = await all<{ ym: string; cents: number; n: number }>(
    c.env.DB, `SELECT strftime('%Y-%m', ${depDate}) AS ym, COALESCE(SUM(amount_paid_cents),0) AS cents, 0 AS n
               FROM jobs WHERE ${IN_FLIGHT} AND ${depDate} >= date('now','-6 months','start of month')
               GROUP BY ym ORDER BY ym ASC`);

  // Same aggregates over the paid revenue_entries ledger (guarded — table is
  // additive from migration 0009/0010 and always present, but stay defensive).
  const entTotals = await one<{ cents: number; n: number }>(
    c.env.DB, `SELECT COALESCE(SUM(amount_cents),0) AS cents, COUNT(*) AS n FROM revenue_entries WHERE status = 'paid'`).catch(() => null);
  const entMonth = await one<{ cents: number }>(
    c.env.DB, `SELECT COALESCE(SUM(amount_cents),0) AS cents FROM revenue_entries
               WHERE status = 'paid' AND strftime('%Y-%m', ${entDate}) = strftime('%Y-%m','now')`).catch(() => null);
  const entWeek = await one<{ cents: number }>(
    c.env.DB, `SELECT COALESCE(SUM(amount_cents),0) AS cents FROM revenue_entries
               WHERE status = 'paid' AND strftime('%Y-%W', ${entDate}) = strftime('%Y-%W','now')`).catch(() => null);
  const entPending = await one<{ cents: number; n: number }>(
    c.env.DB, `SELECT COALESCE(SUM(amount_cents),0) AS cents, COUNT(*) AS n FROM revenue_entries WHERE status = 'pending'`).catch(() => null);
  const entSeries = await all<{ ym: string; cents: number; n: number }>(
    c.env.DB, `SELECT strftime('%Y-%m', ${entDate}) AS ym, COALESCE(SUM(amount_cents),0) AS cents, COUNT(*) AS n
               FROM revenue_entries WHERE status = 'paid' AND ${entDate} >= date('now','-6 months','start of month')
               GROUP BY ym ORDER BY ym ASC`).catch(() => []);

  // Merge the monthly series (completed jobs + deposits + ledger) by year-month.
  const seriesMap = new Map<string, { ym: string; cents: number; n: number }>();
  for (const r of [...(jobSeries ?? []), ...(depSeries ?? []), ...(entSeries ?? [])]) {
    if (!r.ym) continue;
    const cur = seriesMap.get(r.ym) ?? { ym: r.ym, cents: 0, n: 0 };
    cur.cents += r.cents; cur.n += r.n;
    seriesMap.set(r.ym, cur);
  }
  const seriesRows = [...seriesMap.values()].sort((a, b) => a.ym.localeCompare(b.ym));

  const completedCents = (jobTotals?.cents ?? 0) + (entTotals?.cents ?? 0);
  const allCents = completedCents + (depAll?.cents ?? 0);
  const salesAll = (jobTotals?.n ?? 0) + (entTotals?.n ?? 0);
  const revenue = {
    month_cents: (jobMonth?.cents ?? 0) + (depMonth?.cents ?? 0) + (entMonth?.cents ?? 0),
    week_cents: (jobWeek?.cents ?? 0) + (depWeek?.cents ?? 0) + (entWeek?.cents ?? 0),
    pipeline_cents: (jobPipe?.cents ?? 0) + (entPending?.cents ?? 0),
    pipeline_jobs: (jobPipe?.n ?? 0) + (entPending?.n ?? 0),
    all_time_cents: allCents,
    jobs_paid_all: salesAll,
    // avg ticket is per completed sale — deposits on open jobs don't count as sales yet
    avg_ticket_cents: salesAll > 0 ? Math.round(completedCents / salesAll) : 0,
    series: seriesRows,
  };
  return c.json({ byStage, recent, todayJobs, openTasks, revenue });
});
