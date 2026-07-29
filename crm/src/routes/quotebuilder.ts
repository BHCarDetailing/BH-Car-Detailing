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
 */
import { Hono } from "hono";
import type { Env } from "../types";
import { all, nowIso, one, run, uuid } from "../lib/db";
import { requireAuth } from "../lib/auth";
import { logActivity } from "../lib/activity";
import { cleanName, normalizeEmail, normalizePhone } from "../lib/normalize";
import { bucketFor, priceFor, vehicleType } from "../lib/vehicles";
import { exitEnrollments } from "../lib/sequences";
import { slotEndIso } from "../lib/booking";
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

  const phone = normalizePhone(typeof b.phone === "string" ? b.phone : undefined);
  const email = normalizeEmail(typeof b.email === "string" ? b.email : undefined);
  if (!phone && !email) return c.json({ error: "contact_info_required" }, 400);

  const vt = typeof b.vehicle_type === "string" ? b.vehicle_type : "";
  if (!vehicleType(vt)) return c.json({ error: "vehicle_type_required" }, 400);

  // Accept either a plain id list or explicit quantities (curb rash × 2 rims).
  const rawLines: Array<{ service_id: string; qty: number }> = Array.isArray(b.lines)
    ? (b.lines as LineInput[])
        .filter((l) => typeof l?.service_id === "string")
        .map((l) => ({ service_id: l.service_id as string, qty: Number(l.qty) || 1 }))
    : Array.isArray(b.service_ids)
      ? (b.service_ids as unknown[]).filter((s): s is string => typeof s === "string").map((id) => ({ service_id: id, qty: 1 }))
      : [];
  if (!rawLines.length) return c.json({ error: "service_required" }, 400);

  const services = await all<ServiceRow>(
    c.env.DB,
    `SELECT id, name, base_price_cents, size_pricing, duration_min, is_addon, requires_planning, level
       FROM services WHERE active = 1`
  );
  const priced = priceLines(services, rawLines, vt);
  if (!priced.items.length) return c.json({ error: "no_priced_services" }, 400);

  // An override replaces the pre-tax subtotal — Max types the price he quoted
  // out loud, and tax (if any) is added on top of it.
  const override = Number(b.price_override_cents);
  const subtotal = Number.isFinite(override) && override > 0 ? Math.round(override) : priced.total_cents;
  const tax = await loadTaxSettings(c.env);
  const taxCents = taxOn(subtotal, tax);
  const total = subtotal + taxCents;

  const now = nowIso();
  const first = cleanName(typeof b.first_name === "string" ? b.first_name : undefined);
  const last = cleanName(typeof b.last_name === "string" ? b.last_name : undefined);
  const address = typeof b.address === "string" ? b.address.slice(0, 200) : null;
  const city = typeof b.city === "string" ? b.city.slice(0, 80) : null;
  const state = typeof b.state === "string" ? b.state.slice(0, 40) : null;
  const zip = typeof b.zip === "string" ? b.zip.slice(0, 20) : null;
  const notes = typeof b.notes === "string" ? b.notes.slice(0, 2000) : null;

  // Same duplicate detection the public forms use: email first, then phone.
  let existing = email ? await one<{ id: string }>(c.env.DB, "SELECT id FROM contacts WHERE email = ? AND deleted_at IS NULL", email) : null;
  if (!existing && phone) existing = await one<{ id: string }>(c.env.DB, "SELECT id FROM contacts WHERE phone = ? AND deleted_at IS NULL", phone);

  let contactId: string;
  let createdContact = false;
  if (existing) {
    contactId = existing.id;
    await run(
      c.env.DB,
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
    await run(
      c.env.DB,
      `INSERT INTO contacts (id, first_name, last_name, email, phone, address, city, state, zip, stage, source,
                             email_opt_in, last_activity_at, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?, 'scheduled', 'in-person', 1, ?, ?, ?)`,
      contactId, first || null, last || null, email, phone, address, city, state, zip, now, now, now
    );
  }

  // Vehicle: reuse a matching one rather than stacking duplicates on repeat visits.
  const label = typeof b.vehicle_notes === "string" && b.vehicle_notes.trim()
    ? b.vehicle_notes.trim().slice(0, 200)
    : vehicleType(vt)!.label;
  let vehicleId = (await one<{ id: string }>(
    c.env.DB, "SELECT id FROM vehicles WHERE contact_id = ? AND notes = ?", contactId, label))?.id ?? null;
  if (!vehicleId) {
    vehicleId = uuid();
    await run(
      c.env.DB,
      "INSERT INTO vehicles (id, contact_id, size_class, notes, created_at) VALUES (?,?,?,?,?)",
      vehicleId, contactId, priced.bucket, label, now
    );
  }

  // The job is the opportunity AND the appointment — scheduled when they picked
  // a time, quoted when they did not.
  // Planned work is never dropped onto the calendar from the driveway, whatever
  // the client sent — it gets quoted, and a date is agreed afterwards.
  const start = !priced.needsPlanning
    && typeof b.scheduled_start === "string"
    && Number.isFinite(Date.parse(b.scheduled_start))
    ? b.scheduled_start : null;
  const primary = priced.items.find((i) => !i.is_addon) ?? priced.items[0];
  const title = String(primary?.name ?? "Detailing");
  const jobId = uuid();
  await run(
    c.env.DB,
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
  const ip = c.req.header("CF-Connecting-IP") ?? "in-person";
  if (b.sms_opt_in === true || b.marketing_opt_in === true) {
    await run(c.env.DB, "UPDATE contacts SET sms_opt_in = 1, sms_opted_out_at = NULL, sms_opt_out_auto = 0 WHERE id = ?", contactId);
    if (b.marketing_opt_in === true) {
      const row = await one<{ tags: string }>(c.env.DB, "SELECT tags FROM contacts WHERE id = ?", contactId);
      let tags: string[] = [];
      try { tags = JSON.parse(row?.tags || "[]"); } catch { tags = []; }
      if (!tags.includes("sms_marketing")) {
        tags.push("sms_marketing");
        await run(c.env.DB, "UPDATE contacts SET tags = ? WHERE id = ?", JSON.stringify(tags), contactId);
      }
    }
    await logActivity(c.env.DB, {
      contactId, type: "note",
      title: `SMS consent captured in person — ${b.sms_opt_in === true ? "service" : ""}${b.sms_opt_in === true && b.marketing_opt_in === true ? " + " : ""}${b.marketing_opt_in === true ? "marketing" : ""}`,
      payload: {
        transactional: b.sms_opt_in === true, marketing: b.marketing_opt_in === true,
        source: "quote-builder", at: now, ip,
      },
      actor: "system",
    });
  }

  await logActivity(c.env.DB, {
    contactId, type: start ? "job_scheduled" : "note",
    title: start ? `Booked in person: ${title}` : `Quoted in person: ${title}`,
    payload: { job_id: jobId, total_cents: total, vehicle_type: vt, bucket: priced.bucket, scheduled_start: start },
    actor: actorOf(c),
  });

  // A booking is what every sequence is chasing.
  if (start) await exitEnrollments(c.env, contactId, "booked");

  // The suggested deposit is a function of the price and the configured
  // percentage only — taking cash in a driveway must not depend on whether
  // Stripe happens to be connected.
  const pay = await loadPaymentSettings(c.env);
  const depositCents = depositForTotal(total, pay.percent);

  return c.json({
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
  }, 201);
});
