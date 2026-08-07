import type { Env } from "../types";
import { all, nowIso, one, run, uuid } from "./db";
import { normalizePhone } from "./normalize";
import { logActivity } from "./activity";
import { sendSms } from "./sms";

export const DEFAULT_MISSED_CALL_BODY =
  "Hey, this is BH Car Detailing - sorry we missed your call! Reply here with what you need and we'll be in touch.\nIf you'd like to book on your own our website is bhcardetails.com\nReply STOP to opt out.";

export type SkipReason =
  | "answered" | "cooldown" | "disabled" | "unknown_number"
  | "self_guard" | "opt_out" | "sms_failed";

export interface MissedCallSettings {
  enabled: boolean;
  forwardNumber: string;
  dialTimeout: number;
  textBody: string;
  cooldownHours: number;
  ownerNotifyEnabled: boolean;
  ownerNotifyNumber: string;
}

async function settingsMap(env: Env): Promise<Record<string, string>> {
  const rows = await all<{ key: string; value: string }>(env.DB, "SELECT key, value FROM settings");
  const m: Record<string, string> = {};
  for (const r of rows) m[r.key] = r.value;
  return m;
}

export async function loadMissedCallSettings(env: Env): Promise<MissedCallSettings> {
  const s = await settingsMap(env);
  const forwardNumberRaw = (s.owner_forward_number ?? "").trim();
  const forwardNumber = normalizePhone(forwardNumberRaw) ?? forwardNumberRaw;
  const notifyNumberRaw = (s.owner_notify_number ?? "").trim();
  const ownerNotifyNumber = (normalizePhone(notifyNumberRaw) ?? notifyNumberRaw) || forwardNumber;
  const dialTimeout = Number.parseInt(s.missed_call_dial_timeout ?? "20", 10);
  const cooldownHours = Number.parseInt(s.missed_call_cooldown_hours ?? "4", 10);
  return {
    enabled: (s.missed_call_enabled ?? "1") === "1",
    forwardNumber,
    dialTimeout: Number.isFinite(dialTimeout) ? dialTimeout : 20,
    textBody: (s.missed_call_text_body ?? "").trim() || DEFAULT_MISSED_CALL_BODY,
    cooldownHours: Number.isFinite(cooldownHours) ? cooldownHours : 4,
    ownerNotifyEnabled: (s.owner_notify_enabled ?? "1") === "1",
    ownerNotifyNumber,
  };
}

export async function findOrCreateMissedCallContact(
  env: Env, phone: string
): Promise<{ id: string; created: boolean }> {
  const existing = await one<{ id: string }>(env.DB, "SELECT id FROM contacts WHERE phone = ?", phone);
  if (existing) return { id: existing.id, created: false };
  const id = uuid();
  const now = nowIso();
  await run(
    env.DB,
    `INSERT INTO contacts (id, phone, stage, source, lead_source, first_contact_method, acquisition_channel, created_at, updated_at)
     VALUES (?,?, 'new', 'missed-call', 'missed_call', 'phone', 'twilio_voice', ?, ?)`,
    id, phone, now, now
  );
  return { id, created: true };
}

export async function insertMissedCall(
  env: Env,
  row: {
    contactId: string | null; fromPhone: string; toPhone: string | null;
    callSid: string | null; dialStatus: string | null; texted: boolean;
    messageId: string | null; skipReason: SkipReason | null;
    templateSnapshot: string | null; durationSeconds: number | null;
  }
): Promise<string> {
  const id = uuid();
  await run(
    env.DB,
    `INSERT INTO missed_calls
      (id, contact_id, from_phone, to_phone, call_sid, dial_status, texted, message_id, skip_reason, text_template_snapshot, duration_seconds, acknowledged_at, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,NULL,?)`,
    id, row.contactId, row.fromPhone, row.toPhone, row.callSid, row.dialStatus,
    row.texted ? 1 : 0, row.messageId, row.skipReason, row.templateSnapshot,
    row.durationSeconds, nowIso()
  );
  return id;
}

/**
 * Reply-aware cooldown. Allow the auto-text if:
 *  - there is no prior auto-text to this number, OR
 *  - the cooldown window has expired AND the customer has sent no inbound
 *    message since that last auto-text.
 */
export async function isAutoTextAllowed(
  env: Env, contactId: string, fromPhone: string, cooldownHours: number, nowMs: number
): Promise<boolean> {
  const last = await one<{ created_at: string }>(
    env.DB,
    "SELECT created_at FROM missed_calls WHERE from_phone = ? AND texted = 1 ORDER BY created_at DESC LIMIT 1",
    fromPhone
  );
  if (!last) return true;
  const lastMs = Date.parse(last.created_at);
  const windowExpired = nowMs - lastMs >= cooldownHours * 60 * 60 * 1000;
  if (!windowExpired) return false;
  const reply = await one<{ id: string }>(
    env.DB,
    "SELECT id FROM messages WHERE contact_id = ? AND direction = 'inbound' AND created_at > ? LIMIT 1",
    contactId, last.created_at
  );
  return !reply;
}

// re-export for callers that normalize at the boundary
export { normalizePhone };

export interface MissedCallInput {
  fromPhone: string | null;
  toPhone: string | null;
  callSid: string | null;
  dialStatus: string | null;
  durationSeconds: number | null;
}

export interface MissedCallDeps {
  send?: (env: Env, msg: { contactId?: string; toPhone: string; body: string }) => Promise<{ id: string; status: string }>;
  nowMs?: number;
}

export interface MissedCallResult {
  logged: boolean;
  texted: boolean;
  skipReason: SkipReason | null;
  contactId: string | null;
  messageId: string | null;
  ownerNotified: boolean;
}

const TIMELINE_TITLES: Record<string, string> = {
  cooldown: "Missed Call — Skipped (Cooldown)",
  opt_out: "Missed Call — Skipped (Opt Out)",
  sms_failed: "Missed Call — Text failed",
  sent: "Missed Call — Auto-text sent",
};

function ownerNotifyBody(env: Env, name: string, phone: string, texted: boolean, contactId: string): string {
  const base = (env.PUBLIC_BASE_URL ?? "").replace(/\/$/, "");
  const link = base ? `${base}/contacts/${contactId}` : `/contacts/${contactId}`;
  const when = new Date().toLocaleString("en-US", { timeStyle: "short", dateStyle: "short", timeZone: env.HOME_TZ });
  return `Missed call: ${name} (${phone}) at ${when}. Auto-text ${texted ? "sent" : "NOT sent"}. Open: ${link}`;
}

export async function handleMissedCall(
  env: Env, input: MissedCallInput, deps: MissedCallDeps = {}
): Promise<MissedCallResult> {
  const send = deps.send ?? sendSms;
  const nowMs = deps.nowMs ?? Date.now();
  const settings = await loadMissedCallSettings(env);
  const from = normalizePhone(input.fromPhone);
  const dial = input.dialStatus;

  const logOnly = async (contactId: string | null, texted: boolean, skip: SkipReason | null, messageId: string | null, snapshot: string | null): Promise<string> =>
    insertMissedCall(env, {
      contactId, fromPhone: from ?? (input.fromPhone ?? ""), toPhone: input.toPhone,
      callSid: input.callSid, dialStatus: dial, texted, messageId, skipReason: skip,
      templateSnapshot: snapshot, durationSeconds: input.durationSeconds,
    });

  // 1. Owner answered
  if (dial === "completed") {
    await logOnly(null, false, "answered", null, null);
    return { logged: true, texted: false, skipReason: "answered", contactId: null, messageId: null, ownerNotified: false };
  }
  // 2. Unknown caller
  if (!from) {
    await logOnly(null, false, "unknown_number", null, null);
    return { logged: true, texted: false, skipReason: "unknown_number", contactId: null, messageId: null, ownerNotified: false };
  }
  // 3. Self / loop guard
  if (from === settings.forwardNumber || (env.TWILIO_FROM_NUMBER && from === normalizePhone(env.TWILIO_FROM_NUMBER))) {
    await logOnly(null, false, "self_guard", null, null);
    return { logged: true, texted: false, skipReason: "self_guard", contactId: null, messageId: null, ownerNotified: false };
  }
  // 4. Feature disabled
  if (!settings.enabled) {
    await logOnly(null, false, "disabled", null, null);
    return { logged: true, texted: false, skipReason: "disabled", contactId: null, messageId: null, ownerNotified: false };
  }

  // From here we have a real missed call from an external number -> owner is notified.
  const { id: contactId } = await findOrCreateMissedCallContact(env, from);
  const contact = await one<{ first_name: string | null; last_name: string | null; sms_opt_out_auto: number }>(
    env.DB, "SELECT first_name, last_name, sms_opt_out_auto FROM contacts WHERE id = ?", contactId);
  const name = [contact?.first_name, contact?.last_name].filter(Boolean).join(" ").trim() || "Unknown Caller";

  let texted = false;
  let skip: SkipReason | null = null;
  let messageId: string | null = null;
  let snapshot: string | null = null;

  if (contact?.sms_opt_out_auto === 1) {
    skip = "opt_out";
  } else if (!(await isAutoTextAllowed(env, contactId, from, settings.cooldownHours, nowMs))) {
    skip = "cooldown";
  } else {
    // Send with exactly one retry on failure.
    let res = await send(env, { contactId, toPhone: from, body: settings.textBody });
    if (res.status === "failed") res = await send(env, { contactId, toPhone: from, body: settings.textBody });
    if (res.status === "failed") {
      skip = "sms_failed";
    } else {
      texted = true;
      messageId = res.id;
      snapshot = settings.textBody;
    }
  }

  const mcId = await logOnly(contactId, texted, skip, messageId, snapshot);

  // Timeline event
  const title = texted ? TIMELINE_TITLES.sent : (skip ? TIMELINE_TITLES[skip] : "Missed Call");
  await logActivity(env.DB, {
    contactId, type: "missed_call", title,
    payload: { missed_call_id: mcId, dial_status: dial, texted, skip_reason: skip }, actor: "system",
  });

  // Owner notification (SMS). Skipped only if the feature is disabled; the
  // actual SMS only goes out when a target number is configured.
  let ownerNotified = false;
  if (settings.ownerNotifyEnabled && settings.ownerNotifyNumber) {
    await send(env, { toPhone: settings.ownerNotifyNumber, body: ownerNotifyBody(env, name, from, texted, contactId) });
    ownerNotified = true;
  }

  return { logged: true, texted, skipReason: skip, contactId, messageId, ownerNotified };
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Pure TwiML builder for the incoming-call webhook. */
export function buildVoiceTwiml(s: MissedCallSettings): string {
  if (!s.forwardNumber) {
    return `<Response><Redirect method="POST">/api/twilio/voice/complete?DialCallStatus=no-answer</Redirect></Response>`;
  }
  const forwardNumber = escapeXml(s.forwardNumber);
  if (!s.enabled) {
    return `<Response><Dial timeout="${s.dialTimeout}">${forwardNumber}</Dial></Response>`;
  }
  return `<Response><Dial timeout="${s.dialTimeout}" action="/api/twilio/voice/complete" method="POST">${forwardNumber}</Dial></Response>`;
}
