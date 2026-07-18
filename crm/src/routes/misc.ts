import { Hono } from "hono";
import type { Env } from "../types";
import { STAGES } from "../types";
import { all, nowIso, one, run, uuid } from "../lib/db";
import { cleanName, normalizeEmail, normalizePhone, vehicleSizeClass } from "../lib/normalize";
import { logActivity } from "../lib/activity";
import { requireAuth } from "../lib/auth";

const MANUAL_ACTIVITY_TYPES = new Set(["note", "call_logged", "sms_logged"]);
const FIELD_TYPES = new Set(["text", "number", "select", "date", "checkbox"]);

export const activityWriteRoutes = new Hono<{ Bindings: Env }>();
activityWriteRoutes.use("*", requireAuth());

activityWriteRoutes.post("/:id/activities", async (c) => {
  const id = c.req.param("id");
  const exists = await one(c.env.DB, "SELECT id FROM contacts WHERE id = ?", id);
  if (!exists) return c.json({ error: "not_found" }, 404);
  const b = ((await c.req.json().catch(() => null)) ?? {}) as { type?: string; title?: string; payload?: unknown };
  if (!b.type || !MANUAL_ACTIVITY_TYPES.has(b.type) || !b.title) {
    return c.json({ error: "invalid_activity" }, 400);
  }
  const actor = c.req.header("Authorization")?.startsWith("Bearer ") ? "agent" : "human";
  await logActivity(c.env.DB, { contactId: id, type: b.type, title: b.title, payload: b.payload, actor });
  return c.json({ ok: true }, 201);
});

export const customFieldRoutes = new Hono<{ Bindings: Env }>();
customFieldRoutes.use("*", requireAuth());

customFieldRoutes.get("/", async (c) =>
  c.json({ items: await all(c.env.DB, "SELECT * FROM custom_field_defs ORDER BY sort, key") })
);

customFieldRoutes.post("/", async (c) => {
  const b = ((await c.req.json().catch(() => null)) ?? {}) as { key?: string; label?: string; type?: string; options?: string[]; sort?: number };
  if (!b.key || !/^[a-z0-9_]{1,40}$/.test(b.key) || !b.label || !b.type || !FIELD_TYPES.has(b.type)) {
    return c.json({ error: "invalid_field" }, 400);
  }
  const dupe = await one(c.env.DB, "SELECT key FROM custom_field_defs WHERE key = ?", b.key);
  if (dupe) return c.json({ error: "duplicate_key" }, 409);
  await run(
    c.env.DB,
    "INSERT INTO custom_field_defs (key, label, type, options, sort) VALUES (?,?,?,?,?)",
    b.key, b.label, b.type, b.options ? JSON.stringify(b.options) : null, b.sort ?? 0
  );
  return c.json({ ok: true }, 201);
});

customFieldRoutes.delete("/:key", async (c) => {
  await run(c.env.DB, "DELETE FROM custom_field_defs WHERE key = ?", c.req.param("key"));
  return c.json({ ok: true });
});

export const bulkRoutes = new Hono<{ Bindings: Env }>();
bulkRoutes.use("*", requireAuth());

bulkRoutes.post("/bulk", async (c) => {
  const b = ((await c.req.json().catch(() => null)) ?? {}) as { contacts?: Array<Record<string, unknown>> };
  const rows = b.contacts;
  if (!Array.isArray(rows) || rows.length === 0 || rows.length > 200) {
    return c.json({ error: "contacts_array_required_max_200" }, 400);
  }
  let created = 0;
  let merged = 0;
  const errors: Array<{ index: number; error: string }> = [];

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const email = normalizeEmail(typeof r.email === "string" ? r.email : undefined);
    const phone = normalizePhone(typeof r.phone === "string" ? r.phone : undefined);
    if (!email && !phone) { errors.push({ index: i, error: "contact_info_required" }); continue; }
    const stage = (r.stage as string) ?? "new";
    if (!STAGES.includes(stage as (typeof STAGES)[number])) { errors.push({ index: i, error: "invalid_stage" }); continue; }

    const now = nowIso();
    let existing = email ? await one<{ id: string }>(c.env.DB, "SELECT id FROM contacts WHERE email = ?", email) : null;
    if (!existing && phone) existing = await one<{ id: string }>(c.env.DB, "SELECT id FROM contacts WHERE phone = ?", phone);

    let contactId: string;
    if (existing) {
      merged++;
      contactId = existing.id;
      await run(
        c.env.DB,
        `UPDATE contacts SET
           first_name = COALESCE(first_name, ?), last_name = COALESCE(last_name, ?),
           email = COALESCE(email, ?), phone = COALESCE(phone, ?),
           address = COALESCE(address, ?), city = COALESCE(city, ?), updated_at = ?
         WHERE id = ?`,
        cleanName(typeof r.first_name === "string" ? r.first_name : undefined) ?? null, cleanName(typeof r.last_name === "string" ? r.last_name : undefined) ?? null,
        email, phone, typeof r.address === "string" ? r.address : null, typeof r.city === "string" ? r.city : null, now, contactId
      );
    } else {
      created++;
      contactId = uuid();
      await run(
        c.env.DB,
        `INSERT INTO contacts
           (id, first_name, last_name, email, phone, address, city, stage, source, tags, custom,
            email_opt_in, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,1,?,?)`,
        contactId,
        cleanName(typeof r.first_name === "string" ? r.first_name : undefined) ?? null, cleanName(typeof r.last_name === "string" ? r.last_name : undefined) ?? null,
        email, phone, typeof r.address === "string" ? r.address : null, typeof r.city === "string" ? r.city : null,
        stage, (r.source as string) ?? "import",
        JSON.stringify(Array.isArray(r.tags) ? r.tags : []),
        JSON.stringify(typeof r.custom === "object" && r.custom ? r.custom : {}),
        now, now
      );
    }

    const vehicleRaw = typeof r.vehicle === "string" ? r.vehicle.trim() : "";
    if (vehicleRaw) {
      const dupe = await one(c.env.DB, "SELECT id FROM vehicles WHERE contact_id = ? AND notes = ?", contactId, vehicleRaw);
      if (!dupe) {
        await run(c.env.DB, "INSERT INTO vehicles (id, contact_id, size_class, notes, created_at) VALUES (?,?,?,?,?)",
          uuid(), contactId, vehicleSizeClass(vehicleRaw), vehicleRaw, now);
      }
    }

    await logActivity(c.env.DB, {
      contactId, type: "import",
      title: existing ? "Merged by import" : "Created by import",
      payload: { source: (r.source as string) ?? "import" },
      actor: "agent",
    });
  }

  return c.json({ created, merged, errors });
});
