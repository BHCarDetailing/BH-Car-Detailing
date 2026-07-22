import type { Env } from "../types";
import { all, nowIso, one, run, uuid } from "./db";
import { normalizePhone } from "./normalize";

export const DEFAULT_MISSED_CALL_BODY =
  "Hey, this is BH Car Detailing - sorry we missed your call! Reply here with what you need and we'll be in touch.\nIf you'd like to book on your own our website is bhcardetails.com";

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
  const forwardNumber = (s.owner_forward_number ?? "").trim();
  const dialTimeout = Number.parseInt(s.missed_call_dial_timeout ?? "20", 10);
  const cooldownHours = Number.parseInt(s.missed_call_cooldown_hours ?? "4", 10);
  return {
    enabled: (s.missed_call_enabled ?? "1") === "1",
    forwardNumber,
    dialTimeout: Number.isFinite(dialTimeout) ? dialTimeout : 20,
    textBody: (s.missed_call_text_body ?? "").trim() || DEFAULT_MISSED_CALL_BODY,
    cooldownHours: Number.isFinite(cooldownHours) ? cooldownHours : 4,
    ownerNotifyEnabled: (s.owner_notify_enabled ?? "1") === "1",
    ownerNotifyNumber: ((s.owner_notify_number ?? "").trim() || forwardNumber),
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
