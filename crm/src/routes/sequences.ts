import { Hono } from "hono";
import type { Env } from "../types";
import { all, nowIso, one, run, uuid } from "../lib/db";
import { requireAuth } from "../lib/auth";
import { enrollContact } from "../lib/sequences";

export const sequenceRoutes = new Hono<{ Bindings: Env }>();
sequenceRoutes.use("*", requireAuth());

interface StepInput { delay_hours?: number; subject?: string; body_text?: string }

async function writeSteps(env: Env, sequenceId: string, steps: StepInput[]): Promise<void> {
  await run(env.DB, "DELETE FROM sequence_steps WHERE sequence_id = ?", sequenceId);
  const now = nowIso();
  let order = 0;
  for (const s of steps) {
    const subject = typeof s.subject === "string" ? s.subject.trim() : "";
    const body = typeof s.body_text === "string" ? s.body_text.trim() : "";
    if (!subject || !body) continue;
    await run(env.DB,
      "INSERT INTO sequence_steps (id, sequence_id, step_order, delay_hours, subject, body_text, created_at) VALUES (?,?,?,?,?,?,?)",
      uuid(), sequenceId, order, Number.isFinite(Number(s.delay_hours)) ? Math.max(0, Math.round(Number(s.delay_hours))) : 0, subject, body, now);
    order++;
  }
}

sequenceRoutes.get("/", async (c) => {
  const items = await all(c.env.DB,
    `SELECT s.*,
       (SELECT COUNT(*) FROM sequence_steps st WHERE st.sequence_id = s.id) AS step_count,
       (SELECT COUNT(*) FROM enrollments e WHERE e.sequence_id = s.id AND e.status = 'active') AS active_count
     FROM sequences s ORDER BY s.created_at DESC`);
  return c.json({ items });
});

sequenceRoutes.post("/", async (c) => {
  const b = ((await c.req.json().catch(() => null)) ?? {}) as { name?: string; trigger?: string; steps?: StepInput[] };
  const name = typeof b.name === "string" ? b.name.trim() : "";
  if (!name) return c.json({ error: "name_required" }, 400);
  const id = uuid();
  const now = nowIso();
  await run(c.env.DB, "INSERT INTO sequences (id, name, status, trigger, created_at, updated_at) VALUES (?,?, 'draft', ?, ?, ?)",
    id, name, typeof b.trigger === "string" ? b.trigger : "manual", now, now);
  if (Array.isArray(b.steps)) await writeSteps(c.env, id, b.steps);
  return c.json({ id }, 201);
});

sequenceRoutes.get("/:id", async (c) => {
  const seq = await one(c.env.DB, "SELECT * FROM sequences WHERE id = ?", c.req.param("id"));
  if (!seq) return c.json({ error: "not_found" }, 404);
  const steps = await all(c.env.DB, "SELECT * FROM sequence_steps WHERE sequence_id = ? ORDER BY step_order ASC", c.req.param("id"));
  return c.json({ ...seq, steps });
});

sequenceRoutes.patch("/:id", async (c) => {
  const id = c.req.param("id");
  const existing = await one(c.env.DB, "SELECT id FROM sequences WHERE id = ?", id);
  if (!existing) return c.json({ error: "not_found" }, 404);
  const b = ((await c.req.json().catch(() => null)) ?? {}) as { name?: string; status?: string; trigger?: string; steps?: StepInput[] };
  const sets: string[] = [];
  const binds: unknown[] = [];
  if (typeof b.name === "string") { sets.push("name = ?"); binds.push(b.name.trim()); }
  if (b.status === "draft" || b.status === "active") { sets.push("status = ?"); binds.push(b.status); }
  if (typeof b.trigger === "string") { sets.push("trigger = ?"); binds.push(b.trigger); }
  if (sets.length) {
    sets.push("updated_at = ?"); binds.push(nowIso());
    await run(c.env.DB, `UPDATE sequences SET ${sets.join(", ")} WHERE id = ?`, ...binds, id);
  }
  if (Array.isArray(b.steps)) await writeSteps(c.env, id, b.steps);
  return c.json({ ok: true });
});

sequenceRoutes.delete("/:id", async (c) => {
  await run(c.env.DB, "DELETE FROM sequences WHERE id = ?", c.req.param("id"));
  return c.json({ ok: true });
});

sequenceRoutes.post("/:id/enroll", async (c) => {
  const b = ((await c.req.json().catch(() => null)) ?? {}) as { contact_id?: string };
  if (!b.contact_id) return c.json({ error: "contact_id_required" }, 400);
  const out = await enrollContact(c.env, c.req.param("id"), b.contact_id);
  const code = out.status === "enrolled" ? 201 : out.status.endsWith("not_found") ? 404 : 200;
  return c.json(out, code);
});

sequenceRoutes.get("/:id/enrollments", async (c) => {
  const items = await all(c.env.DB,
    `SELECT e.*, ct.first_name, ct.last_name, ct.email
     FROM enrollments e JOIN contacts ct ON ct.id = e.contact_id
     WHERE e.sequence_id = ? ORDER BY e.enrolled_at DESC LIMIT 200`, c.req.param("id"));
  return c.json({ items });
});

// Remove someone from a sequence (deletes the enrollment so they can be re-added later).
sequenceRoutes.delete("/:id/enrollments/:eid", async (c) => {
  await run(c.env.DB, "DELETE FROM enrollments WHERE id = ? AND sequence_id = ?", c.req.param("eid"), c.req.param("id"));
  return c.json({ ok: true });
});
