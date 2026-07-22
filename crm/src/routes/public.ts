import { Hono } from "hono";
import type { Context } from "hono";
import type { Env } from "../types";
import { all, nowIso, one, run, uuid } from "../lib/db";
import { cleanName, normalizeEmail, normalizePhone, vehicleSizeClass } from "../lib/normalize";
import { logActivity } from "../lib/activity";
import { verifyTwilioSignature } from "../lib/sms";
import { timingSafeEqualStr } from "../lib/auth";
import { buildIcs, type IcsJob } from "../lib/ics";
import { enrollContact, unsubscribeContact, verifyUnsub } from "../lib/sequences";
import { analyzeLead } from "../lib/ai";
import { availableSlots, businessHours, slotEndIso, slotIsFree } from "../lib/booking";
import { sendJobConfirmation } from "../lib/reminders";

export const publicRoutes = new Hono<{ Bindings: Env }>();

function corsHeaders(c: Context<{ Bindings: Env }>): Record<string, string> {
  const origin = c.req.header("Origin");
  const allowed = c.env.ALLOWED_ORIGINS.split(",").map((s) => s.trim());
  if (origin && allowed.includes(origin)) {
    return {
      "Access-Control-Allow-Origin": origin,
      Vary: "Origin",
      "Access-Control-Allow-Headers": "Content-Type",
    };
  }
  return {};
}

publicRoutes.get("/health", (c) => c.json({ ok: true, ts: nowIso() }));

// --- One-click email unsubscribe (token = HMAC of contact id) ---
publicRoutes.get("/unsubscribe/:cid/:sig", async (c) => {
  const cid = c.req.param("cid");
  const ok = await verifyUnsub(c.env.SESSION_SECRET, cid, c.req.param("sig"));
  if (!ok) return c.html("<p>Invalid unsubscribe link.</p>", 400);
  await unsubscribeContact(c.env, cid);
  return c.html("<p>You've been unsubscribed. You won't receive further marketing emails from BH Car Detailing.</p>");
});

// --- iCloud/Google calendar subscription feed (token-guarded, no PII in path) ---
publicRoutes.get("/calendar/:file", async (c) => {
  const token = c.req.param("file").replace(/\.ics$/i, "");
  const row = await one<{ value: string }>(c.env.DB, "SELECT value FROM settings WHERE key = 'ics_feed_token'");
  if (!row?.value || !(await timingSafeEqualStr(token, row.value))) return c.text("not found", 404);
  const jobs = await all<IcsJob>(
    c.env.DB,
    `SELECT j.id, j.title, j.status, j.scheduled_start, j.scheduled_end, j.address, j.price_cents,
            ct.first_name, ct.last_name, ct.phone
     FROM jobs j JOIN contacts ct ON ct.id = j.contact_id
     WHERE j.scheduled_start IS NOT NULL
       AND j.status IN ('scheduled','in_progress','completed','paid')
     ORDER BY j.scheduled_start ASC`
  );
  return c.body(buildIcs(jobs), 200, {
    "Content-Type": "text/calendar; charset=utf-8",
    "Cache-Control": "no-cache",
  });
});

publicRoutes.options("/lead", (c) =>
  new Response(null, {
    status: 204,
    headers: { ...corsHeaders(c), "Access-Control-Allow-Methods": "POST, OPTIONS" },
  })
);

publicRoutes.post("/lead", async (c) => {
  const h = corsHeaders(c);
  const body = await c.req.json<Record<string, unknown>>().catch(() => null);
  if (!body) return c.json({ ok: false, error: "bad_json" }, 400, h);

  // Spam checks — pretend success so bots learn nothing.
  const ts = typeof body.ts === "number" ? body.ts : NaN;
  if (typeof body.website === "string" && body.website !== "") return c.json({ ok: true }, 200, h);
  if (!Number.isFinite(ts) || Date.now() - ts < 2000) return c.json({ ok: true }, 200, h);

  // Rate limit: 10 stored submissions / hour / IP.
  const ip = c.req.header("CF-Connecting-IP") ?? "local";
  const cutoff = Date.now() - 3600_000;
  const rl = await one<{ n: number }>(
    c.env.DB, "SELECT COUNT(*) AS n FROM rl_events WHERE bucket = ? AND ts > ?", "lead:" + ip, cutoff);
  if ((rl?.n ?? 0) >= 10) return c.json({ ok: true }, 200, h);

  const email = normalizeEmail(typeof body.email === "string" ? body.email : undefined);
  const phone = normalizePhone(typeof body.phone === "string" ? body.phone : undefined);
  if (!email && !phone) return c.json({ ok: false, error: "contact_info_required" }, 400, h);

  await run(c.env.DB, "INSERT INTO rl_events (bucket, ts) VALUES (?, ?)", "lead:" + ip, Date.now());

  const name = cleanName(typeof body.name === "string" ? body.name : undefined);
  const [first, ...rest] = (name ?? "").split(" ");
  const last = rest.join(" ");
  const source = typeof body.source === "string" ? body.source.slice(0, 50) : "website";
  const sourceDetail = typeof body.source_detail === "string" ? body.source_detail.slice(0, 200) : null;
  const now = nowIso();

  let contact = email
    ? await one<{ id: string }>(c.env.DB, "SELECT id FROM contacts WHERE email = ?", email)
    : null;
  if (!contact && phone) {
    contact = await one<{ id: string }>(c.env.DB, "SELECT id FROM contacts WHERE phone = ?", phone);
  }

  let contactId: string;
  let created = false;
  if (contact) {
    contactId = contact.id;
    await run(
      c.env.DB,
      `UPDATE contacts SET
         first_name = COALESCE(first_name, ?), last_name = COALESCE(last_name, ?),
         email = COALESCE(email, ?), phone = COALESCE(phone, ?), updated_at = ?
       WHERE id = ?`,
      first || null, last || null, email, phone, now, contactId
    );
  } else {
    created = true;
    contactId = uuid();
    const m = sourceDetail?.match(/\/areas\/([a-z-]+)\.html/);
    await run(
      c.env.DB,
      `INSERT INTO contacts
         (id, first_name, last_name, email, phone, area_slug, stage, source, source_detail,
          email_opt_in, email_opt_in_at, created_at, updated_at)
       VALUES (?,?,?,?,?,?,'new',?,?,1,?,?,?)`,
      contactId, first || null, last || null, email, phone, m?.[1] ?? null, source, sourceDetail, now, now, now
    );
  }

  const vehicleRaw = typeof body.vehicle === "string" ? body.vehicle.trim() : "";
  if (vehicleRaw) {
    const existing = await one<{ id: string }>(
      c.env.DB, "SELECT id FROM vehicles WHERE contact_id = ? AND notes = ?", contactId, vehicleRaw);
    if (!existing) {
      await run(
        c.env.DB,
        "INSERT INTO vehicles (id, contact_id, size_class, notes, created_at) VALUES (?,?,?,?,?)",
        uuid(), contactId, vehicleSizeClass(vehicleRaw), vehicleRaw, now
      );
    }
  }

  await logActivity(c.env.DB, {
    contactId,
    type: "form_submitted",
    title: created ? `New lead via ${source}` : `Repeat submission via ${source}`,
    payload: { source, source_detail: sourceDetail, message: body.message ?? null, vehicle: vehicleRaw || null },
  });

  // Auto-enroll brand-new leads into any active "stage:new" nurture sequence.
  if (created) {
    const seqs = await all<{ id: string }>(c.env.DB, "SELECT id FROM sequences WHERE status = 'active' AND trigger = 'stage:new'");
    for (const s of seqs) await enrollContact(c.env, s.id, contactId);
  }

  // Lead intelligence (async, dormant without ANTHROPIC_API_KEY) — don't block the response.
  if (created && c.env.ANTHROPIC_API_KEY) {
    c.executionCtx.waitUntil(analyzeLead(c.env, contactId));
  }

  return c.json({ ok: true }, 200, h);
});

// --- Public self-booking: live open slots ---
publicRoutes.options("/book", (c) =>
  new Response(null, { status: 204, headers: { ...corsHeaders(c), "Access-Control-Allow-Methods": "POST, OPTIONS" } }));

publicRoutes.get("/book/availability", async (c) => {
  const h = corsHeaders(c);
  const date = c.req.query("date");
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return c.json({ error: "bad_date" }, 400, h);
  const cfg = await businessHours(c.env);
  return c.json({ slots: await availableSlots(c.env, date), slot_min: cfg.slot_min }, 200, h);
});

publicRoutes.post("/book", async (c) => {
  const h = corsHeaders(c);
  const body = await c.req.json<Record<string, unknown>>().catch(() => null);
  if (!body) return c.json({ ok: false, error: "bad_json" }, 400, h);
  const ts = typeof body.ts === "number" ? body.ts : NaN;
  if (typeof body.website === "string" && body.website !== "") return c.json({ ok: true }, 200, h);
  if (!Number.isFinite(ts) || Date.now() - ts < 2000) return c.json({ ok: true }, 200, h);

  const ip = c.req.header("CF-Connecting-IP") ?? "local";
  const rl = await one<{ n: number }>(c.env.DB, "SELECT COUNT(*) AS n FROM rl_events WHERE bucket = ? AND ts > ?", "book:" + ip, Date.now() - 3600_000);
  if ((rl?.n ?? 0) >= 10) return c.json({ ok: true }, 200, h);

  const phone = normalizePhone(typeof body.phone === "string" ? body.phone : undefined);
  const email = normalizeEmail(typeof body.email === "string" ? body.email : undefined);
  if (!phone) return c.json({ ok: false, error: "phone_required" }, 400, h);
  const slot = typeof body.slot_start === "string" ? body.slot_start : "";
  if (!slot || !Number.isFinite(Date.parse(slot))) return c.json({ ok: false, error: "slot_required" }, 400, h);
  if (!(await slotIsFree(c.env, slot))) return c.json({ ok: false, error: "slot_taken" }, 409, h);

  await run(c.env.DB, "INSERT INTO rl_events (bucket, ts) VALUES (?, ?)", "book:" + ip, Date.now());
  const cfg = await businessHours(c.env);
  const service = typeof body.service === "string" && body.service.trim() ? body.service.slice(0, 120) : "Detailing";
  const name = cleanName(typeof body.name === "string" ? body.name : undefined);
  const [first, ...rest] = (name ?? "").split(" ");
  const last = rest.join(" ");
  const address = typeof body.address === "string" ? body.address.slice(0, 200) : null;
  const now = nowIso();

  let contact = email ? await one<{ id: string }>(c.env.DB, "SELECT id FROM contacts WHERE email = ?", email) : null;
  if (!contact && phone) contact = await one<{ id: string }>(c.env.DB, "SELECT id FROM contacts WHERE phone = ?", phone);
  let contactId: string;
  if (contact) {
    contactId = contact.id;
    await run(c.env.DB,
      "UPDATE contacts SET first_name = COALESCE(first_name, ?), last_name = COALESCE(last_name, ?), email = COALESCE(email, ?), phone = COALESCE(phone, ?), updated_at = ? WHERE id = ?",
      first || null, last || null, email, phone, now, contactId);
  } else {
    contactId = uuid();
    await run(c.env.DB,
      `INSERT INTO contacts (id, first_name, last_name, email, phone, address, stage, source, email_opt_in, created_at, updated_at)
       VALUES (?,?,?,?,?,?, 'scheduled', 'self-booking', 1, ?, ?)`,
      contactId, first || null, last || null, email, phone, address, now, now);
  }

  const jobId = uuid();
  await run(c.env.DB,
    `INSERT INTO jobs (id, contact_id, title, status, scheduled_start, scheduled_end, address, created_at, updated_at)
     VALUES (?,?,?, 'scheduled', ?, ?, ?, ?, ?)`,
    jobId, contactId, service, slot, slotEndIso(slot, cfg.slot_min), address, now, now);
  await logActivity(c.env.DB, { contactId, type: "job_scheduled", title: `Self-booked: ${service}`, payload: { job_id: jobId, scheduled_start: slot, source: "self-booking" } });
  c.executionCtx.waitUntil(sendJobConfirmation(c.env, jobId).then(() => undefined));
  return c.json({ ok: true }, 200, h);
});

// --- Twilio inbound SMS webhook (signature-verified, fails closed) ---
async function twilioParams(c: Context<{ Bindings: Env }>): Promise<Record<string, string>> {
  const form = await c.req.formData();
  const params: Record<string, string> = {};
  for (const [k, v] of form.entries()) params[k] = typeof v === "string" ? v : "";
  return params;
}

publicRoutes.post("/twilio/inbound", async (c) => {
  const params = await twilioParams(c);
  const ok = await verifyTwilioSignature(c.env, c.req.url, params, c.req.header("X-Twilio-Signature"));
  if (!ok) return c.text("forbidden", 403);

  const from = normalizePhone(params.From);
  const body = typeof params.Body === "string" ? params.Body : "";
  if (!from) return c.text("<Response></Response>", 200, { "Content-Type": "text/xml" });

  let contact = await one<{ id: string }>(c.env.DB, "SELECT id FROM contacts WHERE phone = ?", from);
  if (!contact) {
    const id = uuid();
    const now = nowIso();
    await run(
      c.env.DB,
      `INSERT INTO contacts (id, phone, stage, source, created_at, updated_at)
       VALUES (?,?, 'new', 'sms-inbound', ?, ?)`,
      id, from, now, now
    );
    contact = { id };
  }

  const now = nowIso();
  await run(
    c.env.DB,
    `INSERT INTO messages (id, contact_id, kind, body_text, provider_id, status, created_at, sent_at, channel, direction, from_addr, to_addr)
     VALUES (?,?, 'sms', ?, ?, 'delivered', ?, ?, 'sms', 'inbound', ?, ?)`,
    uuid(), contact.id, body, params.MessageSid ?? null, now, now, from, params.To ?? null
  );
  await run(c.env.DB, "UPDATE contacts SET replied_flag = 1 WHERE id = ?", contact.id);
  await logActivity(c.env.DB, {
    contactId: contact.id, type: "sms_logged", title: `Reply: ${body.slice(0, 80)}`,
    payload: { direction: "inbound", message_sid: params.MessageSid ?? null }, actor: "system",
  });

  return c.text("<Response></Response>", 200, { "Content-Type": "text/xml" });
});

// --- Twilio delivery status callback (signature-verified, fails closed) ---
publicRoutes.post("/twilio/status", async (c) => {
  const params = await twilioParams(c);
  const ok = await verifyTwilioSignature(c.env, c.req.url, params, c.req.header("X-Twilio-Signature"));
  if (!ok) return c.text("forbidden", 403);
  const sid = params.MessageSid;
  const status = params.MessageStatus;
  if (sid && status) {
    await run(c.env.DB, "UPDATE messages SET status = ? WHERE provider_id = ?", status, sid);
  }
  return c.body(null, 204);
});
