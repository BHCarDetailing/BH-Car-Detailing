/**
 * The rebook engine.
 *
 * Every completed job leaves a scheduled next action: a date on the customer
 * saying when they are due back. The daily pass turns those dates into a
 * worklist. Nothing here sends automatically — messages go out only when a
 * human taps send (decision 2026-07-28), because the imported book has no
 * recorded consent and A2P registration is still in review.
 */
import type { Env } from "../types";
import { all, nowIso, one, run, uuid } from "./db";
import { logActivity } from "./activity";
import { canSend } from "./guardrails";
import { sendSms } from "./sms";

export const DAY_MS = 86_400_000;
/** Used when a job's services carry no cadence of their own. */
export const DEFAULT_REBOOK_DAYS = 60;

export type DueBucket = "due_soon" | "due_now" | "overdue" | "lapsing";

interface JobRow {
  id: string;
  contact_id: string;
  title: string;
  services: string;
  price_cents: number;
  completed_at: string | null;
}

interface LineItem { service_id?: string; name?: string }

/**
 * How many days until this job's customer is due back.
 *
 * A contact-level override always wins. Otherwise the *longest* cadence among
 * the job's services governs: the biggest service on the ticket is the anchor
 * (a paint correction resets the clock much further out than the wash bundled
 * with it). Returns null for one-off work that should never trigger a rebook.
 */
export async function rebookDaysForJob(env: Env, job: JobRow): Promise<number | null> {
  const override = await one<{ rebook_days_override: number | null }>(
    env.DB, "SELECT rebook_days_override FROM contacts WHERE id = ?", job.contact_id);
  if (override?.rebook_days_override != null) return Number(override.rebook_days_override);

  let items: LineItem[] = [];
  try { items = JSON.parse(job.services || "[]"); } catch { items = []; }
  const ids = items.map((i) => i.service_id).filter((id): id is string => typeof id === "string" && id.length > 0);
  if (!ids.length) return DEFAULT_REBOOK_DAYS;

  const rows = await all<{ rebook_days: number | null }>(
    env.DB,
    `SELECT rebook_days FROM services WHERE id IN (${ids.map(() => "?").join(",")})`,
    ...ids
  );
  const cadences = rows.map((r) => r.rebook_days).filter((d): d is number => d != null && d > 0);
  if (!cadences.length) return null;
  return Math.max(...cadences);
}

/** Recompute a contact's aggregates from their job history. Idempotent by design. */
export async function refreshContactTotals(env: Env, contactId: string): Promise<void> {
  await run(
    env.DB,
    `UPDATE contacts SET
       job_count = (SELECT COUNT(*) FROM jobs j WHERE j.contact_id = ? AND j.status IN ('completed','paid')),
       lifetime_value_cents = COALESCE((
         SELECT SUM(MAX(j.amount_paid_cents, j.price_cents)) FROM jobs j
          WHERE j.contact_id = ? AND j.status IN ('completed','paid')), 0),
       last_service_at = (SELECT MAX(j.completed_at) FROM jobs j
          WHERE j.contact_id = ? AND j.status IN ('completed','paid')),
       updated_at = ?
     WHERE id = ?`,
    contactId, contactId, contactId, nowIso(), contactId
  );
}

/**
 * The single funnel for everything that must happen when a job finishes.
 *
 * Guarded on `completed_at` so a double PATCH — or a status flip from
 * 'completed' to 'paid' — cannot double-count revenue or move the due date.
 */
export async function onJobCompleted(
  env: Env, jobId: string, nowMs = Date.now()
): Promise<{ status: string; next_due_at?: string | null }> {
  const job = await one<JobRow>(env.DB, "SELECT * FROM jobs WHERE id = ?", jobId);
  if (!job) return { status: "not_found" };
  if (job.completed_at) return { status: "already_completed" };

  const completedAt = new Date(nowMs).toISOString();
  await run(env.DB, "UPDATE jobs SET completed_at = ?, updated_at = ? WHERE id = ?", completedAt, nowIso(), jobId);
  await refreshContactTotals(env, job.contact_id);

  const days = await rebookDaysForJob(env, job);
  const nextDue = days == null ? null : new Date(nowMs + days * DAY_MS).toISOString();
  await run(
    env.DB,
    "UPDATE contacts SET next_due_at = ?, rebook_snooze_until = NULL, updated_at = ? WHERE id = ?",
    nextDue, nowIso(), job.contact_id
  );

  await logActivity(env.DB, {
    contactId: job.contact_id,
    type: "job_status_changed",
    title: nextDue
      ? `Job completed — due back ${nextDue.slice(0, 10)}`
      : "Job completed — one-off, no rebook scheduled",
    payload: { job_id: jobId, next_due_at: nextDue, rebook_days: days },
    actor: "system",
  });

  // A finished job is the moment to start post-job follow-up — and, on the
  // third one, to ask for a referral from someone who clearly likes the work.
  const { fireTrigger } = await import("./triggers");
  const totals = await one<{ job_count: number }>(
    env.DB, "SELECT job_count FROM contacts WHERE id = ?", job.contact_id);
  if ((totals?.job_count ?? 0) >= 3) await fireTrigger(env, "job:completed:3", job.contact_id);
  await fireTrigger(env, "job:completed", job.contact_id);

  return { status: "completed", next_due_at: nextDue };
}

export interface DueRow {
  contact_id: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  next_due_at: string;
  last_service_at: string | null;
  job_count: number;
  lifetime_value_cents: number;
  last_job_title: string | null;
  last_job_price_cents: number | null;
  vehicle: string | null;
  size_class: string | null;
  bucket: DueBucket;
  days_out: number;
}

export function bucketFor(nextDueMs: number, nowMs: number): DueBucket | null {
  const days = Math.round((nextDueMs - nowMs) / DAY_MS);
  if (days > 7) return null;          // not yet our problem
  if (days >= 1) return "due_soon";
  if (days >= -7) return "due_now";
  if (days >= -60) return "overdue";
  return "lapsing";
}

/**
 * The worklist: who to work today, best customers first.
 *
 * Opted-out, do-not-contact, archived and snoozed contacts never appear —
 * a list you have to mentally filter is a list you stop opening.
 */
export async function dueList(
  env: Env, nowMs = Date.now(), opts: { limit?: number; horizonDays?: number } = {}
): Promise<DueRow[]> {
  const limit = Math.min(opts.limit ?? 50, 200);
  const horizon = new Date(nowMs + (opts.horizonDays ?? 7) * DAY_MS).toISOString();
  const now = new Date(nowMs).toISOString();

  const rows = await all<Omit<DueRow, "bucket" | "days_out">>(
    env.DB,
    `SELECT c.id AS contact_id, c.first_name, c.last_name, c.phone, c.next_due_at,
            c.last_service_at, c.job_count, c.lifetime_value_cents,
            (SELECT j.title FROM jobs j
              WHERE j.contact_id = c.id AND j.completed_at IS NOT NULL
              ORDER BY j.completed_at DESC LIMIT 1) AS last_job_title,
            (SELECT j.price_cents FROM jobs j
              WHERE j.contact_id = c.id AND j.completed_at IS NOT NULL
              ORDER BY j.completed_at DESC LIMIT 1) AS last_job_price_cents,
            (SELECT v.notes FROM vehicles v WHERE v.contact_id = c.id ORDER BY v.created_at ASC LIMIT 1) AS vehicle,
            (SELECT v.size_class FROM vehicles v WHERE v.contact_id = c.id ORDER BY v.created_at ASC LIMIT 1) AS size_class
       FROM contacts c
      WHERE c.next_due_at IS NOT NULL
        AND c.next_due_at <= ?
        AND c.deleted_at IS NULL
        AND c.do_not_contact = 0
        AND c.sms_opted_out_at IS NULL
        AND (c.rebook_snooze_until IS NULL OR c.rebook_snooze_until <= ?)
      ORDER BY c.lifetime_value_cents DESC, c.next_due_at ASC
      LIMIT ?`,
    horizon, now, limit
  );

  return rows.flatMap((r) => {
    const dueMs = Date.parse(r.next_due_at);
    const bucket = Number.isFinite(dueMs) ? bucketFor(dueMs, nowMs) : null;
    if (!bucket) return [];
    return [{ ...r, bucket, days_out: Math.round((dueMs - nowMs) / DAY_MS) }];
  });
}

/** The message we suggest for a due customer. Max edits before it sends. */
export function draftRebookMessage(env: Env, row: DueRow): string {
  const name = row.first_name || "there";
  const brand = env.FROM_NAME || "BH Car Detailing";
  const vehicle = row.vehicle ? ` for the ${row.vehicle}` : "";
  const last = row.last_job_title ? ` Last time we did the ${row.last_job_title.toLowerCase()}.` : "";
  const overdue = row.bucket === "overdue" || row.bucket === "lapsing";
  const opener = overdue
    ? `Hi ${name} — it's been a while!`
    : `Hi ${name}, you're about due for your next detail${vehicle}.`;
  return `${opener}${last} Want me to get you back on the schedule? — ${brand}. Reply STOP to opt out.`;
}

/**
 * Human-initiated rebook send. Still guardrail-checked: an explicit tap does
 * not override a STOP, and it does not license texting someone at 2am.
 */
export async function sendRebookOffer(
  env: Env, contactId: string, bodyOverride?: string, nowMs = Date.now()
): Promise<{ ok: boolean; reason?: string; detail?: string; status?: string }> {
  const verdict = await canSend(env, contactId, nowMs);
  if (!verdict.ok) return { ok: false, reason: verdict.reason, detail: verdict.detail };

  const target = (await dueList(env, nowMs, { limit: 200, horizonDays: 3650 }))
    .find((r) => r.contact_id === contactId);
  const contact = await one<{ phone: string | null; first_name: string | null }>(
    env.DB, "SELECT phone, first_name FROM contacts WHERE id = ?", contactId);
  if (!contact?.phone) return { ok: false, reason: "no_phone", detail: "No phone number on file." };

  const body = bodyOverride?.trim()
    || (target ? draftRebookMessage(env, target) : `Hi ${contact.first_name || "there"}, ready for your next detail? — ${env.FROM_NAME || "BH Car Detailing"}. Reply STOP to opt out.`);

  const r = await sendSms(env, { contactId, toPhone: contact.phone, body, kind: "rebook" });
  await run(
    env.DB,
    "UPDATE contacts SET rebook_snooze_until = ?, updated_at = ? WHERE id = ?",
    new Date(nowMs + 14 * DAY_MS).toISOString(), nowIso(), contactId
  );
  await logActivity(env.DB, {
    contactId, type: "sms_logged", title: `Rebook offer sent (${r.status})`,
    payload: { message_id: r.id, body }, actor: "human",
  });
  return { ok: true, status: r.status };
}

/** Push a contact out of the worklist for a while. */
export async function snoozeRebook(env: Env, contactId: string, days: number, nowMs = Date.now()): Promise<void> {
  const until = new Date(nowMs + Math.max(1, days) * DAY_MS).toISOString();
  await run(env.DB, "UPDATE contacts SET rebook_snooze_until = ?, updated_at = ? WHERE id = ?", until, nowIso(), contactId);
  await logActivity(env.DB, {
    contactId, type: "note", title: `Rebook snoozed ${days} days`, payload: { until }, actor: "human",
  });
}

/**
 * Recompute next_due_at for every contact with service history, using the real
 * cadence of the services on their most recent completed job. The migration
 * seeds a provisional 60-day figure; this refines it.
 */
export async function recomputeAllDueDates(env: Env, nowMs = Date.now()): Promise<{ updated: number }> {
  const contacts = await all<{ id: string; last_service_at: string }>(
    env.DB,
    "SELECT id, last_service_at FROM contacts WHERE last_service_at IS NOT NULL AND deleted_at IS NULL"
  );
  let updated = 0;
  for (const c of contacts) {
    const job = await one<JobRow>(
      env.DB,
      `SELECT * FROM jobs WHERE contact_id = ? AND completed_at IS NOT NULL
        ORDER BY completed_at DESC LIMIT 1`,
      c.id
    );
    if (!job) continue;
    const days = await rebookDaysForJob(env, job);
    const base = Date.parse(job.completed_at ?? c.last_service_at);
    if (!Number.isFinite(base)) continue;
    const next = days == null ? null : new Date(base + days * DAY_MS).toISOString();
    await run(env.DB, "UPDATE contacts SET next_due_at = ? WHERE id = ?", next, c.id);
    updated++;
  }
  return { updated };
}

/**
 * Daily pass (09:00 ET). Draft-for-approval mode: this refreshes the worklist
 * and tells Max what is waiting. It deliberately sends nothing to customers.
 */
export async function runRebook(env: Env, nowMs = Date.now()): Promise<{ due: number; posted: boolean }> {
  const rows = await dueList(env, nowMs, { limit: 200 });
  if (!rows.length) return { due: 0, posted: false };

  // One digest per day — don't spam the feed if the cron double-fires.
  const since = new Date(nowMs - 20 * 3600_000).toISOString();
  const existing = await one<{ n: number }>(
    env.DB,
    "SELECT COUNT(*) AS n FROM updates WHERE category = 'rebook' AND created_at > ?",
    since
  );
  if ((existing?.n ?? 0) > 0) return { due: rows.length, posted: false };

  const overdue = rows.filter((r) => r.bucket === "overdue" || r.bucket === "lapsing").length;
  const value = rows.reduce((sum, r) => sum + (r.last_job_price_cents ?? 0), 0);
  await run(
    env.DB,
    "INSERT INTO updates (id, category, body, author, pinned, created_at) VALUES (?,?,?,?,0,?)",
    uuid(), "rebook",
    `${rows.length} customer${rows.length === 1 ? "" : "s"} due for a rebook` +
      `${overdue ? ` (${overdue} overdue)` : ""} — about $${Math.round(value / 100)} of repeat work waiting on Home.`,
    "system", new Date(nowMs).toISOString()
  );
  return { due: rows.length, posted: true };
}
