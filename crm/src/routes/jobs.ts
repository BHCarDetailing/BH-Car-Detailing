import { Hono } from "hono";
import type { Env } from "../types";
import { all, nowIso, one, run, uuid } from "../lib/db";
import { logActivity } from "../lib/activity";
import { requireAuth } from "../lib/auth";

export const JOB_STATUSES = ["draft", "quoted", "scheduled", "in_progress", "completed", "paid", "cancelled"] as const;
type JobStatus = (typeof JOB_STATUSES)[number];

const PATCH_FIELDS = new Set([
  "title", "vehicle_id", "services", "price_cents", "status",
  "scheduled_start", "scheduled_end", "address", "travel_buffer_min", "notes",
]);

function actorOf(c: { req: { header: (n: string) => string | undefined } }): string {
  return c.req.header("Authorization")?.startsWith("Bearer ") ? "agent" : "human";
}

export const jobRoutes = new Hono<{ Bindings: Env }>();
jobRoutes.use("*", requireAuth());

jobRoutes.get("/", async (c) => {
  const q = c.req.query();
  const limit = Math.min(Number(q.limit) > 0 ? Number(q.limit) : 100, 200);
  const offset = Number(q.offset) > 0 ? Number(q.offset) : 0;
  const where: string[] = [];
  const binds: unknown[] = [];
  if (q.status) { where.push("j.status = ?"); binds.push(q.status); }
  if (q.contact_id) { where.push("j.contact_id = ?"); binds.push(q.contact_id); }
  if (q.from) { where.push("j.scheduled_start >= ?"); binds.push(q.from); }
  if (q.to) { where.push("j.scheduled_start <= ?"); binds.push(q.to + "T23:59:59.999Z"); }
  const w = where.length ? "WHERE " + where.join(" AND ") : "";
  const total = await one<{ n: number }>(c.env.DB, `SELECT COUNT(*) AS n FROM jobs j ${w}`, ...binds);
  const items = await all(
    c.env.DB,
    `SELECT j.*, c.first_name, c.last_name, c.phone
     FROM jobs j JOIN contacts c ON c.id = j.contact_id
     ${w} ORDER BY COALESCE(j.scheduled_start, j.created_at) DESC LIMIT ? OFFSET ?`,
    ...binds, limit, offset
  );
  return c.json({ items, total: total?.n ?? 0 });
});

jobRoutes.post("/", async (c) => {
  const b = ((await c.req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  const contactId = typeof b.contact_id === "string" ? b.contact_id : "";
  const title = typeof b.title === "string" ? b.title.trim() : "";
  if (!contactId || !title) return c.json({ error: "contact_required" }, 400);
  const status = (typeof b.status === "string" ? b.status : "draft") as JobStatus;
  if (!JOB_STATUSES.includes(status)) return c.json({ error: "invalid_status" }, 400);
  const contact = await one(c.env.DB, "SELECT id FROM contacts WHERE id = ?", contactId);
  if (!contact) return c.json({ error: "contact_not_found" }, 404);

  const id = uuid();
  const now = nowIso();
  await run(
    c.env.DB,
    `INSERT INTO jobs
       (id, contact_id, vehicle_id, title, services, price_cents, status,
        scheduled_start, scheduled_end, address, travel_buffer_min, notes, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    id, contactId,
    typeof b.vehicle_id === "string" ? b.vehicle_id : null,
    title,
    JSON.stringify(Array.isArray(b.services) ? b.services : []),
    Number.isFinite(Number(b.price_cents)) ? Math.round(Number(b.price_cents)) : 0,
    status,
    typeof b.scheduled_start === "string" ? b.scheduled_start : null,
    typeof b.scheduled_end === "string" ? b.scheduled_end : null,
    typeof b.address === "string" ? b.address : null,
    Number.isFinite(Number(b.travel_buffer_min)) ? Math.round(Number(b.travel_buffer_min)) : 30,
    typeof b.notes === "string" ? b.notes : null,
    now, now
  );
  await logActivity(c.env.DB, { contactId, type: "job_created", title: `Job: ${title}`, payload: { job_id: id, status }, actor: actorOf(c) });
  return c.json({ id }, 201);
});

jobRoutes.get("/:id", async (c) => {
  const job = await one<Record<string, unknown>>(c.env.DB, "SELECT * FROM jobs WHERE id = ?", c.req.param("id"));
  if (!job) return c.json({ error: "not_found" }, 404);
  const contact = await one(c.env.DB, "SELECT id, first_name, last_name, phone, email FROM contacts WHERE id = ?", job.contact_id);
  return c.json({ ...job, services: JSON.parse((job.services as string) || "[]"), contact });
});

jobRoutes.patch("/:id", async (c) => {
  const id = c.req.param("id");
  const existing = await one<Record<string, unknown>>(c.env.DB, "SELECT * FROM jobs WHERE id = ?", id);
  if (!existing) return c.json({ error: "not_found" }, 404);
  const b = ((await c.req.json().catch(() => null)) ?? {}) as Record<string, unknown>;

  const sets: string[] = [];
  const binds: unknown[] = [];
  for (const [k, v] of Object.entries(b)) {
    if (!PATCH_FIELDS.has(k)) continue;
    if (k === "status") {
      if (!JOB_STATUSES.includes(v as JobStatus)) return c.json({ error: "invalid_status" }, 400);
      sets.push("status = ?"); binds.push(v);
    } else if (k === "services") {
      sets.push("services = ?"); binds.push(JSON.stringify(Array.isArray(v) ? v : []));
    } else if (k === "price_cents" || k === "travel_buffer_min") {
      sets.push(`${k} = ?`); binds.push(Number.isFinite(Number(v)) ? Math.round(Number(v)) : 0);
    } else {
      sets.push(`${k} = ?`); binds.push(typeof v === "string" ? v : v == null ? null : String(v));
    }
  }
  if (!sets.length) return c.json({ error: "no_valid_fields" }, 400);
  sets.push("updated_at = ?"); binds.push(nowIso());
  await run(c.env.DB, `UPDATE jobs SET ${sets.join(", ")} WHERE id = ?`, ...binds, id);

  const contactId = existing.contact_id as string;
  const actor = actorOf(c);
  if (typeof b.status === "string" && b.status !== existing.status) {
    await logActivity(c.env.DB, { contactId, type: "job_status_changed", title: `Job ${existing.title}: ${existing.status} → ${b.status}`, payload: { job_id: id, from: existing.status, to: b.status }, actor });
  }
  if (typeof b.scheduled_start === "string" && b.scheduled_start && b.scheduled_start !== existing.scheduled_start) {
    await logActivity(c.env.DB, { contactId, type: "job_scheduled", title: `Job scheduled: ${existing.title}`, payload: { job_id: id, scheduled_start: b.scheduled_start }, actor });
  }
  // Auto review request on completion (opt-in via settings.review_auto).
  if (b.status === "completed" && existing.status !== "completed") {
    const auto = await one<{ value: string }>(c.env.DB, "SELECT value FROM settings WHERE key = 'review_auto'");
    if (auto?.value === "1") {
      const { sendReviewRequest } = await import("../lib/reminders");
      c.executionCtx.waitUntil(sendReviewRequest(c.env, id).then(() => undefined));
    }
  }
  return c.json({ ok: true });
});

jobRoutes.delete("/:id", async (c) => {
  await run(c.env.DB, "DELETE FROM jobs WHERE id = ?", c.req.param("id"));
  return c.json({ ok: true });
});

jobRoutes.post("/:id/confirm", async (c) => {
  const { sendJobConfirmation } = await import("../lib/reminders");
  const out = await sendJobConfirmation(c.env, c.req.param("id"));
  return c.json(out, out.status === "not_found" ? 404 : 200);
});

// Ensure the job has a public quote token and mark it as sent. Returns the
// token + relative path so the UI can build the shareable link.
jobRoutes.post("/:id/send-quote", async (c) => {
  const id = c.req.param("id");
  const job = await one<Record<string, unknown>>(c.env.DB, "SELECT * FROM jobs WHERE id = ?", id);
  if (!job) return c.json({ error: "not_found" }, 404);
  let token = (job.quote_token as string) || "";
  if (!token) token = uuid().replace(/-/g, "");
  await run(c.env.DB, "UPDATE jobs SET quote_token = ?, quote_sent_at = ?, updated_at = ? WHERE id = ?", token, nowIso(), nowIso(), id);
  await logActivity(c.env.DB, { contactId: job.contact_id as string, type: "note", title: "Quote link sent", payload: { job_id: id }, actor: actorOf(c) });
  return c.json({ token, path: `/quote/${token}` });
});

// Record a manual (non-Stripe) payment — Zelle, cash, check, etc.
const MANUAL_METHODS = new Set(["zelle", "cash", "check", "card_external", "deposit", "other"]);
jobRoutes.post("/:id/mark-paid", async (c) => {
  const id = c.req.param("id");
  const job = await one<Record<string, unknown>>(c.env.DB, "SELECT * FROM jobs WHERE id = ?", id);
  if (!job) return c.json({ error: "not_found" }, 404);
  const b = ((await c.req.json().catch(() => null)) ?? {}) as { amount_cents?: unknown; method?: unknown; in_full?: unknown };
  const method = typeof b.method === "string" && MANUAL_METHODS.has(b.method) ? b.method : "other";
  const amount = Math.max(0, Math.round(Number(b.amount_cents) || 0));
  if (amount <= 0) return c.json({ error: "amount_required" }, 400);
  const prevPaid = (job.amount_paid_cents as number) ?? 0;
  const newPaid = prevPaid + amount;
  const total = (job.price_cents as number) ?? 0;
  const fullyPaid = b.in_full === true || newPaid >= total;
  const now = nowIso();
  await run(
    c.env.DB,
    "UPDATE jobs SET amount_paid_cents = ?, paid_at = COALESCE(paid_at, ?), paid_in_full = ?, updated_at = ? WHERE id = ?",
    newPaid, now, fullyPaid ? 1 : 0, now, id
  );
  await logActivity(c.env.DB, {
    contactId: job.contact_id as string,
    type: "note",
    title: `Payment recorded: $${(amount / 100).toFixed(2)} via ${method}${fullyPaid ? " (paid in full)" : ""}`,
    payload: { job_id: id, amount_cents: amount, method, manual: true },
    actor: actorOf(c),
  });
  return c.json({ ok: true, amount_paid_cents: newPaid, paid_in_full: fullyPaid });
});

jobRoutes.post("/:id/request-review", async (c) => {
  const { sendReviewRequest } = await import("../lib/reminders");
  const out = await sendReviewRequest(c.env, c.req.param("id"));
  const code = out.status === "not_found" ? 404 : out.status === "no_review_url" ? 400 : 200;
  return c.json(out, code);
});
