import { Hono } from "hono";
import type { Env } from "../types";
import { all, nowIso, one, run } from "../lib/db";
import { requireAuth } from "../lib/auth";

export const labelRoutes = new Hono<{ Bindings: Env }>();
labelRoutes.use("*", requireAuth());

labelRoutes.get("/", async (c) =>
  c.json({ items: await all(c.env.DB, "SELECT * FROM labels ORDER BY sort, label") })
);

labelRoutes.post("/", async (c) => {
  const b = ((await c.req.json().catch(() => null)) ?? {}) as { key?: string; label?: string; color?: string; sort?: number };
  if (!b.key || !/^[a-z0-9_]{1,40}$/.test(b.key) || !b.label) return c.json({ error: "invalid_label" }, 400);
  const dupe = await one(c.env.DB, "SELECT key FROM labels WHERE key = ?", b.key);
  if (dupe) return c.json({ error: "duplicate_key" }, 409);
  await run(c.env.DB, "INSERT INTO labels (key, label, color, sort, created_at) VALUES (?,?,?,?,?)",
    b.key, b.label, typeof b.color === "string" ? b.color : "#6b7280", b.sort ?? 0, nowIso());
  return c.json({ ok: true }, 201);
});

labelRoutes.patch("/:key", async (c) => {
  const key = c.req.param("key");
  const b = ((await c.req.json().catch(() => null)) ?? {}) as { label?: string; color?: string; sort?: number };
  const sets: string[] = [];
  const binds: unknown[] = [];
  if (typeof b.label === "string") { sets.push("label = ?"); binds.push(b.label); }
  if (typeof b.color === "string") { sets.push("color = ?"); binds.push(b.color); }
  if (Number.isFinite(Number(b.sort))) { sets.push("sort = ?"); binds.push(Math.round(Number(b.sort))); }
  if (!sets.length) return c.json({ error: "no_valid_fields" }, 400);
  await run(c.env.DB, `UPDATE labels SET ${sets.join(", ")} WHERE key = ?`, ...binds, key);
  return c.json({ ok: true });
});

labelRoutes.delete("/:key", async (c) => {
  const key = c.req.param("key");
  await run(c.env.DB, "DELETE FROM labels WHERE key = ?", key);
  // Strip the label from every contact that carried it.
  const rows = await all<{ id: string; tags: string }>(c.env.DB, "SELECT id, tags FROM contacts WHERE tags LIKE ?", `%"${key.replace(/[%_"]/g, "")}"%`);
  const now = nowIso();
  for (const r of rows) {
    let tags: string[] = [];
    try { tags = JSON.parse(r.tags || "[]"); } catch { tags = []; }
    const next = tags.filter((t) => t !== key);
    if (next.length !== tags.length) {
      await run(c.env.DB, "UPDATE contacts SET tags = ?, updated_at = ? WHERE id = ?", JSON.stringify(next), now, r.id);
    }
  }
  return c.json({ ok: true });
});
