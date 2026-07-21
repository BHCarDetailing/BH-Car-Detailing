import { Hono } from "hono";
import type { Env } from "../types";
import { all, nowIso, one, run, uuid } from "../lib/db";
import { requireAuth } from "../lib/auth";

const TASK_STATUSES = ["open", "done", "dismissed"] as const;
type TaskStatus = (typeof TASK_STATUSES)[number];

export const taskRoutes = new Hono<{ Bindings: Env }>();
taskRoutes.use("*", requireAuth());

taskRoutes.get("/", async (c) => {
  const q = c.req.query();
  const where: string[] = [];
  const binds: unknown[] = [];
  if (q.status) { where.push("t.status = ?"); binds.push(q.status); }
  if (q.contact_id) { where.push("t.contact_id = ?"); binds.push(q.contact_id); }
  if (q.due_before) { where.push("t.due_at IS NOT NULL AND t.due_at <= ?"); binds.push(q.due_before); }
  const w = where.length ? "WHERE " + where.join(" AND ") : "";
  const items = await all(
    c.env.DB,
    `SELECT t.*, c.first_name, c.last_name
     FROM tasks t LEFT JOIN contacts c ON c.id = t.contact_id
     ${w} ORDER BY (t.due_at IS NULL), t.due_at ASC, t.created_at ASC LIMIT 200`,
    ...binds
  );
  return c.json({ items });
});

taskRoutes.post("/", async (c) => {
  const b = ((await c.req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  const title = typeof b.title === "string" ? b.title.trim() : "";
  if (!title) return c.json({ error: "title_required" }, 400);
  const id = uuid();
  const now = nowIso();
  await run(
    c.env.DB,
    `INSERT INTO tasks (id, contact_id, job_id, title, notes, due_at, status, created_by, created_at)
     VALUES (?,?,?,?,?,?, 'open', ?, ?)`,
    id,
    typeof b.contact_id === "string" ? b.contact_id : null,
    typeof b.job_id === "string" ? b.job_id : null,
    title,
    typeof b.notes === "string" ? b.notes : null,
    typeof b.due_at === "string" ? b.due_at : null,
    c.req.header("Authorization")?.startsWith("Bearer ") ? "agent" : "human",
    now
  );
  return c.json({ id }, 201);
});

taskRoutes.patch("/:id", async (c) => {
  const id = c.req.param("id");
  const existing = await one<Record<string, unknown>>(c.env.DB, "SELECT * FROM tasks WHERE id = ?", id);
  if (!existing) return c.json({ error: "not_found" }, 404);
  const b = ((await c.req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  const sets: string[] = [];
  const binds: unknown[] = [];
  if (typeof b.title === "string") { sets.push("title = ?"); binds.push(b.title.trim()); }
  if ("notes" in b) { sets.push("notes = ?"); binds.push(typeof b.notes === "string" ? b.notes : null); }
  if ("due_at" in b) { sets.push("due_at = ?"); binds.push(typeof b.due_at === "string" ? b.due_at : null); }
  if (typeof b.status === "string") {
    if (!TASK_STATUSES.includes(b.status as TaskStatus)) return c.json({ error: "invalid_status" }, 400);
    sets.push("status = ?"); binds.push(b.status);
    sets.push("done_at = ?"); binds.push(b.status === "done" ? nowIso() : null);
  }
  if (!sets.length) return c.json({ error: "no_valid_fields" }, 400);
  await run(c.env.DB, `UPDATE tasks SET ${sets.join(", ")} WHERE id = ?`, ...binds, id);
  return c.json({ ok: true });
});

taskRoutes.delete("/:id", async (c) => {
  await run(c.env.DB, "DELETE FROM tasks WHERE id = ?", c.req.param("id"));
  return c.json({ ok: true });
});
