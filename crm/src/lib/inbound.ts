/**
 * What happens when a customer texts us.
 *
 * Lives here rather than inside the Twilio webhook so the behaviour can be
 * tested without forging a carrier signature, and so the route stays a thin
 * verify-then-delegate shell.
 */
import type { Env } from "../types";
import { nowIso, one, run, uuid } from "./db";
import { logActivity } from "./activity";
import { classifyInbound, helpReply, startConfirmation, stopConfirmation } from "./optout";
import { sendSms } from "./sms";

export interface InboundSms {
  from: string;               // E.164
  body: string;
  messageSid?: string | null;
  to?: string | null;
}

export type InboundOutcome = "opted_out" | "help_sent" | "resubscribed" | "logged";

export interface InboundResult {
  contactId: string;
  outcome: InboundOutcome;
  sequencePaused: boolean;
}

/** Find the contact behind this number, or create one for the new lead. */
async function resolveContact(env: Env, phone: string): Promise<string> {
  const existing = await one<{ id: string }>(env.DB, "SELECT id FROM contacts WHERE phone = ?", phone);
  if (existing) return existing.id;
  const id = uuid();
  const now = nowIso();
  await run(
    env.DB,
    "INSERT INTO contacts (id, phone, stage, source, created_at, updated_at) VALUES (?,?, 'new', 'sms-inbound', ?, ?)",
    id, phone, now, now
  );
  return id;
}

export async function handleInboundSms(env: Env, msg: InboundSms): Promise<InboundResult> {
  const contactId = await resolveContact(env, msg.from);
  const now = nowIso();

  await run(
    env.DB,
    `INSERT INTO messages (id, contact_id, kind, body_text, provider_id, status, created_at, sent_at, channel, direction, from_addr, to_addr)
     VALUES (?,?, 'sms', ?, ?, 'delivered', ?, ?, 'sms', 'inbound', ?, ?)`,
    uuid(), contactId, msg.body, msg.messageSid ?? null, now, now, msg.from, msg.to ?? null
  );
  await run(env.DB, "UPDATE contacts SET replied_flag = 1 WHERE id = ?", contactId);
  await logActivity(env.DB, {
    contactId, type: "sms_logged", title: `Reply: ${msg.body.slice(0, 80)}`,
    payload: { direction: "inbound", message_sid: msg.messageSid ?? null }, actor: "system",
  });

  // Carrier keywords outrank everything else.
  const keyword = classifyInbound(msg.body);

  if (keyword === "stop") {
    await run(
      env.DB,
      "UPDATE contacts SET sms_opted_out_at = ?, sms_opt_in = 0, sms_opt_out_auto = 1, updated_at = ? WHERE id = ?",
      now, now, contactId
    );
    await run(
      env.DB,
      "UPDATE enrollments SET status = 'unsubscribed', exit_reason = 'opted_out', completed_at = ? WHERE contact_id = ? AND status = 'active'",
      now, contactId
    );
    await logActivity(env.DB, {
      contactId, type: "unsubscribed", title: "Texted STOP — opted out of SMS",
      payload: { keyword: msg.body.trim().slice(0, 20) }, actor: "system",
    });
    // One confirmation, then silence. Sent directly on purpose: canSend() would
    // rightly refuse to message an opted-out contact, but carriers require it.
    await sendSms(env, { contactId, toPhone: msg.from, body: stopConfirmation(env), kind: "compliance" });
    return { contactId, outcome: "opted_out", sequencePaused: false };
  }

  if (keyword === "help") {
    await sendSms(env, { contactId, toPhone: msg.from, body: await helpReply(env), kind: "compliance" });
    return { contactId, outcome: "help_sent", sequencePaused: false };
  }

  if (keyword === "start") {
    await run(
      env.DB,
      "UPDATE contacts SET sms_opted_out_at = NULL, sms_opt_in = 1, sms_opt_out_auto = 0, updated_at = ? WHERE id = ?",
      now, contactId
    );
    await logActivity(env.DB, {
      contactId, type: "note", title: "Texted START — resubscribed to SMS", actor: "system",
    });
    await sendSms(env, { contactId, toPhone: msg.from, body: startConfirmation(env), kind: "compliance" });
    return { contactId, outcome: "resubscribed", sequencePaused: false };
  }

  // A human replied — stop the robot. No automated sequence may talk over a
  // live conversation until Max answers and resumes it himself.
  const paused = await run(
    env.DB,
    "UPDATE enrollments SET status = 'paused', exit_reason = 'replied' WHERE contact_id = ? AND status = 'active'",
    contactId
  );
  const sequencePaused = (paused.meta?.changes ?? 0) > 0;
  if (sequencePaused) {
    await logActivity(env.DB, {
      contactId, type: "note", title: "Sequence paused — customer replied", actor: "system",
    });
  }
  return { contactId, outcome: "logged", sequencePaused };
}
