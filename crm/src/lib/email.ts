import type { Env } from "../types";
import { nowIso, one, run, uuid } from "./db";

export interface OutgoingEmail {
  contactId?: string;
  jobId?: string;
  sequenceId?: string; // set for sequence steps so the send-log can group by sequence
  kind: string; // transactional | reminder | sequence | oneoff
  toEmail: string;
  subject: string;
  html: string;
  text: string;
}

const HOME_TZ = "America/New_York";

function fmtWhen(iso?: string | null): string {
  if (!iso) return "your scheduled time";
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: HOME_TZ, weekday: "long", month: "long", day: "numeric",
      hour: "numeric", minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function dollars(cents?: number): string {
  return "$" + ((Number(cents) || 0) / 100).toFixed(2);
}

interface JobLike { title: string; scheduled_start?: string | null; address?: string | null; price_cents?: number; }
interface ContactLike { first_name?: string | null; last_name?: string | null; }

export function renderBookingConfirmation(job: JobLike, contact: ContactLike): { subject: string; html: string; text: string } {
  const name = contact.first_name || "there";
  const when = fmtWhen(job.scheduled_start);
  const where = job.address ? ` at ${job.address}` : "";
  const price = job.price_cents ? ` (${dollars(job.price_cents)})` : "";
  const subject = `You're booked: ${job.title} — ${when}`;
  const text = `Hi ${name},\n\nYou're confirmed for ${job.title}${price} on ${when}${where}.\n\nWe'll text you when we're on the way. Reply to this email if anything changes.\n\n— BH Car Detailing`;
  const html = `<p>Hi ${name},</p><p>You're confirmed for <strong>${job.title}</strong>${price} on <strong>${when}</strong>${where}.</p><p>We'll text you when we're on the way. Reply to this email if anything changes.</p><p>— BH Car Detailing</p>`;
  return { subject, html, text };
}

export function renderBookingReminder(job: JobLike, contact: ContactLike): { subject: string; html: string; text: string } {
  const name = contact.first_name || "there";
  const when = fmtWhen(job.scheduled_start);
  const where = job.address ? ` at ${job.address}` : "";
  const subject = `Reminder: ${job.title} — ${when}`;
  const text = `Hi ${name},\n\nQuick reminder — your ${job.title} is coming up ${when}${where}. See you then!\n\n— BH Car Detailing`;
  const html = `<p>Hi ${name},</p><p>Quick reminder — your <strong>${job.title}</strong> is coming up <strong>${when}</strong>${where}. See you then!</p><p>— BH Car Detailing</p>`;
  return { subject, html, text };
}

export async function sendEmail(env: Env, msg: OutgoingEmail): Promise<{ id: string; status: "logged" | "sent" | "failed" }> {
  const id = uuid();
  const now = nowIso();
  const insert = (status: string, providerId: string | null, error: string | null, sentAt: string | null) =>
    run(env.DB,
      `INSERT INTO messages (id, contact_id, job_id, sequence_id, kind, to_email, subject, body_html, body_text, provider_id, status, error, created_at, sent_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      id, msg.contactId ?? null, msg.jobId ?? null, msg.sequenceId ?? null, msg.kind, msg.toEmail, msg.subject,
      msg.html, msg.text, providerId, status, error, now, sentAt);

  if (!env.RESEND_API_KEY) {
    await insert("logged", null, null, null);
    return { id, status: "logged" };
  }

  try {
    const from = `${env.FROM_NAME ?? "BH Car Detailing"} <${env.FROM_EMAIL ?? "hello@bhcardetails.com"}>`;
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from, to: [msg.toEmail], subject: msg.subject, html: msg.html, text: msg.text,
        reply_to: env.REPLY_TO ? [env.REPLY_TO] : undefined,
      }),
    });
    if (!res.ok) {
      const error = `resend_${res.status}: ${(await res.text()).slice(0, 200)}`;
      await insert("failed", null, error, null);
      return { id, status: "failed" };
    }
    const data = (await res.json()) as { id?: string };
    await insert("sent", data.id ?? null, null, nowIso());
    return { id, status: "sent" };
  } catch (e) {
    await insert("failed", null, String(e).slice(0, 200), null);
    return { id, status: "failed" };
  }
}

/* ------------------------------------------------------------------ */
/* Owner alerts — the "someone booked" / "someone started" emails.      */
/* ------------------------------------------------------------------ */

/** Where owner alerts go. Editable in settings so it can change without a deploy. */
export async function ownerAlertAddress(env: Env): Promise<string> {
  const row = await one<{ value: string }>(env.DB, "SELECT value FROM settings WHERE key = 'owner_email'");
  const v = (row?.value ?? "").trim();
  return v || "info@bhcardetails.com";
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * Send an internal alert to the owner. Never throws: an alert failing must not
 * cost a booking that has already been written to the database.
 *
 * Not linked to a contact_id on purpose — these are internal notes to Max, and
 * threading them onto the customer's record would make it look like the
 * customer was emailed.
 */
export async function notifyOwner(
  env: Env,
  alert: { subject: string; heading: string; rows: Array<[string, string]>; note?: string; jobId?: string }
): Promise<void> {
  try {
    const to = await ownerAlertAddress(env);
    const rowsHtml = alert.rows
      .filter(([, v]) => v && v.trim() !== "")
      .map(([k, v]) =>
        `<tr><td style="padding:6px 14px 6px 0;color:#6b7280;white-space:nowrap;vertical-align:top">${esc(k)}</td>` +
        `<td style="padding:6px 0;color:#111827"><strong>${esc(v)}</strong></td></tr>`)
      .join("");
    const rowsText = alert.rows
      .filter(([, v]) => v && v.trim() !== "")
      .map(([k, v]) => `${k}: ${v}`).join("\n");

    const html =
      `<div style="font-family:-apple-system,Segoe UI,sans-serif;max-width:520px">` +
      `<h2 style="margin:0 0 14px;font-size:18px;color:#111827">${esc(alert.heading)}</h2>` +
      `<table style="border-collapse:collapse;font-size:14px">${rowsHtml}</table>` +
      (alert.note ? `<p style="margin:16px 0 0;font-size:13px;color:#6b7280">${esc(alert.note)}</p>` : "") +
      `</div>`;
    const text = alert.heading + "\n\n" + rowsText + (alert.note ? `\n\n${alert.note}` : "");

    await sendEmail(env, {
      jobId: alert.jobId,
      kind: "owner-alert",
      toEmail: to,
      subject: alert.subject,
      html,
      text,
    });
  } catch {
    /* an alert is never worth failing a booking over */
  }
}
