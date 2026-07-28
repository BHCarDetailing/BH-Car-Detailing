import type { Env } from "../types";
import { all, nowIso, one, run, uuid } from "./db";
import { logActivity } from "./activity";
import { sendEmail } from "./email";
import { QUIET_END, QUIET_START, localHour } from "./guardrails";

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

interface StepRow { id: string; step_order: number; delay_hours: number; subject: string; body_text: string; }

async function firstStep(env: Env, sequenceId: string): Promise<StepRow | null> {
  return one<StepRow>(env.DB, "SELECT * FROM sequence_steps WHERE sequence_id = ? ORDER BY step_order ASC LIMIT 1", sequenceId);
}
async function stepAt(env: Env, sequenceId: string, order: number): Promise<StepRow | null> {
  return one<StepRow>(env.DB, "SELECT * FROM sequence_steps WHERE sequence_id = ? AND step_order = ?", sequenceId, order);
}

/** Enroll a contact; idempotent (unique index). Schedules the first step. Returns status. */
export async function enrollContact(env: Env, sequenceId: string, contactId: string): Promise<{ status: string }> {
  const seq = await one(env.DB, "SELECT id FROM sequences WHERE id = ?", sequenceId);
  if (!seq) return { status: "sequence_not_found" };
  const contact = await one<{ id: string; email: string | null; email_opt_in: number }>(
    env.DB, "SELECT id, email, email_opt_in FROM contacts WHERE id = ?", contactId);
  if (!contact) return { status: "contact_not_found" };
  const existing = await one(env.DB, "SELECT id FROM enrollments WHERE sequence_id = ? AND contact_id = ?", sequenceId, contactId);
  if (existing) return { status: "already_enrolled" };
  const step0 = await firstStep(env, sequenceId);
  if (!step0) return { status: "no_steps" };

  const now = nowIso();
  const nextRun = nextSendTime(env, Date.now(), step0.delay_hours);
  await run(env.DB,
    "INSERT INTO enrollments (id, sequence_id, contact_id, status, current_step, next_run_at, enrolled_at) VALUES (?,?,?, 'active', ?, ?, ?)",
    crypto.randomUUID(), sequenceId, contactId, step0.step_order, nextRun, now);
  await logActivity(env.DB, { contactId, type: "enrolled", title: "Enrolled in a sequence", payload: { sequence_id: sequenceId }, actor: "system" });
  return { status: "enrolled" };
}

interface DueRow { id: string; sequence_id: string; contact_id: string; current_step: number; }

/** Cron worker: send due sequence steps, respecting opt-out and quiet hours. */
export async function runSequences(env: Env, nowMs: number): Promise<{ sent: number }> {
  const nowIsoStr = new Date(nowMs).toISOString();
  const due = await all<DueRow>(env.DB,
    "SELECT id, sequence_id, contact_id, current_step FROM enrollments WHERE status = 'active' AND next_run_at IS NOT NULL AND next_run_at <= ? LIMIT 100",
    nowIsoStr);
  const base = env.PUBLIC_BASE_URL ?? "https://bh-crm.bhcardetails.workers.dev";
  let sent = 0;

  for (const e of due) {
    const contact = await one<{ id: string; email: string | null; email_opt_in: number; first_name: string | null; last_name: string | null }>(
      env.DB, "SELECT id, email, email_opt_in, first_name, last_name FROM contacts WHERE id = ?", e.contact_id);
    if (!contact || !contact.email || contact.email_opt_in === 0) {
      await run(env.DB, "UPDATE enrollments SET status = 'exited', completed_at = ? WHERE id = ?", nowIso(), e.id);
      continue;
    }
    const step = await stepAt(env, e.sequence_id, e.current_step);
    if (!step) {
      await run(env.DB, "UPDATE enrollments SET status = 'completed', completed_at = ? WHERE id = ?", nowIso(), e.id);
      continue;
    }

    const name = contact.first_name || "there";
    const token = await unsubToken(env.SESSION_SECRET, contact.id);
    const unsubUrl = `${base}/api/unsubscribe/${contact.id}/${token}`;
    const text = step.body_text.replace(/\{first_name\}/g, name);
    const html = `<div>${text.replace(/\n/g, "<br>")}</div><p style="font-size:12px;color:#888">— BH Car Detailing · <a href="${unsubUrl}">Unsubscribe</a></p>`;
    const finalText = `${text}\n\n— BH Car Detailing\nUnsubscribe: ${unsubUrl}`;

    const r = await sendEmail(env, {
      contactId: contact.id, sequenceId: e.sequence_id, kind: "sequence", toEmail: contact.email,
      subject: step.subject.replace(/\{first_name\}/g, name), html, text: finalText,
    });
    await logActivity(env.DB, { contactId: contact.id, type: "email_sent", title: `Sequence email (${r.status})`, payload: { sequence_id: e.sequence_id, step: e.current_step, message_id: r.id }, actor: "workflow:" + e.sequence_id });
    sent++;

    // Post to the Updates feed: who got a sequence email, with a "Sequence" tag + timestamp.
    if (r.status === "sent" || r.status === "logged") {
      const who = [contact.first_name, contact.last_name].filter(Boolean).join(" ") || contact.email || "a contact";
      await run(env.DB,
        "INSERT INTO updates (id, category, body, author, pinned, created_at) VALUES (?,?,?,?,0,?)",
        uuid(), "sequence", `Sequence email sent to ${who} — "${step.subject.replace(/\{first_name\}/g, contact.first_name || "there")}"`, "system", nowIso());
    }

    const nextStep = await stepAt(env, e.sequence_id, e.current_step + 1);
    if (nextStep) {
      await run(env.DB, "UPDATE enrollments SET current_step = ?, next_run_at = ? WHERE id = ?",
        nextStep.step_order, nextSendTime(env, nowMs, nextStep.delay_hours), e.id);
    } else {
      await run(env.DB, "UPDATE enrollments SET status = 'completed', completed_at = ? WHERE id = ?", nowIso(), e.id);
    }
  }
  return { sent };
}

/** Unsubscribe: opt the contact out and exit their active enrollments. */
export async function unsubscribeContact(env: Env, contactId: string): Promise<void> {
  await run(env.DB, "UPDATE contacts SET email_opt_in = 0 WHERE id = ?", contactId);
  await run(env.DB, "UPDATE enrollments SET status = 'unsubscribed', completed_at = ? WHERE contact_id = ? AND status = 'active'", nowIso(), contactId);
  await logActivity(env.DB, { contactId, type: "unsubscribed", title: "Unsubscribed from emails", actor: "system" });
}
