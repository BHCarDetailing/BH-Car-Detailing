import type { Env } from "../types";
import { all, nowIso, one, run, uuid } from "./db";
import { logActivity } from "./activity";
import { sendEmail } from "./email";
import { QUIET_END, QUIET_START, canSend, localHour } from "./guardrails";
import { sendSms } from "./sms";

const enc = new TextEncoder();

async function hmacHex(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function unsubToken(secret: string, contactId: string): Promise<string> {
  return hmacHex(secret, "unsub:" + contactId);
}

export async function verifyUnsub(secret: string, contactId: string, sig: string): Promise<boolean> {
  const expected = await unsubToken(secret, contactId);
  if (expected.length !== sig.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0;
}

/** Delay from `fromMs`, then shift into the quiet-hours window (local HOME_TZ). */
export function nextSendTime(env: Env, fromMs: number, delayHours: number): string {
  let t = fromMs + delayHours * 3600_000;
  const h = localHour(env, t);
  if (h < QUIET_START) t += (QUIET_START - h) * 3600_000;
  else if (h >= QUIET_END) t += (24 - h + QUIET_START) * 3600_000;
  return new Date(t).toISOString();
}

export type StepChannel = "sms" | "email" | "auto";

interface StepRow {
  id: string; step_order: number; delay_hours: number;
  subject: string; body_text: string; channel: StepChannel;
}

async function firstStep(env: Env, sequenceId: string): Promise<StepRow | null> {
  return one<StepRow>(env.DB, "SELECT * FROM sequence_steps WHERE sequence_id = ? ORDER BY step_order ASC LIMIT 1", sequenceId);
}
async function stepAt(env: Env, sequenceId: string, order: number): Promise<StepRow | null> {
  return one<StepRow>(env.DB, "SELECT * FROM sequence_steps WHERE sequence_id = ? AND step_order = ?", sequenceId, order);
}

export interface ChannelTarget {
  channel: "sms" | "email" | "task";
  /** Why this channel — surfaced in the send log so a fallback is never silent. */
  reason: string;
}

/**
 * Which channel can actually reach this contact.
 *
 * 'auto' prefers SMS, because this is a business booked by text and most of
 * the book has a phone and no email. It falls back to email, and finally to a
 * task for Max — a contact we cannot legally or practically message is a
 * person to call, not a message to drop on the floor.
 */
export function resolveChannel(
  want: StepChannel,
  contact: { phone: string | null; email: string | null; email_opt_in: number; sms_opt_in: number; sms_opted_out_at: string | null }
): ChannelTarget {
  const smsOk = !!contact.phone && Number(contact.sms_opt_in) === 1 && !contact.sms_opted_out_at;
  const emailOk = !!contact.email && Number(contact.email_opt_in) === 1;

  if (want === "sms") {
    if (smsOk) return { channel: "sms", reason: "step is SMS" };
    return { channel: "task", reason: contact.sms_opted_out_at ? "opted out of SMS" : "no SMS consent on file" };
  }
  if (want === "email") {
    if (emailOk) return { channel: "email", reason: "step is email" };
    return { channel: "task", reason: contact.email ? "unsubscribed from email" : "no email address" };
  }
  if (smsOk) return { channel: "sms", reason: "auto → SMS (consented)" };
  if (emailOk) return { channel: "email", reason: "auto → email (no SMS consent)" };
  return { channel: "task", reason: "no reachable channel — needs a call" };
}

interface ActiveEnrollment { id: string; sequence_id: string; priority: number; name: string }

/** The contact's current active enrollment, if any, with its sequence priority. */
async function activeEnrollment(env: Env, contactId: string): Promise<ActiveEnrollment | null> {
  return one<ActiveEnrollment>(
    env.DB,
    `SELECT e.id, e.sequence_id, s.priority, s.name
       FROM enrollments e JOIN sequences s ON s.id = e.sequence_id
      WHERE e.contact_id = ? AND e.status = 'active' LIMIT 1`,
    contactId
  );
}

/** End every active enrollment for a contact — they replied, booked, or opted out. */
export async function exitEnrollments(
  env: Env, contactId: string, reason: string, status = "exited"
): Promise<number> {
  const r = await run(
    env.DB,
    "UPDATE enrollments SET status = ?, exit_reason = ?, completed_at = ? WHERE contact_id = ? AND status = 'active'",
    status, reason, nowIso(), contactId
  );
  const n = r.meta?.changes ?? 0;
  if (n > 0) {
    await logActivity(env.DB, {
      contactId, type: "note", title: `Sequence ended (${reason})`, payload: { reason }, actor: "system",
    });
  }
  return n;
}

/**
 * Enroll a contact. Idempotent per sequence.
 *
 * A contact may be in only ONE active sequence at a time — two robots talking
 * at once is how a customer decides you're spam. When another is already
 * running, the higher-priority sequence wins and supersedes the other.
 */
export async function enrollContact(env: Env, sequenceId: string, contactId: string): Promise<{ status: string }> {
  const seq = await one<{ id: string; priority: number; name: string }>(
    env.DB, "SELECT id, priority, name FROM sequences WHERE id = ?", sequenceId);
  if (!seq) return { status: "sequence_not_found" };
  const contact = await one<{ id: string; deleted_at: string | null; do_not_contact: number }>(
    env.DB, "SELECT id, deleted_at, do_not_contact FROM contacts WHERE id = ?", contactId);
  if (!contact) return { status: "contact_not_found" };
  if (contact.deleted_at) return { status: "contact_archived" };
  if (Number(contact.do_not_contact) === 1) return { status: "do_not_contact" };

  const existing = await one<{ status: string }>(
    env.DB, "SELECT status FROM enrollments WHERE sequence_id = ? AND contact_id = ?", sequenceId, contactId);
  if (existing) return { status: "already_enrolled" };

  const current = await activeEnrollment(env, contactId);
  if (current) {
    if (Number(current.priority) >= Number(seq.priority)) return { status: "lower_priority" };
    await run(
      env.DB,
      "UPDATE enrollments SET status = 'exited', exit_reason = 'superseded', completed_at = ? WHERE id = ?",
      nowIso(), current.id
    );
  }

  const step0 = await firstStep(env, sequenceId);
  if (!step0) return { status: "no_steps" };

  const now = nowIso();
  const nextRun = nextSendTime(env, Date.now(), step0.delay_hours);
  await run(env.DB,
    "INSERT INTO enrollments (id, sequence_id, contact_id, status, current_step, next_run_at, enrolled_at) VALUES (?,?,?, 'active', ?, ?, ?)",
    crypto.randomUUID(), sequenceId, contactId, step0.step_order, nextRun, now);
  await logActivity(env.DB, { contactId, type: "enrolled", title: `Enrolled in ${seq.name}`, payload: { sequence_id: sequenceId }, actor: "system" });
  return { status: "enrolled" };
}

interface DueRow { id: string; sequence_id: string; contact_id: string; current_step: number; }

interface SeqContact {
  id: string; first_name: string | null; last_name: string | null;
  email: string | null; email_opt_in: number;
  phone: string | null; sms_opt_in: number; sms_opted_out_at: string | null;
}

const fullName = (c: SeqContact): string =>
  [c.first_name, c.last_name].filter(Boolean).join(" ") || c.phone || c.email || "a contact";

/**
 * Cron worker: send due sequence steps.
 *
 * Every send goes through the same guardrails as any other automated message
 * (consent, quiet hours, daily cap) — the anti-pile-on window is the one rule
 * that does not apply, because a sequence's step delays *are* its cadence.
 */
export async function runSequences(env: Env, nowMs: number): Promise<{ sent: number; deferred: number; tasks: number }> {
  const nowIsoStr = new Date(nowMs).toISOString();
  const due = await all<DueRow>(env.DB,
    "SELECT id, sequence_id, contact_id, current_step FROM enrollments WHERE status = 'active' AND next_run_at IS NOT NULL AND next_run_at <= ? LIMIT 100",
    nowIsoStr);
  const base = env.PUBLIC_BASE_URL ?? "https://bh-crm.bhcardetails.workers.dev";
  const brand = env.FROM_NAME || "BH Car Detailing";
  let sent = 0, deferred = 0, tasks = 0;

  for (const e of due) {
    const contact = await one<SeqContact>(
      env.DB,
      `SELECT id, first_name, last_name, email, email_opt_in, phone, sms_opt_in, sms_opted_out_at
         FROM contacts WHERE id = ? AND deleted_at IS NULL`,
      e.contact_id
    );
    if (!contact) {
      await run(env.DB, "UPDATE enrollments SET status = 'exited', exit_reason = 'contact_gone', completed_at = ? WHERE id = ?", nowIso(), e.id);
      continue;
    }
    const step = await stepAt(env, e.sequence_id, e.current_step);
    if (!step) {
      await run(env.DB, "UPDATE enrollments SET status = 'completed', completed_at = ? WHERE id = ?", nowIso(), e.id);
      continue;
    }

    const target = resolveChannel(step.channel ?? "auto", contact);
    const name = contact.first_name || "there";
    const text = step.body_text.replace(/\{first_name\}/g, name);
    const subject = step.subject.replace(/\{first_name\}/g, name);

    // No reachable channel: hand it to Max as a task rather than dropping it.
    if (target.channel === "task") {
      await run(env.DB,
        `INSERT INTO tasks (id, contact_id, title, notes, due_at, status, created_by, created_at)
         VALUES (?,?,?,?,?, 'open', 'system', ?)`,
        uuid(), contact.id, `Reach out to ${fullName(contact)} — ${target.reason}`,
        `${subject}\n\n${text}`, nowIsoStr, nowIso());
      await run(env.DB, "UPDATE enrollments SET status = 'exited', exit_reason = 'unreachable', completed_at = ? WHERE id = ?", nowIso(), e.id);
      tasks++;
      continue;
    }

    // Quiet hours and the daily cap defer rather than drop: try again later.
    const verdict = await canSend(env, contact.id, nowMs, { recentContactDays: null, channel: target.channel });
    if (!verdict.ok) {
      if (verdict.reason === "quiet_hours" || verdict.reason === "daily_cap") {
        await run(env.DB, "UPDATE enrollments SET next_run_at = ? WHERE id = ?",
          nextSendTime(env, nowMs, 1), e.id);
        deferred++;
      } else {
        await run(env.DB, "UPDATE enrollments SET status = 'exited', exit_reason = ?, completed_at = ? WHERE id = ?",
          verdict.reason ?? "blocked", nowIso(), e.id);
      }
      continue;
    }

    let status: string;
    if (target.channel === "sms") {
      const r = await sendSms(env, {
        contactId: contact.id, toPhone: contact.phone!,
        body: `${text}\n\nReply STOP to opt out.`, kind: "sequence",
      });
      status = r.status;
      await run(env.DB, "UPDATE messages SET sequence_id = ? WHERE id = ?", e.sequence_id, r.id);
      await logActivity(env.DB, {
        contactId: contact.id, type: "sms_logged", title: `Sequence text (${status})`,
        payload: { sequence_id: e.sequence_id, step: e.current_step, message_id: r.id, resolved: target.reason },
        actor: "workflow:" + e.sequence_id,
      });
    } else {
      const token = await unsubToken(env.SESSION_SECRET, contact.id);
      const unsubUrl = `${base}/api/unsubscribe/${contact.id}/${token}`;
      const html = `<div>${text.replace(/\n/g, "<br>")}</div><p style="font-size:12px;color:#888">— ${brand} · <a href="${unsubUrl}">Unsubscribe</a></p>`;
      const finalText = `${text}\n\n— ${brand}\nUnsubscribe: ${unsubUrl}`;
      const r = await sendEmail(env, {
        contactId: contact.id, sequenceId: e.sequence_id, kind: "sequence", toEmail: contact.email!,
        subject, html, text: finalText,
      });
      status = r.status;
      await logActivity(env.DB, {
        contactId: contact.id, type: "email_sent", title: `Sequence email (${status})`,
        payload: { sequence_id: e.sequence_id, step: e.current_step, message_id: r.id, resolved: target.reason },
        actor: "workflow:" + e.sequence_id,
      });
    }
    sent++;

    // Post to the Updates feed so sends are visible without opening a sequence.
    if (status === "sent" || status === "logged") {
      await run(env.DB,
        "INSERT INTO updates (id, category, body, author, pinned, created_at) VALUES (?,?,?,?,0,?)",
        uuid(), "sequence",
        `Sequence ${target.channel === "sms" ? "text" : "email"} sent to ${fullName(contact)} — "${subject}"`,
        "system", nowIso());
    }

    const nextStep = await stepAt(env, e.sequence_id, e.current_step + 1);
    if (nextStep) {
      await run(env.DB, "UPDATE enrollments SET current_step = ?, next_run_at = ?, last_sent_at = ? WHERE id = ?",
        nextStep.step_order, nextSendTime(env, nowMs, nextStep.delay_hours), nowIso(), e.id);
    } else {
      await run(env.DB, "UPDATE enrollments SET status = 'completed', last_sent_at = ?, completed_at = ? WHERE id = ?",
        nowIso(), nowIso(), e.id);
    }
  }
  return { sent, deferred, tasks };
}

/** Unsubscribe: opt the contact out and exit their active enrollments. */
export async function unsubscribeContact(env: Env, contactId: string): Promise<void> {
  await run(env.DB, "UPDATE contacts SET email_opt_in = 0 WHERE id = ?", contactId);
  await run(env.DB,
    "UPDATE enrollments SET status = 'unsubscribed', exit_reason = 'opted_out', completed_at = ? WHERE contact_id = ? AND status = 'active'",
    nowIso(), contactId);
  await logActivity(env.DB, { contactId, type: "unsubscribed", title: "Unsubscribed from emails", actor: "system" });
}
