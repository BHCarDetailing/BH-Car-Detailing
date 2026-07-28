import { Hono } from "hono";
import type { Env } from "../types";
import { all, nowIso, one, run, uuid } from "../lib/db";
import { requireAuth } from "../lib/auth";

/**
 * Generic collections engine.
 *
 * Every "operating-system" entity (clients, updates, revenue, team, tasks, …)
 * is a thin config in COLLECTIONS below. This one file gives them all
 * list / create / update / delete over D1 with column + enum whitelisting,
 * type coercion, and required-field validation — so adding a future entity is
 * a config edit, not a new route file. Existing CRM routes are untouched.
 */

type FieldType = "text" | "int" | "bool";
interface Field {
  type: FieldType;
  required?: boolean;
  enum?: readonly string[];
  min?: number;
  max?: number;      // int: max value; text: max length
}
interface Collection {
  table: string;
  fields: Record<string, Field>;
  orderBy: string;
  timestamps: "none" | "created" | "both"; // created_at / updated_at management
}

const TEXT_MAX = 20000;

export const COLLECTIONS: Record<string, Collection> = {
  updates: {
    table: "updates",
    orderBy: "pinned DESC, created_at DESC",
    timestamps: "created",
    fields: {
      category: { type: "text", enum: ["meeting", "car_event", "call", "general", "win", "follow_up", "sequence"], max: 40 },
      body: { type: "text", required: true, max: 4000 },
      author: { type: "text", max: 80 },
      pinned: { type: "bool" },
    },
  },
  clients: {
    table: "clients",
    orderBy: "updated_at DESC",
    timestamps: "both",
    fields: {
      name: { type: "text", required: true, max: 120 },
      type: { type: "text", enum: ["residential", "fleet", "dealership", "exotic", "commercial"], max: 40 },
      stage: { type: "text", enum: ["lead", "active", "recurring", "paused", "churned"], max: 40 },
      email: { type: "text", max: 160 },
      notes: { type: "text", max: 4000 },
    },
  },
  revenue: {
    table: "revenue_entries",
    orderBy: "occurred_at DESC, created_at DESC",
    timestamps: "created",
    fields: {
      label: { type: "text", required: true, max: 160 },
      amount_cents: { type: "int", min: 0, max: 100_000_000_00 },
      occurred_at: { type: "text", max: 40 },
      customer: { type: "text", max: 160 },
      service: { type: "text", max: 160 },
      status: { type: "text", enum: ["paid", "pending", "refunded", "cancelled"], max: 20 },
      note: { type: "text", max: 2000 },
      contact_id: { type: "text", max: 40 }, // optional link to a real contact
      // kind retained in DB for back-compat but no longer set from the UI
    },
  },
  team: {
    table: "team_members",
    orderBy: "created_at ASC",
    timestamps: "created",
    fields: {
      name: { type: "text", required: true, max: 120 },
      role: { type: "text", max: 120 },
      focus: { type: "text", max: 200 },
      bandwidth: { type: "text", max: 500 },
    },
  },
  acct_tasks: {
    table: "acct_tasks",
    orderBy: "sort ASC, created_at ASC",
    timestamps: "created",
    fields: {
      title: { type: "text", required: true, max: 400 },
      bucket: { type: "text", enum: ["today", "week", "month", "wins"], max: 20 },
      status: { type: "text", enum: ["not_started", "started", "needs_attention", "done", "flagged"], max: 30 },
      progress: { type: "int", min: 0, max: 100 },
      owner: { type: "text", max: 80 },
      due_date: { type: "text", max: 40 },
      sort: { type: "int", min: 0, max: 1_000_000 },
    },
  },
  kpis: {
    table: "kpis",
    orderBy: "sort ASC",
    timestamps: "created",
    fields: {
      label: { type: "text", required: true, max: 120 },
      target: { type: "text", max: 40 },
      current: { type: "text", max: 40 },
      unit: { type: "text", max: 20 },
      sort: { type: "int", min: 0, max: 1_000_000 },
    },
  },
  onboarding: {
    table: "onboarding_items",
    orderBy: "sort ASC, created_at ASC",
    timestamps: "created",
    fields: {
      subject: { type: "text", required: true, max: 120 },
      step: { type: "text", required: true, max: 300 },
      status: { type: "text", enum: ["todo", "in_progress", "done"], max: 20 },
      sort: { type: "int", min: 0, max: 1_000_000 },
    },
  },
  products: {
    table: "products",
    orderBy: "sort ASC, name ASC",
    timestamps: "created",
    fields: {
      name: { type: "text", required: true, max: 160 },
      price_cents: { type: "int", min: 0, max: 100_000_000_00 },
      description: { type: "text", max: 4000 },
      sort: { type: "int", min: 0, max: 1_000_000 },
    },
  },
  partners: {
    table: "partners",
    orderBy: "created_at DESC",
    timestamps: "created",
    fields: {
      name: { type: "text", required: true, max: 120 },
      kind: { type: "text", enum: ["partner", "sdr"], max: 20 },
      email: { type: "text", max: 160 },
      phone: { type: "text", max: 40 },
      notes: { type: "text", max: 4000 },
    },
  },
  advisors: {
    table: "advisors",
    orderBy: "created_at DESC",
    timestamps: "created",
    fields: {
      name: { type: "text", required: true, max: 120 },
      email: { type: "text", max: 160 },
      cadence: { type: "text", enum: ["weekly", "monthly", "quarterly", "none"], max: 20 },
      last_contact: { type: "text", max: 40 },
      notes: { type: "text", max: 4000 },
    },
  },
  prospects: {
    table: "prospects",
    orderBy: "created_at DESC",
    timestamps: "created",
    fields: {
      name: { type: "text", required: true, max: 160 },
      source: { type: "text", max: 80 },
      status: { type: "text", enum: ["new", "contacted", "follow_up", "won", "lost"], max: 20 },
      next_follow_up: { type: "text", max: 40 },
      notes: { type: "text", max: 4000 },
    },
  },
  campaigns: {
    table: "marketing_campaigns",
    orderBy: "created_at DESC",
    timestamps: "created",
    fields: {
      name: { type: "text", required: true, max: 160 },
      channel: { type: "text", enum: ["google_ads", "google_lsa", "instagram", "facebook", "other"], max: 20 },
      status: { type: "text", enum: ["active", "paused", "ended"], max: 20 },
      spend_cents: { type: "int", min: 0, max: 100_000_000_00 },
      leads: { type: "int", min: 0, max: 10_000_000 },
      start_date: { type: "text", max: 40 },
      end_date: { type: "text", max: 40 },
      notes: { type: "text", max: 4000 },
    },
  },
  content: {
    table: "content_items",
    orderBy: "scheduled_for DESC, created_at DESC",
    timestamps: "created",
    fields: {
      title: { type: "text", required: true, max: 200 },
      channel: { type: "text", enum: ["instagram", "facebook", "tiktok", "youtube", "blog", "other"], max: 20 },
      body: { type: "text", max: 8000 },
      scheduled_for: { type: "text", max: 40 },
      status: { type: "text", enum: ["draft", "scheduled", "published"], max: 20 },
      media_key: { type: "text", max: 200 },
    },
  },
  discovery: {
    table: "discovery_notes",
    orderBy: "created_at DESC",
    timestamps: "created",
    fields: {
      title: { type: "text", required: true, max: 200 },
      contact: { type: "text", max: 160 },
      body: { type: "text", max: 8000 },
    },
  },
  docs: {
    table: "docs",
    orderBy: "created_at DESC",
    timestamps: "created",
    fields: {
      title: { type: "text", required: true, max: 200 },
      category: { type: "text", max: 60 },
      url: { type: "text", max: 2000 },
      notes: { type: "text", max: 4000 },
    },
  },
};

/** Coerce + validate one incoming field value against its spec. Returns [value] or throws message. */
function coerce(name: string, spec: Field, raw: unknown): unknown {
  if (raw === undefined || raw === null || raw === "") {
    if (spec.required) throw `${name}_required`;
    return spec.type === "bool" ? 0 : spec.type === "int" ? 0 : null;
  }
  if (spec.type === "bool") return raw ? 1 : 0;
  if (spec.type === "int") {
    const n = Math.round(Number(raw));
    if (!Number.isFinite(n)) throw `${name}_invalid`;
    if (spec.min !== undefined && n < spec.min) throw `${name}_too_small`;
    if (spec.max !== undefined && n > spec.max) throw `${name}_too_large`;
    return n;
  }
  // text
  const s = String(raw).trim();
  if (spec.required && !s) throw `${name}_required`;
  if (s.length > (spec.max ?? TEXT_MAX)) throw `${name}_too_long`;
  if (spec.enum && s && !spec.enum.includes(s)) throw `${name}_invalid`;
  return s || null;
}

/**
 * Build column/value pairs from a request body. Absent fields are skipped so
 * DB column defaults apply (important for NOT NULL DEFAULT columns like
 * `status`); required fields that are absent throw on create.
 */
function buildValues(col: Collection, body: Record<string, unknown>, mode: "create" | "patch") {
  const cols: string[] = [];
  const vals: unknown[] = [];
  for (const [name, spec] of Object.entries(col.fields)) {
    const present = Object.prototype.hasOwnProperty.call(body, name);
    if (!present) {
      if (mode === "create" && spec.required) throw `${name}_required`;
      continue; // let the DB default fill it
    }
    cols.push(name);
    vals.push(coerce(name, spec, body[name]));
  }
  return { cols, vals };
}

export const collectionRoutes = new Hono<{ Bindings: Env }>();
collectionRoutes.use("*", requireAuth());

collectionRoutes.get("/:name", async (c) => {
  const col = COLLECTIONS[c.req.param("name")];
  if (!col) return c.json({ error: "unknown_collection" }, 404);
  const items = await all(c.env.DB, `SELECT * FROM ${col.table} ORDER BY ${col.orderBy}`);
  return c.json({ items });
});

collectionRoutes.post("/:name", async (c) => {
  const col = COLLECTIONS[c.req.param("name")];
  if (!col) return c.json({ error: "unknown_collection" }, 404);
  const body = ((await c.req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  let built;
  try { built = buildValues(col, body, "create"); }
  catch (e) { return c.json({ error: String(e) }, 400); }

  const id = uuid();
  const cols = ["id", ...built.cols];
  const vals: unknown[] = [id, ...built.vals];
  if (col.timestamps !== "none") {
    const now = nowIso();
    cols.push("created_at"); vals.push(now);
    if (col.timestamps === "both") { cols.push("updated_at"); vals.push(now); }
  }
  const placeholders = cols.map(() => "?").join(",");
  await run(c.env.DB, `INSERT INTO ${col.table} (${cols.join(",")}) VALUES (${placeholders})`, ...vals);
  const item = await one(c.env.DB, `SELECT * FROM ${col.table} WHERE id = ?`, id);
  return c.json({ item }, 201);
});

collectionRoutes.patch("/:name/:id", async (c) => {
  const col = COLLECTIONS[c.req.param("name")];
  if (!col) return c.json({ error: "unknown_collection" }, 404);
  const id = c.req.param("id");
  const exists = await one(c.env.DB, `SELECT id FROM ${col.table} WHERE id = ?`, id);
  if (!exists) return c.json({ error: "not_found" }, 404);
  const body = ((await c.req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  let built;
  try { built = buildValues(col, body, "patch"); }
  catch (e) { return c.json({ error: String(e) }, 400); }
  if (built.cols.length === 0 && col.timestamps !== "both") return c.json({ error: "no_fields" }, 400);

  const sets = built.cols.map((k) => `${k} = ?`);
  const vals = [...built.vals];
  if (col.timestamps === "both") { sets.push("updated_at = ?"); vals.push(nowIso()); }
  vals.push(id);
  await run(c.env.DB, `UPDATE ${col.table} SET ${sets.join(", ")} WHERE id = ?`, ...vals);
  const item = await one(c.env.DB, `SELECT * FROM ${col.table} WHERE id = ?`, id);
  return c.json({ item });
});

collectionRoutes.delete("/:name/:id", async (c) => {
  const col = COLLECTIONS[c.req.param("name")];
  if (!col) return c.json({ error: "unknown_collection" }, 404);
  await run(c.env.DB, `DELETE FROM ${col.table} WHERE id = ?`, c.req.param("id"));
  return c.json({ ok: true });
});
