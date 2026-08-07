/**
 * Working the dead book.
 *
 * Most of the contact list has never been worked — leads that came in, got a
 * number quoted, and were never followed up. This turns that pile into a short
 * daily queue instead of a blast: a capped number of people a day, best
 * prospects first, each with a drafted message Max approves before it sends.
 *
 * These contacts have NO recorded SMS consent (they were imported from a phone
 * and from HubSpot), so every draft is framed as a reply to their original
 * enquiry — service, not marketing — and asks for consent rather than assuming
 * it. See §7 of the build spec: this is the highest-liability part of the app.
 */
import type { Env } from "../types";
import { all, nowIso, one, run } from "./db";
import { logActivity } from "./activity";
import { canSend } from "./guardrails";
import { sendSms } from "./sms";

/** A habit, not a chore — and it protects deliverability on an unconsented list. */
export const DAILY_REACTIVATION_CAP = 15;

/** Lead sources worth calling first: they asked for us by name. */
const STRONG_SOURCES = ["google_lsa", "lsa", "google", "website_form", "website", "referral", "webchat", "self-booking", "instagram", "nextdoor"];

export interface ReactivationRow {
  contact_id: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  email: string | null;
  source: string | null;
  stage: string;
  created_at: string;
  last_activity_at: string | null;
  vehicle: string | null;
  size_class: string | null;
  /** A price the original enquiry mentioned, in cents — they got a number and didn't book. */
  quoted_cents: number | null;
  score: number;
  reasons: string[];
}

/**
 * Pull a dollar figure out of the legacy contact name.
 *
 * The imported rows carry their whole story in the name field
 * ("Luis Garcia Car Detailing $90/160 Light/Full Interior"). Until that data is
 * parsed properly, a quoted price is still the strongest buying signal we have.
 */
export function quotedCentsFromText(text: string | null | undefined): number | null {
  if (!text) return null;
  const m = text.match(/\$\s?(\d{2,5})/);
  if (!m) return null;
  const dollars = parseInt(m[1], 10);
  if (!Number.isFinite(dollars) || dollars < 20 || dollars > 20000) return null;
  return dollars * 100;
}

interface CandidateRow {
  contact_id: string; first_name: string | null; last_name: string | null;
  phone: string | null; email: string | null; source: string | null; stage: string;
  created_at: string; last_activity_at: string | null;
  vehicle: string | null; size_class: string | null;
}

/**
 * Rank a candidate. Ordered by what the spec found actually predicts a booking:
 * a known vehicle, a source that chose us, a price already discussed, recency.
 */
export function scoreCandidate(row: CandidateRow, nowMs: number): { score: number; reasons: string[]; quoted: number | null } {
  const reasons: string[] = [];
  let score = 0;

  if (row.vehicle) { score += 30; reasons.push("vehicle on file"); }

  const source = (row.source ?? "").toLowerCase();
  if (STRONG_SOURCES.some((s) => source.includes(s))) { score += 25; reasons.push(`came from ${row.source}`); }
  else if (source.includes("import")) { score -= 10; reasons.push("imported contact, no stated interest"); }

  const quoted = quotedCentsFromText([row.first_name, row.last_name].filter(Boolean).join(" "));
  if (quoted) { score += 25; reasons.push(`was quoted about $${Math.round(quoted / 100)}`); }

  const ageDays = (nowMs - Date.parse(row.last_activity_at ?? row.created_at)) / 86_400_000;
  if (Number.isFinite(ageDays)) {
    if (ageDays <= 30) { score += 20; reasons.push("recent enquiry"); }
    else if (ageDays <= 90) { score += 10; reasons.push("enquired in the last 3 months"); }
    else if (ageDays > 365) { score -= 5; reasons.push("over a year old"); }
  }

  return { score, reasons, quoted };
}

/** How many reactivation messages have gone out in the last 24 hours. */
export async function sentToday(env: Env, nowMs: number): Promise<number> {
  const row = await one<{ n: number }>(
    env.DB,
    "SELECT COUNT(*) AS n FROM messages WHERE kind = 'reactivation' AND direction = 'outbound' AND created_at > ?",
    new Date(nowMs - 86_400_000).toISOString()
  );
  return row?.n ?? 0;
}

/**
 * Today's queue: never-bought contacts who have not been approached yet.
 * Customers with job history belong to the rebook engine, not here.
 */
export async function reactivationQueue(
  env: Env, nowMs = Date.now(), limit = DAILY_REACTIVATION_CAP
): Promise<ReactivationRow[]> {
  const rows = await all<CandidateRow>(
    env.DB,
    `SELECT c.id AS contact_id, c.first_name, c.last_name, c.phone, c.email, c.source, c.stage,
            c.created_at, c.last_activity_at,
            (SELECT v.notes FROM vehicles v WHERE v.contact_id = c.id ORDER BY v.created_at ASC LIMIT 1) AS vehicle,
            (SELECT v.size_class FROM vehicles v WHERE v.contact_id = c.id ORDER BY v.created_at ASC LIMIT 1) AS size_class
       FROM contacts c
      WHERE c.deleted_at IS NULL
        AND c.do_not_contact = 0
        AND c.sms_opted_out_at IS NULL
        AND c.reactivation_sent_at IS NULL
        AND c.reactivation_skipped_at IS NULL
        AND COALESCE(c.job_count, 0) = 0
        AND c.stage IN ('new', 'contacted', 'lost')
        AND c.phone IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM enrollments e WHERE e.contact_id = c.id AND e.status = 'active')
      LIMIT 400`
  );

  return rows
    .map((r) => {
      const { score, reasons, quoted } = scoreCandidate(r, nowMs);
      return { ...r, score, reasons, quoted_cents: quoted };
    })
    .sort((a, b) => b.score - a.score || Date.parse(b.created_at) - Date.parse(a.created_at))
    .slice(0, limit);
}

/**
 * The drafted message.
 *
 * Deliberately framed as a follow-up to *their* enquiry, names the business,
 * and carries opt-out instructions — the three things that keep an unconsented
 * contact on the right side of TCPA. It asks a question rather than pitching,
 * because a reply is what creates consent for anything further.
 */
export function draftReactivationMessage(env: Env, row: ReactivationRow): string {
  const brand = env.FROM_NAME || "BH Car Detailing";
  const name = row.first_name || "there";
  const vehicle = row.vehicle ? ` for the ${row.vehicle}` : "";
  const quoted = row.quoted_cents ? ` I had you down around $${Math.round(row.quoted_cents / 100)}.` : "";
  return `Hi ${name}, it's ${brand} — you reached out to us about detailing${vehicle} a while back and I never got you booked in.${quoted} ` +
    `Still want it done? Reply YES and I'll send times. Reply STOP and I won't message again.`;
}

export async function skipReactivation(env: Env, contactId: string, nowMs = Date.now()): Promise<void> {
  await run(env.DB, "UPDATE contacts SET reactivation_skipped_at = ?, updated_at = ? WHERE id = ?",
    new Date(nowMs).toISOString(), nowIso(), contactId);
  await logActivity(env.DB, { contactId, type: "note", title: "Skipped for reactivation", actor: "human" });
}

/**
 * Send one reactivation message. Human-initiated only — there is no automated
 * path to this function, by design.
 */
export async function sendReactivation(
  env: Env, contactId: string, bodyOverride?: string, nowMs = Date.now()
): Promise<{ ok: boolean; reason?: string; detail?: string; status?: string }> {
  if (await sentToday(env, nowMs) >= DAILY_REACTIVATION_CAP) {
    return { ok: false, reason: "daily_cap", detail: `That's ${DAILY_REACTIVATION_CAP} for today — the daily limit protects the number.` };
  }
  const verdict = await canSend(env, contactId, nowMs, { channel: "sms" });
  if (!verdict.ok) return { ok: false, reason: verdict.reason, detail: verdict.detail };

  const contact = await one<{ phone: string | null; first_name: string | null }>(
    env.DB, "SELECT phone, first_name FROM contacts WHERE id = ?", contactId);
  if (!contact?.phone) return { ok: false, reason: "no_phone", detail: "No phone number on file." };

  let body = bodyOverride?.trim();
  if (!body) {
    const [row] = (await reactivationQueue(env, nowMs, 400)).filter((r) => r.contact_id === contactId);
    body = row
      ? draftReactivationMessage(env, row)
      : `Hi ${contact.first_name || "there"}, it's ${env.FROM_NAME || "BH Car Detailing"} — still interested in getting your car detailed? Reply STOP to opt out.`;
  }

  const r = await sendSms(env, { contactId, toPhone: contact.phone, body, kind: "reactivation" });
  await run(env.DB, "UPDATE contacts SET reactivation_sent_at = ?, stage = CASE WHEN stage = 'new' THEN 'contacted' ELSE stage END, updated_at = ? WHERE id = ?",
    new Date(nowMs).toISOString(), nowIso(), contactId);
  await logActivity(env.DB, {
    contactId, type: "sms_logged", title: `Reactivation message sent (${r.status})`,
    payload: { message_id: r.id, body }, actor: "human",
  });
  return { ok: true, status: r.status };
}
