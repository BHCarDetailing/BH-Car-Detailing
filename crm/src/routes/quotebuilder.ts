/**
 * In-person quote builder.
 *
 * One call at the end of the wizard turns a driveway conversation into every
 * record the CRM needs: the customer, their vehicle, a priced job on the
 * calendar, and their consent — created together so a half-finished quote can
 * never leave an orphaned contact behind.
 *
 * Deposits are deliberately NOT taken here. Manual payments go through the
 * existing mark-paid route and Stripe through the existing checkout, so there is
 * exactly one code path that records money in this system.
 *
 * The completion logic (completeQuote below) is shared with the public intake
 * flow in routes/public.ts — a customer who scans a QR code and fills in their
 * own details goes through the exact same booking rules as Max typing it in
 * himself. Only the entry point differs.
 */
import { Hono } from "hono";
import type { Env } from "../types";
import { all, nowIso, one, run, uuid } from "../lib/db";
import { requireAuth } from "../lib/auth";
import { logActivity } from "../lib/activity";
import { cleanName, normalizeEmail, normalizePhone } from "../lib/normalize";
import { bucketFor, priceFor, vehicleType } from "../lib/vehicles";
import { exitEnrollments } from "../lib/sequences";
import { slotEndIso, slotIsFree } from "../lib/booking";
import { syncIfStale, pushJobEvent } from "../lib/gcal";
import { depositForTotal, loadPaymentSettings } from "../lib/stripe";
import { loadTaxSettings, taxOn } from "../lib/tax";

export const quoteBuilderRoutes = new Hono<{ Bindings: Env }>();
quoteBuilderRoutes.use("*", requireAuth());

const actorOf = (c: { req: { header: (n: string) => string | undefined } }): string =>
  c.req.header("Authorization")?.startsWith("Bearer ") ? "agent" : "human";

interface LineInput { service_id?: unknown; qty?: unknown }

interface CompleteBody {
  vehicle_type?: unknown;
  vehicle_notes?: unknown;
  service_ids?: unknown;      // primary + add-ons, in display order
  lines?: unknown;            // optional [{service_id, qty}]
  price_override_cents?: unknown;
  first_name?: unknown; last_name?: unknown; phone?: unknown; email?: unknown;
  address?: unknown; city?: unknown; state?: unknown; zip?: unknown;
  scheduled_start?: unknown;  // ISO instant chosen by the customer
  notes?: unknown;
  sms_opt_in?: unknown; marketing_opt_in?: unknown;
}

/** Pull the [{service_id, qty}] shape out of either input format the wizard sends. */
export function parseLines(b: { lines?: unknown; service_ids?: unknown }): Array<{ service_id: string; qty: number }> {
  if (Array.isArray(b.lines)) {
    return (b.lines as LineInput[])
      .filter((l) => typeof l?.service_id === "string")
      .map((l) => ({ service_id: l.service_id as string, qty: Number(l.qty) || 1 }));
  }
  if (Array.isArray(b.service_ids)) {
    return (b.service_ids as unknown[])
      .filter((s): s is string => typeof s === "string")
      .map((id) => ({ service_id: id, qty: 1 }));
  }
  return [];
}

interface ServiceRow {
  id: string; name: string; base_price_cents: number; size_pricing: string;
  duration_min: number | null; is_addon: number; requires_planning?: number; level?: string | null;
}

/**
 * Price a set of services for a vehicle. Returns the line items the job stores,
 * plus totals — the same shape the existing quote builder writes, so quote
 * pages, deposits and revenue all keep working unchanged.
 */
export function priceLines(
  services: ServiceRow[], lines: Array<{ service_id: string; qty: number }>, vehicleTypeValue: string
) {
  const bucket = bucketFor(vehicleTypeValue);
  const byId = new Map(services.map((s) => [s.id, s]));
  const items: Array<Record<string, unknown>> = [];
  let total = 0;
  let duration = 0;

  for (const line of lines) {
    const svc = byId.get(line.service_id);
    if (!svc) continue;
    let pricing: Record<string, number> = {};
    try { pricing = JSON.parse(svc.size_pricing || "{}"); } catch { pricing = {}; }
    const unit = priceFor(pricing, bucket, svc.base_price_cents);
    const qty = Math.max(1, Math.round(line.qty || 1));
    const planned = Number(svc.requires_planning) === 1;
    // Specialty work is priced off the damage in front of you — a scratch or a
    // kerbed rim has no menu price — so a zero there means "to be quoted", and
    // Max types the figure before saving. Everywhere else an unpriced service is
    // a gap in the menu, not a freebie, and gets skipped rather than sold at $0.
    const quoteOnSight = planned || svc.level === "specialty";
    if (unit <= 0 && !quoteOnSight) continue;
    total += unit * qty;
    duration += (svc.duration_min ?? 0) * qty;
    // price_cents is the per-unit price — the same key the shareable quote page
    // and the existing contact quote builder already read.
    items.push({
      service_id: svc.id, name: svc.name, qty,
      price_cents: unit, size_class: bucket, is_addon: Number(svc.is_addon) === 1,
      requires_planning: planned,
    });
  }
  const needsPlanning = items.some((i) => i.requires_planning === true);
  return { items, total_cents: total, duration_min: duration, bucket, needsPlanning };
}

export interface QuoteCompletionInput {
  vehicleType: string;
  vehicleNotes: string | null;
  rawLines: Array<{ service_id: string; qty: number }>;
  priceOverrideCents: number | null;
  firstName: string | null; lastName: string | null;
  phone: string | null; email: string | null;
  address: string | null; city: string | null; state: string | null; zip: string | null;
  notes: string | null;
  scheduledStart: string | null;
  smsOptIn: boolean;
  marketingOptIn: boolean;
  ip: string;
  actor: string;
  /** Tagged onto the activity log so a booking made from a QR link is visibly distinct. */
  source: "quote-builder" | "customer-intake" | "self-book";
}

export type QuoteCompletionResult =
  | { ok: true; contact_id: string; created_contact: boolean; vehicle_id: string; job_id: string;
      subtotal_cents: number; tax_cents: number; tax_label: string; tax_rate: number; total_cents: number;
      deposit_cents: number; deposit_percent: number; duration_min: number; items: unknown[];
      requires_planning: boolean; status: string }
  | { ok: false; error: string };

/**
 * Everything a completed quote touches: contact, vehicle, job, consent, and
 * exiting any sequence the booking makes moot. Shared by the in-person wizard
 * and the public customer-intake page so there is exactly one booking rule set.
 */
export async function completeQuote(env: Env, input: QuoteCompletionInput): Promise<QuoteCompletionResult> {
  if (!input.phone && !input.email) return { ok: false, error: "contact_info_required" };
  if (!vehicleType(input.vehicleType)) return { ok: false, error: "vehicle_type_required" };
  if (!input.rawLines.length) return { ok: false, error: "service_required" };

  const services = await all<ServiceRow>(
    env.DB,
    `SELECT id, name, base_price_cents, size_pricing, duration_min, is_addon, requires_planning, level
       FROM services WHERE active = 1`
  );
  const priced = priceLines(services, input.rawLines, input.vehicleType);
  if (!priced.items.length) return { ok: false, error: "no_priced_services" };

  // An override replaces the pre-tax subtotal — Max types the price he quoted
  // out loud, and tax (if any) is added on top of it.
  const subtotal = input.priceOverrideCents != null && input.priceOverrideCents > 0
    ? Math.round(input.priceOverrideCents) : priced.total_cents;
  const tax = await loadTaxSettings(env);
  const taxCents = taxOn(subtotal, tax);
  const total = subtotal + taxCents;

  const now = nowIso();
  const first = cleanName(input.firstName ?? undefined);
  const last = cleanName(input.lastName ?? undefined);
  const { phone, email, address, city, state, zip, notes } = input;

  // Same duplicate detection the public forms use: email first, then phone.
  let existing = email ? await one<{ id: string }>(env.DB, "SELECT id FROM contacts WHERE email = ? AND deleted_at IS NULL", email) : null;
  if (!existing && phone) existing = await one<{ id: string }>(env.DB, "SELECT id FROM contacts WHERE phone = ? AND deleted_at IS NULL", phone);

  let contactId: string;
  let createdContact = false;
  if (existing) {
    contactId = existing.id;
    await run(
      env.DB,
      `UPDATE contacts SET first_name = COALESCE(first_name, ?), last_name = COALESCE(last_name, ?),
              email = COALESCE(email, ?), phone = COALESCE(phone, ?),
              address = COALESCE(address, ?), city = COALESCE(city, ?),
              state = COALESCE(state, ?), zip = COALESCE(zip, ?),
              stage = CASE WHEN stage IN ('new','contacted') THEN 'scheduled' ELSE stage END,
              last_activity_at = ?, updated_at = ? WHERE id = ?`,
      first || null, last || null, email, phone, address, city, state, zip, now, now, contactId
    );
  } else {
    createdContact = true;
    contactId = uuid();
    const contactSource = input.source === "customer-intake" ? "customer-intake"
      : input.source === "self-book" ? "self-book" : "in-person";
    await run(
      env.DB,
      `INSERT INTO contacts (id, first_name, last_name, email, phone, address, city, state, zip, stage, source,
                             email_opt_in, last_activity_at, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?, 'scheduled', ?, 1, ?, ?, ?)`,
      contactId, first || null, last || null, email, phone, address, city, state, zip,
      contactSource, now, now, now
    );
  }

  // Vehicle: reuse a matching one rather than stacking duplicates on repeat visits.
  const label = input.vehicleNotes?.trim() ? input.vehicleNotes.trim().slice(0, 200) : vehicleType(input.vehicleType)!.label;
  let vehicleId = (await one<{ id: string }>(
    env.DB, "SELECT id FROM vehicles WHERE contact_id = ? AND notes = ?", contactId, label))?.id ?? null;
  if (!vehicleId) {
    vehicleId = uuid();
    await run(
      env.DB,
      "INSERT INTO vehicles (id, contact_id, size_class, notes, created_at) VALUES (?,?,?,?,?)",
      vehicleId, contactId, priced.bucket, label, now
    );
  }

  // The job is the opportunity AND the appointment — scheduled when they picked
  // a time, quoted when they did not. Planned work is never dropped onto the
  // calendar from the driveway, whatever was sent — it gets quoted, and a date
  // is agreed afterwards.
  const start = !priced.needsPlanning && input.scheduledStart && Number.isFinite(Date.parse(input.scheduledStart))
    ? input.scheduledStart : null;
  const primary = priced.items.find((i) => !i.is_addon) ?? priced.items[0];
  const title = String(primary?.name ?? "Detailing");
  const jobId = uuid();
  await run(
    env.DB,
    `INSERT INTO jobs (id, contact_id, vehicle_id, title, services, price_cents, tax_cents, status,
                       scheduled_start, scheduled_end, address, notes, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    jobId, contactId, vehicleId, title, JSON.stringify(priced.items), total, taxCents,
    start ? "scheduled" : "quoted",
    start, start ? slotEndIso(start, Math.max(60, priced.duration_min || 120)) : null,
    [address, city, zip].filter(Boolean).join(", ") || null,
    notes, now, now
  );

  // Consent, captured on the customer's own taps with time and IP — the evidence
  // carriers ask for. Transactional and marketing stay separate (A2P 30913).
  if (input.smsOptIn || input.marketingOptIn) {
    await run(env.DB, "UPDATE contacts SET sms_opt_in = 1, sms_opted_out_at = NULL, sms_opt_out_auto = 0 WHERE id = ?", contactId);
    if (input.marketingOptIn) {
      const row = await one<{ tags: string }>(env.DB, "SELECT tags FROM contacts WHERE id = ?", contactId);
      let tags: string[] = [];
      try { tags = JSON.parse(row?.tags || "[]"); } catch { tags = []; }
      if (!tags.includes("sms_marketing")) {
        tags.push("sms_marketing");
        await run(env.DB, "UPDATE contacts SET tags = ? WHERE id = ?", JSON.stringify(tags), contactId);
      }
    }
    await logActivity(env.DB, {
      contactId, type: "note",
      title: `SMS consent captured — ${input.smsOptIn ? "service" : ""}${input.smsOptIn && input.marketingOptIn ? " + " : ""}${input.marketingOptIn ? "marketing" : ""}`,
      payload: {
        transactional: input.smsOptIn, marketing: input.marketingOptIn,
        source: input.source, at: now, ip: input.ip,
      },
      actor: "system",
    });
  }

  const verb = input.source === "customer-intake" ? "Booked via customer link"
    : input.source === "self-book" ? "Self-booked online" : "Booked in person";
  const verbQuoted = input.source === "customer-intake" ? "Quoted via customer link"
    : input.source === "self-book" ? "Quote requested online" : "Quoted in person";
  await logActivity(env.DB, {
    contactId, type: start ? "job_scheduled" : "note",
    title: start ? `${verb}: ${title}` : `${verbQuoted}: ${title}`,
    payload: { job_id: jobId, total_cents: total, vehicle_type: input.vehicleType, bucket: priced.bucket, scheduled_start: start, source: input.source },
    actor: input.actor,
  });

  // A booking is what every sequence is chasing.
  if (start) await exitEnrollments(env, contactId, "booked");

  // The suggested deposit is a function of the price and the configured
  // percentage only — taking cash in a driveway must not depend on whether
  // Stripe happens to be connected.
  const pay = await loadPaymentSettings(env);
  const depositCents = depositForTotal(total, pay.percent);

  return {
    ok: true,
    contact_id: contactId,
    created_contact: createdContact,
    vehicle_id: vehicleId,
    job_id: jobId,
    subtotal_cents: subtotal,
    tax_cents: taxCents,
    tax_label: tax.label,
    tax_rate: tax.rate,
    total_cents: total,
    deposit_cents: depositCents,
    deposit_percent: pay.percent,
    duration_min: priced.duration_min,
    items: priced.items,
    requires_planning: priced.needsPlanning,
    status: start ? "scheduled" : "quoted",
  };
}

/** Tax and deposit settings, so the wizard can show the real total before saving. */
quoteBuilderRoutes.get("/config", async (c) => {
  const [tax, pay] = await Promise.all([loadTaxSettings(c.env), loadPaymentSettings(c.env)]);
  return c.json({
    tax_enabled: tax.enabled, tax_rate: tax.rate, tax_label: tax.label,
    deposit_percent: pay.percent,
  });
});

quoteBuilderRoutes.post("/complete", async (c) => {
  const b = ((await c.req.json().catch(() => null)) ?? {}) as CompleteBody;

  // The wizard now offers real openings, so the chosen one is re-checked here —
  // a quote written at the car can sit open while /book or the Google calendar
  // takes the slot. Same guard as the customer intake link.
  const wantedSlot = typeof b.scheduled_start === "string" ? b.scheduled_start : null;
  if (wantedSlot) {
    await syncIfStale(c.env);
    if (!(await slotIsFree(c.env, wantedSlot))) return c.json({ ok: false, error: "slot_taken" }, 409);
  }

  const result = await completeQuote(c.env, {
    vehicleType: typeof b.vehicle_type === "string" ? b.vehicle_type : "",
    vehicleNotes: typeof b.vehicle_notes === "string" ? b.vehicle_notes : null,
    rawLines: parseLines(b),
    priceOverrideCents: Number.isFinite(Number(b.price_override_cents)) ? Number(b.price_override_cents) : null,
    firstName: typeof b.first_name === "string" ? b.first_name : null,
    lastName: typeof b.last_name === "string" ? b.last_name : null,
    phone: normalizePhone(typeof b.phone === "string" ? b.phone : undefined) ?? null,
    email: normalizeEmail(typeof b.email === "string" ? b.email : undefined) ?? null,
    address: typeof b.address === "string" ? b.address.slice(0, 200) : null,
    city: typeof b.city === "string" ? b.city.slice(0, 80) : null,
    state: typeof b.state === "string" ? b.state.slice(0, 40) : null,
    zip: typeof b.zip === "string" ? b.zip.slice(0, 20) : null,
    notes: typeof b.notes === "string" ? b.notes.slice(0, 2000) : null,
    scheduledStart: typeof b.scheduled_start === "string" ? b.scheduled_start : null,
    smsOptIn: b.sms_opt_in === true,
    marketingOptIn: b.marketing_opt_in === true,
    ip: c.req.header("CF-Connecting-IP") ?? "in-person",
    actor: actorOf(c),
    source: "quote-builder",
  });
  if (!result.ok) {
    const code = result.error === "no_priced_services" || result.error === "service_required"
      || result.error === "vehicle_type_required" || result.error === "contact_info_required" ? 400 : 500;
    return c.json(result, code);
  }
  c.executionCtx.waitUntil(pushJobEvent(c.env, result.job_id));
  return c.json(result, 201);
});

/**
 * Create a customer-intake link: the vehicle and service Max picked, saved
 * server-side so the customer's own phone can't be tricked into a different
 * price. Shared via QR code or a copied link from the quote builder summary.
 */
quoteBuilderRoutes.post("/intent", async (c) => {
  const b = ((await c.req.json().catch(() => null)) ?? {}) as {
    vehicle_type?: unknown; vehicle_notes?: unknown; lines?: unknown; service_ids?: unknown; price_override_cents?: unknown;
  };
  const vt = typeof b.vehicle_type === "string" ? b.vehicle_type : "";
  if (!vehicleType(vt)) return c.json({ error: "vehicle_type_required" }, 400);
  const lines = parseLines(b);
  if (!lines.length) return c.json({ error: "service_required" }, 400);

  // Validate the lines actually price out before minting a link nobody can use.
  const services = await all<ServiceRow>(
    c.env.DB, `SELECT id, name, base_price_cents, size_pricing, duration_min, is_addon, requires_planning, level FROM services WHERE active = 1`);
  const priced = priceLines(services, lines, vt);
  if (!priced.items.length) return c.json({ error: "no_priced_services" }, 400);

  const token = uuid().replace(/-/g, "");
  const now = nowIso();
  await run(
    c.env.DB,
    `INSERT INTO quote_intents (id, token, vehicle_type, vehicle_notes, lines, price_override_cents, created_by, created_at)
     VALUES (?,?,?,?,?,?,?,?)`,
    uuid(), token, vt,
    typeof b.vehicle_notes === "string" ? b.vehicle_notes.slice(0, 200) : null,
    JSON.stringify(lines),
    Number.isFinite(Number(b.price_override_cents)) && Number(b.price_override_cents) > 0 ? Math.round(Number(b.price_override_cents)) : null,
    actorOf(c), now
  );
  return c.json({ token }, 201);
});
