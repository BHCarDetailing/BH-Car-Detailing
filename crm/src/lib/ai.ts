import type { Env } from "../types";
import { all, nowIso, one, run } from "./db";
import { logActivity } from "./activity";

const MODEL = "claude-haiku-4-5";

/**
 * Call Claude via the Messages API. Returns the text response, or null when
 * the AI layer is dormant (no ANTHROPIC_API_KEY) or on any error — callers
 * treat null as "AI unavailable" and fall back gracefully.
 */
export async function callClaude(
  env: Env, opts: { system: string; user: string; maxTokens?: number }
): Promise<string | null> {
  if (!env.ANTHROPIC_API_KEY) return null;
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: opts.maxTokens ?? 512,
        system: opts.system,
        messages: [{ role: "user", content: opts.user }],
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
    const text = data.content?.find((b) => b.type === "text")?.text;
    return typeof text === "string" ? text : null;
  } catch {
    return null;
  }
}

async function brandBrief(env: Env): Promise<string> {
  const row = await one<{ value: string }>(env.DB, "SELECT value FROM settings WHERE key = 'brand_brief'");
  return row?.value ||
    "BH Car Detailing — mobile auto detailing serving Miami–Fort Lauderdale. Friendly, professional, quick to quote. Sales motion is quote-first: respond fast with a price and book the job.";
}

interface ContactCtx { id: string; first_name: string | null; phone: string | null; email: string | null; source: string | null; }

/**
 * Lead intelligence: classify + summarize a new lead and draft a first reply.
 * Runs async after capture (dormant without ANTHROPIC_API_KEY). Stores
 * ai_summary + ai_next_action on the contact and logs an ai_summary activity
 * with the drafted reply in the payload.
 */
export async function analyzeLead(env: Env, contactId: string): Promise<void> {
  const contact = await one<ContactCtx>(
    env.DB, "SELECT id, first_name, phone, email, source FROM contacts WHERE id = ?", contactId);
  if (!contact) return;
  const vehicles = await all<{ notes: string | null }>(
    env.DB, "SELECT notes FROM vehicles WHERE contact_id = ?", contactId);
  const acts = await all<{ payload: string | null }>(
    env.DB, "SELECT payload FROM activities WHERE contact_id = ? AND type = 'form_submitted' ORDER BY id DESC LIMIT 1", contactId);
  const message = acts[0]?.payload ? (JSON.parse(acts[0].payload).message ?? "") : "";
  const vehicle = vehicles.map((v) => v.notes).filter(Boolean).join("; ");

  const brief = await brandBrief(env);
  const system = `${brief}\n\nYou are the owner's assistant. Given a new lead, respond with a compact JSON object and nothing else: {"summary": "one or two sentences on who this is and what they want", "next_action": "the single best next step", "draft_reply": "a short, friendly text message to send them (first name, no placeholders)"}.`;
  const user = `New lead via ${contact.source ?? "website"}.\nName: ${contact.first_name ?? "(unknown)"}\nPhone: ${contact.phone ?? "—"}\nEmail: ${contact.email ?? "—"}\nVehicle: ${vehicle || "—"}\nMessage: ${message || "—"}`;

  const out = await callClaude(env, { system, user, maxTokens: 400 });
  if (!out) return;
  let parsed: { summary?: string; next_action?: string; draft_reply?: string } | null = null;
  try {
    const m = out.match(/\{[\s\S]*\}/);
    parsed = m ? JSON.parse(m[0]) : null;
  } catch { parsed = null; }
  if (!parsed) return;

  await run(env.DB, "UPDATE contacts SET ai_summary = ?, ai_next_action = ?, updated_at = ? WHERE id = ?",
    parsed.summary ?? null, parsed.next_action ?? null, nowIso(), contactId);
  await logActivity(env.DB, {
    contactId, type: "ai_summary",
    title: parsed.next_action ? `AI: ${parsed.next_action}` : "AI lead summary",
    payload: { summary: parsed.summary, next_action: parsed.next_action, draft_reply: parsed.draft_reply },
    actor: "ai",
  });
}

/** Draft an SMS/email for a contact using the brand brief + their context. */
export async function draftMessage(env: Env, contactId: string, channel: string): Promise<string | null> {
  const contact = await one<ContactCtx & { ai_summary: string | null }>(
    env.DB, "SELECT id, first_name, phone, email, source, ai_summary FROM contacts WHERE id = ?", contactId);
  if (!contact) return null;
  const brief = await brandBrief(env);
  const system = `${brief}\n\nWrite a single ${channel === "email" ? "email (subject optional)" : "short text message"} to this customer. Warm, professional, first name, no placeholders or brackets. Return only the message text.`;
  const user = `Customer: ${contact.first_name ?? "there"}\nSource: ${contact.source ?? "website"}\nWhat we know: ${contact.ai_summary ?? "New lead, no summary yet."}`;
  return callClaude(env, { system, user, maxTokens: 300 });
}

/** Weekly digest: computed numbers, optionally wrapped in an AI narrative. */
export async function generateDigest(env: Env): Promise<{ stats: Record<string, number>; narrative: string | null }> {
  const wk = new Date(Date.now() - 7 * 86400_000).toISOString();
  const num = async (sql: string, ...b: unknown[]) => (await one<{ n: number }>(env.DB, sql, ...b))?.n ?? 0;
  const stats = {
    new_leads: await num("SELECT COUNT(*) AS n FROM contacts WHERE created_at >= ?", wk),
    replied: await num("SELECT COUNT(*) AS n FROM contacts WHERE replied_flag = 1"),
    jobs_scheduled: await num("SELECT COUNT(*) AS n FROM jobs WHERE status = 'scheduled'"),
    quoted_cents: await num("SELECT COALESCE(SUM(price_cents),0) AS n FROM jobs WHERE created_at >= ?", wk),
    open_tasks: await num("SELECT COUNT(*) AS n FROM tasks WHERE status = 'open'"),
  };
  const brief = await brandBrief(env);
  const narrative = await callClaude(env, {
    system: `${brief}\n\nYou write a short, upbeat weekly business digest for the owner. 3-4 sentences, plain text, concrete about the numbers, end with the single most useful thing to focus on next.`,
    user: `This week: ${stats.new_leads} new leads, ${stats.jobs_scheduled} jobs on the calendar, $${(stats.quoted_cents / 100).toFixed(0)} in quotes written, ${stats.open_tasks} open tasks.`,
    maxTokens: 300,
  });
  return { stats, narrative };
}
