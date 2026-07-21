# BH CRM Phase 2 (Pipeline, Calendar, Jobs) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** A mobile-first pipeline board, an internal jobs calendar, jobs + tasks management, and booking confirmation/reminder emails (log-only until Resend is configured), built on the live Phase 1 CRM.

**Architecture:** Extends the single Cloudflare Worker (Hono + D1) with jobs/tasks tables, their REST routes, an email-sending abstraction that no-ops-to-log when unconfigured, and a cron trigger that sends job reminders. The React admin gains a responsive app shell (sidebar on desktop, bottom tab bar on phones), a kanban Pipeline, a Calendar, and job/task UIs — and a responsive pass over the existing Phase 1 screens.

**Tech Stack:** Hono ^4, D1, Vitest + @cloudflare/vitest-pool-workers, React 18 + Vite + Tailwind v4, @dnd-kit/core + @dnd-kit/sortable (drag), react-router-dom ^7.

**Spec:** `docs/superpowers/specs/2026-07-17-bh-crm-design.md` (Phase 2 = spec §13 phase 2). Phase 1 is live at `bh-crm.bhcardetails.workers.dev`.

## Global Constraints

- **PATH:** Node is not on the session PATH. Every node/npm/npx command MUST be prefixed with: `export PATH="/c/Program Files/nodejs:$PATH" && `
- **Working dir:** worker/test commands from `C:\Users\Maxwell Berko\Desktop\7-17 Website\crm`; admin build from `crm/admin`.
- **Stage enum (unchanged):** `new|contacted|quoted|scheduled|customer|lost`.
- **Job status enum (exact):** `draft|quoted|scheduled|in_progress|completed|paid|cancelled`.
- **Task status enum (exact):** `open|done|dismissed`.
- **Money:** integer cents (`price_cents`), never floats. **IDs:** `crypto.randomUUID()` for jobs/tasks. **Timestamps:** ISO-8601 UTC strings. `scheduled_start`/`scheduled_end` are ISO-8601 UTC.
- **TZ:** display in `HOME_TZ` (America/New_York) on the client; store UTC.
- **Email is fallback-safe:** when `RESEND_API_KEY` is absent/empty, `sendEmail` MUST record the message with status `logged` and NOT make a network call. No task in this phase requires Resend to pass.
- **Mobile-first:** every screen must be usable one-handed on a 375px-wide viewport — primary nav is a bottom tab bar under `md:` breakpoint, tap targets ≥44px, no hover-only affordances, no horizontal body scroll. Desktop (≥768px) keeps the sidebar.
- **Reuse Phase 1 patterns:** API routes follow `crm/src/routes/contacts.ts` (requireAuth mount, null-safe `((await c.req.json().catch(() => null)) ?? {})`, `typeof x === "string"` guards before normalize, raw prepared statements via `one/all/run` from `crm/src/lib/db.ts`). UI calls go through `api()` in `crm/admin/src/api.ts`. Log state changes with `logActivity` from `crm/src/lib/activity.ts`.
- **Agent surface:** every new endpoint MUST be added to the catalog in `crm/src/routes/agent.ts` and documented in `crm/AGENTS.md` within the task that introduces it.
- **Commit trailer (every commit):** `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
- **`.npmrc`** with `legacy-peer-deps=true` already exists in `crm/` and `crm/admin/` — new deps install under it.

---

### Task 1: Mobile-first app shell + responsive pass on Phase 1 screens

**Files:**
- Create: `crm/admin/src/components/BottomNav.tsx`, `crm/admin/src/lib/nav.ts`
- Modify: `crm/admin/src/components/Layout.tsx`, `crm/admin/src/pages/Dashboard.tsx`, `crm/admin/src/pages/Contacts.tsx`, `crm/admin/src/pages/ContactDetail.tsx`, `crm/admin/src/App.tsx`

**Interfaces:**
- Produces: `NAV_ITEMS` array (`crm/admin/src/lib/nav.ts`) — `{ to, label, icon }[]`, the single source of truth both Layout (desktop sidebar) and BottomNav consume. Routes `/pipeline`, `/calendar` added to App.tsx pointing at placeholder components (Tasks 7/8 replace them). All five previously-disabled nav items become live links.

- [ ] **Step 1: Create `crm/admin/src/lib/nav.ts`** — shared nav definition (inline SVG icon strings keep the bundle dependency-free):

```ts
export interface NavItem {
  to: string;
  label: string;
  short: string; // bottom-nav label (mobile)
  icon: string;  // inline SVG path data, drawn in a 24x24 viewBox
}

export const NAV_ITEMS: NavItem[] = [
  { to: "/dashboard", label: "Dashboard", short: "Home", icon: "M3 12l9-9 9 9M5 10v10h14V10" },
  { to: "/pipeline", label: "Pipeline", short: "Pipeline", icon: "M4 6h16M4 12h10M4 18h7" },
  { to: "/calendar", label: "Calendar", short: "Calendar", icon: "M7 3v4M17 3v4M4 8h16M4 8v12h16V8" },
  { to: "/contacts", label: "Contacts", short: "Contacts", icon: "M16 20a4 4 0 00-8 0M12 12a4 4 0 100-8 4 4 0 000 8" },
];
```
(Sequences / Workflows / Brand Brain arrive in Phases 3–4; they are intentionally NOT in NAV_ITEMS yet.)

- [ ] **Step 2: Create `crm/admin/src/components/BottomNav.tsx`** — fixed bottom tab bar, shown only below `md`:

```tsx
import { NavLink } from "react-router-dom";
import { NAV_ITEMS } from "../lib/nav";

export default function BottomNav() {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 flex border-t border-neutral-200 bg-white md:hidden">
      {NAV_ITEMS.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          className={({ isActive }) =>
            `flex flex-1 flex-col items-center gap-1 py-2 text-[11px] ${
              isActive ? "text-red-600" : "text-neutral-500"
            }`
          }
        >
          <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d={item.icon} />
          </svg>
          {item.short}
        </NavLink>
      ))}
    </nav>
  );
}
```

- [ ] **Step 3: Rewrite `crm/admin/src/components/Layout.tsx`** — sidebar on desktop, hidden on mobile; render BottomNav; add bottom padding on mobile so content clears the bar:

```tsx
import { NavLink, Outlet } from "react-router-dom";
import { NAV_ITEMS } from "../lib/nav";
import BottomNav from "./BottomNav";

export default function Layout() {
  return (
    <div className="flex min-h-screen bg-neutral-100">
      <aside className="hidden w-56 shrink-0 bg-neutral-950 p-4 text-neutral-300 md:block">
        <div className="mb-6 text-lg font-bold text-white">BH CRM</div>
        <nav className="space-y-1">
          {NAV_ITEMS.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-md px-3 py-2 text-sm ${isActive ? "bg-red-600 text-white" : "hover:bg-neutral-800"}`
              }
            >
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d={l.icon} />
              </svg>
              {l.label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <main className="min-w-0 flex-1 pb-16 md:pb-0">
        <Outlet />
      </main>
      <BottomNav />
    </div>
  );
}
```

- [ ] **Step 4: Responsive pass — Dashboard, Contacts, ContactDetail.** Apply these exact, behavior-preserving changes (layout only):
  - `Dashboard.tsx`: change the stat-tile grid from `grid-cols-3 ... lg:grid-cols-6` to `grid-cols-2 sm:grid-cols-3 lg:grid-cols-6`; change page padding `p-8` → `p-4 md:p-8`. In the new-leads list, make each row stack on mobile: the row container `flex items-center justify-between` → `flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between`, and the action-button group already wraps — add `flex-wrap`.
  - `Contacts.tsx`: page padding `p-8` → `p-4 md:p-8`. Wrap the `<table>` in `<div className="overflow-x-auto">`. Make the filter row wrap: `flex gap-3` → `flex flex-wrap gap-3`, and the search input `w-72` → `w-full sm:w-72`.
  - `ContactDetail.tsx`: page grid `lg:grid-cols-[1fr_380px]` unchanged (already stacks below lg); change padding `p-8` → `p-4 md:p-8`; the action buttons row add `flex-wrap`; the stage `<select>` gets `min-h-[44px]` and every `<a>`/`<button>` action gets `min-h-[44px]` for tap targets.

- [ ] **Step 5: Wire `/pipeline` and `/calendar` routes in `App.tsx`** with temporary placeholders (Tasks 7/8 replace):

```tsx
// add imports at top: (Pipeline/Calendar real pages land in later tasks)
function Soon({ name }: { name: string }) {
  return <div className="p-4 text-neutral-500 md:p-8">{name} — building…</div>;
}
```
Add inside the `<Route element={<Layout />}>` block:
```tsx
        <Route path="/pipeline" element={<Soon name="Pipeline" />} />
        <Route path="/calendar" element={<Soon name="Calendar" />} />
```

- [ ] **Step 6: Build + verify.** From `crm/admin`: `npm run build` (must pass tsc strict + vite). Then confirm no worker regressions: from `crm`, `npx vitest run` (expect the existing 62 passing). Report the build output and test count.

- [ ] **Step 7: Commit**

```bash
cd "/c/Users/Maxwell Berko/Desktop/7-17 Website" && git add crm/admin && git commit -m "feat(crm): mobile-first app shell with bottom nav; responsive Phase 1 screens

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Jobs + tasks schema (migration 0002)

**Files:**
- Create: `crm/migrations/0002_jobs_tasks.sql`
- Test: `crm/test/jobs-schema.test.ts`

**Interfaces:**
- Produces: tables `jobs`, `tasks`, `messages` (used by email module Task 5). Columns below are consumed verbatim by Tasks 3–10.

- [ ] **Step 1: Write the failing test** — `crm/test/jobs-schema.test.ts`:

```ts
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { all } from "../src/lib/db";

describe("phase-2 schema", () => {
  it("has jobs, tasks, messages tables", async () => {
    const rows = await all<{ name: string }>(
      env.DB, "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name");
    const names = rows.map((r) => r.name);
    for (const t of ["jobs", "tasks", "messages"]) expect(names).toContain(t);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `export PATH="/c/Program Files/nodejs:$PATH" && cd "/c/Users/Maxwell Berko/Desktop/7-17 Website/crm" && npx vitest run test/jobs-schema.test.ts` → FAIL (no jobs table).

- [ ] **Step 3: Create `crm/migrations/0002_jobs_tasks.sql`**:

```sql
CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  vehicle_id TEXT REFERENCES vehicles(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  services TEXT NOT NULL DEFAULT '[]',
  price_cents INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft',
  scheduled_start TEXT,
  scheduled_end TEXT,
  address TEXT,
  travel_buffer_min INTEGER NOT NULL DEFAULT 30,
  notes TEXT,
  confirmation_sent_at TEXT,
  reminder_sent_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_jobs_contact ON jobs(contact_id);
CREATE INDEX idx_jobs_status ON jobs(status);
CREATE INDEX idx_jobs_start ON jobs(scheduled_start);

CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  contact_id TEXT REFERENCES contacts(id) ON DELETE CASCADE,
  job_id TEXT REFERENCES jobs(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  notes TEXT,
  due_at TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  created_by TEXT NOT NULL DEFAULT 'human',
  created_at TEXT NOT NULL,
  done_at TEXT
);
CREATE INDEX idx_tasks_status ON tasks(status, due_at);
CREATE INDEX idx_tasks_contact ON tasks(contact_id);

CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  contact_id TEXT REFERENCES contacts(id) ON DELETE CASCADE,
  job_id TEXT REFERENCES jobs(id) ON DELETE SET NULL,
  kind TEXT NOT NULL,
  to_email TEXT,
  subject TEXT,
  body_html TEXT,
  body_text TEXT,
  provider_id TEXT,
  status TEXT NOT NULL DEFAULT 'queued',
  error TEXT,
  created_at TEXT NOT NULL,
  sent_at TEXT
);
CREATE INDEX idx_messages_contact ON messages(contact_id, id DESC);
CREATE INDEX idx_messages_job ON messages(job_id);
```

- [ ] **Step 4: Run tests — expect pass** (`npx vitest run` from crm; the pool auto-applies the new migration). All prior + new pass.

- [ ] **Step 5: Commit**

```bash
cd "/c/Users/Maxwell Berko/Desktop/7-17 Website" && git add crm/migrations crm/test/jobs-schema.test.ts && git commit -m "feat(crm): jobs, tasks, messages schema (migration 0002)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Jobs API (TDD)

**Files:**
- Create: `crm/src/routes/jobs.ts`
- Modify: `crm/src/index.ts`, `crm/src/routes/agent.ts`, `crm/AGENTS.md`
- Test: `crm/test/jobs.test.ts`

**Interfaces:**
- Consumes: `one/all/run/uuid/nowIso`, `logActivity`, `requireAuth`, and `JOB_STATUSES` (define locally in jobs.ts and also export from there).
- Produces (all behind `requireAuth()`), router `jobRoutes` mounted at `/api/jobs`:
  - `GET /api/jobs?status=&contact_id=&from=&to=&limit=&offset=` → `{ items, total }`. `from`/`to` filter `scheduled_start` (ISO date range, inclusive). items include `first_name,last_name` of the contact (JOIN). default limit 100, max 200.
  - `POST /api/jobs` body `{ contact_id (required), vehicle_id?, title (required), services?, price_cents?, status?, scheduled_start?, scheduled_end?, address?, travel_buffer_min?, notes? }` → 201 `{ id }`. 400 `{error:"contact_required"}` if no contact_id, 404 `{error:"contact_not_found"}` if it doesn't exist, 400 `{error:"invalid_status"}` for bad status. Logs `job_created` activity on the contact.
  - `GET /api/jobs/:id` → full job + `contact` (id, first/last, phone, email) + parsed `services`, or 404.
  - `PATCH /api/jobs/:id` — allowlist `title,vehicle_id,services,price_cents,status,scheduled_start,scheduled_end,address,travel_buffer_min,notes`; validates status; a status change logs `job_status_changed` `{from,to}`; scheduling (setting/among changing `scheduled_start`) logs `job_scheduled`. Returns `{ ok:true }`.
  - `DELETE /api/jobs/:id` → `{ ok:true }`.

- [ ] **Step 1: Write the failing tests** — `crm/test/jobs.test.ts`:

```ts
import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

const AUTH = { Authorization: "Bearer dev-agent-key", "Content-Type": "application/json" };

async function makeContact(first = "Job", email = "job@x.com") {
  const r = await SELF.fetch("http://x/api/contacts", {
    method: "POST", headers: AUTH, body: JSON.stringify({ first_name: first, email }),
  });
  return ((await r.json()) as { id: string }).id;
}

describe("jobs API", () => {
  it("creates a job and logs job_created", async () => {
    const cid = await makeContact("Alpha", "alpha@x.com");
    const res = await SELF.fetch("http://x/api/jobs", {
      method: "POST", headers: AUTH,
      body: JSON.stringify({ contact_id: cid, title: "Ceramic coating", price_cents: 75000, status: "quoted" }),
    });
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: string };
    const got = (await (await SELF.fetch(`http://x/api/jobs/${id}`, { headers: AUTH })).json()) as { title: string; price_cents: number; contact: { id: string } };
    expect(got.title).toBe("Ceramic coating");
    expect(got.price_cents).toBe(75000);
    expect(got.contact.id).toBe(cid);
    const acts = (await (await SELF.fetch(`http://x/api/contacts/${cid}/activities`, { headers: AUTH })).json()) as { items: Array<{ type: string }> };
    expect(acts.items.some((a) => a.type === "job_created")).toBe(true);
  });

  it("rejects missing contact and bad status", async () => {
    expect((await SELF.fetch("http://x/api/jobs", { method: "POST", headers: AUTH, body: JSON.stringify({ title: "x" }) })).status).toBe(400);
    const cid = await makeContact("Beta", "beta@x.com");
    expect((await SELF.fetch("http://x/api/jobs", { method: "POST", headers: AUTH, body: JSON.stringify({ contact_id: cid, title: "x", status: "nope" }) })).status).toBe(400);
    expect((await SELF.fetch("http://x/api/jobs", { method: "POST", headers: AUTH, body: JSON.stringify({ contact_id: "missing", title: "x" }) })).status).toBe(404);
  });

  it("PATCH status logs job_status_changed; scheduling logs job_scheduled", async () => {
    const cid = await makeContact("Gamma", "gamma@x.com");
    const { id } = (await (await SELF.fetch("http://x/api/jobs", { method: "POST", headers: AUTH, body: JSON.stringify({ contact_id: cid, title: "Detail" }) })).json()) as { id: string };
    await SELF.fetch(`http://x/api/jobs/${id}`, { method: "PATCH", headers: AUTH, body: JSON.stringify({ status: "scheduled", scheduled_start: "2026-08-01T14:00:00.000Z", scheduled_end: "2026-08-01T16:00:00.000Z" }) });
    const acts = (await (await SELF.fetch(`http://x/api/contacts/${cid}/activities`, { headers: AUTH })).json()) as { items: Array<{ type: string }> };
    expect(acts.items.some((a) => a.type === "job_status_changed")).toBe(true);
    expect(acts.items.some((a) => a.type === "job_scheduled")).toBe(true);
  });

  it("lists jobs filtered by date range", async () => {
    const cid = await makeContact("Delta", "delta@x.com");
    await SELF.fetch("http://x/api/jobs", { method: "POST", headers: AUTH, body: JSON.stringify({ contact_id: cid, title: "Aug job", status: "scheduled", scheduled_start: "2026-08-15T14:00:00.000Z" }) });
    const res = await SELF.fetch("http://x/api/jobs?from=2026-08-01&to=2026-08-31", { headers: AUTH });
    const { items } = (await res.json()) as { items: Array<{ title: string; first_name: string }> };
    expect(items.some((j) => j.title === "Aug job" && j.first_name === "Delta")).toBe(true);
  });

  it("requires auth", async () => {
    expect((await SELF.fetch("http://x/api/jobs")).status).toBe(401);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run test/jobs.test.ts` → 404s.

- [ ] **Step 3: Create `crm/src/routes/jobs.ts`** (mirror the contacts.ts patterns exactly):

```ts
import { Hono } from "hono";
import type { Env } from "../types";
import { all, nowIso, one, run, uuid } from "../lib/db";
import { logActivity } from "../lib/activity";
import { requireAuth } from "../lib/auth";

export const JOB_STATUSES = ["draft", "quoted", "scheduled", "in_progress", "completed", "paid", "cancelled"] as const;
type JobStatus = (typeof JOB_STATUSES)[number];

const PATCH_FIELDS = new Set([
  "title", "vehicle_id", "services", "price_cents", "status",
  "scheduled_start", "scheduled_end", "address", "travel_buffer_min", "notes",
]);

function actorOf(c: { req: { header: (n: string) => string | undefined } }): string {
  return c.req.header("Authorization")?.startsWith("Bearer ") ? "agent" : "human";
}

export const jobRoutes = new Hono<{ Bindings: Env }>();
jobRoutes.use("*", requireAuth());

jobRoutes.get("/", async (c) => {
  const q = c.req.query();
  const limit = Math.min(Number(q.limit) > 0 ? Number(q.limit) : 100, 200);
  const offset = Number(q.offset) > 0 ? Number(q.offset) : 0;
  const where: string[] = [];
  const binds: unknown[] = [];
  if (q.status) { where.push("j.status = ?"); binds.push(q.status); }
  if (q.contact_id) { where.push("j.contact_id = ?"); binds.push(q.contact_id); }
  if (q.from) { where.push("j.scheduled_start >= ?"); binds.push(q.from); }
  if (q.to) { where.push("j.scheduled_start <= ?"); binds.push(q.to + "T23:59:59.999Z"); }
  const w = where.length ? "WHERE " + where.join(" AND ") : "";
  const total = await one<{ n: number }>(c.env.DB, `SELECT COUNT(*) AS n FROM jobs j ${w}`, ...binds);
  const items = await all(
    c.env.DB,
    `SELECT j.*, c.first_name, c.last_name, c.phone
     FROM jobs j JOIN contacts c ON c.id = j.contact_id
     ${w} ORDER BY COALESCE(j.scheduled_start, j.created_at) DESC LIMIT ? OFFSET ?`,
    ...binds, limit, offset
  );
  return c.json({ items, total: total?.n ?? 0 });
});

jobRoutes.post("/", async (c) => {
  const b = ((await c.req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  const contactId = typeof b.contact_id === "string" ? b.contact_id : "";
  const title = typeof b.title === "string" ? b.title.trim() : "";
  if (!contactId || !title) return c.json({ error: "contact_required" }, 400);
  const status = (typeof b.status === "string" ? b.status : "draft") as JobStatus;
  if (!JOB_STATUSES.includes(status)) return c.json({ error: "invalid_status" }, 400);
  const contact = await one(c.env.DB, "SELECT id FROM contacts WHERE id = ?", contactId);
  if (!contact) return c.json({ error: "contact_not_found" }, 404);

  const id = uuid();
  const now = nowIso();
  await run(
    c.env.DB,
    `INSERT INTO jobs
       (id, contact_id, vehicle_id, title, services, price_cents, status,
        scheduled_start, scheduled_end, address, travel_buffer_min, notes, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    id, contactId,
    typeof b.vehicle_id === "string" ? b.vehicle_id : null,
    title,
    JSON.stringify(Array.isArray(b.services) ? b.services : []),
    Number.isFinite(Number(b.price_cents)) ? Math.round(Number(b.price_cents)) : 0,
    status,
    typeof b.scheduled_start === "string" ? b.scheduled_start : null,
    typeof b.scheduled_end === "string" ? b.scheduled_end : null,
    typeof b.address === "string" ? b.address : null,
    Number.isFinite(Number(b.travel_buffer_min)) ? Math.round(Number(b.travel_buffer_min)) : 30,
    typeof b.notes === "string" ? b.notes : null,
    now, now
  );
  await logActivity(c.env.DB, { contactId, type: "job_created", title: `Job: ${title}`, payload: { job_id: id, status }, actor: actorOf(c) });
  return c.json({ id }, 201);
});

jobRoutes.get("/:id", async (c) => {
  const job = await one<Record<string, unknown>>(c.env.DB, "SELECT * FROM jobs WHERE id = ?", c.req.param("id"));
  if (!job) return c.json({ error: "not_found" }, 404);
  const contact = await one(c.env.DB, "SELECT id, first_name, last_name, phone, email FROM contacts WHERE id = ?", job.contact_id);
  return c.json({ ...job, services: JSON.parse((job.services as string) || "[]"), contact });
});

jobRoutes.patch("/:id", async (c) => {
  const id = c.req.param("id");
  const existing = await one<Record<string, unknown>>(c.env.DB, "SELECT * FROM jobs WHERE id = ?", id);
  if (!existing) return c.json({ error: "not_found" }, 404);
  const b = ((await c.req.json().catch(() => null)) ?? {}) as Record<string, unknown>;

  const sets: string[] = [];
  const binds: unknown[] = [];
  for (const [k, v] of Object.entries(b)) {
    if (!PATCH_FIELDS.has(k)) continue;
    if (k === "status") {
      if (!JOB_STATUSES.includes(v as JobStatus)) return c.json({ error: "invalid_status" }, 400);
      sets.push("status = ?"); binds.push(v);
    } else if (k === "services") {
      sets.push("services = ?"); binds.push(JSON.stringify(Array.isArray(v) ? v : []));
    } else if (k === "price_cents" || k === "travel_buffer_min") {
      sets.push(`${k} = ?`); binds.push(Number.isFinite(Number(v)) ? Math.round(Number(v)) : 0);
    } else {
      sets.push(`${k} = ?`); binds.push(typeof v === "string" ? v : v == null ? null : String(v));
    }
  }
  if (!sets.length) return c.json({ error: "no_valid_fields" }, 400);
  sets.push("updated_at = ?"); binds.push(nowIso());
  await run(c.env.DB, `UPDATE jobs SET ${sets.join(", ")} WHERE id = ?`, ...binds, id);

  const contactId = existing.contact_id as string;
  const actor = actorOf(c);
  if (typeof b.status === "string" && b.status !== existing.status) {
    await logActivity(c.env.DB, { contactId, type: "job_status_changed", title: `Job ${existing.title}: ${existing.status} → ${b.status}`, payload: { job_id: id, from: existing.status, to: b.status }, actor });
  }
  if (typeof b.scheduled_start === "string" && b.scheduled_start && b.scheduled_start !== existing.scheduled_start) {
    await logActivity(c.env.DB, { contactId, type: "job_scheduled", title: `Job scheduled: ${existing.title}`, payload: { job_id: id, scheduled_start: b.scheduled_start }, actor });
  }
  return c.json({ ok: true });
});

jobRoutes.delete("/:id", async (c) => {
  await run(c.env.DB, "DELETE FROM jobs WHERE id = ?", c.req.param("id"));
  return c.json({ ok: true });
});
```

- [ ] **Step 4: Mount + document.** In `crm/src/index.ts` add `import { jobRoutes } from "./routes/jobs";` and `app.route("/api/jobs", jobRoutes);` (after the contacts mounts). In `crm/src/routes/agent.ts` add these entries to the `endpoints` array (after the contacts entries):

```ts
      { method: "GET", path: "/api/jobs", description: "List jobs. Query: status, contact_id, from, to (YYYY-MM-DD), limit, offset. Returns {items, total} with contact name/phone" },
      { method: "POST", path: "/api/jobs", description: "Create job. Body {contact_id, title, services?, price_cents?, status?, scheduled_start?, scheduled_end?, address?, notes?}" },
      { method: "GET", path: "/api/jobs/:id", description: "Job + contact + parsed services" },
      { method: "PATCH", path: "/api/jobs/:id", description: "Update job; status change logs job_status_changed, scheduling logs job_scheduled" },
      { method: "DELETE", path: "/api/jobs/:id", description: "Delete a job" },
```
In `crm/AGENTS.md`, under the recipes, add one line: `Jobs: GET/POST /api/jobs, GET/PATCH/DELETE /api/jobs/:id — statuses: draft|quoted|scheduled|in_progress|completed|paid|cancelled; price_cents is integer cents.`

- [ ] **Step 5: Run full suite — expect pass**, then commit:

```bash
cd "/c/Users/Maxwell Berko/Desktop/7-17 Website" && git add crm/src crm/test/jobs.test.ts crm/AGENTS.md && git commit -m "feat(crm): jobs API with status + scheduling activity logging

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Tasks API (TDD)

**Files:**
- Create: `crm/src/routes/tasks.ts`
- Modify: `crm/src/index.ts`, `crm/src/routes/agent.ts`, `crm/AGENTS.md`
- Test: `crm/test/tasks.test.ts`

**Interfaces:**
- Produces router `taskRoutes` at `/api/tasks` (behind requireAuth):
  - `GET /api/tasks?status=&contact_id=&due_before=` → `{ items }` ordered by `due_at` asc nulls last, then created_at. Joins contact name when `contact_id` present. default limit 200.
  - `POST /api/tasks` body `{ title (required), contact_id?, job_id?, notes?, due_at? }` → 201 `{ id }`; 400 `{error:"title_required"}`. actor from auth.
  - `PATCH /api/tasks/:id` body `{ title?, notes?, due_at?, status? }` — status in `open|done|dismissed`; setting `done` stamps `done_at`. 400 on invalid status.
  - `DELETE /api/tasks/:id`.

- [ ] **Step 1: Write the failing tests** — `crm/test/tasks.test.ts`:

```ts
import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

const AUTH = { Authorization: "Bearer dev-agent-key", "Content-Type": "application/json" };

describe("tasks API", () => {
  it("creates, lists, completes, deletes", async () => {
    const res = await SELF.fetch("http://x/api/tasks", { method: "POST", headers: AUTH, body: JSON.stringify({ title: "Call Jorge back", due_at: "2026-08-01T12:00:00.000Z" }) });
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: string };
    const list = (await (await SELF.fetch("http://x/api/tasks?status=open", { headers: AUTH })).json()) as { items: Array<{ id: string; status: string }> };
    expect(list.items.some((t) => t.id === id)).toBe(true);
    const done = await SELF.fetch(`http://x/api/tasks/${id}`, { method: "PATCH", headers: AUTH, body: JSON.stringify({ status: "done" }) });
    expect(done.status).toBe(200);
    const openAfter = (await (await SELF.fetch("http://x/api/tasks?status=open", { headers: AUTH })).json()) as { items: Array<{ id: string }> };
    expect(openAfter.items.some((t) => t.id === id)).toBe(false);
    expect((await SELF.fetch(`http://x/api/tasks/${id}`, { method: "DELETE", headers: AUTH })).status).toBe(200);
  });

  it("requires a title and validates status", async () => {
    expect((await SELF.fetch("http://x/api/tasks", { method: "POST", headers: AUTH, body: JSON.stringify({ notes: "x" }) })).status).toBe(400);
    const { id } = (await (await SELF.fetch("http://x/api/tasks", { method: "POST", headers: AUTH, body: JSON.stringify({ title: "t" }) })).json()) as { id: string };
    expect((await SELF.fetch(`http://x/api/tasks/${id}`, { method: "PATCH", headers: AUTH, body: JSON.stringify({ status: "banana" }) })).status).toBe(400);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run test/tasks.test.ts` → 404s.

- [ ] **Step 3: Create `crm/src/routes/tasks.ts`**:

```ts
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
```

- [ ] **Step 4: Mount + document.** `index.ts`: `import { taskRoutes } from "./routes/tasks";` + `app.route("/api/tasks", taskRoutes);`. `agent.ts` endpoints array:

```ts
      { method: "GET", path: "/api/tasks", description: "List tasks. Query: status (open|done|dismissed), contact_id, due_before. Returns {items}" },
      { method: "POST", path: "/api/tasks", description: "Create task. Body {title, contact_id?, job_id?, notes?, due_at?}" },
      { method: "PATCH", path: "/api/tasks/:id", description: "Update task; status=done stamps done_at" },
      { method: "DELETE", path: "/api/tasks/:id", description: "Delete a task" },
```
`AGENTS.md`: add `Tasks: GET/POST /api/tasks, GET/PATCH/DELETE /api/tasks/:id — status open|done|dismissed.`

- [ ] **Step 5: Run full suite — expect pass**, commit:

```bash
cd "/c/Users/Maxwell Berko/Desktop/7-17 Website" && git add crm/src crm/test/tasks.test.ts crm/AGENTS.md && git commit -m "feat(crm): tasks API

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Email module with log-only fallback (TDD)

**Files:**
- Create: `crm/src/lib/email.ts`
- Modify: `crm/src/types.ts` (add optional email vars to Env)
- Test: `crm/test/email.test.ts`

**Interfaces:**
- Consumes: `run/uuid/nowIso`, `Env`.
- Produces: `sendEmail(env, msg): Promise<{ id: string; status: "logged" | "sent" | "failed" }>` where `msg = { contactId?: string; jobId?: string; kind: string; toEmail: string; subject: string; html: string; text: string }`. Behavior: always inserts a `messages` row. If `env.RESEND_API_KEY` is falsy → status `logged`, no network. If present → POST to Resend, status `sent` (+ provider_id) or `failed` (+ error). Also exports `renderBookingConfirmation(job, contact)` and `renderBookingReminder(job, contact)` returning `{ subject, html, text }`.
- Adds to `Env` (all optional): `RESEND_API_KEY?: string; FROM_EMAIL?: string; FROM_NAME?: string; REPLY_TO?: string; BUSINESS_ADDRESS?: string;`

- [ ] **Step 1: Add optional Env fields.** In `crm/src/types.ts`, inside the `Env` interface, add:

```ts
  RESEND_API_KEY?: string;
  FROM_EMAIL?: string;
  FROM_NAME?: string;
  REPLY_TO?: string;
  BUSINESS_ADDRESS?: string;
```

- [ ] **Step 2: Write the failing tests** — `crm/test/email.test.ts`:

```ts
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { renderBookingConfirmation, sendEmail } from "../src/lib/email";
import { one } from "../src/lib/db";

describe("email fallback", () => {
  it("logs instead of sending when RESEND_API_KEY is unset", async () => {
    // env has no RESEND_API_KEY in tests
    const res = await sendEmail(env, { kind: "transactional", toEmail: "x@example.com", subject: "Hi", html: "<p>Hi</p>", text: "Hi" });
    expect(res.status).toBe("logged");
    const row = await one<{ status: string; to_email: string }>(env.DB, "SELECT status, to_email FROM messages WHERE id = ?", res.id);
    expect(row?.status).toBe("logged");
    expect(row?.to_email).toBe("x@example.com");
  });

  it("renders a booking confirmation with the job details", () => {
    const out = renderBookingConfirmation(
      { title: "Ceramic coating", scheduled_start: "2026-08-01T14:00:00.000Z", address: "123 Ocean Dr", price_cents: 75000 },
      { first_name: "Jorge", last_name: "Zurita" }
    );
    expect(out.subject).toContain("Ceramic coating");
    expect(out.text).toContain("Jorge");
    expect(out.html).toContain("123 Ocean Dr");
  });
});
```

- [ ] **Step 3: Run to verify failure** — `npx vitest run test/email.test.ts` → module not found.

- [ ] **Step 4: Create `crm/src/lib/email.ts`**:

```ts
import type { Env } from "../types";
import { nowIso, run, uuid } from "./db";

export interface OutgoingEmail {
  contactId?: string;
  jobId?: string;
  kind: string; // transactional | reminder | sequence | oneoff
  toEmail: string;
  subject: string;
  html: string;
  text: string;
}

const HOME_TZ = "America/New_York";

function fmtWhen(iso?: string | null): string {
  if (!iso) return "your scheduled time";
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: HOME_TZ, weekday: "long", month: "long", day: "numeric",
      hour: "numeric", minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function dollars(cents?: number): string {
  return "$" + ((Number(cents) || 0) / 100).toFixed(2);
}

interface JobLike { title: string; scheduled_start?: string | null; address?: string | null; price_cents?: number; }
interface ContactLike { first_name?: string | null; last_name?: string | null; }

export function renderBookingConfirmation(job: JobLike, contact: ContactLike): { subject: string; html: string; text: string } {
  const name = contact.first_name || "there";
  const when = fmtWhen(job.scheduled_start);
  const where = job.address ? ` at ${job.address}` : "";
  const price = job.price_cents ? ` (${dollars(job.price_cents)})` : "";
  const subject = `You're booked: ${job.title} — ${when}`;
  const text = `Hi ${name},\n\nYou're confirmed for ${job.title}${price} on ${when}${where}.\n\nWe'll text you when we're on the way. Reply to this email if anything changes.\n\n— BH Car Detailing`;
  const html = `<p>Hi ${name},</p><p>You're confirmed for <strong>${job.title}</strong>${price} on <strong>${when}</strong>${where}.</p><p>We'll text you when we're on the way. Reply to this email if anything changes.</p><p>— BH Car Detailing</p>`;
  return { subject, html, text };
}

export function renderBookingReminder(job: JobLike, contact: ContactLike): { subject: string; html: string; text: string } {
  const name = contact.first_name || "there";
  const when = fmtWhen(job.scheduled_start);
  const where = job.address ? ` at ${job.address}` : "";
  const subject = `Reminder: ${job.title} — ${when}`;
  const text = `Hi ${name},\n\nQuick reminder — your ${job.title} is coming up ${when}${where}. See you then!\n\n— BH Car Detailing`;
  const html = `<p>Hi ${name},</p><p>Quick reminder — your <strong>${job.title}</strong> is coming up <strong>${when}</strong>${where}. See you then!</p><p>— BH Car Detailing</p>`;
  return { subject, html, text };
}

export async function sendEmail(env: Env, msg: OutgoingEmail): Promise<{ id: string; status: "logged" | "sent" | "failed" }> {
  const id = uuid();
  const now = nowIso();
  const insert = (status: string, providerId: string | null, error: string | null, sentAt: string | null) =>
    run(env.DB,
      `INSERT INTO messages (id, contact_id, job_id, kind, to_email, subject, body_html, body_text, provider_id, status, error, created_at, sent_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      id, msg.contactId ?? null, msg.jobId ?? null, msg.kind, msg.toEmail, msg.subject,
      msg.html, msg.text, providerId, status, error, now, sentAt);

  if (!env.RESEND_API_KEY) {
    await insert("logged", null, null, null);
    return { id, status: "logged" };
  }

  try {
    const from = `${env.FROM_NAME ?? "BH Car Detailing"} <${env.FROM_EMAIL ?? "hello@bhcardetails.com"}>`;
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from, to: [msg.toEmail], subject: msg.subject, html: msg.html, text: msg.text,
        reply_to: env.REPLY_TO ? [env.REPLY_TO] : undefined,
      }),
    });
    if (!res.ok) {
      const error = `resend_${res.status}: ${(await res.text()).slice(0, 200)}`;
      await insert("failed", null, error, null);
      return { id, status: "failed" };
    }
    const data = (await res.json()) as { id?: string };
    await insert("sent", data.id ?? null, null, nowIso());
    return { id, status: "sent" };
  } catch (e) {
    await insert("failed", null, String(e).slice(0, 200), null);
    return { id, status: "failed" };
  }
}
```

- [ ] **Step 5: Run full suite — expect pass**, commit:

```bash
cd "/c/Users/Maxwell Berko/Desktop/7-17 Website" && git add crm/src crm/test/email.test.ts && git commit -m "feat(crm): email module with log-only fallback and booking templates

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Booking confirmation on schedule + cron reminders (TDD)

**Files:**
- Create: `crm/src/lib/reminders.ts`, `crm/test/reminders.test.ts`
- Modify: `crm/src/index.ts` (add `scheduled` handler + `POST /api/jobs/:id/confirm` route via jobs.ts), `crm/src/routes/jobs.ts`, `crm/wrangler.jsonc` (cron trigger), `crm/src/routes/agent.ts`, `crm/AGENTS.md`

**Interfaces:**
- Consumes: `sendEmail`, `renderBookingConfirmation`, `renderBookingReminder`, db helpers, `logActivity`.
- Produces:
  - `sendJobConfirmation(env, jobId): Promise<{ status }>` and `runReminders(env, nowMs): Promise<{ sent: number }>` in `crm/src/lib/reminders.ts`. `runReminders` finds jobs with status `scheduled`, `scheduled_start` between `now+110min` and `now+130min` (≈T-2h window) OR between `now+23h` and `now+25h` (≈T-24h window), whose `reminder_sent_at` is null, sends a reminder, stamps `reminder_sent_at`, logs `email_sent`. (Two windows so a 5-min cron never double-fires: guarded by `reminder_sent_at`.)
  - `POST /api/jobs/:id/confirm` (in jobs.ts, behind requireAuth) — sends booking confirmation to the contact's email if present, stamps `confirmation_sent_at`, logs `email_sent`; returns `{ status }`. If contact has no email → `{ status: "skipped_no_email" }`.
  - Worker `scheduled(event, env, ctx)` export calling `runReminders(env, Date.now())`.

- [ ] **Step 1: Write the failing tests** — `crm/test/reminders.test.ts`:

```ts
import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { runReminders } from "../src/lib/reminders";
import { all, one } from "../src/lib/db";

const AUTH = { Authorization: "Bearer dev-agent-key", "Content-Type": "application/json" };

async function contactWithJob(startIso: string, email = "book@x.com") {
  const cid = ((await (await SELF.fetch("http://x/api/contacts", { method: "POST", headers: AUTH, body: JSON.stringify({ first_name: "Book", email }) })).json()) as { id: string }).id;
  const jid = ((await (await SELF.fetch("http://x/api/jobs", { method: "POST", headers: AUTH, body: JSON.stringify({ contact_id: cid, title: "Detail", status: "scheduled", scheduled_start: startIso }) })).json()) as { id: string }).id;
  return { cid, jid };
}

describe("booking confirmation", () => {
  it("sends (logs) a confirmation and stamps confirmation_sent_at", async () => {
    const { jid } = await contactWithJob("2026-09-01T14:00:00.000Z", "conf@x.com");
    const res = await SELF.fetch(`http://x/api/jobs/${jid}/confirm`, { method: "POST", headers: AUTH });
    expect(res.status).toBe(200);
    const job = await one<{ confirmation_sent_at: string }>(env.DB, "SELECT confirmation_sent_at FROM jobs WHERE id = ?", jid);
    expect(job?.confirmation_sent_at).toBeTruthy();
    const msg = await all(env.DB, "SELECT * FROM messages WHERE job_id = ? AND kind = 'transactional'", jid);
    expect(msg.length).toBe(1);
  });

  it("skips confirmation when contact has no email", async () => {
    const cid = ((await (await SELF.fetch("http://x/api/contacts", { method: "POST", headers: AUTH, body: JSON.stringify({ first_name: "NoEmail", phone: "3055550123" }) })).json()) as { id: string }).id;
    const jid = ((await (await SELF.fetch("http://x/api/jobs", { method: "POST", headers: AUTH, body: JSON.stringify({ contact_id: cid, title: "Detail", status: "scheduled", scheduled_start: "2026-09-02T14:00:00.000Z" }) })).json()) as { id: string }).id;
    const res = await SELF.fetch(`http://x/api/jobs/${jid}/confirm`, { method: "POST", headers: AUTH });
    expect(((await res.json()) as { status: string }).status).toBe("skipped_no_email");
  });
});

describe("cron reminders", () => {
  it("sends a reminder for a job ~2h out and does not double-send", async () => {
    const now = Date.parse("2026-09-10T10:00:00.000Z");
    const twoHours = new Date(now + 2 * 3600_000).toISOString();
    const { jid } = await contactWithJob(twoHours, "rem@x.com");
    const first = await runReminders(env, now);
    expect(first.sent).toBeGreaterThanOrEqual(1);
    const job = await one<{ reminder_sent_at: string }>(env.DB, "SELECT reminder_sent_at FROM jobs WHERE id = ?", jid);
    expect(job?.reminder_sent_at).toBeTruthy();
    const second = await runReminders(env, now);
    // the already-reminded job must not fire again
    const msgs = await all(env.DB, "SELECT * FROM messages WHERE job_id = ? AND kind = 'reminder'", jid);
    expect(msgs.length).toBe(1);
    expect(second.sent).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run test/reminders.test.ts` → module/route missing.

- [ ] **Step 3: Create `crm/src/lib/reminders.ts`**:

```ts
import type { Env } from "../types";
import { all, nowIso, one, run } from "./db";
import { logActivity } from "./activity";
import { renderBookingConfirmation, renderBookingReminder, sendEmail } from "./email";

interface JobRow {
  id: string; contact_id: string; title: string; scheduled_start: string | null;
  address: string | null; price_cents: number; reminder_sent_at: string | null;
}
interface ContactRow { id: string; first_name: string | null; last_name: string | null; email: string | null; }

export async function sendJobConfirmation(env: Env, jobId: string): Promise<{ status: string }> {
  const job = await one<JobRow>(env.DB, "SELECT * FROM jobs WHERE id = ?", jobId);
  if (!job) return { status: "not_found" };
  const contact = await one<ContactRow>(env.DB, "SELECT id, first_name, last_name, email FROM contacts WHERE id = ?", job.contact_id);
  if (!contact?.email) return { status: "skipped_no_email" };
  const tpl = renderBookingConfirmation(job, contact);
  const r = await sendEmail(env, { contactId: contact.id, jobId: job.id, kind: "transactional", toEmail: contact.email, subject: tpl.subject, html: tpl.html, text: tpl.text });
  await run(env.DB, "UPDATE jobs SET confirmation_sent_at = ? WHERE id = ?", nowIso(), job.id);
  await logActivity(env.DB, { contactId: contact.id, type: "email_sent", title: `Booking confirmation (${r.status})`, payload: { job_id: job.id, message_id: r.id }, actor: "system" });
  return { status: r.status };
}

export async function runReminders(env: Env, nowMs: number): Promise<{ sent: number }> {
  const lo2 = new Date(nowMs + 110 * 60_000).toISOString();
  const hi2 = new Date(nowMs + 130 * 60_000).toISOString();
  const lo24 = new Date(nowMs + 23 * 3600_000).toISOString();
  const hi24 = new Date(nowMs + 25 * 3600_000).toISOString();
  const jobs = await all<JobRow>(
    env.DB,
    `SELECT * FROM jobs
     WHERE status = 'scheduled' AND reminder_sent_at IS NULL AND scheduled_start IS NOT NULL
       AND ((scheduled_start BETWEEN ? AND ?) OR (scheduled_start BETWEEN ? AND ?))`,
    lo2, hi2, lo24, hi24
  );
  let sent = 0;
  for (const job of jobs) {
    const contact = await one<ContactRow>(env.DB, "SELECT id, first_name, last_name, email FROM contacts WHERE id = ?", job.contact_id);
    // Stamp first (idempotency guard) so an overlapping cron can't double-send.
    await run(env.DB, "UPDATE jobs SET reminder_sent_at = ? WHERE id = ?", nowIso(), job.id);
    if (!contact?.email) continue;
    const tpl = renderBookingReminder(job, contact);
    const r = await sendEmail(env, { contactId: contact.id, jobId: job.id, kind: "reminder", toEmail: contact.email, subject: tpl.subject, html: tpl.html, text: tpl.text });
    await logActivity(env.DB, { contactId: contact.id, type: "email_sent", title: `Job reminder (${r.status})`, payload: { job_id: job.id, message_id: r.id }, actor: "system" });
    sent++;
  }
  return { sent };
}
```

- [ ] **Step 4: Add the confirm route** in `crm/src/routes/jobs.ts` (import `sendJobConfirmation` from `../lib/reminders` at top; add before the `export`... i.e. after the delete route):

```ts
jobRoutes.post("/:id/confirm", async (c) => {
  const { sendJobConfirmation } = await import("../lib/reminders");
  const out = await sendJobConfirmation(c.env, c.req.param("id"));
  return c.json(out, out.status === "not_found" ? 404 : 200);
});
```

- [ ] **Step 5: Add the `scheduled` handler + cron.** Change `crm/src/index.ts`'s default export block from `export default app;` to:

```ts
import { runReminders } from "./lib/reminders";

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runReminders(env, Date.now()).then(() => undefined));
  },
};
```
In `crm/wrangler.jsonc`, add a top-level `"triggers"` key: `"triggers": { "crons": ["*/5 * * * *"] },`.

- [ ] **Step 6: Document + verify.** In `agent.ts` add `{ method: "POST", path: "/api/jobs/:id/confirm", description: "Send the booking confirmation email to the contact; stamps confirmation_sent_at" }`. In `AGENTS.md` add: `Reminders run on a 5-min cron; jobs auto-send a reminder ~2h and ~24h before scheduled_start (guarded by reminder_sent_at). Emails log-only until RESEND_API_KEY is set.` Run full suite — expect pass.

- [ ] **Step 7: Commit**

```bash
cd "/c/Users/Maxwell Berko/Desktop/7-17 Website" && git add crm/src crm/wrangler.jsonc crm/test/reminders.test.ts crm/AGENTS.md && git commit -m "feat(crm): booking confirmation + cron reminders (idempotent, log-safe)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Pipeline UI — mobile-first kanban (with dnd-kit)

**Files:**
- Create: `crm/admin/src/pages/Pipeline.tsx`, `crm/admin/src/lib/stages.ts`
- Modify: `crm/admin/src/App.tsx` (real route), `crm/admin/package.json` (add @dnd-kit deps)

**Interfaces:**
- Consumes: `GET /api/contacts?stage=&limit=`, `PATCH /api/contacts/:id` (stage change).
- Produces: `/pipeline` route. Desktop: horizontal columns, drag cards between them (dnd-kit). Mobile (<md): one stage visible at a time with a segmented stage switcher at top; each card has a "Move ▸" button opening a stage picker (no drag needed — touch-friendly). Both paths PATCH the contact's stage and optimistically update.

- [ ] **Step 1: Add deps.** In `crm/admin/package.json` dependencies add `"@dnd-kit/core": "^6.1.0"` and `"@dnd-kit/sortable": "^8.0.0"`. Run `export PATH="/c/Program Files/nodejs:$PATH" && cd "/c/Users/Maxwell Berko/Desktop/7-17 Website/crm/admin" && npm install`.

- [ ] **Step 2: Create `crm/admin/src/lib/stages.ts`**:

```ts
import type { Stage } from "../types";

export const STAGE_META: { key: Stage; label: string; hint: string }[] = [
  { key: "new", label: "New", hint: "Just arrived" },
  { key: "contacted", label: "Contacted", hint: "Reached out" },
  { key: "quoted", label: "Quoted", hint: "Price sent" },
  { key: "scheduled", label: "Scheduled", hint: "On the calendar" },
  { key: "customer", label: "Customer", hint: "Job done" },
  { key: "lost", label: "Lost", hint: "No deal" },
];
```

- [ ] **Step 3: Create `crm/admin/src/pages/Pipeline.tsx`** — mobile-first (tap-to-move) with desktop drag:

```tsx
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { DndContext, PointerSensor, useSensor, useSensors, useDraggable, useDroppable, type DragEndEvent } from "@dnd-kit/core";
import { api } from "../api";
import { fullName, type Contact, type Stage } from "../types";
import { STAGE_META } from "../lib/stages";

type Board = Record<Stage, Contact[]>;
const empty = (): Board => ({ new: [], contacted: [], quoted: [], scheduled: [], customer: [], lost: [] });

function Card({ c }: { c: Contact }) {
  return (
    <Link to={`/contacts/${c.id}`} className="block rounded-lg border border-neutral-200 bg-white p-3 shadow-sm">
      <div className="font-medium">{fullName(c)}</div>
      <div className="truncate text-xs text-neutral-500">{c.source ?? "—"}</div>
    </Link>
  );
}

function DraggableCard({ c }: { c: Contact }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: c.id });
  const style = transform ? { transform: `translate(${transform.x}px, ${transform.y}px)`, opacity: isDragging ? 0.5 : 1 } : undefined;
  return (
    <div ref={setNodeRef} style={style} {...listeners} {...attributes} className="touch-none">
      <Card c={c} />
    </div>
  );
}

function Column({ stage, items }: { stage: Stage; items: Contact[] }) {
  const { setNodeRef, isOver } = useDroppable({ id: stage });
  const meta = STAGE_META.find((m) => m.key === stage)!;
  return (
    <div ref={setNodeRef} className={`flex w-72 shrink-0 flex-col gap-2 rounded-xl p-2 ${isOver ? "bg-red-50" : "bg-neutral-100"}`}>
      <div className="px-1 text-sm font-semibold">{meta.label} <span className="text-neutral-400">{items.length}</span></div>
      {items.map((c) => <DraggableCard key={c.id} c={c} />)}
    </div>
  );
}

export default function Pipeline() {
  const [board, setBoard] = useState<Board>(empty());
  const [mobileStage, setMobileStage] = useState<Stage>("new");
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const load = useCallback(() => {
    Promise.all(STAGE_META.map((m) =>
      api<{ items: Contact[] }>(`/api/contacts?stage=${m.key}&limit=100`).then((r) => [m.key, r.items] as const)
    )).then((pairs) => {
      const b = empty();
      for (const [k, items] of pairs) b[k] = items;
      setBoard(b);
    }).catch(() => {});
  }, []);
  useEffect(load, [load]);

  async function move(contactId: string, from: Stage, to: Stage) {
    if (from === to) return;
    setBoard((b) => {
      const card = b[from].find((c) => c.id === contactId);
      if (!card) return b;
      return { ...b, [from]: b[from].filter((c) => c.id !== contactId), [to]: [{ ...card, stage: to }, ...b[to]] };
    });
    try {
      await api(`/api/contacts/${contactId}`, { method: "PATCH", body: JSON.stringify({ stage: to }) });
    } catch {
      load(); // revert to server truth on failure
    }
  }

  function onDragEnd(e: DragEndEvent) {
    const to = e.over?.id as Stage | undefined;
    const contactId = e.active.id as string;
    if (!to) return;
    const from = (Object.keys(board) as Stage[]).find((s) => board[s].some((c) => c.id === contactId));
    if (from) move(contactId, from, to);
  }

  return (
    <div className="p-4 md:p-8">
      <h1 className="mb-4 text-2xl font-semibold">Pipeline</h1>

      {/* Mobile: segmented switcher + tap-to-move */}
      <div className="md:hidden">
        <div className="mb-3 flex gap-1 overflow-x-auto pb-1">
          {STAGE_META.map((m) => (
            <button key={m.key} onClick={() => setMobileStage(m.key)}
              className={`whitespace-nowrap rounded-full px-3 py-2 text-sm ${mobileStage === m.key ? "bg-red-600 text-white" : "bg-neutral-200 text-neutral-700"}`}>
              {m.label} <span className="opacity-70">{board[m.key].length}</span>
            </button>
          ))}
        </div>
        <div className="flex flex-col gap-2">
          {board[mobileStage].map((c) => (
            <div key={c.id} className="rounded-lg border border-neutral-200 bg-white p-3 shadow-sm">
              <div className="flex items-center justify-between gap-2">
                <Link to={`/contacts/${c.id}`} className="min-w-0"><div className="truncate font-medium">{fullName(c)}</div><div className="truncate text-xs text-neutral-500">{c.source ?? "—"}</div></Link>
                <select value={c.stage} onChange={(e) => move(c.id, c.stage, e.target.value as Stage)}
                  className="min-h-[44px] rounded-md border border-neutral-300 px-2 text-sm">
                  {STAGE_META.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
                </select>
              </div>
            </div>
          ))}
          {board[mobileStage].length === 0 && <p className="text-sm text-neutral-500">No one here yet.</p>}
        </div>
      </div>

      {/* Desktop: draggable columns */}
      <div className="hidden md:block">
        <DndContext sensors={sensors} onDragEnd={onDragEnd}>
          <div className="flex gap-3 overflow-x-auto pb-4">
            {STAGE_META.map((m) => <Column key={m.key} stage={m.key} items={board[m.key]} />)}
          </div>
        </DndContext>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Wire the route.** In `App.tsx` replace the `/pipeline` `<Soon…>` route with `import Pipeline from "./pages/Pipeline";` and `<Route path="/pipeline" element={<Pipeline />} />`.

- [ ] **Step 5: Build + verify.** `npm run build` in crm/admin (tsc strict must pass). Report bundle result. (No worker change → don't re-run vitest.)

- [ ] **Step 6: Commit**

```bash
cd "/c/Users/Maxwell Berko/Desktop/7-17 Website" && git add crm/admin && git commit -m "feat(crm): mobile-first pipeline board (tap-to-move + desktop drag)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: Calendar UI — mobile agenda + desktop week

**Files:**
- Create: `crm/admin/src/pages/Calendar.tsx`, `crm/admin/src/lib/datetime.ts`
- Modify: `crm/admin/src/App.tsx`, `crm/admin/src/types.ts` (add Job type)

**Interfaces:**
- Consumes: `GET /api/jobs?from=&to=`, `PATCH /api/jobs/:id`, `POST /api/jobs/:id/confirm`.
- Produces: `/calendar` route. Mobile (<md): a scrollable **agenda list** grouped by day (this is the primary, most usable phone view). Desktop (≥md): a 7-day week grid with jobs placed by day; click a job to open a drawer to reschedule (date+time inputs) and send confirmation. `Job` type added to types.ts.

- [ ] **Step 1: Add the `Job` type** to `crm/admin/src/types.ts`:

```ts
export interface Job {
  id: string;
  contact_id: string;
  title: string;
  status: string;
  price_cents: number;
  scheduled_start: string | null;
  scheduled_end: string | null;
  address: string | null;
  first_name?: string | null;
  last_name?: string | null;
  phone?: string | null;
}
```

- [ ] **Step 2: Create `crm/admin/src/lib/datetime.ts`** (TZ-aware display helpers, dependency-free):

```ts
const TZ = "America/New_York";

export function startOfWeek(d = new Date()): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - x.getDay()); // Sunday start
  return x;
}

export function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

export function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function dayLabel(d: Date): string {
  return new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric" }).format(d);
}

export function timeLabel(iso: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" }).format(new Date(iso));
}

/** True if the job's scheduled_start falls on calendar day `d` (local). */
export function isOnDay(iso: string | null, d: Date): boolean {
  if (!iso) return false;
  const j = new Date(iso);
  return j.getFullYear() === d.getFullYear() && j.getMonth() === d.getMonth() && j.getDate() === d.getDate();
}
```

- [ ] **Step 3: Create `crm/admin/src/pages/Calendar.tsx`**:

```tsx
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { fullName, type Job } from "../types";
import { addDays, dayLabel, isOnDay, startOfWeek, timeLabel, ymd } from "../lib/datetime";

const STATUS_COLOR: Record<string, string> = {
  quoted: "bg-amber-100 text-amber-800",
  scheduled: "bg-blue-100 text-blue-800",
  in_progress: "bg-purple-100 text-purple-800",
  completed: "bg-green-100 text-green-800",
  paid: "bg-emerald-100 text-emerald-800",
  cancelled: "bg-neutral-200 text-neutral-500",
  draft: "bg-neutral-100 text-neutral-600",
};

function JobChip({ job, onClick }: { job: Job; onClick: () => void }) {
  return (
    <button onClick={onClick} className={`w-full rounded-md px-2 py-1 text-left text-xs ${STATUS_COLOR[job.status] ?? "bg-neutral-100"}`}>
      <div className="font-medium">{job.scheduled_start ? timeLabel(job.scheduled_start) : "—"} · {job.title}</div>
      <div className="truncate opacity-80">{fullName({ first_name: job.first_name ?? null, last_name: job.last_name ?? null })}</div>
    </button>
  );
}

export default function Calendar() {
  const [weekStart, setWeekStart] = useState(() => startOfWeek());
  const [jobs, setJobs] = useState<Job[]>([]);
  const [selected, setSelected] = useState<Job | null>(null);
  const [when, setWhen] = useState("");
  const [msg, setMsg] = useState("");

  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  const load = useCallback(() => {
    const from = ymd(weekStart);
    const to = ymd(addDays(weekStart, 6));
    api<{ items: Job[] }>(`/api/jobs?from=${from}&to=${to}`).then((r) => setJobs(r.items)).catch(() => {});
  }, [weekStart]);
  useEffect(load, [load]);

  function openJob(job: Job) {
    setSelected(job);
    setMsg("");
    setWhen(job.scheduled_start ? job.scheduled_start.slice(0, 16) : "");
  }

  async function reschedule() {
    if (!selected || !when) return;
    setMsg("");
    try {
      const iso = new Date(when).toISOString();
      await api(`/api/jobs/${selected.id}`, { method: "PATCH", body: JSON.stringify({ status: "scheduled", scheduled_start: iso }) });
      setMsg("Saved. Send the customer a confirmation?");
      load();
      setSelected({ ...selected, scheduled_start: iso });
    } catch {
      setMsg("Couldn't save — try again.");
    }
  }

  async function sendConfirmation() {
    if (!selected) return;
    try {
      const r = (await api(`/api/jobs/${selected.id}/confirm`, { method: "POST" })) as { status: string };
      setMsg(r.status === "sent" ? "Confirmation sent." : r.status === "logged" ? "Logged (email goes live once Resend is set up)." : r.status === "skipped_no_email" ? "No email on file for this customer." : `Status: ${r.status}`);
    } catch {
      setMsg("Couldn't send — try again.");
    }
  }

  return (
    <div className="p-4 md:p-8">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Calendar</h1>
        <div className="flex gap-2">
          <button onClick={() => setWeekStart(addDays(weekStart, -7))} className="min-h-[44px] rounded-md bg-neutral-200 px-3">‹</button>
          <button onClick={() => setWeekStart(startOfWeek())} className="min-h-[44px] rounded-md bg-neutral-200 px-3 text-sm">Today</button>
          <button onClick={() => setWeekStart(addDays(weekStart, 7))} className="min-h-[44px] rounded-md bg-neutral-200 px-3">›</button>
        </div>
      </div>

      {/* Mobile agenda */}
      <div className="space-y-4 md:hidden">
        {days.map((d) => {
          const dayJobs = jobs.filter((j) => isOnDay(j.scheduled_start, d));
          return (
            <div key={ymd(d)}>
              <div className="mb-1 text-sm font-semibold text-neutral-600">{dayLabel(d)}</div>
              {dayJobs.length === 0 ? <div className="text-xs text-neutral-400">—</div> :
                <div className="space-y-1">{dayJobs.map((j) => <JobChip key={j.id} job={j} onClick={() => openJob(j)} />)}</div>}
            </div>
          );
        })}
      </div>

      {/* Desktop week grid */}
      <div className="hidden grid-cols-7 gap-2 md:grid">
        {days.map((d) => {
          const dayJobs = jobs.filter((j) => isOnDay(j.scheduled_start, d));
          return (
            <div key={ymd(d)} className="min-h-40 rounded-lg bg-neutral-100 p-2">
              <div className="mb-2 text-xs font-semibold text-neutral-600">{dayLabel(d)}</div>
              <div className="space-y-1">{dayJobs.map((j) => <JobChip key={j.id} job={j} onClick={() => openJob(j)} />)}</div>
            </div>
          );
        })}
      </div>

      {/* Job drawer */}
      {selected && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 md:items-center" onClick={() => setSelected(null)}>
          <div className="w-full max-w-md rounded-t-2xl bg-white p-5 md:rounded-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-start justify-between">
              <div>
                <h2 className="text-lg font-semibold">{selected.title}</h2>
                <Link to={`/contacts/${selected.contact_id}`} className="text-sm text-red-600 hover:underline">{fullName({ first_name: selected.first_name ?? null, last_name: selected.last_name ?? null })}</Link>
              </div>
              <button onClick={() => setSelected(null)} className="min-h-[44px] px-2 text-neutral-400">✕</button>
            </div>
            <label className="mb-1 block text-sm text-neutral-600">Scheduled start</label>
            <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} className="mb-3 min-h-[44px] w-full rounded-md border border-neutral-300 px-3" />
            <div className="flex flex-wrap gap-2">
              <button onClick={reschedule} className="min-h-[44px] flex-1 rounded-md bg-neutral-900 px-4 text-white">Save time</button>
              <button onClick={sendConfirmation} className="min-h-[44px] flex-1 rounded-md bg-red-600 px-4 text-white">Send confirmation</button>
            </div>
            {selected.phone && <a href={`sms:${selected.phone}`} className="mt-2 block min-h-[44px] rounded-md bg-neutral-200 px-4 py-3 text-center text-sm">Text {selected.phone}</a>}
            {msg && <p className="mt-3 text-sm text-neutral-600">{msg}</p>}
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Wire the route** in `App.tsx`: replace `/calendar` `<Soon…>` with `import Calendar from "./pages/Calendar";` and `<Route path="/calendar" element={<Calendar />} />`.

- [ ] **Step 5: Build + verify** — `npm run build` (tsc strict). Report result.

- [ ] **Step 6: Commit**

```bash
cd "/c/Users/Maxwell Berko/Desktop/7-17 Website" && git add crm/admin && git commit -m "feat(crm): calendar — mobile agenda + desktop week, reschedule + confirm

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: Jobs on the contact detail + create-job flow

**Files:**
- Modify: `crm/admin/src/pages/ContactDetail.tsx`

**Interfaces:**
- Consumes: `GET /api/jobs?contact_id=`, `POST /api/jobs`, `PATCH /api/jobs/:id`.
- Produces: a "Jobs & Quotes" section on the contact page listing the contact's jobs (title, status pill, price, date) with a "＋ New quote/job" form (title, price in dollars → cents, optional date). Each job row lets you advance status via a select. Fully touch-friendly.

- [ ] **Step 1: Add jobs state + fetch to `ContactDetail.tsx`.** After the existing `activities` state, add `const [jobs, setJobs] = useState<Job[]>([]);` (import `Job` from `../types`), and in the `load` callback add `api<{ items: Job[] }>(\`/api/jobs?contact_id=${id}\`).then((r) => setJobs(r.items)).catch(() => {});`.

- [ ] **Step 2: Add the Jobs section UI** — insert this block in the left column, between the Vehicles section and the Timeline section:

```tsx
        <section className="rounded-xl bg-white p-5 shadow-sm">
          <h2 className="mb-3 font-medium">Jobs & Quotes</h2>
          <NewJob contactId={id!} onCreated={load} />
          {jobs.length === 0 ? (
            <p className="mt-3 text-sm text-neutral-500">No jobs yet.</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {jobs.map((j) => (
                <li key={j.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-neutral-200 p-3">
                  <div className="min-w-0">
                    <div className="font-medium">{j.title}</div>
                    <div className="text-xs text-neutral-500">
                      ${(j.price_cents / 100).toFixed(2)}{j.scheduled_start ? ` · ${new Date(j.scheduled_start).toLocaleString()}` : ""}
                    </div>
                  </div>
                  <select value={j.status} onChange={async (e) => { await api(`/api/jobs/${j.id}`, { method: "PATCH", body: JSON.stringify({ status: e.target.value }) }); load(); }}
                    className="min-h-[44px] rounded-md border border-neutral-300 px-2 text-sm capitalize">
                    {["draft","quoted","scheduled","in_progress","completed","paid","cancelled"].map((s) => <option key={s} value={s}>{s.replace("_"," ")}</option>)}
                  </select>
                </li>
              ))}
            </ul>
          )}
        </section>
```

- [ ] **Step 3: Add the `NewJob` component** at the bottom of `ContactDetail.tsx` (below the default export function):

```tsx
function NewJob({ contactId, onCreated }: { contactId: string; onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [price, setPrice] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setBusy(true); setErr("");
    try {
      await api("/api/jobs", { method: "POST", body: JSON.stringify({
        contact_id: contactId, title: title.trim(), status: "quoted",
        price_cents: Math.round((parseFloat(price) || 0) * 100),
      }) });
      setTitle(""); setPrice(""); setOpen(false); onCreated();
    } catch { setErr("Couldn't save — try again."); }
    finally { setBusy(false); }
  }

  if (!open) return <button onClick={() => setOpen(true)} className="min-h-[44px] rounded-md bg-neutral-900 px-4 text-sm text-white">＋ New quote / job</button>;
  return (
    <form onSubmit={submit} className="space-y-2">
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Ceramic coating" className="min-h-[44px] w-full rounded-md border border-neutral-300 px-3 text-sm" autoFocus />
      <input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" placeholder="Price (e.g. 750)" className="min-h-[44px] w-full rounded-md border border-neutral-300 px-3 text-sm" />
      <div className="flex gap-2">
        <button disabled={busy} className="min-h-[44px] flex-1 rounded-md bg-red-600 px-4 text-sm text-white disabled:opacity-50">{busy ? "Saving…" : "Save quote"}</button>
        <button type="button" onClick={() => setOpen(false)} className="min-h-[44px] rounded-md bg-neutral-200 px-4 text-sm">Cancel</button>
      </div>
      {err && <p className="text-sm text-red-600">{err}</p>}
    </form>
  );
}
```

- [ ] **Step 4: Build + verify** — `npm run build` (tsc strict). Report result.

- [ ] **Step 5: Commit**

```bash
cd "/c/Users/Maxwell Berko/Desktop/7-17 Website" && git add crm/admin && git commit -m "feat(crm): jobs and quote creation on the contact page

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 10: Dashboard — today's jobs + due tasks; stats endpoint extension

**Files:**
- Modify: `crm/src/routes/contacts.ts` (extend `/api/stats`), `crm/admin/src/pages/Dashboard.tsx`, `crm/admin/src/types.ts`
- Test: `crm/test/stats-phase2.test.ts`

**Interfaces:**
- Consumes: jobs/tasks tables.
- Produces: `/api/stats` response gains `todayJobs: Job[]` (status scheduled|in_progress with scheduled_start today, in server TZ approximated by UTC date match on the `HOME_TZ` day) and `openTasks: Array<{id,title,due_at,contact_id,first_name,last_name}>` (status open, ordered by due_at, limit 10). Dashboard renders both as new sections above "New leads". `Stats` type extended.

- [ ] **Step 1: Write the failing test** — `crm/test/stats-phase2.test.ts`:

```ts
import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

const AUTH = { Authorization: "Bearer dev-agent-key", "Content-Type": "application/json" };

describe("stats phase 2", () => {
  it("returns todayJobs and openTasks arrays", async () => {
    const res = await SELF.fetch("http://x/api/stats", { headers: AUTH });
    const s = (await res.json()) as { todayJobs: unknown[]; openTasks: unknown[]; byStage: Record<string, number> };
    expect(Array.isArray(s.todayJobs)).toBe(true);
    expect(Array.isArray(s.openTasks)).toBe(true);
    expect(typeof s.byStage.new).toBe("number");
  });

  it("surfaces an open task", async () => {
    await SELF.fetch("http://x/api/tasks", { method: "POST", headers: AUTH, body: JSON.stringify({ title: "Dash task", due_at: "2026-08-01T12:00:00.000Z" }) });
    const s = (await (await SELF.fetch("http://x/api/stats", { headers: AUTH })).json()) as { openTasks: Array<{ title: string }> };
    expect(s.openTasks.some((t) => t.title === "Dash task")).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run test/stats-phase2.test.ts` → todayJobs undefined.

- [ ] **Step 3: Extend the stats handler** in `crm/src/routes/contacts.ts`. Replace the final `return c.json({ byStage, recent });` with:

```ts
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
```

- [ ] **Step 4: Extend the `Stats` type** in `crm/admin/src/types.ts` — add to the `Stats` interface:

```ts
  todayJobs: Array<{ id: string; title: string; status: string; scheduled_start: string | null; contact_id: string; first_name: string | null; last_name: string | null; phone: string | null }>;
  openTasks: Array<{ id: string; title: string; due_at: string | null; contact_id: string | null; first_name: string | null; last_name: string | null }>;
```

- [ ] **Step 5: Render the sections** in `crm/admin/src/pages/Dashboard.tsx` — insert directly after the stage-tiles `<div>` grid and before the "New leads needing action" section:

```tsx
      {(stats?.todayJobs?.length ?? 0) > 0 && (
        <section>
          <h2 className="mb-3 text-lg font-medium">Today's jobs</h2>
          <ul className="divide-y rounded-xl bg-white shadow-sm">
            {stats!.todayJobs.map((j) => (
              <li key={j.id} className="flex items-center justify-between gap-3 p-3 text-sm">
                <Link to={`/contacts/${j.contact_id}`} className="min-w-0">
                  <span className="font-medium">{j.title}</span>{" "}
                  <span className="text-neutral-500">{[j.first_name, j.last_name].filter(Boolean).join(" ")}</span>
                </Link>
                <span className="shrink-0 text-neutral-500">{j.scheduled_start ? new Date(j.scheduled_start).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : ""}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {(stats?.openTasks?.length ?? 0) > 0 && (
        <section>
          <h2 className="mb-3 text-lg font-medium">Due tasks</h2>
          <ul className="divide-y rounded-xl bg-white shadow-sm">
            {stats!.openTasks.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-3 p-3 text-sm">
                <span className="min-w-0"><span className="font-medium">{t.title}</span>{t.contact_id && <span className="text-neutral-500"> · {[t.first_name, t.last_name].filter(Boolean).join(" ")}</span>}</span>
                <span className="shrink-0 text-neutral-400">{t.due_at ? new Date(t.due_at).toLocaleDateString() : ""}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
```

- [ ] **Step 6: Run worker tests + build admin — expect pass.** `npx vitest run` from crm; `npm run build` from crm/admin.

- [ ] **Step 7: Commit**

```bash
cd "/c/Users/Maxwell Berko/Desktop/7-17 Website" && git add crm/src crm/admin crm/test/stats-phase2.test.ts && git commit -m "feat(crm): dashboard today's jobs + due tasks; stats extended

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 11: Deploy Phase 2 to production

Not user-gated (account already connected from Phase 1). Runs via the existing wrangler permission.

- [ ] **Step 1: Apply migration 0002 to production** — `export PATH="/c/Program Files/nodejs:$PATH" && cd "/c/Users/Maxwell Berko/Desktop/7-17 Website/crm" && npx wrangler d1 migrations apply bh-crm --remote`. Expect `0002_jobs_tasks.sql` applied.
- [ ] **Step 2: Build admin** — `cd crm/admin && npm run build` (outputs to `crm/public`).
- [ ] **Step 3: Deploy** — `cd crm && npx wrangler deploy`. Note the cron trigger registers (`*/5 * * * *`). Verify: `curl https://bh-crm.bhcardetails.workers.dev/api/health` → ok (via the browser tool if curl is blocked). Confirm the deploy output lists "Cron Triggers".
- [ ] **Step 4: Live smoke via browser** — open `bh-crm.bhcardetails.workers.dev`, log in, confirm Pipeline and Calendar pages load and the bottom nav appears at mobile width (resize the browser or use responsive mode). Create a test quote on a contact; move a card in Pipeline; confirm it persists on reload. Delete test data.
- [ ] **Step 5: Commit any config changes** (wrangler.jsonc cron) if not already committed, then update `.superpowers/sdd/progress.md` with Phase 2 completion.

---

## Self-Review (completed during plan writing)

- **Spec coverage (Phase 2, spec §13):** kanban → Task 7; jobs → Tasks 2–3, 9; calendar UI → Task 8; booking confirmation/reminder emails → Tasks 5–6; tasks → Tasks 4, 10. Mobile-first (new cross-cutting req) → Task 1 (shell + Phase 1 pass) and enforced in every UI task's constraints.
- **Type consistency:** `JOB_STATUSES` (7 values) identical between jobs.ts (Task 3) and the UI selects (Tasks 8–9); `Job` type shape (Task 8) matches the jobs API SELECT columns (Task 3); `sendEmail`/`renderBooking*` signatures identical between Task 5 (definition) and Task 6 (consumer); stats response additions (Task 10 server) match the `Stats` type additions (Task 10 client).
- **Placeholder scan:** none — the `<Soon>` placeholder in Task 1 is explicitly replaced in Tasks 7–8, and the D1 id/config already exist from Phase 1.
- **Fallback safety:** every email path (Tasks 5, 6, 8) tolerates a missing RESEND_API_KEY and never fails a test or a user action; the Calendar's "Send confirmation" surfaces the `logged` status to the user in plain words.
