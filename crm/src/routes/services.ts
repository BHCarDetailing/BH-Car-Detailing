import { Hono } from "hono";
import type { Env } from "../types";
import { all, nowIso, one, run, uuid } from "../lib/db";
import { requireAuth } from "../lib/auth";

export const SIZE_CLASSES = ["sedan", "suv", "truck", "van", "exotic", "other"] as const;

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
  return { ...r, size_pricing: pricing, active: Number(r.active) === 1 };
}

export const serviceRoutes = new Hono<{ Bindings: Env }>();
serviceRoutes.use("*", requireAuth());

serviceRoutes.get("/", async (c) => {
  const onlyActive = c.req.query("active") === "1";
  const rows = await all<Record<string, unknown>>(
    c.env.DB,
    `SELECT * FROM services ${onlyActive ? "WHERE active = 1" : ""} ORDER BY sort ASC, name ASC`
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
    `INSERT INTO services (id, name, description, size_pricing, base_price_cents, active, sort, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    id, name,
    typeof b.description === "string" ? b.description : null,
    JSON.stringify(pricing), base,
    b.active === false ? 0 : 1,
    Number.isFinite(Number(b.sort)) ? Math.round(Number(b.sort)) : 100,
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
  if (!sets.length) return c.json({ error: "no_valid_fields" }, 400);
  sets.push("updated_at = ?"); binds.push(nowIso());
  await run(c.env.DB, `UPDATE services SET ${sets.join(", ")} WHERE id = ?`, ...binds, id);
  return c.json({ ok: true });
});

serviceRoutes.delete("/:id", async (c) => {
  await run(c.env.DB, "DELETE FROM services WHERE id = ?", c.req.param("id"));
  return c.json({ ok: true });
});
