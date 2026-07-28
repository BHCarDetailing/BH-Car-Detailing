/**
 * The single gate every automated outbound message passes through.
 *
 * These rules exist because one bad query can otherwise text the entire book.
 * They live here rather than inside each sender so every path — rebook offers,
 * sequences, reactivation — enforces the same policy.
 */
import type { Env } from "../types";
import { one } from "./db";

export const QUIET_START = 9;   // local hour automated sends may begin
export const QUIET_END = 20;    // ...and must stop (exclusive)
export const DAILY_SEND_CAP = 40;
export const RECENT_CONTACT_DAYS = 7;

/** Message kinds that count as automated for the purposes of the daily cap. */
const AUTOMATED_KINDS = ["rebook", "sequence", "reminder", "review", "reactivation", "missed_call"];

export type BlockReason =
  | "opted_out"
  | "do_not_contact"
  | "archived"
  | "no_phone"
  | "recent_contact"
  | "awaiting_reply"
  | "quiet_hours"
  | "daily_cap";

export interface SendVerdict {
  ok: boolean;
  reason?: BlockReason;
  /** Human-readable explanation, shown in the UI when a send is blocked. */
  detail?: string;
}

/** Local hour in the business timezone. */
export function localHour(env: Env, ms: number): number {
  const s = new Intl.DateTimeFormat("en-US", {
    timeZone: env.HOME_TZ || "America/New_York", hour: "2-digit", hour12: false,
  }).format(new Date(ms));
  return parseInt(s, 10) % 24;
}

export const inQuietHours = (env: Env, ms: number): boolean => {
  const h = localHour(env, ms);
  return h < QUIET_START || h >= QUIET_END;
};

interface ContactGate {
  id: string;
  phone: string | null;
  deleted_at: string | null;
  do_not_contact: number;
  sms_opted_out_at: string | null;
}

/**
 * May we send this contact an automated message right now?
 *
 * Checks run cheapest-and-most-absolute first: consent, then conversation
 * state, then timing, then volume.
 */
export async function canSend(env: Env, contactId: string, nowMs: number): Promise<SendVerdict> {
  const c = await one<ContactGate>(
    env.DB,
    "SELECT id, phone, deleted_at, do_not_contact, sms_opted_out_at FROM contacts WHERE id = ?",
    contactId
  );
  if (!c) return { ok: false, reason: "archived", detail: "Contact not found." };
  if (c.deleted_at) return { ok: false, reason: "archived", detail: "Contact is archived." };
  if (c.sms_opted_out_at) return { ok: false, reason: "opted_out", detail: "Customer texted STOP." };
  if (Number(c.do_not_contact) === 1) return { ok: false, reason: "do_not_contact", detail: "Marked do-not-contact." };
  if (!c.phone) return { ok: false, reason: "no_phone", detail: "No phone number on file." };

  // Don't pile on: nothing automated within a week of our last message.
  const since = new Date(nowMs - RECENT_CONTACT_DAYS * 86_400_000).toISOString();
  const recent = await one<{ n: number }>(
    env.DB,
    "SELECT COUNT(*) AS n FROM messages WHERE contact_id = ? AND direction = 'outbound' AND created_at > ?",
    contactId, since
  );
  if ((recent?.n ?? 0) > 0) {
    return { ok: false, reason: "recent_contact", detail: `Already messaged in the last ${RECENT_CONTACT_DAYS} days.` };
  }

  // Never talk over a live conversation: if their last inbound is newer than
  // our last outbound, they asked something nobody has answered.
  const lastIn = await one<{ t: string | null }>(
    env.DB,
    "SELECT MAX(created_at) AS t FROM messages WHERE contact_id = ? AND direction = 'inbound'",
    contactId
  );
  if (lastIn?.t) {
    const lastOut = await one<{ t: string | null }>(
      env.DB,
      "SELECT MAX(created_at) AS t FROM messages WHERE contact_id = ? AND direction = 'outbound'",
      contactId
    );
    if (!lastOut?.t || lastIn.t > lastOut.t) {
      return { ok: false, reason: "awaiting_reply", detail: "They replied and are waiting on an answer." };
    }
  }

  if (inQuietHours(env, nowMs)) {
    return { ok: false, reason: "quiet_hours", detail: `Outside sending hours (${QUIET_START}:00–${QUIET_END}:00 local).` };
  }

  // Volume ceiling across the whole account, rolling 24h.
  const dayAgo = new Date(nowMs - 86_400_000).toISOString();
  const placeholders = AUTOMATED_KINDS.map(() => "?").join(",");
  const sentToday = await one<{ n: number }>(
    env.DB,
    `SELECT COUNT(*) AS n FROM messages
      WHERE direction = 'outbound' AND created_at > ? AND kind IN (${placeholders})`,
    dayAgo, ...AUTOMATED_KINDS
  );
  if ((sentToday?.n ?? 0) >= DAILY_SEND_CAP) {
    return { ok: false, reason: "daily_cap", detail: `Daily automated send cap (${DAILY_SEND_CAP}) reached.` };
  }

  return { ok: true };
}
