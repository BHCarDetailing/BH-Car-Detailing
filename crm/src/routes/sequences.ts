import { Hono } from "hono";
import type { Env } from "../types";
import { all, nowIso, one, run, uuid } from "../lib/db";
import { requireAuth } from "../lib/auth";
import { enrollContact } from "../lib/sequences";
import { TRIGGERS } from "../lib/triggers";

export const sequenceRoutes = new Hono<{ Bindings: Env }>();
sequenceRoutes.use("*", requireAuth());

interface StepInput { delay_hours?: number; subject?: string; body_text?: string; channel?: string }

const CHANNELS = new Set(["sms", "email", "auto"]);

async function writeSteps(env: Env, sequenceId: string, steps: StepInput[]): Promise<void> {
  await run(env.DB, "DELETE FROM sequence_steps WHERE sequence_id = ?", sequenceId);
  const now = nowIso();
  let order = 0;
  for (const s of steps) {
    const subject = typeof s.subject === "string" ? s.subject.trim() : "";
    const body = typeof s.body_text === "string" ? s.body_text.trim() : "";
    if (!subject || !body) continue;
    const channel = typeof s.channel === "string" && CHANNELS.has(s.channel) ? s.channel : "auto";
    await run(env.DB,
      "INSERT INTO sequence_steps (id, sequence_id, step_order, delay_hours, subject, body_text, channel, created_at) VALUES (?,?,?,?,?,?,?,?)",
      uuid(), sequenceId, order, Number.isFinite(Number(s.delay_hours)) ? Math.max(0, Math.round(Number(s.delay_hours))) : 0, subject, body, channel, now);
    order++;
  }
}

// Per-sequence outcomes, so a sequence can be judged on results rather than
// on how many people it is quietly emailing.
sequenceRoutes.get("/", async (c) => {
  const items = await all(c.env.DB,
    `SELECT s.*,
       (SELECT COUNT(*) FROM sequence_steps st WHERE st.sequence_id = s.id) AS step_count,
       (SELECT COUNT(*) FROM enrollments e WHERE e.sequence_id = s.id AND e.status = 'active') AS active_count,
       (SELECT COUNT(*) FROM enrollments e WHERE e.sequence_id = s.id) AS enrolled_count,
       (SELECT COUNT(*) FROM messages m WHERE m.sequence_id = s.id AND m.direction = 'outbound') AS sent_count,
       (SELECT COUNT(*) FROM enrollments e WHERE e.sequence_id = s.id AND e.exit_reason = 'replied') AS replied_count,
       (SELECT COUNT(*) FROM enrollments e WHERE e.sequence_id = s.id AND e.exit_reason = 'booked') AS booked_count
     FROM sequences s ORDER BY s.priority DESC, s.created_at DESC`);
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

// Trigger vocabulary for the sequence editor. Declared before "/:id" so the
// path is not swallowed by the id route.
sequenceRoutes.get("/triggers", (c) => c.json({ items: TRIGGERS }));

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
  const b = ((await c.req.json().catch(() => null)) ?? {}) as { name?: string; status?: string; trigger?: string; priority?: unknown; steps?: StepInput[] };
  const sets: string[] = [];
  const binds: unknown[] = [];
  if (typeof b.name === "string") { sets.push("name = ?"); binds.push(b.name.trim()); }
  if (b.status === "draft" || b.status === "active") { sets.push("status = ?"); binds.push(b.status); }
  if (typeof b.trigger === "string") { sets.push("trigger = ?"); binds.push(b.trigger); }
  if (Number.isFinite(Number(b.priority))) { sets.push("priority = ?"); binds.push(Math.round(Number(b.priority))); }
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

// Send-log: every email this sequence actually fired, newest first, with the
// recipient, subject, status and time (bodies were stored at send time).
sequenceRoutes.get("/:id/sends", async (c) => {
  const items = await all(c.env.DB,
    `SELECT m.id, m.contact_id, m.to_email, m.subject, m.body_text, m.status, m.created_at, m.sent_at,
            ct.first_name, ct.last_name
     FROM messages m LEFT JOIN contacts ct ON ct.id = m.contact_id
     WHERE m.sequence_id = ?
     ORDER BY m.created_at DESC, m.id DESC LIMIT 200`, c.req.param("id"));
  return c.json({ items });
});

// Resume a sequence that auto-paused when the customer replied. Deliberately
// manual: the robot stops the moment a human speaks, and only a human restarts it.
sequenceRoutes.post("/:id/enrollments/:eid/resume", async (c) => {
  const eid = c.req.param("eid");
  const e = await one<{ id: string; status: string }>(
    c.env.DB, "SELECT id, status FROM enrollments WHERE id = ? AND sequence_id = ?", eid, c.req.param("id"));
  if (!e) return c.json({ error: "not_found" }, 404);
  if (e.status !== "paused") return c.json({ error: "not_paused", status: e.status }, 400);
  await run(c.env.DB,
    "UPDATE enrollments SET status = 'active', exit_reason = NULL, next_run_at = ? WHERE id = ?",
    nowIso(), eid);
  return c.json({ ok: true });
});

// Remove someone from a sequence (deletes the enrollment so they can be re-added later).
sequenceRoutes.delete("/:id/enrollments/:eid", async (c) => {
  await run(c.env.DB, "DELETE FROM enrollments WHERE id = ? AND sequence_id = ?", c.req.param("eid"), c.req.param("id"));
  return c.json({ ok: true });
});
