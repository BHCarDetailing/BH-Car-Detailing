/**
 * Review engine.
 *
 * The KPI target is 20 five-star reviews a month and there was no mechanism at
 * all. The first ask already fires on job completion (settings.review_auto);
 * this adds the follow-up that actually produces most of the reviews, plus the
 * tracking needed to tell asked-and-ignored from asked-and-delivered.
 */
import type { Env } from "../types";
import { all, nowIso, one, run } from "./db";
import { logActivity } from "./activity";
import { canSend } from "./guardrails";
import { sendSms } from "./sms";

export const FOLLOWUP_AFTER_DAYS = 5;

interface PendingJob {
  id: string;
  contact_id: string;
  title: string;
  review_requested_at: string;
  first_name: string | null;
  phone: string | null;
}

/**
 * Jobs asked for a review N days ago that never got one.
 *
 * Anyone who has messaged us since the job is excluded: a customer with
 * something to say gets a person, not a second automated ask. That is also the
 * cheapest possible implementation of "never chase a review from someone who
 * had a problem".
 */
export async function pendingReviewFollowUps(env: Env, nowMs: number): Promise<PendingJob[]> {
  const cutoff = new Date(nowMs - FOLLOWUP_AFTER_DAYS * 86_400_000).toISOString();
  return all<PendingJob>(
    env.DB,
    `SELECT j.id, j.contact_id, j.title, j.review_requested_at, c.first_name, c.phone
       FROM jobs j JOIN contacts c ON c.id = j.contact_id
      WHERE j.review_requested_at IS NOT NULL
        AND j.review_requested_at <= ?
        AND j.review_left_at IS NULL
        AND j.review_followup_sent_at IS NULL
        AND c.deleted_at IS NULL
        AND c.sms_opted_out_at IS NULL
        AND c.do_not_contact = 0
        AND NOT EXISTS (
          SELECT 1 FROM messages m
           WHERE m.contact_id = c.id AND m.direction = 'inbound'
             AND m.created_at > j.review_requested_at
        )
      LIMIT 50`,
    cutoff
  );
}

/**
 * Daily pass: one gentle nudge, five days after the first ask. Only ever one —
 * `review_followup_sent_at` is stamped whether or not the send succeeds, so a
 * customer can never be chased twice by a retry.
 */
export async function runReviewFollowUps(env: Env, nowMs = Date.now()): Promise<{ sent: number }> {
  const url = (await one<{ value: string }>(env.DB, "SELECT value FROM settings WHERE key = 'review_url'"))?.value;
  if (!url) return { sent: 0 };

  const brand = env.FROM_NAME || "BH Car Detailing";
  const jobs = await pendingReviewFollowUps(env, nowMs);
  let sent = 0;

  for (const job of jobs) {
    const verdict = await canSend(env, job.contact_id, nowMs, { recentContactDays: null, channel: "sms" });
    if (!verdict.ok) continue;

    await run(env.DB, "UPDATE jobs SET review_followup_sent_at = ? WHERE id = ?", new Date(nowMs).toISOString(), job.id);
    const name = job.first_name || "there";
    await sendSms(env, {
      contactId: job.contact_id,
      toPhone: job.phone!,
      body: `Hi ${name}, hope the car still looks great! If you have 30 seconds, a quick review really helps a small business like ours: ${url} — ${brand}. Reply STOP to opt out.`,
      kind: "review",
    });
    await logActivity(env.DB, {
      contactId: job.contact_id, type: "note", title: "Review follow-up sent",
      payload: { job_id: job.id }, actor: "system",
    });
    sent++;
  }
  return { sent };
}

/**
 * Mark that a review came in. Manual: Google gives no API for this on a
 * business profile, so Max ticks it off when he sees the review.
 */
export async function markReviewLeft(env: Env, jobId: string, nowMs = Date.now()): Promise<{ ok: boolean }> {
  const job = await one<{ id: string; contact_id: string }>(env.DB, "SELECT id, contact_id FROM jobs WHERE id = ?", jobId);
  if (!job) return { ok: false };
  await run(env.DB, "UPDATE jobs SET review_left_at = COALESCE(review_left_at, ?), updated_at = ? WHERE id = ?",
    new Date(nowMs).toISOString(), nowIso(), jobId);
  await logActivity(env.DB, {
    contactId: job.contact_id, type: "note", title: "Review received ⭐", payload: { job_id: jobId }, actor: "human",
  });
  return { ok: true };
}

/** Review funnel for the KPI page: asked, chased, received. */
export async function reviewStats(env: Env, sinceIso: string): Promise<{
  requested: number; followed_up: number; received: number;
}> {
  const row = await one<{ requested: number; followed_up: number; received: number }>(
    env.DB,
    `SELECT
       SUM(CASE WHEN review_requested_at >= ? THEN 1 ELSE 0 END) AS requested,
       SUM(CASE WHEN review_followup_sent_at >= ? THEN 1 ELSE 0 END) AS followed_up,
       SUM(CASE WHEN review_left_at >= ? THEN 1 ELSE 0 END) AS received
     FROM jobs`,
    sinceIso, sinceIso, sinceIso
  );
  return {
    requested: row?.requested ?? 0,
    followed_up: row?.followed_up ?? 0,
    received: row?.received ?? 0,
  };
}
