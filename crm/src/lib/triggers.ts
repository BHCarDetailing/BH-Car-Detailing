/**
 * What starts a sequence.
 *
 * Eight of nine sequences were `trigger: manual`, and manual means never. These
 * are the events and time windows that enroll people without anyone
 * remembering to. Enrollment itself still enforces the one-active-sequence
 * rule (see lib/sequences.ts), so firing a trigger is always safe.
 */
import type { Env } from "../types";
import { all, one } from "./db";
import { enrollContact } from "./sequences";

/**
 * Event triggers fire from the code path where the thing happened.
 * Time triggers are found by scanning on the daily cron.
 */
export const TRIGGERS = [
  { value: "manual", label: "Manual only", kind: "manual" },
  { value: "stage:new", label: "New lead created", kind: "event" },
  { value: "job:completed", label: "Job completed", kind: "event" },
  { value: "job:completed:3", label: "3rd completed job (referral)", kind: "event" },
  { value: "quote:sent", label: "Quote sent, no reply after 48h", kind: "time" },
  { value: "next_due", label: "Due for a rebook", kind: "time" },
  { value: "no_activity:90d", label: "No activity for 90 days", kind: "time" },
] as const;

export type TriggerType = (typeof TRIGGERS)[number]["value"];

/**
 * Enroll a contact into every active sequence listening for this event.
 * Priority decides which one actually runs when several compete.
 */
export async function fireTrigger(
  env: Env, trigger: TriggerType, contactId: string
): Promise<{ enrolled: number }> {
  const seqs = await all<{ id: string }>(
    env.DB,
    "SELECT id FROM sequences WHERE status = 'active' AND trigger = ? ORDER BY priority DESC",
    trigger
  );
  let enrolled = 0;
  for (const s of seqs) {
    const r = await enrollContact(env, s.id, contactId);
    if (r.status === "enrolled") enrolled++;
  }
  return { enrolled };
}

/** Does any active sequence listen for this trigger? Saves pointless scans. */
async function hasListener(env: Env, trigger: TriggerType): Promise<boolean> {
  const row = await one<{ n: number }>(
    env.DB, "SELECT COUNT(*) AS n FROM sequences WHERE status = 'active' AND trigger = ?", trigger);
  return (row?.n ?? 0) > 0;
}

const DAY_MS = 86_400_000;

/**
 * Time-based triggers, scanned once a day.
 *
 * Each query deliberately excludes contacts who are already in an active
 * sequence, archived, or do-not-contact, so a scan can never resurrect
 * someone who has been dealt with.
 */
export async function runTimeTriggers(env: Env, nowMs: number): Promise<Record<string, number>> {
  const out: Record<string, number> = { "quote:sent": 0, next_due: 0, "no_activity:90d": 0 };
  const now = new Date(nowMs).toISOString();

  const notAlreadyEnrolled = `
    AND c.deleted_at IS NULL AND c.do_not_contact = 0
    AND NOT EXISTS (SELECT 1 FROM enrollments e WHERE e.contact_id = c.id AND e.status = 'active')`;

  // A quote went out, 48h passed, and they neither accepted nor replied.
  if (await hasListener(env, "quote:sent")) {
    const cutoff = new Date(nowMs - 2 * DAY_MS).toISOString();
    const rows = await all<{ id: string }>(
      env.DB,
      `SELECT DISTINCT c.id FROM contacts c
         JOIN jobs j ON j.contact_id = c.id
        WHERE j.quote_sent_at IS NOT NULL AND j.quote_sent_at <= ?
          AND j.quote_accepted_at IS NULL
          AND j.status IN ('quoted','draft')
          AND c.replied_flag = 0
          ${notAlreadyEnrolled}
        LIMIT 100`,
      cutoff
    );
    for (const r of rows) out["quote:sent"] += (await fireTrigger(env, "quote:sent", r.id)).enrolled;
  }

  // The rebook window opened. Runs alongside the /home worklist: the worklist
  // is for Max to work by hand, a sequence here is for the ones he doesn't get to.
  if (await hasListener(env, "next_due")) {
    const rows = await all<{ id: string }>(
      env.DB,
      `SELECT c.id FROM contacts c
        WHERE c.next_due_at IS NOT NULL AND c.next_due_at <= ?
          AND (c.rebook_snooze_until IS NULL OR c.rebook_snooze_until <= ?)
          AND c.sms_opted_out_at IS NULL
          ${notAlreadyEnrolled}
        ORDER BY c.lifetime_value_cents DESC LIMIT 100`,
      now, now
    );
    for (const r of rows) out.next_due += (await fireTrigger(env, "next_due", r.id)).enrolled;
  }

  // Gone quiet for 90 days. Past customers only — a cold lead who never bought
  // is reactivation work, not a dormant-customer nudge.
  if (await hasListener(env, "no_activity:90d")) {
    const cutoff = new Date(nowMs - 90 * DAY_MS).toISOString();
    const rows = await all<{ id: string }>(
      env.DB,
      `SELECT c.id FROM contacts c
        WHERE c.job_count > 0
          AND COALESCE(c.last_activity_at, c.updated_at) <= ?
          AND c.sms_opted_out_at IS NULL
          ${notAlreadyEnrolled}
        ORDER BY c.lifetime_value_cents DESC LIMIT 100`,
      cutoff
    );
    for (const r of rows) out["no_activity:90d"] += (await fireTrigger(env, "no_activity:90d", r.id)).enrolled;
  }

  return out;
}
