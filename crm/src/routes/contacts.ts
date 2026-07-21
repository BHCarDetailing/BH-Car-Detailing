import { Hono } from "hono";
import type { Env } from "../types";
import { STAGES } from "../types";
import { all, nowIso, one, run, uuid } from "../lib/db";
import { cleanName, normalizeEmail, normalizePhone } from "../lib/normalize";
import { logActivity } from "../lib/activity";
import { requireAuth } from "../lib/auth";

export const contactRoutes = new Hono<{ Bindings: Env }>();
contactRoutes.use("*", requireAuth());

const PATCH_FIELDS = new Set([
  "first_name", "last_name", "email", "phone", "address", "city", "area_slug",
  "stage", "source", "source_detail", "tags", "custom",
  "email_opt_in", "sms_opt_in", "replied_flag", "ai_summary", "ai_next_action",
]);

function actorOf(c: { req: { header: (n: string) => string | undefined } }): string {
  return c.req.header("Authorization")?.startsWith("Bearer ") ? "agent" : "human";
}

// Bridge touch-log: the tap-to-text / tap-to-call buttons fire this so the CRM
// records the outreach even though the actual send happens in the phone's apps.
contactRoutes.post("/:id/touch", async (c) => {
  const id = c.req.param("id");
  const b = ((await c.req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  const channel = b.channel === "call" ? "call" : "sms";
  const contact = await one<{ id: string; stage: string }>(c.env.DB, "SELECT id, stage FROM contacts WHERE id = ?", id);
  if (!contact) return c.json({ error: "not_found" }, 404);
  await logActivity(c.env.DB, {
    contactId: id,
    type: channel === "call" ? "call_logged" : "sms_logged",
    title: channel === "call" ? "Called (from CRM)" : "Texted (from CRM)",
    payload: { via: "bridge", direction: "outbound" },
    actor: actorOf(c),
  });
  if (contact.stage === "new") {
    await run(c.env.DB, "UPDATE contacts SET stage = 'contacted' WHERE id = ? AND stage = 'new'", id);
  }
  return c.json({ ok: true });
});

contactRoutes.get("/", async (c) => {
  const q = c.req.query();
  const limit = Math.min(Number(q.limit) > 0 ? Number(q.limit) : 50, 200);
  const offset = Number(q.offset) > 0 ? Number(q.offset) : 0;
  const where: string[] = [];
  const binds: unknown[] = [];
  if (q.search) {
    const term = `%${q.search.replace(/[%_]/g, "")}%`;
    where.push("(first_name LIKE ? OR last_name LIKE ? OR email LIKE ? OR phone LIKE ?)");
    binds.push(term, term, term, term);
  }
  if (q.stage) { where.push("stage = ?"); binds.push(q.stage); }
  if (q.source) { where.push("source = ?"); binds.push(q.source); }
  if (q.tag) { where.push("tags LIKE ?"); binds.push(`%"${q.tag.replace(/[%_"]/g, "")}"%`); }
  const w = where.length ? "WHERE " + where.join(" AND ") : "";
  const total = await one<{ n: number }>(c.env.DB, `SELECT COUNT(*) AS n FROM contacts ${w}`, ...binds);
  const items = await all(
    c.env.DB,
    `SELECT c.*, (SELECT COUNT(*) FROM vehicles v WHERE v.contact_id = c.id) AS vehicle_count
     FROM contacts c ${w} ORDER BY c.created_at DESC LIMIT ? OFFSET ?`,
    ...binds, limit, offset
  );
  return c.json({ items, total: total?.n ?? 0 });
});

contactRoutes.post("/", async (c) => {
  const b = ((await c.req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  const stage = (b.stage as string) ?? "new";
  if (!STAGES.includes(stage as (typeof STAGES)[number])) {
    return c.json({ error: "invalid_stage" }, 400);
  }
  const id = uuid();
  const now = nowIso();
  await run(
    c.env.DB,
    `INSERT INTO contacts
       (id, first_name, last_name, email, phone, address, city, stage, source, tags, custom,
        email_opt_in, email_opt_in_at, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,1,?,?,?)`,
    id,
    cleanName(b.first_name as string) ?? null,
    cleanName(b.last_name as string) ?? null,
    normalizeEmail(b.email as string) ?? null,
    normalizePhone(b.phone as string) ?? null,
    (b.address as string) ?? null,
    (b.city as string) ?? null,
    stage,
    (b.source as string) ?? "manual",
    JSON.stringify(Array.isArray(b.tags) ? b.tags : []),
    JSON.stringify(typeof b.custom === "object" && b.custom ? b.custom : {}),
    now, now, now
  );
  return c.json({ id }, 201);
});

contactRoutes.get("/:id", async (c) => {
  const row = await one<Record<string, unknown>>(
    c.env.DB, "SELECT * FROM contacts WHERE id = ?", c.req.param("id"));
  if (!row) return c.json({ error: "not_found" }, 404);
  const vehicles = await all(
    c.env.DB, "SELECT * FROM vehicles WHERE contact_id = ? ORDER BY created_at DESC", row.id);
  return c.json({
    ...row,
    tags: JSON.parse((row.tags as string) || "[]"),
    custom: JSON.parse((row.custom as string) || "{}"),
    vehicles,
  });
});

contactRoutes.patch("/:id", async (c) => {
  const id = c.req.param("id");
  const existing = await one<Record<string, unknown>>(c.env.DB, "SELECT * FROM contacts WHERE id = ?", id);
  if (!existing) return c.json({ error: "not_found" }, 404);
  const b = ((await c.req.json().catch(() => null)) ?? {}) as Record<string, unknown>;

  const sets: string[] = [];
  const binds: unknown[] = [];
  for (const [k, v] of Object.entries(b)) {
    if (!PATCH_FIELDS.has(k)) continue;
    if (k === "stage") {
      if (!STAGES.includes(v as (typeof STAGES)[number])) return c.json({ error: "invalid_stage" }, 400);
      sets.push("stage = ?"); binds.push(v);
    } else if (k === "email") {
      sets.push("email = ?"); binds.push(normalizeEmail(v as string));
    } else if (k === "phone") {
      sets.push("phone = ?"); binds.push(normalizePhone(v as string));
    } else if (k === "tags") {
      sets.push("tags = ?"); binds.push(JSON.stringify(Array.isArray(v) ? v : []));
    } else if (k === "custom") {
      const merged = { ...JSON.parse((existing.custom as string) || "{}"), ...(typeof v === "object" && v ? v : {}) };
      sets.push("custom = ?"); binds.push(JSON.stringify(merged));
    } else {
      sets.push(`${k} = ?`); binds.push(v ?? null);
    }
  }
  if (!sets.length) return c.json({ error: "no_valid_fields" }, 400);
  sets.push("updated_at = ?"); binds.push(nowIso());
  await run(c.env.DB, `UPDATE contacts SET ${sets.join(", ")} WHERE id = ?`, ...binds, id);

  if (typeof b.stage === "string" && b.stage !== existing.stage) {
    await logActivity(c.env.DB, {
      contactId: id, type: "stage_changed",
      title: `Stage: ${existing.stage} → ${b.stage}`,
      payload: { from: existing.stage, to: b.stage },
      actor: actorOf(c),
    });
  }
  return c.json({ ok: true });
});

contactRoutes.delete("/:id", async (c) => {
  await run(c.env.DB, "DELETE FROM contacts WHERE id = ?", c.req.param("id"));
  return c.json({ ok: true });
});

contactRoutes.get("/:id/activities", async (c) => {
  const items = await all(
    c.env.DB,
    "SELECT * FROM activities WHERE contact_id = ? ORDER BY id DESC LIMIT 100",
    c.req.param("id")
  );
  return c.json({ items });
});

export const statsRoutes = new Hono<{ Bindings: Env }>();
statsRoutes.use("*", requireAuth());
statsRoutes.get("/", async (c) => {
  const rows = await all<{ stage: string; n: number }>(
    c.env.DB, "SELECT stage, COUNT(*) AS n FROM contacts GROUP BY stage");
  const byStage: Record<string, number> = {};
  for (const s of STAGES) byStage[s] = 0;
  for (const r of rows) byStage[r.stage] = r.n;
  const recent = await all(
    c.env.DB,
    `SELECT a.id, a.type, a.title, a.created_at, a.contact_id, c.first_name, c.last_name
     FROM activities a JOIN contacts c ON c.id = a.contact_id
     ORDER BY a.id DESC LIMIT 20`
  );
  const todayJobs = await all(
    c.env.DB,
    `SELECT j.id, j.title, j.status, j.scheduled_start, j.contact_id, c.first_name, c.last_name, c.phone
     FROM jobs j JOIN contacts c ON c.id = j.contact_id
     WHERE j.status IN ('scheduled','in_progress')
       AND j.scheduled_start IS NOT NULL
       AND date(j.scheduled_start) = date('now')
     ORDER BY j.scheduled_start ASC`
  );
  const openTasks = await all(
    c.env.DB,
    `SELECT t.id, t.title, t.due_at, t.contact_id, c.first_name, c.last_name
     FROM tasks t LEFT JOIN contacts c ON c.id = t.contact_id
     WHERE t.status = 'open'
     ORDER BY (t.due_at IS NULL), t.due_at ASC LIMIT 10`
  );
  return c.json({ byStage, recent, todayJobs, openTasks });
});
