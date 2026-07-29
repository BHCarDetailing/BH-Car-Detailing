import { Hono } from "hono";
import type { Env } from "../types";
import { all, nowIso, one, run, uuid } from "../lib/db";
import { requireAuth } from "../lib/auth";
import { SIZE_CLASSES, VEHICLE_TYPES } from "../lib/vehicles";

export { SIZE_CLASSES };

const AREAS = new Set(["interior", "exterior", "both", "specialty"]);
const LEVELS = new Set(["maintenance", "light", "full", "specialty"]);

function parsePricing(v: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (v && typeof v === "object" && !Array.isArray(v)) {
    for (const [k, n] of Object.entries(v as Record<string, unknown>)) {
      if ((SIZE_CLASSES as readonly string[]).includes(k) && Number.isFinite(Number(n))) {
        out[k] = Math.max(0, Math.round(Number(n)));
      }
    }
  }
  return out;
}

function shapeRow(r: Record<string, unknown>) {
  let pricing: Record<string, number> = {};
  try { pricing = JSON.parse((r.size_pricing as string) || "{}"); } catch { pricing = {}; }
  return {
    ...r,
    size_pricing: pricing,
    active: Number(r.active) === 1,
    is_addon: Number(r.is_addon) === 1,
    standalone: Number(r.standalone ?? 1) === 1,
    requires_planning: Number(r.requires_planning ?? 0) === 1,
    duration_min: r.duration_min == null ? null : Number(r.duration_min),
  };
}

export const serviceRoutes = new Hono<{ Bindings: Env }>();
serviceRoutes.use("*", requireAuth());

/**
 * Vocabulary for the quote builder and the Products filters — vehicle types with
 * the bucket each bills as, so the UI never has to hardcode the mapping.
 */
serviceRoutes.get("/vocab", (c) => c.json({
  vehicle_types: VEHICLE_TYPES,
  areas: [...AREAS],
  levels: [...LEVELS],
  size_classes: [...SIZE_CLASSES],
}));

serviceRoutes.get("/", async (c) => {
  const onlyActive = c.req.query("active") === "1";
  const addons = c.req.query("addons");           // "1" = only add-ons, "0" = exclude
  const where: string[] = [];
  if (onlyActive) where.push("active = 1");
  if (addons === "1") where.push("is_addon = 1");
  else if (addons === "0") where.push("is_addon = 0");
  const rows = await all<Record<string, unknown>>(
    c.env.DB,
    `SELECT * FROM services ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY sort ASC, name ASC`
  );
  return c.json({ items: rows.map(shapeRow) });
});

serviceRoutes.post("/", async (c) => {
  const b = ((await c.req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  const name = typeof b.name === "string" ? b.name.trim() : "";
  if (!name) return c.json({ error: "name_required" }, 400);
  const pricing = parsePricing(b.size_pricing);
  const base = Number.isFinite(Number(b.base_price_cents))
    ? Math.max(0, Math.round(Number(b.base_price_cents)))
    : (pricing.sedan ?? 0);
  const id = uuid();
  const now = nowIso();
  await run(
    c.env.DB,
    `INSERT INTO services (id, name, description, size_pricing, base_price_cents, active, sort,
                           area, level, duration_min, is_addon, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    id, name,
    typeof b.description === "string" ? b.description : null,
    JSON.stringify(pricing), base,
    b.active === false ? 0 : 1,
    Number.isFinite(Number(b.sort)) ? Math.round(Number(b.sort)) : 100,
    typeof b.area === "string" && AREAS.has(b.area) ? b.area : "both",
    typeof b.level === "string" && LEVELS.has(b.level) ? b.level : "specialty",
    Number.isFinite(Number(b.duration_min)) ? Math.max(0, Math.round(Number(b.duration_min))) : 120,
    b.is_addon ? 1 : 0,
    now, now
  );
  return c.json({ id }, 201);
});

serviceRoutes.patch("/:id", async (c) => {
  const id = c.req.param("id");
  const existing = await one<Record<string, unknown>>(c.env.DB, "SELECT * FROM services WHERE id = ?", id);
  if (!existing) return c.json({ error: "not_found" }, 404);
  const b = ((await c.req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  const sets: string[] = [];
  const binds: unknown[] = [];
  if (typeof b.name === "string") { sets.push("name = ?"); binds.push(b.name.trim()); }
  if ("description" in b) { sets.push("description = ?"); binds.push(typeof b.description === "string" ? b.description : null); }
  if ("size_pricing" in b) {
    const pricing = parsePricing(b.size_pricing);
    sets.push("size_pricing = ?"); binds.push(JSON.stringify(pricing));
    if (!("base_price_cents" in b)) { sets.push("base_price_cents = ?"); binds.push(pricing.sedan ?? 0); }
  }
  if ("base_price_cents" in b) { sets.push("base_price_cents = ?"); binds.push(Math.max(0, Math.round(Number(b.base_price_cents) || 0))); }
  if ("active" in b) { sets.push("active = ?"); binds.push(b.active ? 1 : 0); }
  if ("sort" in b) { sets.push("sort = ?"); binds.push(Math.round(Number(b.sort) || 0)); }
  if (typeof b.area === "string" && AREAS.has(b.area)) { sets.push("area = ?"); binds.push(b.area); }
  if (typeof b.level === "string" && LEVELS.has(b.level)) { sets.push("level = ?"); binds.push(b.level); }
  if ("duration_min" in b) { sets.push("duration_min = ?"); binds.push(Math.max(0, Math.round(Number(b.duration_min) || 0))); }
  if ("is_addon" in b) { sets.push("is_addon = ?"); binds.push(b.is_addon ? 1 : 0); }
  if ("standalone" in b) { sets.push("standalone = ?"); binds.push(b.standalone ? 1 : 0); }
  if ("requires_planning" in b) { sets.push("requires_planning = ?"); binds.push(b.requires_planning ? 1 : 0); }
  if (!sets.length) return c.json({ error: "no_valid_fields" }, 400);
  sets.push("updated_at = ?"); binds.push(nowIso());
  await run(c.env.DB, `UPDATE services SET ${sets.join(", ")} WHERE id = ?`, ...binds, id);
  return c.json({ ok: true });
});

serviceRoutes.delete("/:id", async (c) => {
  await run(c.env.DB, "DELETE FROM services WHERE id = ?", c.req.param("id"));
  return c.json({ ok: true });
});
