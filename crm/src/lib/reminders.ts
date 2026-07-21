import type { Env } from "../types";
import { all, nowIso, one, run } from "./db";
import { logActivity } from "./activity";
import { renderBookingConfirmation, renderBookingReminder, sendEmail } from "./email";

interface JobRow {
  id: string; contact_id: string; title: string; scheduled_start: string | null;
  address: string | null; price_cents: number; reminder_sent_at: string | null;
}
interface ContactRow { id: string; first_name: string | null; last_name: string | null; email: string | null; }

export async function sendJobConfirmation(env: Env, jobId: string): Promise<{ status: string }> {
  const job = await one<JobRow>(env.DB, "SELECT * FROM jobs WHERE id = ?", jobId);
  if (!job) return { status: "not_found" };
  const contact = await one<ContactRow>(env.DB, "SELECT id, first_name, last_name, email FROM contacts WHERE id = ?", job.contact_id);
  if (!contact?.email) return { status: "skipped_no_email" };
  const tpl = renderBookingConfirmation(job, contact);
  const r = await sendEmail(env, { contactId: contact.id, jobId: job.id, kind: "transactional", toEmail: contact.email, subject: tpl.subject, html: tpl.html, text: tpl.text });
  await run(env.DB, "UPDATE jobs SET confirmation_sent_at = ? WHERE id = ?", nowIso(), job.id);
  await logActivity(env.DB, { contactId: contact.id, type: "email_sent", title: `Booking confirmation (${r.status})`, payload: { job_id: job.id, message_id: r.id }, actor: "system" });
  return { status: r.status };
}

export async function runReminders(env: Env, nowMs: number): Promise<{ sent: number }> {
  const lo2 = new Date(nowMs + 110 * 60_000).toISOString();
  const hi2 = new Date(nowMs + 130 * 60_000).toISOString();
  const lo24 = new Date(nowMs + 23 * 3600_000).toISOString();
  const hi24 = new Date(nowMs + 25 * 3600_000).toISOString();
  const jobs = await all<JobRow>(
    env.DB,
    `SELECT * FROM jobs
     WHERE status = 'scheduled' AND reminder_sent_at IS NULL AND scheduled_start IS NOT NULL
       AND ((scheduled_start BETWEEN ? AND ?) OR (scheduled_start BETWEEN ? AND ?))`,
    lo2, hi2, lo24, hi24
  );
  let sent = 0;
  for (const job of jobs) {
    const contact = await one<ContactRow>(env.DB, "SELECT id, first_name, last_name, email FROM contacts WHERE id = ?", job.contact_id);
    // Stamp first (idempotency guard) so an overlapping cron can't double-send.
    await run(env.DB, "UPDATE jobs SET reminder_sent_at = ? WHERE id = ?", nowIso(), job.id);
    if (!contact?.email) continue;
    const tpl = renderBookingReminder(job, contact);
    const r = await sendEmail(env, { contactId: contact.id, jobId: job.id, kind: "reminder", toEmail: contact.email, subject: tpl.subject, html: tpl.html, text: tpl.text });
    await logActivity(env.DB, { contactId: contact.id, type: "email_sent", title: `Job reminder (${r.status})`, payload: { job_id: job.id, message_id: r.id }, actor: "system" });
    sent++;
  }
  return { sent };
}
