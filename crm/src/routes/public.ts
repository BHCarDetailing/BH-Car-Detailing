import { Hono } from "hono";
import type { Context } from "hono";
import type { Env } from "../types";
import { all, nowIso, one, run, uuid } from "../lib/db";
import { cleanName, normalizeEmail, normalizePhone, vehicleSizeClass } from "../lib/normalize";
import { logActivity } from "../lib/activity";
import { verifyTwilioSignature } from "../lib/sms";
import { handleInboundSms } from "../lib/inbound";
import { timingSafeEqualStr } from "../lib/auth";
import { buildIcs, type IcsJob } from "../lib/ics";
import { exitEnrollments, unsubscribeContact, verifyUnsub } from "../lib/sequences";
import { fireTrigger } from "../lib/triggers";
import { analyzeLead } from "../lib/ai";
import { availableSlots, businessHours, slotEndIso, slotIsFree } from "../lib/booking";
import { sendJobConfirmation } from "../lib/reminders";
import { buildVoiceTwiml, handleMissedCall, loadMissedCallSettings } from "../lib/missedcall";
import { createCheckoutSession, depositForTotal, loadPaymentSettings, stripeConfigured, verifyStripeWebhook } from "../lib/stripe";
import { loadTaxSettings, taxOn } from "../lib/tax";
import { completeQuote, priceLines } from "./quotebuilder";
import { vehicleType } from "../lib/vehicles";

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

// Record SMS consent — transactional and marketing kept separate (A2P 30913).
// Marketing consent also tags the contact so promo sends can target only
// those who explicitly opted in to marketing.
async function recordSmsConsent(
  env: Env, contactId: string,
  o: { txn: boolean; mkt: boolean; source: string; sourceDetail?: string | null; at: string; ip: string }
): Promise<void> {
  if (!o.txn && !o.mkt) return;
  await run(env.DB, "UPDATE contacts SET sms_opt_in = 1, sms_opt_out_auto = 0 WHERE id = ?", contactId);
  if (o.txn) {
    await logActivity(env.DB, {
      contactId, type: "note", title: "SMS consent given — transactional (service messages)",
      payload: { consent: "transactional", source: o.source, source_detail: o.sourceDetail ?? null, at: o.at, ip: o.ip },
      actor: "system",
    });
  }
  if (o.mkt) {
    const row = await one<{ tags: string }>(env.DB, "SELECT tags FROM contacts WHERE id = ?", contactId);
    let tags: string[] = [];
    try { tags = JSON.parse(row?.tags || "[]"); } catch { tags = []; }
    if (!tags.includes("sms_marketing")) {
      tags.push("sms_marketing");
      await run(env.DB, "UPDATE contacts SET tags = ? WHERE id = ?", JSON.stringify(tags), contactId);
    }
    await logActivity(env.DB, {
      contactId, type: "note", title: "SMS consent given — marketing (promotions & offers)",
      payload: { consent: "marketing", source: o.source, source_detail: o.sourceDetail ?? null, at: o.at, ip: o.ip },
      actor: "system",
    });
  }
}

publicRoutes.get("/health", (c) => c.json({ ok: true, ts: nowIso() }));

// --- Embeddable webchat widget (chat-to-text lead capture). One <script> tag
// on any site injects a floating bubble that posts to /api/lead. ---
publicRoutes.get("/widget.js", (c) => {
  const origin = (c.env.PUBLIC_BASE_URL || new URL(c.req.url).origin).replace(/\/$/, "");
  const brand = "#c8102e";
  const js = `(function(){
  var API=${JSON.stringify(origin)}+"/api/lead";
  var BRAND=${JSON.stringify(brand)};
  var TS=Date.now();
  if(document.getElementById("bhchat-root"))return;
  var root=document.createElement("div");root.id="bhchat-root";
  root.style.cssText="position:fixed;bottom:20px;right:20px;z-index:2147483000;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif";
  var panel=document.createElement("div");
  panel.style.cssText="display:none;width:320px;max-width:calc(100vw - 40px);background:#fff;border-radius:16px;box-shadow:0 12px 40px rgba(0,0,0,.25);overflow:hidden;margin-bottom:12px";
  panel.innerHTML='<div style="background:'+BRAND+';color:#fff;padding:14px 16px;font-weight:600">Chat with BH Car Detailing<div style="font-weight:400;font-size:12px;opacity:.9">Leave your number — we\\'ll text you right back.</div></div>'
    +'<form id="bhchat-form" style="padding:14px 16px;display:flex;flex-direction:column;gap:8px">'
    +'<input name="name" placeholder="Your name" style="padding:10px;border:1px solid #ddd;border-radius:8px;font-size:14px">'
    +'<input name="phone" required placeholder="Phone number" inputmode="tel" style="padding:10px;border:1px solid #ddd;border-radius:8px;font-size:14px">'
    +'<textarea name="message" rows="2" placeholder="How can we help?" style="padding:10px;border:1px solid #ddd;border-radius:8px;font-size:14px;resize:none"></textarea>'
    +'<label style="display:flex;gap:6px;align-items:flex-start;font-size:11px;line-height:1.4;color:#666"><input type="checkbox" name="sms_opt_in" style="margin-top:2px;flex:0 0 auto"><span>Text me about the quote I requested and my appointment.</span></label>'
    +'<span style="font-size:10px;line-height:1.4;color:#999">By checking the box above, you agree to receive texts about your quote request. Checking the box is optional and not a condition of purchase &mdash; we\\'ll still follow up on your message. Msg &amp; data rates may apply, frequency varies, reply STOP to opt out, HELP for help. <a href="https://bhcardetails.com/terms.html" target="_blank" style="color:'+BRAND+'">Terms</a> &amp; <a href="https://bhcardetails.com/privacy-policy.html" target="_blank" style="color:'+BRAND+'">Privacy</a>.</span>'
    +'<input name="website" tabindex="-1" autocomplete="off" style="position:absolute;left:-9999px" aria-hidden="true">'
    +'<button type="submit" style="background:'+BRAND+';color:#fff;border:0;border-radius:8px;padding:12px;font-size:15px;font-weight:600;cursor:pointer">Send</button>'
    +'<div id="bhchat-msg" style="font-size:13px;color:#666;text-align:center"></div></form>';
  var bubble=document.createElement("button");
  bubble.setAttribute("aria-label","Open chat");
  bubble.style.cssText="width:60px;height:60px;border-radius:50%;background:"+BRAND+";color:#fff;border:0;box-shadow:0 8px 24px rgba(0,0,0,.3);cursor:pointer;font-size:26px;float:right";
  bubble.innerHTML="&#128172;";
  var open=false;
  bubble.onclick=function(){open=!open;panel.style.display=open?"block":"none";bubble.innerHTML=open?"&times;":"&#128172;"};
  root.appendChild(panel);root.appendChild(bubble);document.body.appendChild(root);
  document.getElementById("bhchat-form").addEventListener("submit",function(e){
    e.preventDefault();var f=e.target;var msg=document.getElementById("bhchat-msg");
    var phone=f.phone.value.trim();if(!phone){msg.textContent="Please add a phone number.";return;}
    msg.textContent="Sending...";
    fetch(API,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({
      name:f.name.value,phone:phone,message:f.message.value,website:f.website.value,ts:TS,
      sms_opt_in:f.sms_opt_in.checked,marketing_opt_in:f.marketing_opt_in.checked,source:"webchat",source_detail:location.href
    })}).then(function(r){return r.json()}).then(function(){
      f.style.display="none";msg.textContent="Thanks! We'll text you shortly.";msg.style.color=BRAND;
    }).catch(function(){msg.textContent="Something went wrong — please call us.";});
  });
})();`;
  return c.body(js, 200, {
    "Content-Type": "application/javascript; charset=utf-8",
    "Cache-Control": "public, max-age=300",
  });
});

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

  // Referral attribution: /book?ref=<contact id> on a customer's share link.
  // Verified against a real contact so a junk value can never poison the report.
  const refRaw = typeof body.ref === "string" ? body.ref.slice(0, 64) : null;
  const referrer = refRaw
    ? await one<{ id: string }>(c.env.DB, "SELECT id FROM contacts WHERE id = ? AND deleted_at IS NULL", refRaw)
    : null;

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
          referred_by_contact_id, email_opt_in, email_opt_in_at, created_at, updated_at)
       VALUES (?,?,?,?,?,?,'new',?,?,?,1,?,?,?)`,
      contactId, first || null, last || null, email, phone, m?.[1] ?? null,
      referrer ? "referral" : source, sourceDetail, referrer?.id ?? null, now, now, now
    );
    if (referrer) {
      await logActivity(c.env.DB, {
        contactId: referrer.id, type: "note", title: "Referred a new lead",
        payload: { referred_contact_id: contactId }, actor: "system",
      });
    }
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

  // SMS consent capture (A2P 10DLC / TCPA evidence). Transactional and marketing
  // consent are SEPARATE (error 30913): each is its own checkbox, recorded and
  // logged distinctly with source page, timestamp, and IP.
  await recordSmsConsent(c.env, contactId, {
    txn: body.sms_opt_in === true,
    mkt: body.marketing_opt_in === true,
    source, sourceDetail, at: now, ip,
  });

  await logActivity(c.env.DB, {
    contactId,
    type: "form_submitted",
    title: created ? `New lead via ${source}` : `Repeat submission via ${source}`,
    payload: { source, source_detail: sourceDetail, message: body.message ?? null, vehicle: vehicleRaw || null },
  });

  // Webchat messages become inbound conversation messages so they appear in the
  // unified inbox thread (not just the activity log).
  const chatMsg = typeof body.message === "string" ? body.message.trim() : "";
  if (source === "webchat" && chatMsg) {
    await run(
      c.env.DB,
      `INSERT INTO messages (id, contact_id, kind, body_text, status, created_at, sent_at, channel, direction, from_addr)
       VALUES (?,?, 'sms', ?, 'received', ?, ?, 'webchat', 'inbound', ?)`,
      uuid(), contactId, chatMsg, now, now, phone ?? null
    );
  }

  // Auto-enroll brand-new leads into any active "stage:new" nurture sequence.
  if (created) await fireTrigger(c.env, "stage:new", contactId);

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

  await recordSmsConsent(c.env, contactId, {
    txn: body.sms_opt_in === true,
    mkt: body.marketing_opt_in === true,
    source: "self-booking", at: now, ip,
  });

  const jobId = uuid();
  await run(c.env.DB,
    `INSERT INTO jobs (id, contact_id, title, status, scheduled_start, scheduled_end, address, created_at, updated_at)
     VALUES (?,?,?, 'scheduled', ?, ?, ?, ?, ?)`,
    jobId, contactId, service, slot, slotEndIso(slot, cfg.slot_min), address, now, now);
  await logActivity(c.env.DB, { contactId, type: "job_scheduled", title: `Self-booked: ${service}`, payload: { job_id: jobId, scheduled_start: slot, source: "self-booking" } });
  // They booked — that is what every sequence was trying to achieve. Stop them all.
  await exitEnrollments(c.env, contactId, "booked");
  c.executionCtx.waitUntil(sendJobConfirmation(c.env, jobId).then(() => undefined));
  return c.json({ ok: true }, 200, h);
});

// --- Public shareable quote (token-guarded, no auth). ---
publicRoutes.get("/quote/:token", async (c) => {
  const token = c.req.param("token");
  if (!token) return c.json({ error: "not_found" }, 404);
  const job = await one<Record<string, unknown>>(c.env.DB, "SELECT * FROM jobs WHERE quote_token = ?", token);
  if (!job) return c.json({ error: "not_found" }, 404);
  const contact = await one<{ first_name: string | null }>(c.env.DB, "SELECT first_name FROM contacts WHERE id = ?", job.contact_id);
  if (!job.quote_viewed_at) {
    await run(c.env.DB, "UPDATE jobs SET quote_viewed_at = ? WHERE id = ?", nowIso(), job.id);
  }
  let items: unknown[] = [];
  try { items = JSON.parse((job.services as string) || "[]"); } catch { items = []; }
  const total = (job.price_cents as number) ?? 0;
  const taxCents = (job.tax_cents as number) ?? 0;
  const taxLabel = taxCents > 0 ? (await loadTaxSettings(c.env)).label : null;
  const pay = await loadPaymentSettings(c.env);
  const paymentsLive = stripeConfigured(c.env) && pay.enabled;
  const amountPaid = (job.amount_paid_cents as number) ?? 0;
  return c.json({
    business: c.env.FROM_NAME || "BH Car Detailing",
    title: job.title,
    customer_first: contact?.first_name ?? null,
    status: job.status,
    accepted: !!job.quote_accepted_at,
    items,
    total_cents: total,
    // Tax is already inside total_cents; these let the page show the split.
    tax_cents: taxCents,
    tax_label: taxLabel,
    subtotal_cents: total - taxCents,
    notes: job.notes ?? null,
    created_at: job.created_at,
    payments_enabled: paymentsLive,
    deposit_cents: paymentsLive ? depositForTotal(total, pay.percent) : 0,
    deposit_percent: pay.percent,
    allow_full: pay.allowFull,
    amount_paid_cents: amountPaid,
    paid: amountPaid > 0,
    paid_in_full: Number(job.paid_in_full) === 1,
  });
});

// Create a Stripe Checkout Session for a quote (deposit or full). Public — the
// customer initiates payment. Card data is handled entirely by Stripe.
publicRoutes.post("/quote/:token/checkout", async (c) => {
  const token = c.req.param("token");
  const body = ((await c.req.json().catch(() => null)) ?? {}) as { kind?: string };
  const kind = body.kind === "full" ? "full" : "deposit";
  const job = await one<Record<string, unknown>>(c.env.DB, "SELECT * FROM jobs WHERE quote_token = ?", token);
  if (!job) return c.json({ error: "not_found" }, 404);
  if (!stripeConfigured(c.env)) return c.json({ error: "payments_unavailable" }, 503);
  const pay = await loadPaymentSettings(c.env);
  if (!pay.enabled) return c.json({ error: "payments_unavailable" }, 503);
  if (kind === "full" && !pay.allowFull) return c.json({ error: "full_not_allowed" }, 400);

  const total = (job.price_cents as number) ?? 0;
  const already = (job.amount_paid_cents as number) ?? 0;
  const amount = kind === "full" ? Math.max(0, total - already) : depositForTotal(total, pay.percent);
  if (amount < 50) return c.json({ error: "amount_too_low" }, 400);

  const contact = await one<{ email: string | null }>(c.env.DB, "SELECT email FROM contacts WHERE id = ?", job.contact_id);
  const base = (c.env.PUBLIC_BASE_URL || new URL(c.req.url).origin).replace(/\/$/, "");
  const url = await createCheckoutSession(c.env, {
    jobId: job.id as string,
    amountCents: amount,
    label: `${kind === "full" ? "Payment" : "Deposit"} — ${job.title as string}`,
    kind,
    customerEmail: contact?.email ?? null,
    successUrl: `${base}/quote/${token}?paid=1`,
    cancelUrl: `${base}/quote/${token}`,
    allowAch: pay.ach,
  });
  if (!url) return c.json({ error: "checkout_failed" }, 502);
  await run(c.env.DB, "UPDATE jobs SET deposit_cents = ?, updated_at = ? WHERE id = ?", kind === "deposit" ? amount : job.deposit_cents ?? null, nowIso(), job.id);
  return c.json({ url });
});

// Stripe webhook — payment confirmation. Signature-verified, fails closed.
publicRoutes.post("/stripe/webhook", async (c) => {
  const raw = await c.req.text();
  const ok = await verifyStripeWebhook(c.env, raw, c.req.header("stripe-signature"));
  if (!ok) return c.text("bad signature", 400);
  let event: { type?: string; data?: { object?: Record<string, unknown> } };
  try { event = JSON.parse(raw); } catch { return c.text("bad json", 400); }
  if (event.type === "checkout.session.completed") {
    const s = event.data?.object ?? {};
    const jobId = (s.metadata as Record<string, unknown> | undefined)?.job_id as string | undefined
      ?? (s.client_reference_id as string | undefined);
    const kind = (s.metadata as Record<string, unknown> | undefined)?.kind as string | undefined;
    const amount = Number(s.amount_total) || 0;
    if (jobId) {
      const job = await one<Record<string, unknown>>(c.env.DB, "SELECT * FROM jobs WHERE id = ?", jobId);
      if (job) {
        const prevPaid = (job.amount_paid_cents as number) ?? 0;
        const newPaid = prevPaid + amount;
        const total = (job.price_cents as number) ?? 0;
        const fullyPaid = kind === "full" || newPaid >= total;
        await run(
          c.env.DB,
          `UPDATE jobs SET amount_paid_cents = ?, paid_at = COALESCE(paid_at, ?), paid_in_full = ?,
                          stripe_session_id = ?, stripe_payment_intent = ?, updated_at = ? WHERE id = ?`,
          newPaid, nowIso(), fullyPaid ? 1 : 0,
          (s.id as string) ?? null, (s.payment_intent as string) ?? null, nowIso(), jobId
        );
        await logActivity(c.env.DB, {
          contactId: job.contact_id as string,
          type: "note",
          title: `Payment received: $${(amount / 100).toFixed(2)}${fullyPaid ? " (paid in full)" : " (deposit)"}`,
          payload: { job_id: jobId, amount_cents: amount, kind: kind ?? "deposit" },
          actor: "system",
        });
      }
    }
  }
  return c.json({ received: true });
});

publicRoutes.post("/quote/:token/accept", async (c) => {
  const token = c.req.param("token");
  const job = await one<Record<string, unknown>>(c.env.DB, "SELECT * FROM jobs WHERE quote_token = ?", token);
  if (!job) return c.json({ error: "not_found" }, 404);
  if (!job.quote_accepted_at) {
    await run(c.env.DB, "UPDATE jobs SET quote_accepted_at = ?, updated_at = ? WHERE id = ?", nowIso(), nowIso(), job.id);
    await exitEnrollments(c.env, job.contact_id as string, "booked");
    await logActivity(c.env.DB, {
      contactId: job.contact_id as string,
      type: "note",
      title: `Quote accepted by customer: ${job.title}`,
      payload: { job_id: job.id, total_cents: job.price_cents },
      actor: "system",
    });
  }
  return c.json({ ok: true });
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

  // Logging, STOP/HELP/START, and sequence-pausing all live in lib/inbound.ts.
  await handleInboundSms(c.env, {
    from, body, messageSid: params.MessageSid ?? null, to: params.To ?? null,
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

// --- Twilio Voice: incoming call. Ring the owner's cell, then fall through to complete. ---
publicRoutes.post("/twilio/voice", async (c) => {
  const params = await twilioParams(c);
  const ok = await verifyTwilioSignature(c.env, c.req.url, params, c.req.header("X-Twilio-Signature"));
  if (!ok) return c.text("forbidden", 403);
  const s = await loadMissedCallSettings(c.env);
  return c.text(buildVoiceTwiml(s), 200, { "Content-Type": "text/xml" });
});

// --- Twilio Voice: dial completed. Run text-back logic in the background. ---
publicRoutes.post("/twilio/voice/complete", async (c) => {
  const params = await twilioParams(c);
  const ok = await verifyTwilioSignature(c.env, c.req.url, params, c.req.header("X-Twilio-Signature"));
  if (!ok) return c.text("forbidden", 403);

  const dialStatus = params.DialCallStatus ?? c.req.query("DialCallStatus") ?? null;
  const durRaw = params.DialCallDuration ?? params.CallDuration ?? "";
  const durationSeconds = /^\d+$/.test(durRaw) ? Number.parseInt(durRaw, 10) : null;

  c.executionCtx.waitUntil(
    handleMissedCall(c.env, {
      fromPhone: params.From ?? null,
      toPhone: params.To ?? null,
      callSid: params.CallSid ?? null,
      dialStatus,
      durationSeconds,
    }).then(() => undefined).catch(() => undefined)
  );
  return c.text("<Response></Response>", 200, { "Content-Type": "text/xml" });
});

// --- Customer intake: the QR/link version of the in-person quote builder.
// Max picks the vehicle and service on his device (POST /api/quote-builder/intent);
// the customer opens this token on their OWN phone and fills in their details.
// The intent record is the source of truth for vehicle/service/price, so the
// customer's device cannot alter what was quoted. ---

publicRoutes.get("/intent/:token", async (c) => {
  const token = c.req.param("token");
  const intent = await one<{
    id: string; vehicle_type: string; vehicle_notes: string | null; lines: string;
    price_override_cents: number | null; completed_job_id: string | null; created_at: string;
  }>(c.env.DB, "SELECT * FROM quote_intents WHERE token = ?", token);
  if (!intent) return c.json({ error: "not_found" }, 404);

  const vt = vehicleType(intent.vehicle_type);
  let lines: Array<{ service_id: string; qty: number }> = [];
  try { lines = JSON.parse(intent.lines || "[]"); } catch { lines = []; }

  const services = await all<{
    id: string; name: string; base_price_cents: number; size_pricing: string;
    duration_min: number | null; is_addon: number; requires_planning: number; level: string | null;
  }>(c.env.DB, `SELECT id, name, base_price_cents, size_pricing, duration_min, is_addon, requires_planning, level FROM services WHERE active = 1`);
  const priced = priceLines(services, lines, intent.vehicle_type);

  const subtotal = intent.price_override_cents && intent.price_override_cents > 0 ? intent.price_override_cents : priced.total_cents;
  const tax = await loadTaxSettings(c.env);
  const taxCents = taxOn(subtotal, tax);

  // If this link already produced a booking, report the REAL outcome rather
  // than a guess — reloading a completed link must show "booked" as booked,
  // not fall back to a generic "quoted" because the client lost its state.
  let completedStatus: string | null = null;
  if (intent.completed_job_id) {
    const job = await one<{ status: string }>(c.env.DB, "SELECT status FROM jobs WHERE id = ?", intent.completed_job_id);
    completedStatus = job?.status ?? "quoted";
  }

  return c.json({
    business: c.env.FROM_NAME || "BH Car Detailing",
    vehicle_label: vt?.label ?? intent.vehicle_type,
    vehicle_note: intent.vehicle_notes,
    items: priced.items,
    subtotal_cents: subtotal,
    tax_cents: taxCents,
    tax_label: taxCents > 0 ? tax.label : null,
    total_cents: subtotal + taxCents,
    duration_min: priced.duration_min,
    requires_planning: priced.needsPlanning,
    completed: !!intent.completed_job_id,
    completed_status: completedStatus,
    created_at: intent.created_at,
  });
});

publicRoutes.options("/intent/:token/complete", (c) =>
  new Response(null, { status: 204, headers: { ...corsHeaders(c), "Access-Control-Allow-Methods": "POST, OPTIONS" } }));

publicRoutes.post("/intent/:token/complete", async (c) => {
  const h = corsHeaders(c);
  const token = c.req.param("token");
  const intent = await one<{
    id: string; vehicle_type: string; vehicle_notes: string | null; lines: string;
    price_override_cents: number | null; completed_job_id: string | null;
  }>(c.env.DB, "SELECT * FROM quote_intents WHERE token = ?", token);
  if (!intent) return c.json({ ok: false, error: "not_found" }, 404, h);
  // Single-use: a link that already produced a job cannot be replayed into a second booking.
  if (intent.completed_job_id) return c.json({ ok: false, error: "already_used" }, 409, h);

  const body = await c.req.json<Record<string, unknown>>().catch(() => null);
  if (!body) return c.json({ ok: false, error: "bad_json" }, 400, h);
  // Honeypot + minimum-fill-time, same spam guard as the self-booking form.
  if (typeof body.website === "string" && body.website !== "") return c.json({ ok: true }, 200, h);
  const ts = typeof body.ts === "number" ? body.ts : NaN;
  if (!Number.isFinite(ts) || Date.now() - ts < 2000) return c.json({ ok: false, error: "too_fast" }, 400, h);

  const ip = c.req.header("CF-Connecting-IP") ?? "local";
  const rl = await one<{ n: number }>(c.env.DB, "SELECT COUNT(*) AS n FROM rl_events WHERE bucket = ? AND ts > ?", "intent:" + ip, Date.now() - 3600_000);
  if ((rl?.n ?? 0) >= 10) return c.json({ ok: false, error: "rate_limited" }, 429, h);
  await run(c.env.DB, "INSERT INTO rl_events (bucket, ts) VALUES (?, ?)", "intent:" + ip, Date.now());

  let lines: Array<{ service_id: string; qty: number }> = [];
  try { lines = JSON.parse(intent.lines || "[]"); } catch { lines = []; }

  const result = await completeQuote(c.env, {
    vehicleType: intent.vehicle_type,
    vehicleNotes: intent.vehicle_notes,
    rawLines: lines,
    priceOverrideCents: intent.price_override_cents,
    firstName: typeof body.first_name === "string" ? body.first_name : null,
    lastName: typeof body.last_name === "string" ? body.last_name : null,
    phone: normalizePhone(typeof body.phone === "string" ? body.phone : undefined) ?? null,
    email: normalizeEmail(typeof body.email === "string" ? body.email : undefined) ?? null,
    address: typeof body.address === "string" ? body.address.slice(0, 200) : null,
    city: typeof body.city === "string" ? body.city.slice(0, 80) : null,
    state: typeof body.state === "string" ? body.state.slice(0, 40) : null,
    zip: typeof body.zip === "string" ? body.zip.slice(0, 20) : null,
    notes: typeof body.notes === "string" ? body.notes.slice(0, 2000) : null,
    scheduledStart: typeof body.scheduled_start === "string" ? body.scheduled_start : null,
    smsOptIn: body.sms_opt_in === true,
    marketingOptIn: body.marketing_opt_in === true,
    ip,
    actor: "system",
    source: "customer-intake",
  });
  if (!result.ok) {
    const code = ["no_priced_services", "service_required", "vehicle_type_required", "contact_info_required"].includes(result.error) ? 400 : 500;
    return c.json(result, code, h);
  }

  await run(c.env.DB, "UPDATE quote_intents SET completed_job_id = ?, completed_at = ? WHERE id = ?", result.job_id, nowIso(), intent.id);
  return c.json(result, 201, h);
});
