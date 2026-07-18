import { Hono } from "hono";
import type { Context } from "hono";
import type { Env } from "../types";
import { nowIso, one, run, uuid } from "../lib/db";
import { cleanName, normalizeEmail, normalizePhone, vehicleSizeClass } from "../lib/normalize";
import { logActivity } from "../lib/activity";

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
  const ts = Number(body.ts);
  if (typeof body.website === "string" && body.website !== "") return c.json({ ok: true }, 200, h);
  if (!Number.isFinite(ts) || Date.now() - ts < 2000) return c.json({ ok: true }, 200, h);

  // Rate limit: 10 stored submissions / hour / IP.
  const ip = c.req.header("CF-Connecting-IP") ?? "local";
  const cutoff = Date.now() - 3600_000;
  const rl = await one<{ n: number }>(
    c.env.DB, "SELECT COUNT(*) AS n FROM rl_events WHERE bucket = ? AND ts > ?", "lead:" + ip, cutoff);
  if ((rl?.n ?? 0) >= 10) return c.json({ ok: true }, 200, h);

  const email = normalizeEmail(body.email as string | undefined);
  const phone = normalizePhone(body.phone as string | undefined);
  if (!email && !phone) return c.json({ ok: false, error: "contact_info_required" }, 400, h);

  await run(c.env.DB, "INSERT INTO rl_events (bucket, ts) VALUES (?, ?)", "lead:" + ip, Date.now());

  const name = cleanName(body.name as string | undefined);
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

  return c.json({ ok: true }, 200, h);
});
