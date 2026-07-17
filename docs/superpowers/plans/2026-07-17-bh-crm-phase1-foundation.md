# BH CRM Phase 1 (Foundation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Leads submitted on bhcardetails.com flow into a self-owned Cloudflare Worker + D1 backend with auth, a contacts/activities data core, an agent API, a minimal admin UI, and the 142 HubSpot contacts migrated in.

**Architecture:** Single Cloudflare Worker (TypeScript + Hono) serving a JSON API; D1 (SQLite) via raw prepared statements; React+Vite admin SPA added late in the phase and served as static assets by the same Worker. Local-first: everything develops and tests under `wrangler dev`/vitest with no Cloudflare account until the deploy task.

**Tech Stack:** Hono ^4, wrangler ^4, D1, Vitest + @cloudflare/vitest-pool-workers, React 18 + Vite + Tailwind v4 (admin), TypeScript strict.

**Spec:** `docs/superpowers/specs/2026-07-17-bh-crm-design.md` (approved). This plan is Phase 1 of 4; Phases 2–4 get their own plans.

## Global Constraints

- **PATH:** Node is NOT on the session PATH. Every Bash command using node/npm/npx MUST start with: `export PATH="/c/Program Files/nodejs:$PATH" && `
- **Working dir:** all crm commands run from `C:\Users\Maxwell Berko\Desktop\7-17 Website\crm` (`cd "/c/Users/Maxwell Berko/Desktop/7-17 Website/crm"` in Bash).
- **Stage enum (exact, from spec):** `new|contacted|quoted|scheduled|customer|lost`.
- **Activity types (core vocabulary, spec §4):** `form_submitted|note|call_logged|sms_logged|stage_changed|import` — column is TEXT (open vocabulary), core list documented in AGENTS.md.
- **Timestamps:** ISO-8601 UTC strings. **IDs:** `crypto.randomUUID()`.
- **Runtime deps:** `hono` only. Dev deps only those listed in Task 1. No ORM — raw prepared statements.
- **Secrets:** never committed. Dev values in `crm/.dev.vars` (covered by root `.gitignore` pattern `.dev.vars`).
- **compatibility_date:** `"2026-07-01"`.
- **Commit after every task**, message ending with:
  `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
- If `npm install` reports a peer-dependency conflict between vitest and @cloudflare/vitest-pool-workers, install the exact vitest version the pool package requests — the pool's requirement wins.

---

### Task 1: Baseline commit + project scaffold with working test toolchain

**Files:**
- Create: `crm/package.json`, `crm/wrangler.jsonc`, `crm/tsconfig.json`, `crm/vitest.config.ts`, `crm/.dev.vars`, `crm/src/index.ts`, `crm/src/types.ts`, `crm/test/apply-migrations.ts`, `crm/test/env.d.ts`, `crm/test/health.test.ts`, `crm/migrations/.gitkeep`
- Modify: none

**Interfaces:**
- Produces: `Env` interface (src/types.ts) — every later task's handlers use `Hono<{ Bindings: Env }>`; the Hono app default-exported from `src/index.ts`; a working `npx vitest run` cycle with D1 migrations auto-applied.

- [ ] **Step 1: Baseline-commit the existing site** (so the later cut-over diff is clean)

```bash
cd "/c/Users/Maxwell Berko/Desktop/7-17 Website" && git add -A && git commit -m "baseline: existing static site

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```
Expected: commit created listing index.html, areas/*, js/main.js, assets, etc.

- [ ] **Step 2: Create `crm/package.json`**

```json
{
  "name": "bh-crm",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "test": "vitest run",
    "migrate:local": "wrangler d1 migrations apply bh-crm --local"
  },
  "dependencies": {
    "hono": "^4.6.0"
  },
  "devDependencies": {
    "@cloudflare/vitest-pool-workers": "^0.9.0",
    "@cloudflare/workers-types": "^4.20260701.0",
    "typescript": "^5.6.0",
    "vitest": "~3.2.0",
    "wrangler": "^4.0.0"
  }
}
```

- [ ] **Step 3: Create `crm/wrangler.jsonc`** (no assets block yet — that arrives with the admin UI in Task 9)

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "bh-crm",
  "main": "src/index.ts",
  "compatibility_date": "2026-07-01",
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "bh-crm",
      "database_id": "00000000-0000-0000-0000-000000000000", // placeholder — replaced by real id at deploy (Task 12)
      "migrations_dir": "migrations"
    }
  ],
  "vars": {
    "ALLOWED_ORIGINS": "http://localhost:4173,http://127.0.0.1:4173",
    "HOME_TZ": "America/New_York"
  },
  "observability": { "enabled": true }
}
```

- [ ] **Step 4: Create `crm/.dev.vars`** (dev-only secrets; gitignored)

```
ADMIN_PASSWORD=dev-password
SESSION_SECRET=dev-session-secret-change-me-0123456789
AGENT_API_KEY=dev-agent-key
```

- [ ] **Step 5: Create `crm/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "types": ["@cloudflare/workers-types", "@cloudflare/vitest-pool-workers"],
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "isolatedModules": true
  },
  "include": ["src/**/*.ts", "test/**/*.ts"]
}
```

- [ ] **Step 6: Create `crm/src/types.ts`**

```ts
export interface Env {
  DB: D1Database;
  ASSETS?: Fetcher;
  ADMIN_PASSWORD: string;
  SESSION_SECRET: string;
  AGENT_API_KEY: string;
  ALLOWED_ORIGINS: string;
  HOME_TZ: string;
}

export const STAGES = ["new", "contacted", "quoted", "scheduled", "customer", "lost"] as const;
export type Stage = (typeof STAGES)[number];
```

- [ ] **Step 7: Create `crm/src/index.ts`** (health route only for now)

```ts
import { Hono } from "hono";
import type { Env } from "./types";

const app = new Hono<{ Bindings: Env }>();

app.get("/api/health", (c) => c.json({ ok: true, ts: new Date().toISOString() }));

export default app;
```

- [ ] **Step 8: Create the vitest harness.** `crm/vitest.config.ts`:

```ts
import path from "node:path";
import { defineWorkersConfig, readD1Migrations } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig(async () => {
  const migrations = await readD1Migrations(path.join(__dirname, "migrations"));
  return {
    test: {
      setupFiles: ["./test/apply-migrations.ts"],
      poolOptions: {
        workers: {
          singleWorker: true,
          wrangler: { configPath: "./wrangler.jsonc" },
          miniflare: { bindings: { TEST_MIGRATIONS: migrations } },
        },
      },
    },
  };
});
```

`crm/test/apply-migrations.ts`:

```ts
import { applyD1Migrations, env } from "cloudflare:test";

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
```

`crm/test/env.d.ts`:

```ts
import type { Env } from "../src/types";

declare module "cloudflare:test" {
  interface ProvidedEnv extends Env {
    TEST_MIGRATIONS: D1Migration[];
  }
}
```

`crm/migrations/.gitkeep`: empty file (readD1Migrations needs the directory to exist).

- [ ] **Step 9: Write the failing smoke test** — `crm/test/health.test.ts`

```ts
import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("health", () => {
  it("responds ok", async () => {
    const res = await SELF.fetch("http://x/api/health");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });
});
```

- [ ] **Step 10: Install and run**

```bash
export PATH="/c/Program Files/nodejs:$PATH" && cd "/c/Users/Maxwell Berko/Desktop/7-17 Website/crm" && npm install && npx vitest run
```
Expected: install succeeds; vitest reports `1 passed`. (First run downloads workerd — allow a minute.)

- [ ] **Step 11: Commit**

```bash
cd "/c/Users/Maxwell Berko/Desktop/7-17 Website" && git add crm && git commit -m "feat(crm): scaffold Worker + vitest toolchain with health route

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Schema migration 0001 + db helpers

**Files:**
- Create: `crm/migrations/0001_init.sql`, `crm/src/lib/db.ts`
- Test: `crm/test/schema.test.ts`

**Interfaces:**
- Produces: tables `contacts, vehicles, activities, custom_field_defs, settings, rl_events`; helpers `uuid(): string`, `nowIso(): string`, `one<T>(db, sql, ...binds): Promise<T|null>`, `all<T>(db, sql, ...binds): Promise<T[]>`, `run(db, sql, ...binds): Promise<D1Result>` from `src/lib/db.ts`. All later tasks use these.

- [ ] **Step 1: Write the failing test** — `crm/test/schema.test.ts`

```ts
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { all, one, run, uuid, nowIso } from "../src/lib/db";

describe("schema", () => {
  it("has all phase-1 tables", async () => {
    const rows = await all<{ name: string }>(
      env.DB,
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    );
    const names = rows.map((r) => r.name);
    for (const t of ["contacts", "vehicles", "activities", "custom_field_defs", "settings", "rl_events"]) {
      expect(names).toContain(t);
    }
  });

  it("inserts and reads a contact via helpers", async () => {
    const id = uuid();
    const now = nowIso();
    await run(env.DB, "INSERT INTO contacts (id, first_name, stage, created_at, updated_at) VALUES (?,?,?,?,?)",
      id, "Test", "new", now, now);
    const row = await one<{ id: string; stage: string; tags: string }>(
      env.DB, "SELECT id, stage, tags FROM contacts WHERE id = ?", id);
    expect(row?.stage).toBe("new");
    expect(row?.tags).toBe("[]"); // default applied
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
export PATH="/c/Program Files/nodejs:$PATH" && cd "/c/Users/Maxwell Berko/Desktop/7-17 Website/crm" && npx vitest run test/schema.test.ts
```
Expected: FAIL — cannot resolve `../src/lib/db` / no tables.

- [ ] **Step 3: Create `crm/migrations/0001_init.sql`** (delete `migrations/.gitkeep` in the same step)

```sql
CREATE TABLE contacts (
  id TEXT PRIMARY KEY,
  first_name TEXT,
  last_name TEXT,
  email TEXT,
  phone TEXT,
  address TEXT,
  city TEXT,
  area_slug TEXT,
  stage TEXT NOT NULL DEFAULT 'new',
  source TEXT,
  source_detail TEXT,
  tags TEXT NOT NULL DEFAULT '[]',
  custom TEXT NOT NULL DEFAULT '{}',
  email_opt_in INTEGER NOT NULL DEFAULT 1,
  email_opt_in_at TEXT,
  sms_opt_in INTEGER NOT NULL DEFAULT 0,
  replied_flag INTEGER NOT NULL DEFAULT 0,
  ai_summary TEXT,
  ai_next_action TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_activity_at TEXT
);
CREATE INDEX idx_contacts_email ON contacts(email);
CREATE INDEX idx_contacts_phone ON contacts(phone);
CREATE INDEX idx_contacts_stage ON contacts(stage);

CREATE TABLE vehicles (
  id TEXT PRIMARY KEY,
  contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  year INTEGER,
  make TEXT,
  model TEXT,
  color TEXT,
  size_class TEXT NOT NULL DEFAULT 'other',
  notes TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_vehicles_contact ON vehicles(contact_id);

CREATE TABLE activities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  payload TEXT,
  actor TEXT NOT NULL DEFAULT 'system',
  created_at TEXT NOT NULL
);
CREATE INDEX idx_activities_contact ON activities(contact_id, id DESC);

CREATE TABLE custom_field_defs (
  key TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'text',
  options TEXT,
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE rl_events (
  bucket TEXT NOT NULL,
  ts INTEGER NOT NULL
);
CREATE INDEX idx_rl ON rl_events(bucket, ts);
```

- [ ] **Step 4: Create `crm/src/lib/db.ts`**

```ts
export const uuid = (): string => crypto.randomUUID();
export const nowIso = (): string => new Date().toISOString();

export async function one<T = Record<string, unknown>>(
  db: D1Database, sql: string, ...binds: unknown[]
): Promise<T | null> {
  return ((await db.prepare(sql).bind(...binds).first<T>()) ?? null);
}

export async function all<T = Record<string, unknown>>(
  db: D1Database, sql: string, ...binds: unknown[]
): Promise<T[]> {
  const r = await db.prepare(sql).bind(...binds).all<T>();
  return r.results;
}

export async function run(db: D1Database, sql: string, ...binds: unknown[]) {
  return db.prepare(sql).bind(...binds).run();
}
```

- [ ] **Step 5: Run tests — expect pass**

```bash
export PATH="/c/Program Files/nodejs:$PATH" && cd "/c/Users/Maxwell Berko/Desktop/7-17 Website/crm" && npx vitest run
```
Expected: schema + health tests PASS.

- [ ] **Step 6: Commit**

```bash
cd "/c/Users/Maxwell Berko/Desktop/7-17 Website" && git add crm && git commit -m "feat(crm): phase-1 schema migration and db helpers

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Normalization library (TDD)

**Files:**
- Create: `crm/src/lib/normalize.ts`
- Test: `crm/test/normalize.test.ts`

**Interfaces:**
- Produces: `normalizeEmail(raw?: string|null): string|null`, `normalizePhone(raw?: string|null): string|null` (E.164), `cleanName(raw?: string|null): string|null`, `vehicleSizeClass(raw?: string|null): "sedan"|"suv"|"truck"|"van"|"exotic"|"other"`. Used by lead capture (Task 5), contacts API (Task 6), bulk import (Task 7), HubSpot migration (Task 13).

- [ ] **Step 1: Write the failing tests** — `crm/test/normalize.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { normalizeEmail, normalizePhone, cleanName, vehicleSizeClass } from "../src/lib/normalize";

describe("normalizeEmail", () => {
  it("lowercases and trims", () => expect(normalizeEmail("  Bob@Email.COM ")).toBe("bob@email.com"));
  it("rejects non-emails", () => expect(normalizeEmail("not-an-email")).toBeNull());
  it("passes empty through as null", () => expect(normalizeEmail("")).toBeNull());
});

describe("normalizePhone", () => {
  it("US 10-digit gets +1", () => expect(normalizePhone("(917) 783-1038")).toBe("+19177831038"));
  it("11-digit with 1 keeps it", () => expect(normalizePhone("1 917 783 1038")).toBe("+19177831038"));
  it("international with + kept as digits", () => expect(normalizePhone("+44 20 7946 0958")).toBe("+442079460958"));
  it("garbage is null", () => expect(normalizePhone("123")).toBeNull());
});

describe("cleanName", () => {
  it("collapses whitespace", () => expect(cleanName("  Jorge   Zurita ")).toBe("Jorge Zurita"));
  it("title-cases ALLCAPS", () => expect(cleanName("JORGE ZURITA")).toBe("Jorge Zurita"));
  it("leaves mixed case alone", () => expect(cleanName("Dvori Rosenfeld")).toBe("Dvori Rosenfeld"));
});

describe("vehicleSizeClass — the site's exact select options", () => {
  it("maps sedan option", () => expect(vehicleSizeClass("Sedan / Coupe / Convertible")).toBe("sedan"));
  it("maps suv option", () => expect(vehicleSizeClass("SUV / Truck")).toBe("suv"));
  it("maps exotic option", () => expect(vehicleSizeClass("Exotic / Luxury")).toBe("exotic"));
  it("unknown is other", () => expect(vehicleSizeClass("boat")).toBe("other"));
});
```

- [ ] **Step 2: Run to verify failure**

```bash
export PATH="/c/Program Files/nodejs:$PATH" && cd "/c/Users/Maxwell Berko/Desktop/7-17 Website/crm" && npx vitest run test/normalize.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Create `crm/src/lib/normalize.ts`**

```ts
export function normalizeEmail(raw?: string | null): string | null {
  if (!raw) return null;
  const e = raw.trim().toLowerCase();
  return e.includes("@") && e.length >= 5 ? e : null;
}

export function normalizePhone(raw?: string | null): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return "+1" + digits;
  if (digits.length === 11 && digits.startsWith("1")) return "+" + digits;
  if (raw.trim().startsWith("+") && digits.length >= 8 && digits.length <= 15) return "+" + digits;
  return null;
}

export function cleanName(raw?: string | null): string | null {
  if (!raw) return null;
  const n = raw.replace(/\s+/g, " ").trim();
  if (!n) return null;
  if (n === n.toUpperCase() || n === n.toLowerCase()) {
    return n
      .split(" ")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join(" ");
  }
  return n;
}

export function vehicleSizeClass(
  raw?: string | null
): "sedan" | "suv" | "truck" | "van" | "exotic" | "other" {
  const v = (raw ?? "").toLowerCase();
  if (v.includes("exotic") || v.includes("luxury")) return "exotic";
  if (v.includes("suv") || v.includes("crossover")) return "suv";
  if (v.includes("van")) return "van";
  if (v.includes("truck")) return "truck";
  if (v.includes("sedan") || v.includes("coupe") || v.includes("convertible")) return "sedan";
  return "other";
}
```

- [ ] **Step 4: Run tests — expect pass**

```bash
export PATH="/c/Program Files/nodejs:$PATH" && cd "/c/Users/Maxwell Berko/Desktop/7-17 Website/crm" && npx vitest run
```
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
cd "/c/Users/Maxwell Berko/Desktop/7-17 Website" && git add crm && git commit -m "feat(crm): email/phone/name/vehicle normalization

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Auth — sessions, login/logout, unified admin+agent guard (TDD)

**Files:**
- Create: `crm/src/lib/auth.ts`, `crm/src/routes/auth.ts`
- Modify: `crm/src/index.ts`
- Test: `crm/test/auth.test.ts`

**Interfaces:**
- Consumes: `one/run` from `src/lib/db.ts`; `Env` from `src/types.ts`.
- Produces: `requireAuth(): MiddlewareHandler<{ Bindings: Env }>` — accepts a valid `bh_session` cookie OR `Authorization: Bearer <AGENT_API_KEY>`; `signSession(secret, expiresAtMs): Promise<string>`; `verifySession(secret, cookieVal?): Promise<boolean>`; `timingSafeEqualStr(a, b): Promise<boolean>`; routes `POST /api/auth/login` (body `{password}`; 5 attempts / 15 min / IP), `POST /api/auth/logout`. Every protected route in Tasks 5–10 mounts `requireAuth()`.

- [ ] **Step 1: Write the failing tests** — `crm/test/auth.test.ts`

```ts
import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { signSession, verifySession } from "../src/lib/auth";

describe("session signing", () => {
  it("round-trips a valid session", async () => {
    const cookie = await signSession("secret-a", Date.now() + 60_000);
    expect(await verifySession("secret-a", cookie)).toBe(true);
  });
  it("rejects wrong secret", async () => {
    const cookie = await signSession("secret-a", Date.now() + 60_000);
    expect(await verifySession("secret-b", cookie)).toBe(false);
  });
  it("rejects expired", async () => {
    const cookie = await signSession("secret-a", Date.now() - 1000);
    expect(await verifySession("secret-a", cookie)).toBe(false);
  });
  it("rejects tampered expiry", async () => {
    const cookie = await signSession("secret-a", Date.now() + 60_000);
    const [, mac] = cookie.split(".");
    expect(await verifySession("secret-a", `${Date.now() + 9_999_999}.${mac}`)).toBe(false);
  });
});

describe("login endpoint", () => {
  it("rejects bad password with 401", async () => {
    const res = await SELF.fetch("http://x/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "wrong" }),
    });
    expect(res.status).toBe(401);
  });
  it("accepts ADMIN_PASSWORD and sets cookie", async () => {
    const res = await SELF.fetch("http://x/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "dev-password" }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("Set-Cookie")).toContain("bh_session=");
  });
});

describe("requireAuth", () => {
  it("blocks /api/contacts without credentials", async () => {
    const res = await SELF.fetch("http://x/api/contacts");
    expect(res.status).toBe(401);
  });
  it("allows agent bearer token", async () => {
    const res = await SELF.fetch("http://x/api/contacts", {
      headers: { Authorization: "Bearer dev-agent-key" },
    });
    expect(res.status).not.toBe(401);
  });
});
```
Note: the `requireAuth` tests need a protected `/api/contacts` route to exist. Mount a placeholder in this task (Step 3) that Task 6 replaces: `app.get("/api/contacts", requireAuth(), (c) => c.json({ items: [], total: 0 }))`.

Note: tests read secrets from `.dev.vars` (`dev-password`, `dev-agent-key`) — vitest-pool-workers loads it via the wrangler config automatically.

- [ ] **Step 2: Run to verify failure**

```bash
export PATH="/c/Program Files/nodejs:$PATH" && cd "/c/Users/Maxwell Berko/Desktop/7-17 Website/crm" && npx vitest run test/auth.test.ts
```
Expected: FAIL — modules not found / 404s.

- [ ] **Step 3: Implement.** `crm/src/lib/auth.ts`:

```ts
import type { MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";
import type { Env } from "../types";

const enc = new TextEncoder();

async function hmacHex(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Constant-time-ish string compare: hash both sides, compare digests. */
export async function timingSafeEqualStr(a: string, b: string): Promise<boolean> {
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(a)),
    crypto.subtle.digest("SHA-256", enc.encode(b)),
  ]);
  const va = new Uint8Array(ha);
  const vb = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < va.length; i++) diff |= va[i] ^ vb[i];
  return diff === 0;
}

export async function signSession(secret: string, expiresAtMs: number): Promise<string> {
  return `${expiresAtMs}.${await hmacHex(secret, "session:" + expiresAtMs)}`;
}

export async function verifySession(secret: string, cookieVal?: string): Promise<boolean> {
  if (!cookieVal) return false;
  const dot = cookieVal.indexOf(".");
  if (dot < 1) return false;
  const exp = Number(cookieVal.slice(0, dot));
  if (!Number.isFinite(exp) || exp < Date.now()) return false;
  const expected = await hmacHex(secret, "session:" + exp);
  return timingSafeEqualStr(cookieVal.slice(dot + 1), expected);
}

export function requireAuth(): MiddlewareHandler<{ Bindings: Env }> {
  return async (c, next) => {
    const bearer = c.req.header("Authorization");
    if (bearer?.startsWith("Bearer ") && (await timingSafeEqualStr(bearer.slice(7), c.env.AGENT_API_KEY))) {
      return next();
    }
    if (await verifySession(c.env.SESSION_SECRET, getCookie(c, "bh_session"))) return next();
    return c.json({ error: "unauthorized" }, 401);
  };
}

export async function loginRateLimited(db: D1Database, ip: string): Promise<boolean> {
  const cutoff = Date.now() - 15 * 60 * 1000;
  const row = await db
    .prepare("SELECT COUNT(*) AS n FROM rl_events WHERE bucket = ? AND ts > ?")
    .bind("login:" + ip, cutoff)
    .first<{ n: number }>();
  return (row?.n ?? 0) >= 5;
}

export async function recordAttempt(db: D1Database, bucket: string): Promise<void> {
  await db.prepare("INSERT INTO rl_events (bucket, ts) VALUES (?, ?)").bind(bucket, Date.now()).run();
}
```

`crm/src/routes/auth.ts`:

```ts
import { Hono } from "hono";
import { setCookie } from "hono/cookie";
import type { Env } from "../types";
import { loginRateLimited, recordAttempt, signSession, timingSafeEqualStr } from "../lib/auth";

export const authRoutes = new Hono<{ Bindings: Env }>();

authRoutes.post("/login", async (c) => {
  const ip = c.req.header("CF-Connecting-IP") ?? "local";
  if (await loginRateLimited(c.env.DB, ip)) return c.json({ error: "too_many_attempts" }, 429);

  const body = await c.req.json<{ password?: string }>().catch(() => ({}) as { password?: string });
  if (!body.password || !(await timingSafeEqualStr(body.password, c.env.ADMIN_PASSWORD))) {
    await recordAttempt(c.env.DB, "login:" + ip);
    return c.json({ error: "invalid_password" }, 401);
  }

  const exp = Date.now() + 30 * 24 * 3600 * 1000;
  setCookie(c, "bh_session", await signSession(c.env.SESSION_SECRET, exp), {
    httpOnly: true,
    secure: true, // browsers accept Secure cookies on localhost
    sameSite: "Lax",
    path: "/",
    maxAge: 30 * 24 * 3600,
  });
  return c.json({ ok: true });
});

authRoutes.post("/logout", (c) => {
  setCookie(c, "bh_session", "", { httpOnly: true, secure: true, sameSite: "Lax", path: "/", maxAge: 0 });
  return c.json({ ok: true });
});
```

Modify `crm/src/index.ts` to:

```ts
import { Hono } from "hono";
import type { Env } from "./types";
import { authRoutes } from "./routes/auth";
import { requireAuth } from "./lib/auth";

const app = new Hono<{ Bindings: Env }>();

app.get("/api/health", (c) => c.json({ ok: true, ts: new Date().toISOString() }));
app.route("/api/auth", authRoutes);

// placeholder — replaced with real contacts routes in Task 6
app.get("/api/contacts", requireAuth(), (c) => c.json({ items: [], total: 0 }));

export default app;
```

- [ ] **Step 4: Run tests — expect pass**

```bash
export PATH="/c/Program Files/nodejs:$PATH" && cd "/c/Users/Maxwell Berko/Desktop/7-17 Website/crm" && npx vitest run
```
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
cd "/c/Users/Maxwell Berko/Desktop/7-17 Website" && git add crm && git commit -m "feat(crm): session auth, login/logout, unified admin+agent guard

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Activity logger + public lead-capture endpoint (TDD)

**Files:**
- Create: `crm/src/lib/activity.ts`, `crm/src/routes/public.ts`
- Modify: `crm/src/index.ts`
- Test: `crm/test/lead.test.ts`

**Interfaces:**
- Consumes: db helpers, normalize functions, `Env`.
- Produces: `logActivity(db, { contactId, type, title, payload?, actor? }): Promise<void>` (inserts activity + bumps `contacts.last_activity_at` and `updated_at`) from `src/lib/activity.ts`; routes `POST /api/lead` and `OPTIONS /api/lead` (CORS from `env.ALLOWED_ORIGINS`). `GET /api/health` moves into `routes/public.ts`.

**Endpoint contract (used verbatim by the site JS in Task 11):**
Request JSON: `{ name, phone, email, vehicle, message?, source, source_detail, ts, website }` — `ts` is epoch-ms when the page loaded (REQUIRED; absent/younger than 2s ⇒ treated as spam), `website` is the honeypot (non-empty ⇒ spam). Spam and rate-limited requests get `{ ok: true }` with nothing stored (bots learn nothing). Real requests require email OR phone after normalization, else 400 `{ ok: false, error: "contact_info_required" }`. Dedupe: normalized email match first, then phone; merge fills ONLY blank fields and never overwrites. Every stored submission logs a `form_submitted` activity. New contacts: `stage='new'`, `email_opt_in=1` + `email_opt_in_at`, `area_slug` derived from `source_detail` like `/areas/<slug>.html`. Vehicle string creates a `vehicles` row (`size_class` via `vehicleSizeClass`, raw string in `notes`) unless an identical-notes vehicle already exists for the contact. Rate limit: 10 stored submissions/hour/IP via `rl_events` bucket `lead:<ip>`.

- [ ] **Step 1: Write the failing tests** — `crm/test/lead.test.ts`

```ts
import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { all, one } from "../src/lib/db";

const ORIGIN = "http://localhost:4173";

function leadBody(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    name: "JORGE ZURITA",
    phone: "(917) 555-0100",
    email: "  Jorge@Example.COM ",
    vehicle: "SUV / Truck",
    message: "Need a full detail",
    source: "hero-quote",
    source_detail: "/index.html",
    ts: Date.now() - 5000,
    website: "",
    ...overrides,
  });
}

const post = (body: string) =>
  SELF.fetch("http://x/api/lead", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: ORIGIN },
    body,
  });

describe("POST /api/lead", () => {
  it("stores a normalized contact + vehicle + activity", async () => {
    const res = await post(leadBody());
    expect(res.status).toBe(200);
    const contact = await one<Record<string, unknown>>(
      env.DB, "SELECT * FROM contacts WHERE email = ?", "jorge@example.com");
    expect(contact).not.toBeNull();
    expect(contact!.first_name).toBe("Jorge");
    expect(contact!.last_name).toBe("Zurita");
    expect(contact!.phone).toBe("+19175550100");
    expect(contact!.stage).toBe("new");
    expect(contact!.email_opt_in).toBe(1);
    const vehicles = await all(env.DB, "SELECT * FROM vehicles WHERE contact_id = ?", contact!.id);
    expect(vehicles.length).toBe(1);
    expect((vehicles[0] as { size_class: string }).size_class).toBe("suv");
    const acts = await all(env.DB, "SELECT * FROM activities WHERE contact_id = ?", contact!.id);
    expect(acts.some((a) => (a as { type: string }).type === "form_submitted")).toBe(true);
  });

  it("dedupes on email and fills blanks without overwriting", async () => {
    await post(leadBody({ email: "dupe@example.com", phone: "" , name: "Ana"}));
    await post(leadBody({ email: "dupe@example.com", phone: "(305) 555-0101", name: "Ana Maria Lopez" }));
    const rows = await all(env.DB, "SELECT * FROM contacts WHERE email = ?", "dupe@example.com");
    expect(rows.length).toBe(1);
    const c = rows[0] as { first_name: string; phone: string };
    expect(c.first_name).toBe("Ana"); // not overwritten
    expect(c.phone).toBe("+13055550101"); // blank filled
  });

  it("honeypot pretends success and stores nothing", async () => {
    const res = await post(leadBody({ email: "bot@example.com", website: "http://spam.example" }));
    expect(res.status).toBe(200);
    expect(await one(env.DB, "SELECT id FROM contacts WHERE email = ?", "bot@example.com")).toBeNull();
  });

  it("too-fast submission (ts < 2s ago) stores nothing", async () => {
    await post(leadBody({ email: "fast@example.com", ts: Date.now() }));
    expect(await one(env.DB, "SELECT id FROM contacts WHERE email = ?", "fast@example.com")).toBeNull();
  });

  it("missing ts stores nothing", async () => {
    await post(leadBody({ email: "nots@example.com", ts: undefined }));
    expect(await one(env.DB, "SELECT id FROM contacts WHERE email = ?", "nots@example.com")).toBeNull();
  });

  it("requires email or phone", async () => {
    const res = await post(leadBody({ email: "", phone: "" }));
    expect(res.status).toBe(400);
  });

  it("derives area_slug from area pages", async () => {
    await post(leadBody({ email: "brickell@example.com", source: "area:brickell", source_detail: "/areas/brickell.html" }));
    const c = await one<{ area_slug: string }>(
      env.DB, "SELECT area_slug FROM contacts WHERE email = ?", "brickell@example.com");
    expect(c?.area_slug).toBe("brickell");
  });

  it("answers CORS preflight for the allowed origin", async () => {
    const res = await SELF.fetch("http://x/api/lead", {
      method: "OPTIONS",
      headers: { Origin: ORIGIN, "Access-Control-Request-Method": "POST" },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN);
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
export PATH="/c/Program Files/nodejs:$PATH" && cd "/c/Users/Maxwell Berko/Desktop/7-17 Website/crm" && npx vitest run test/lead.test.ts
```
Expected: FAIL — 404 on /api/lead.

- [ ] **Step 3: Implement.** `crm/src/lib/activity.ts`:

```ts
import { nowIso, run } from "./db";

export interface ActivityInput {
  contactId: string;
  type: string;
  title: string;
  payload?: unknown;
  actor?: string;
}

export async function logActivity(db: D1Database, a: ActivityInput): Promise<void> {
  const now = nowIso();
  await run(
    db,
    "INSERT INTO activities (contact_id, type, title, payload, actor, created_at) VALUES (?,?,?,?,?,?)",
    a.contactId, a.type, a.title, a.payload ? JSON.stringify(a.payload) : null, a.actor ?? "system", now
  );
  await run(db, "UPDATE contacts SET last_activity_at = ?, updated_at = ? WHERE id = ?", now, now, a.contactId);
}
```

`crm/src/routes/public.ts`:

```ts
import { Hono } from "hono";
import type { Context } from "hono";
import type { Env } from "../types";
import { nowIso, one, run, uuid } from "../lib/db";
import { cleanName, normalizeEmail, normalizePhone, vehicleSizeClass } from "../lib/normalize";
import { logActivity } from "../lib/activity";

export const publicRoutes = new Hono<{ Bindings: Env }>();

function corsHeaders(c: Context<{ Bindings: Env }>): Record<string, string> {
  const origin = c.req.header("Origin");
  const allowed = c.env.ALLOWED_ORIGINS.split(",").map((s) => s.trim());
  if (origin && allowed.includes(origin)) {
    return {
      "Access-Control-Allow-Origin": origin,
      Vary: "Origin",
      "Access-Control-Allow-Headers": "Content-Type",
    };
  }
  return {};
}

publicRoutes.get("/health", (c) => c.json({ ok: true, ts: nowIso() }));

publicRoutes.options("/lead", (c) =>
  new Response(null, {
    status: 204,
    headers: { ...corsHeaders(c), "Access-Control-Allow-Methods": "POST, OPTIONS" },
  })
);

publicRoutes.post("/lead", async (c) => {
  const h = corsHeaders(c);
  const body = await c.req.json<Record<string, unknown>>().catch(() => null);
  if (!body) return c.json({ ok: false, error: "bad_json" }, 400, h);

  // Spam checks — pretend success so bots learn nothing.
  const ts = Number(body.ts);
  if (typeof body.website === "string" && body.website !== "") return c.json({ ok: true }, 200, h);
  if (!Number.isFinite(ts) || Date.now() - ts < 2000) return c.json({ ok: true }, 200, h);

  // Rate limit: 10 stored submissions / hour / IP.
  const ip = c.req.header("CF-Connecting-IP") ?? "local";
  const cutoff = Date.now() - 3600_000;
  const rl = await one<{ n: number }>(
    c.env.DB, "SELECT COUNT(*) AS n FROM rl_events WHERE bucket = ? AND ts > ?", "lead:" + ip, cutoff);
  if ((rl?.n ?? 0) >= 10) return c.json({ ok: true }, 200, h);

  const email = normalizeEmail(body.email as string | undefined);
  const phone = normalizePhone(body.phone as string | undefined);
  if (!email && !phone) return c.json({ ok: false, error: "contact_info_required" }, 400, h);

  await run(c.env.DB, "INSERT INTO rl_events (bucket, ts) VALUES (?, ?)", "lead:" + ip, Date.now());

  const name = cleanName(body.name as string | undefined);
  const [first, ...rest] = (name ?? "").split(" ");
  const last = rest.join(" ");
  const source = typeof body.source === "string" ? body.source.slice(0, 50) : "website";
  const sourceDetail = typeof body.source_detail === "string" ? body.source_detail.slice(0, 200) : null;
  const now = nowIso();

  let contact = email
    ? await one<{ id: string }>(c.env.DB, "SELECT id FROM contacts WHERE email = ?", email)
    : null;
  if (!contact && phone) {
    contact = await one<{ id: string }>(c.env.DB, "SELECT id FROM contacts WHERE phone = ?", phone);
  }

  let contactId: string;
  let created = false;
  if (contact) {
    contactId = contact.id;
    await run(
      c.env.DB,
      `UPDATE contacts SET
         first_name = COALESCE(first_name, ?), last_name = COALESCE(last_name, ?),
         email = COALESCE(email, ?), phone = COALESCE(phone, ?), updated_at = ?
       WHERE id = ?`,
      first || null, last || null, email, phone, now, contactId
    );
  } else {
    created = true;
    contactId = uuid();
    const m = sourceDetail?.match(/\/areas\/([a-z-]+)\.html/);
    await run(
      c.env.DB,
      `INSERT INTO contacts
         (id, first_name, last_name, email, phone, area_slug, stage, source, source_detail,
          email_opt_in, email_opt_in_at, created_at, updated_at)
       VALUES (?,?,?,?,?,?,'new',?,?,1,?,?,?)`,
      contactId, first || null, last || null, email, phone, m?.[1] ?? null, source, sourceDetail, now, now, now
    );
  }

  const vehicleRaw = typeof body.vehicle === "string" ? body.vehicle.trim() : "";
  if (vehicleRaw) {
    const existing = await one<{ id: string }>(
      c.env.DB, "SELECT id FROM vehicles WHERE contact_id = ? AND notes = ?", contactId, vehicleRaw);
    if (!existing) {
      await run(
        c.env.DB,
        "INSERT INTO vehicles (id, contact_id, size_class, notes, created_at) VALUES (?,?,?,?,?)",
        uuid(), contactId, vehicleSizeClass(vehicleRaw), vehicleRaw, now
      );
    }
  }

  await logActivity(c.env.DB, {
    contactId,
    type: "form_submitted",
    title: created ? `New lead via ${source}` : `Repeat submission via ${source}`,
    payload: { source, source_detail: sourceDetail, message: body.message ?? null, vehicle: vehicleRaw || null },
  });

  return c.json({ ok: true }, 200, h);
});
```

Modify `crm/src/index.ts` — replace the inline health route with the public router:

```ts
import { Hono } from "hono";
import type { Env } from "./types";
import { authRoutes } from "./routes/auth";
import { publicRoutes } from "./routes/public";
import { requireAuth } from "./lib/auth";

const app = new Hono<{ Bindings: Env }>();

app.route("/api", publicRoutes); // /api/health, /api/lead
app.route("/api/auth", authRoutes);

// placeholder — replaced with real contacts routes in Task 6
app.get("/api/contacts", requireAuth(), (c) => c.json({ items: [], total: 0 }));

export default app;
```

- [ ] **Step 4: Run tests — expect pass**

```bash
export PATH="/c/Program Files/nodejs:$PATH" && cd "/c/Users/Maxwell Berko/Desktop/7-17 Website/crm" && npx vitest run
```
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
cd "/c/Users/Maxwell Berko/Desktop/7-17 Website" && git add crm && git commit -m "feat(crm): activity logger and public lead-capture endpoint with CORS, honeypot, dedupe

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Contacts API — CRUD, search, stats (TDD)

**Files:**
- Create: `crm/src/routes/contacts.ts`
- Modify: `crm/src/index.ts` (remove placeholder, mount router)
- Test: `crm/test/contacts.test.ts`

**Interfaces:**
- Consumes: db helpers, normalize, `logActivity`, `requireAuth`, `STAGES`.
- Produces (all behind `requireAuth()`):
  - `GET /api/contacts?search=&stage=&source=&tag=&limit=&offset=` → `{ items: ContactRow[], total: number }` (items include `vehicle_count`); search is a LIKE over first/last/email/phone; default limit 50, max 200.
  - `POST /api/contacts` body `{ first_name?, last_name?, email?, phone?, address?, city?, stage?, source?, tags?, custom? }` → 201 `{ id }` — normalizes email/phone, rejects invalid stage with 400 `{ error: "invalid_stage" }`.
  - `GET /api/contacts/:id` → full row + `vehicles: []` + parsed `tags`/`custom`, or 404.
  - `PATCH /api/contacts/:id` — partial update over allowlist `first_name,last_name,email,phone,address,city,area_slug,stage,source,source_detail,tags,custom,email_opt_in,sms_opt_in,replied_flag,ai_summary,ai_next_action`; `custom` shallow-merges; `tags` replaces; a `stage` change logs a `stage_changed` activity with payload `{from, to}` and actor `human` (or `agent` when bearer-authed).
  - `DELETE /api/contacts/:id` → cascades vehicles/activities (FK), 200 `{ ok: true }`.
  - `GET /api/stats` → `{ byStage: Record<Stage, number>, recent: Array<{id,type,title,created_at,contact_id,first_name,last_name}> }` (20 most recent activities joined to names).

- [ ] **Step 1: Write the failing tests** — `crm/test/contacts.test.ts`

```ts
import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

const AUTH = { Authorization: "Bearer dev-agent-key", "Content-Type": "application/json" };

async function createContact(body: Record<string, unknown>) {
  const res = await SELF.fetch("http://x/api/contacts", {
    method: "POST", headers: AUTH, body: JSON.stringify(body),
  });
  return res;
}

describe("contacts CRUD", () => {
  it("creates then fetches a contact with normalized fields", async () => {
    const res = await createContact({ first_name: "maria", last_name: "garcia", email: "Maria@X.com", phone: "3055550123" });
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: string };
    const got = await SELF.fetch(`http://x/api/contacts/${id}`, { headers: AUTH });
    const c = (await got.json()) as Record<string, unknown>;
    expect(c.email).toBe("maria@x.com");
    expect(c.phone).toBe("+13055550123");
    expect(c.stage).toBe("new");
    expect(Array.isArray(c.vehicles)).toBe(true);
  });

  it("rejects invalid stage", async () => {
    const res = await createContact({ first_name: "Bad", stage: "vip" });
    expect(res.status).toBe(400);
  });

  it("PATCH stage logs a stage_changed activity", async () => {
    const { id } = (await (await createContact({ first_name: "Stager", email: "stager@x.com" })).json()) as { id: string };
    const res = await SELF.fetch(`http://x/api/contacts/${id}`, {
      method: "PATCH", headers: AUTH, body: JSON.stringify({ stage: "contacted" }),
    });
    expect(res.status).toBe(200);
    const acts = await SELF.fetch(`http://x/api/contacts/${id}/activities`, { headers: AUTH });
    const list = (await acts.json()) as { items: Array<{ type: string; payload: string }> };
    const sc = list.items.find((a) => a.type === "stage_changed");
    expect(sc).toBeTruthy();
    expect(JSON.parse(sc!.payload)).toEqual({ from: "new", to: "contacted" });
  });

  it("PATCH custom shallow-merges", async () => {
    const { id } = (await (await createContact({ first_name: "Cust", email: "cust@x.com", custom: { referral: "yes" } })).json()) as { id: string };
    await SELF.fetch(`http://x/api/contacts/${id}`, {
      method: "PATCH", headers: AUTH, body: JSON.stringify({ custom: { gate_code: "1234" } }),
    });
    const c = (await (await SELF.fetch(`http://x/api/contacts/${id}`, { headers: AUTH })).json()) as { custom: Record<string, string> };
    expect(c.custom).toEqual({ referral: "yes", gate_code: "1234" });
  });

  it("search finds by partial name", async () => {
    await createContact({ first_name: "Zebulon", last_name: "Quartermain", email: "zq@x.com" });
    const res = await SELF.fetch("http://x/api/contacts?search=zebul", { headers: AUTH });
    const { items, total } = (await res.json()) as { items: unknown[]; total: number };
    expect(total).toBe(1);
    expect(items.length).toBe(1);
  });

  it("stats counts by stage", async () => {
    await createContact({ first_name: "S1", email: "s1@x.com" });
    const res = await SELF.fetch("http://x/api/stats", { headers: AUTH });
    const stats = (await res.json()) as { byStage: Record<string, number>; recent: unknown[] };
    expect(stats.byStage.new).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(stats.recent)).toBe(true);
  });

  it("DELETE removes the contact", async () => {
    const { id } = (await (await createContact({ first_name: "Gone", email: "gone@x.com" })).json()) as { id: string };
    await SELF.fetch(`http://x/api/contacts/${id}`, { method: "DELETE", headers: AUTH });
    const got = await SELF.fetch(`http://x/api/contacts/${id}`, { headers: AUTH });
    expect(got.status).toBe(404);
  });
});
```
Note: the activities-list endpoint (`GET /api/contacts/:id/activities`) is implemented in this task too (the stage test needs it): returns `{ items }` ordered newest-first, limit 100.

- [ ] **Step 2: Run to verify failure**

```bash
export PATH="/c/Program Files/nodejs:$PATH" && cd "/c/Users/Maxwell Berko/Desktop/7-17 Website/crm" && npx vitest run test/contacts.test.ts
```
Expected: FAIL — 404s / placeholder returns empty.

- [ ] **Step 3: Implement `crm/src/routes/contacts.ts`**

```ts
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
  const b = await c.req.json<Record<string, unknown>>().catch(() => ({}));
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
  const b = await c.req.json<Record<string, unknown>>().catch(() => ({}));

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
  return c.json({ byStage, recent });
});
```

Modify `crm/src/index.ts` — remove the placeholder route, mount routers:

```ts
import { Hono } from "hono";
import type { Env } from "./types";
import { authRoutes } from "./routes/auth";
import { publicRoutes } from "./routes/public";
import { contactRoutes, statsRoutes } from "./routes/contacts";

const app = new Hono<{ Bindings: Env }>();

app.route("/api", publicRoutes);
app.route("/api/auth", authRoutes);
app.route("/api/contacts", contactRoutes);
app.route("/api/stats", statsRoutes);

export default app;
```

- [ ] **Step 4: Run full suite — expect pass** (auth test's placeholder expectation still holds: bearer on /api/contacts is not 401)

```bash
export PATH="/c/Program Files/nodejs:$PATH" && cd "/c/Users/Maxwell Berko/Desktop/7-17 Website/crm" && npx vitest run
```
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
cd "/c/Users/Maxwell Berko/Desktop/7-17 Website" && git add crm && git commit -m "feat(crm): contacts CRUD, search, activities list, stats

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Activities write, custom fields, bulk import (TDD)

**Files:**
- Create: `crm/src/routes/misc.ts`
- Modify: `crm/src/index.ts`
- Test: `crm/test/misc.test.ts`

**Interfaces:**
- Consumes: everything above.
- Produces (behind `requireAuth()`):
  - `POST /api/contacts/:id/activities` body `{ type, title, payload? }` — type must be one of `note|call_logged|sms_logged` for manual logging; actor from auth mode. Returns 201.
  - `GET /api/custom-fields` → `{ items }`; `POST /api/custom-fields` body `{ key, label, type, options?, sort? }` (key: `^[a-z0-9_]{1,40}$`; type one of `text|number|select|date|checkbox`; 409 on duplicate); `DELETE /api/custom-fields/:key`.
  - `POST /api/contacts/bulk` body `{ contacts: Array<{ first_name?, last_name?, email?, phone?, address?, city?, stage?, source?, tags?, custom?, vehicle? }> }` (max 200/batch) → `{ created, merged, errors: Array<{index, error}> }`. Same dedupe/fill-blanks semantics as /api/lead; each stored row logs an `import` activity; `vehicle` string creates a vehicles row. Used by HubSpot migration (Task 13).

- [ ] **Step 1: Write the failing tests** — `crm/test/misc.test.ts`

```ts
import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

const AUTH = { Authorization: "Bearer dev-agent-key", "Content-Type": "application/json" };

describe("manual activities", () => {
  it("logs a note", async () => {
    const { id } = (await (await SELF.fetch("http://x/api/contacts", {
      method: "POST", headers: AUTH, body: JSON.stringify({ first_name: "Notey", email: "notey@x.com" }),
    })).json()) as { id: string };
    const res = await SELF.fetch(`http://x/api/contacts/${id}/activities`, {
      method: "POST", headers: AUTH, body: JSON.stringify({ type: "note", title: "Called, left VM" }),
    });
    expect(res.status).toBe(201);
    const list = (await (await SELF.fetch(`http://x/api/contacts/${id}/activities`, { headers: AUTH })).json()) as { items: Array<{ type: string; actor: string }> };
    const note = list.items.find((a) => a.type === "note");
    expect(note?.actor).toBe("agent");
  });

  it("rejects unknown manual type", async () => {
    const { id } = (await (await SELF.fetch("http://x/api/contacts", {
      method: "POST", headers: AUTH, body: JSON.stringify({ first_name: "T", email: "t-act@x.com" }),
    })).json()) as { id: string };
    const res = await SELF.fetch(`http://x/api/contacts/${id}/activities`, {
      method: "POST", headers: AUTH, body: JSON.stringify({ type: "email_sent", title: "nope" }),
    });
    expect(res.status).toBe(400);
  });
});

describe("custom fields", () => {
  it("creates, lists, rejects dupes, deletes", async () => {
    const make = () => SELF.fetch("http://x/api/custom-fields", {
      method: "POST", headers: AUTH,
      body: JSON.stringify({ key: "gate_code", label: "Gate code", type: "text" }),
    });
    expect((await make()).status).toBe(201);
    expect((await make()).status).toBe(409);
    const list = (await (await SELF.fetch("http://x/api/custom-fields", { headers: AUTH })).json()) as { items: Array<{ key: string }> };
    expect(list.items.some((f) => f.key === "gate_code")).toBe(true);
    expect((await SELF.fetch("http://x/api/custom-fields/gate_code", { method: "DELETE", headers: AUTH })).status).toBe(200);
  });

  it("rejects bad key", async () => {
    const res = await SELF.fetch("http://x/api/custom-fields", {
      method: "POST", headers: AUTH, body: JSON.stringify({ key: "Bad Key!", label: "x", type: "text" }),
    });
    expect(res.status).toBe(400);
  });
});

describe("bulk import", () => {
  it("creates and merges with per-row errors", async () => {
    const res = await SELF.fetch("http://x/api/contacts/bulk", {
      method: "POST", headers: AUTH,
      body: JSON.stringify({
        contacts: [
          { first_name: "Bulk", last_name: "One", email: "bulk1@x.com", source: "hubspot-import", vehicle: "SUV / Truck" },
          { first_name: "Bulk", email: "bulk1@x.com", phone: "3055550188" }, // merges into row 1
          { first_name: "NoContactInfo" }, // error row
        ],
      }),
    });
    expect(res.status).toBe(200);
    const out = (await res.json()) as { created: number; merged: number; errors: Array<{ index: number }> };
    expect(out.created).toBe(1);
    expect(out.merged).toBe(1);
    expect(out.errors.length).toBe(1);
    expect(out.errors[0].index).toBe(2);
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
export PATH="/c/Program Files/nodejs:$PATH" && cd "/c/Users/Maxwell Berko/Desktop/7-17 Website/crm" && npx vitest run test/misc.test.ts
```
Expected: FAIL — 404s.

- [ ] **Step 3: Implement `crm/src/routes/misc.ts`**

```ts
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
  const b = await c.req.json<{ type?: string; title?: string; payload?: unknown }>().catch(() => ({}) as { type?: string; title?: string; payload?: unknown });
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
  const b = await c.req.json<{ key?: string; label?: string; type?: string; options?: string[]; sort?: number }>().catch(() => ({}) as Record<string, never>);
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
  const b = await c.req.json<{ contacts?: Array<Record<string, unknown>> }>().catch(() => ({}) as { contacts?: never });
  const rows = b.contacts;
  if (!Array.isArray(rows) || rows.length === 0 || rows.length > 200) {
    return c.json({ error: "contacts_array_required_max_200" }, 400);
  }
  let created = 0;
  let merged = 0;
  const errors: Array<{ index: number; error: string }> = [];

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const email = normalizeEmail(r.email as string);
    const phone = normalizePhone(r.phone as string);
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
        cleanName(r.first_name as string) ?? null, cleanName(r.last_name as string) ?? null,
        email, phone, (r.address as string) ?? null, (r.city as string) ?? null, now, contactId
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
        cleanName(r.first_name as string) ?? null, cleanName(r.last_name as string) ?? null,
        email, phone, (r.address as string) ?? null, (r.city as string) ?? null,
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
```

Modify `crm/src/index.ts` — mount them (`bulkRoutes` and `activityWriteRoutes` join the existing `/api/contacts` prefix):

```ts
import { Hono } from "hono";
import type { Env } from "./types";
import { authRoutes } from "./routes/auth";
import { publicRoutes } from "./routes/public";
import { contactRoutes, statsRoutes } from "./routes/contacts";
import { activityWriteRoutes, bulkRoutes, customFieldRoutes } from "./routes/misc";

const app = new Hono<{ Bindings: Env }>();

app.route("/api", publicRoutes);
app.route("/api/auth", authRoutes);
app.route("/api/contacts", bulkRoutes);          // POST /api/contacts/bulk (mounted BEFORE :id routes)
app.route("/api/contacts", activityWriteRoutes); // POST /api/contacts/:id/activities
app.route("/api/contacts", contactRoutes);
app.route("/api/custom-fields", customFieldRoutes);
app.route("/api/stats", statsRoutes);

export default app;
```

- [ ] **Step 4: Run full suite — expect pass**

```bash
export PATH="/c/Program Files/nodejs:$PATH" && cd "/c/Users/Maxwell Berko/Desktop/7-17 Website/crm" && npx vitest run
```
Expected: all PASS. (If `POST /api/contacts/bulk` hits the `:id` matcher instead, the mount order above fixes it — bulk first.)

- [ ] **Step 5: Commit**

```bash
cd "/c/Users/Maxwell Berko/Desktop/7-17 Website" && git add crm && git commit -m "feat(crm): manual activities, custom field defs, bulk import

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: Agent surface — schema endpoint + AGENTS.md

**Files:**
- Create: `crm/src/routes/agent.ts`, `crm/AGENTS.md`
- Modify: `crm/src/index.ts`
- Test: `crm/test/agent.test.ts`

**Interfaces:**
- Produces: `GET /api/agent/schema` (behind `requireAuth()`) returning a JSON catalog `{ name, version, auth, endpoints: Array<{ method, path, description, body? }> }` describing every endpoint above; `crm/AGENTS.md` — the operator manual any future agent session reads first.

- [ ] **Step 1: Write the failing test** — `crm/test/agent.test.ts`

```ts
import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("agent schema", () => {
  it("requires auth", async () => {
    expect((await SELF.fetch("http://x/api/agent/schema")).status).toBe(401);
  });
  it("describes the API", async () => {
    const res = await SELF.fetch("http://x/api/agent/schema", {
      headers: { Authorization: "Bearer dev-agent-key" },
    });
    expect(res.status).toBe(200);
    const s = (await res.json()) as { endpoints: Array<{ method: string; path: string }> };
    const paths = s.endpoints.map((e) => `${e.method} ${e.path}`);
    expect(paths).toContain("POST /api/lead");
    expect(paths).toContain("GET /api/contacts");
    expect(paths).toContain("POST /api/contacts/bulk");
    expect(paths).toContain("GET /api/stats");
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run test/agent.test.ts` (with PATH prefix, from crm/). Expected: FAIL 404.

- [ ] **Step 3: Implement `crm/src/routes/agent.ts`** — a static catalog kept in sync by hand (updating it is part of any task that adds endpoints):

```ts
import { Hono } from "hono";
import type { Env } from "../types";
import { requireAuth } from "../lib/auth";

export const agentRoutes = new Hono<{ Bindings: Env }>();
agentRoutes.use("*", requireAuth());

agentRoutes.get("/schema", (c) =>
  c.json({
    name: "bh-crm",
    version: 1,
    auth: "Authorization: Bearer <AGENT_API_KEY> — full parity with the human UI",
    conventions: {
      stages: ["new", "contacted", "quoted", "scheduled", "customer", "lost"],
      phones: "E.164 (+1XXXXXXXXXX)",
      timestamps: "ISO-8601 UTC",
    },
    endpoints: [
      { method: "GET", path: "/api/health", description: "Liveness check (public)" },
      { method: "POST", path: "/api/lead", description: "Public lead capture (CORS-gated). Body: {name, phone, email, vehicle, message?, source, source_detail, ts, website}" },
      { method: "POST", path: "/api/auth/login", description: "Body {password} -> session cookie" },
      { method: "GET", path: "/api/contacts", description: "List. Query: search, stage, source, tag, limit (<=200), offset. Returns {items, total}" },
      { method: "POST", path: "/api/contacts", description: "Create. Body: {first_name?, last_name?, email?, phone?, address?, city?, stage?, source?, tags?, custom?}" },
      { method: "GET", path: "/api/contacts/:id", description: "Full contact + vehicles + parsed tags/custom" },
      { method: "PATCH", path: "/api/contacts/:id", description: "Partial update; custom shallow-merges; stage change logs stage_changed" },
      { method: "DELETE", path: "/api/contacts/:id", description: "Delete contact (cascades vehicles/activities)" },
      { method: "GET", path: "/api/contacts/:id/activities", description: "Timeline, newest first, limit 100" },
      { method: "POST", path: "/api/contacts/:id/activities", description: "Log manual touch. Body {type: note|call_logged|sms_logged, title, payload?}" },
      { method: "POST", path: "/api/contacts/bulk", description: "Import up to 200. Body {contacts:[...]} -> {created, merged, errors}" },
      { method: "GET", path: "/api/custom-fields", description: "List custom field definitions" },
      { method: "POST", path: "/api/custom-fields", description: "Body {key, label, type: text|number|select|date|checkbox, options?, sort?}" },
      { method: "DELETE", path: "/api/custom-fields/:key", description: "Remove a custom field definition" },
      { method: "GET", path: "/api/stats", description: "{byStage, recent} dashboard numbers" },
      { method: "GET", path: "/api/agent/schema", description: "This document" },
    ],
  })
);
```

Mount in `crm/src/index.ts`: add `import { agentRoutes } from "./routes/agent";` and `app.route("/api/agent", agentRoutes);` after the stats mount.

- [ ] **Step 4: Write `crm/AGENTS.md`**

```markdown
# BH CRM — Agent Operator Manual

The CRM for BH Car Detailing (bhcardetails.com). One Cloudflare Worker (Hono, TypeScript),
one D1 database, React admin served from the same Worker. Spec:
`../docs/superpowers/specs/2026-07-17-bh-crm-design.md`.

## Operating rules
- Humans steer, AI executes: NEVER send or schedule customer-facing copy that a human has
  not approved. (Sending arrives in Phase 3 — the rule is stated now so it's never violated.)
- Stages are exactly: new, contacted, quoted, scheduled, customer, lost. Never invent stages.
- Phones are E.164. Timestamps are ISO-8601 UTC. Custom fields live in `contacts.custom`
  (JSON) with definitions in `custom_field_defs`.
- Log every real-world touch (call, text) as an activity — the timeline is the source of truth.

## Auth
`Authorization: Bearer <AGENT_API_KEY>` on every request. The key is a Worker secret
(local dev: `crm/.dev.vars`). Discover the full API: `GET /api/agent/schema`.

## Quick recipes (local dev base URL: http://127.0.0.1:8787)
List new leads:
  curl -s -H "Authorization: Bearer $KEY" "http://127.0.0.1:8787/api/contacts?stage=new"
Log a call:
  curl -s -X POST -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
    -d '{"type":"call_logged","title":"Quoted $750 ceramic over phone"}' \
    "http://127.0.0.1:8787/api/contacts/<id>/activities"
Bulk import:
  POST /api/contacts/bulk  {"contacts":[{"first_name":"...","email":"...","source":"hubspot-import"}]}

## Development (Windows box)
- Node is at C:\Program Files\nodejs — bash sessions need:
  export PATH="/c/Program Files/nodejs:$PATH"
- From crm/: `npm run dev` (wrangler dev on :8787), `npm test` (vitest), `npm run migrate:local`.
- Admin SPA source in `crm/admin/`, builds into `crm/public/` (served by the Worker).
- When you add or change an endpoint: update `src/routes/agent.ts` schema AND this file.
```

- [ ] **Step 5: Run full suite — expect pass**, then commit

```bash
export PATH="/c/Program Files/nodejs:$PATH" && cd "/c/Users/Maxwell Berko/Desktop/7-17 Website/crm" && npx vitest run
```
```bash
cd "/c/Users/Maxwell Berko/Desktop/7-17 Website" && git add crm && git commit -m "feat(crm): agent schema endpoint and AGENTS.md operator manual

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: Admin SPA scaffold — Vite + React + Tailwind, login, served by the Worker

**Files:**
- Create: `crm/admin/package.json`, `crm/admin/vite.config.ts`, `crm/admin/tsconfig.json`, `crm/admin/index.html`, `crm/admin/src/main.tsx`, `crm/admin/src/index.css`, `crm/admin/src/api.ts`, `crm/admin/src/App.tsx`, `crm/admin/src/pages/Login.tsx`, `crm/admin/src/components/Layout.tsx`
- Modify: `crm/wrangler.jsonc` (add assets block), `crm/package.json` (build script), `.claude/launch.json` (add bh-crm server)

**Interfaces:**
- Consumes: `/api/auth/login`, `/api/stats` (401 probe).
- Produces: `api<T>(path, opts?): Promise<T>` fetch wrapper (`crm/admin/src/api.ts`) — throws `ApiError` with `.status`; on 401 the app routes to /login. Layout shell with nav (Dashboard, Contacts + disabled Phase 2/3/4 placeholders). Build output in `crm/public/` served by the Worker with SPA fallback; `/api/*` and `/u/*` always hit the Worker.

- [ ] **Step 1: Create the admin app files.** `crm/admin/package.json`:

```json
{
  "name": "bh-crm-admin",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build"
  },
  "dependencies": {
    "react": "^18.3.0",
    "react-dom": "^18.3.0",
    "react-router-dom": "^7.0.0"
  },
  "devDependencies": {
    "@tailwindcss/vite": "^4.0.0",
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.0",
    "tailwindcss": "^4.0.0",
    "typescript": "^5.6.0",
    "vite": "^6.0.0"
  }
}
```

`crm/admin/vite.config.ts`:

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: { "/api": "http://127.0.0.1:8787" },
  },
  build: { outDir: "../public", emptyOutDir: true },
});
```

`crm/admin/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "isolatedModules": true
  },
  "include": ["src"]
}
```

`crm/admin/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="robots" content="noindex" />
    <title>BH CRM</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`crm/admin/src/index.css`:

```css
@import "tailwindcss";
```

`crm/admin/src/api.ts`:

```ts
export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function api<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(opts.headers ?? {}) },
    ...opts,
  });
  if (res.status === 401) {
    if (!location.pathname.startsWith("/login")) location.assign("/login");
    throw new ApiError(401, "unauthorized");
  }
  if (!res.ok) throw new ApiError(res.status, await res.text());
  return res.json() as Promise<T>;
}
```

`crm/admin/src/main.tsx`:

```tsx
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
```

`crm/admin/src/App.tsx` (Dashboard/Contacts routes render placeholders replaced in Task 10):

```tsx
import { Navigate, Route, Routes } from "react-router-dom";
import Login from "./pages/Login";
import Layout from "./components/Layout";

function Placeholder({ name }: { name: string }) {
  return <div className="p-8 text-neutral-500">{name} — coming in the next task.</div>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<Layout />}>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<Placeholder name="Dashboard" />} />
        <Route path="/contacts" element={<Placeholder name="Contacts" />} />
        <Route path="/contacts/:id" element={<Placeholder name="Contact" />} />
      </Route>
    </Routes>
  );
}
```

`crm/admin/src/pages/Login.tsx`:

```tsx
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";

export default function Login() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("/api/auth/login", { method: "POST", body: JSON.stringify({ password }) });
      nav("/dashboard");
    } catch {
      setError("Wrong password.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-neutral-950">
      <form onSubmit={submit} className="w-80 space-y-4 rounded-xl bg-neutral-900 p-8">
        <h1 className="text-xl font-semibold text-white">BH CRM</h1>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          autoFocus
          className="w-full rounded-md bg-neutral-800 px-3 py-2 text-white placeholder-neutral-500 outline-none focus:ring-2 focus:ring-red-600"
        />
        {error && <p className="text-sm text-red-500">{error}</p>}
        <button
          disabled={busy}
          className="w-full rounded-md bg-red-600 py-2 font-medium text-white hover:bg-red-500 disabled:opacity-50"
        >
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
```

`crm/admin/src/components/Layout.tsx`:

```tsx
import { NavLink, Outlet } from "react-router-dom";

const links = [
  { to: "/dashboard", label: "Dashboard" },
  { to: "/contacts", label: "Contacts" },
];
const comingSoon = ["Pipeline", "Calendar", "Sequences", "Workflows", "Brand Brain"];

export default function Layout() {
  return (
    <div className="flex min-h-screen bg-neutral-100">
      <aside className="w-56 shrink-0 bg-neutral-950 p-4 text-neutral-300">
        <div className="mb-6 text-lg font-bold text-white">BH CRM</div>
        <nav className="space-y-1">
          {links.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              className={({ isActive }) =>
                `block rounded-md px-3 py-2 text-sm ${isActive ? "bg-red-600 text-white" : "hover:bg-neutral-800"}`
              }
            >
              {l.label}
            </NavLink>
          ))}
          {comingSoon.map((label) => (
            <span key={label} className="block cursor-not-allowed rounded-md px-3 py-2 text-sm text-neutral-600" title="Coming in a later phase">
              {label}
            </span>
          ))}
        </nav>
      </aside>
      <main className="min-w-0 flex-1">
        <Outlet />
      </main>
    </div>
  );
}
```

- [ ] **Step 2: Wire the Worker to serve the SPA.** In `crm/wrangler.jsonc` add after the `main` line:

```jsonc
  "assets": {
    "directory": "./public",
    "not_found_handling": "single-page-application",
    "run_worker_first": ["/api/*", "/u/*"]
  },
```

In `crm/package.json` scripts add: `"build:admin": "cd admin && npm install && npm run build"`.

- [ ] **Step 3: Install + build**

```bash
export PATH="/c/Program Files/nodejs:$PATH" && cd "/c/Users/Maxwell Berko/Desktop/7-17 Website/crm/admin" && npm install && npm run build
```
Expected: Vite build succeeds; `crm/public/index.html` + hashed assets exist.

- [ ] **Step 4: Verify the Worker serves everything.** Start dev server in background:

```bash
export PATH="/c/Program Files/nodejs:$PATH" && cd "/c/Users/Maxwell Berko/Desktop/7-17 Website/crm" && npx wrangler dev
```
Then: `curl -s http://127.0.0.1:8787/api/health` → `{"ok":true,...}`; `curl -s http://127.0.0.1:8787/` → the SPA index.html; `curl -s http://127.0.0.1:8787/contacts` → SPA index.html (SPA fallback). Open http://127.0.0.1:8787 in the Browser pane: login page renders; logging in with `dev-password` lands on the Dashboard placeholder. Run the vitest suite once more (assets dir now exists): all PASS.

- [ ] **Step 5: Add the CRM dev server to `.claude/launch.json`** — append to `configurations`:

```json
{
  "name": "bh-crm",
  "runtimeExecutable": "C:\\Program Files\\nodejs\\npm.cmd",
  "runtimeArgs": ["--prefix", "crm", "run", "dev"],
  "port": 8787
}
```

- [ ] **Step 6: Commit**

```bash
cd "/c/Users/Maxwell Berko/Desktop/7-17 Website" && git add crm .claude/launch.json && git commit -m "feat(crm): admin SPA scaffold with login, served by the Worker

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 10: Admin pages — Dashboard, Contacts list, Contact detail

**Files:**
- Create: `crm/admin/src/pages/Dashboard.tsx`, `crm/admin/src/pages/Contacts.tsx`, `crm/admin/src/pages/ContactDetail.tsx`, `crm/admin/src/types.ts`
- Modify: `crm/admin/src/App.tsx` (swap placeholders for real pages)

**Interfaces:**
- Consumes: `GET /api/stats`, `GET /api/contacts`, `GET /api/contacts/:id`, `PATCH /api/contacts/:id`, `POST /api/contacts/:id/activities`, `POST /api/contacts` via `api()`.
- Produces: the Phase-1 daily-driver UI. Click-to-contact links (`tel:`, `sms:`, `mailto:`) on every phone/email — the v1 "click-to-text bridge" (AI-drafted prefill arrives in Phase 4).

- [ ] **Step 1: Create `crm/admin/src/types.ts`**

```ts
export const STAGES = ["new", "contacted", "quoted", "scheduled", "customer", "lost"] as const;
export type Stage = (typeof STAGES)[number];

export interface Vehicle {
  id: string;
  size_class: string;
  notes: string | null;
  year: number | null;
  make: string | null;
  model: string | null;
}

export interface Contact {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  area_slug: string | null;
  stage: Stage;
  source: string | null;
  source_detail: string | null;
  created_at: string;
  last_activity_at: string | null;
  vehicle_count?: number;
  vehicles?: Vehicle[];
  tags?: string[];
  custom?: Record<string, unknown>;
}

export interface Activity {
  id: number;
  type: string;
  title: string;
  payload: string | null;
  actor: string;
  created_at: string;
}

export interface Stats {
  byStage: Record<Stage, number>;
  recent: Array<{ id: number; type: string; title: string; created_at: string; contact_id: string; first_name: string | null; last_name: string | null }>;
}

export function fullName(c: Pick<Contact, "first_name" | "last_name">): string {
  return [c.first_name, c.last_name].filter(Boolean).join(" ") || "(no name)";
}
```

- [ ] **Step 2: Create `crm/admin/src/pages/Dashboard.tsx`**

```tsx
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { fullName, STAGES, type Contact, type Stats } from "../types";

export default function Dashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [newLeads, setNewLeads] = useState<Contact[]>([]);

  useEffect(() => {
    api<Stats>("/api/stats").then(setStats).catch(() => {});
    api<{ items: Contact[] }>("/api/contacts?stage=new&limit=20").then((r) => setNewLeads(r.items)).catch(() => {});
  }, []);

  return (
    <div className="space-y-8 p-8">
      <h1 className="text-2xl font-semibold">Dashboard</h1>

      <div className="grid grid-cols-3 gap-4 lg:grid-cols-6">
        {STAGES.map((s) => (
          <Link key={s} to={`/contacts?stage=${s}`} className="rounded-xl bg-white p-4 shadow-sm hover:shadow">
            <div className="text-2xl font-bold">{stats?.byStage[s] ?? "–"}</div>
            <div className="text-sm capitalize text-neutral-500">{s}</div>
          </Link>
        ))}
      </div>

      <section>
        <h2 className="mb-3 text-lg font-medium">New leads needing action</h2>
        {newLeads.length === 0 ? (
          <p className="text-neutral-500">No new leads. They'll appear here the moment a form is submitted.</p>
        ) : (
          <ul className="divide-y rounded-xl bg-white shadow-sm">
            {newLeads.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-4 p-4">
                <div className="min-w-0">
                  <Link to={`/contacts/${c.id}`} className="font-medium hover:underline">{fullName(c)}</Link>
                  <div className="truncate text-sm text-neutral-500">
                    {c.source ?? "unknown source"} · {new Date(c.created_at).toLocaleString()}
                  </div>
                </div>
                <div className="flex shrink-0 gap-2">
                  {c.phone && (
                    <>
                      <a href={`sms:${c.phone}`} className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm text-white">Text</a>
                      <a href={`tel:${c.phone}`} className="rounded-md bg-neutral-200 px-3 py-1.5 text-sm">Call</a>
                    </>
                  )}
                  {c.email && <a href={`mailto:${c.email}`} className="rounded-md bg-neutral-200 px-3 py-1.5 text-sm">Email</a>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-lg font-medium">Recent activity</h2>
        <ul className="divide-y rounded-xl bg-white shadow-sm">
          {(stats?.recent ?? []).map((a) => (
            <li key={a.id} className="p-3 text-sm">
              <Link to={`/contacts/${a.contact_id}`} className="font-medium hover:underline">
                {[a.first_name, a.last_name].filter(Boolean).join(" ") || "(no name)"}
              </Link>{" "}
              — {a.title}
              <span className="ml-2 text-neutral-400">{new Date(a.created_at).toLocaleString()}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
```

- [ ] **Step 3: Create `crm/admin/src/pages/Contacts.tsx`**

```tsx
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { fullName, STAGES, type Contact } from "../types";

export default function Contacts() {
  const [params, setParams] = useSearchParams();
  const [items, setItems] = useState<Contact[]>([]);
  const [total, setTotal] = useState(0);
  const search = params.get("search") ?? "";
  const stage = params.get("stage") ?? "";

  useEffect(() => {
    const q = new URLSearchParams();
    if (search) q.set("search", search);
    if (stage) q.set("stage", stage);
    q.set("limit", "100");
    api<{ items: Contact[]; total: number }>(`/api/contacts?${q}`)
      .then((r) => { setItems(r.items); setTotal(r.total); })
      .catch(() => {});
  }, [search, stage]);

  function update(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  }

  return (
    <div className="space-y-4 p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Contacts <span className="text-base font-normal text-neutral-400">({total})</span></h1>
      </div>
      <div className="flex gap-3">
        <input
          value={search}
          onChange={(e) => update("search", e.target.value)}
          placeholder="Search name, email, phone…"
          className="w-72 rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-red-600"
        />
        <select value={stage} onChange={(e) => update("stage", e.target.value)} className="rounded-md border border-neutral-300 px-3 py-2 text-sm">
          <option value="">All stages</option>
          {STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>
      <table className="w-full rounded-xl bg-white text-sm shadow-sm">
        <thead>
          <tr className="border-b text-left text-neutral-500">
            <th className="p-3">Name</th><th className="p-3">Stage</th><th className="p-3">Phone</th>
            <th className="p-3">Email</th><th className="p-3">Source</th><th className="p-3">Created</th>
          </tr>
        </thead>
        <tbody>
          {items.map((c) => (
            <tr key={c.id} className="border-b last:border-0 hover:bg-neutral-50">
              <td className="p-3"><Link className="font-medium hover:underline" to={`/contacts/${c.id}`}>{fullName(c)}</Link></td>
              <td className="p-3 capitalize">{c.stage}</td>
              <td className="p-3">{c.phone && <a className="hover:underline" href={`sms:${c.phone}`}>{c.phone}</a>}</td>
              <td className="p-3">{c.email && <a className="hover:underline" href={`mailto:${c.email}`}>{c.email}</a>}</td>
              <td className="p-3">{c.source}</td>
              <td className="p-3">{new Date(c.created_at).toLocaleDateString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 4: Create `crm/admin/src/pages/ContactDetail.tsx`**

```tsx
import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../api";
import { fullName, STAGES, type Activity, type Contact, type Stage } from "../types";

export default function ContactDetail() {
  const { id } = useParams<{ id: string }>();
  const [contact, setContact] = useState<Contact | null>(null);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [note, setNote] = useState("");

  const load = useCallback(() => {
    if (!id) return;
    api<Contact>(`/api/contacts/${id}`).then(setContact).catch(() => {});
    api<{ items: Activity[] }>(`/api/contacts/${id}/activities`).then((r) => setActivities(r.items)).catch(() => {});
  }, [id]);
  useEffect(load, [load]);

  async function setStage(stage: Stage) {
    await api(`/api/contacts/${id}`, { method: "PATCH", body: JSON.stringify({ stage }) });
    load();
  }

  async function addNote(e: React.FormEvent) {
    e.preventDefault();
    if (!note.trim()) return;
    await api(`/api/contacts/${id}/activities`, {
      method: "POST",
      body: JSON.stringify({ type: "note", title: note.trim() }),
    });
    setNote("");
    load();
  }

  if (!contact) return <div className="p-8 text-neutral-500">Loading…</div>;

  return (
    <div className="grid gap-8 p-8 lg:grid-cols-[1fr_380px]">
      <div className="space-y-6">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-semibold">{fullName(contact)}</h1>
            <div className="mt-1 text-sm text-neutral-500">
              {contact.source} {contact.area_slug && `· ${contact.area_slug}`}
            </div>
          </div>
          <select
            value={contact.stage}
            onChange={(e) => setStage(e.target.value as Stage)}
            className="rounded-md border border-neutral-300 px-3 py-2 text-sm capitalize"
          >
            {STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>

        <div className="flex gap-2">
          {contact.phone && (
            <>
              <a href={`sms:${contact.phone}`} className="rounded-md bg-neutral-900 px-4 py-2 text-sm text-white">Text {contact.phone}</a>
              <a href={`tel:${contact.phone}`} className="rounded-md bg-neutral-200 px-4 py-2 text-sm">Call</a>
            </>
          )}
          {contact.email && <a href={`mailto:${contact.email}`} className="rounded-md bg-neutral-200 px-4 py-2 text-sm">Email</a>}
        </div>

        <section className="rounded-xl bg-white p-5 shadow-sm">
          <h2 className="mb-3 font-medium">Vehicles</h2>
          {(contact.vehicles ?? []).length === 0 ? (
            <p className="text-sm text-neutral-500">None recorded.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {contact.vehicles!.map((v) => (
                <li key={v.id}>
                  <span className="capitalize">{v.size_class}</span>
                  {v.notes && <span className="text-neutral-500"> — {v.notes}</span>}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-xl bg-white p-5 shadow-sm">
          <h2 className="mb-3 font-medium">Timeline</h2>
          <form onSubmit={addNote} className="mb-4 flex gap-2">
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Add a note…"
              className="flex-1 rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-red-600"
            />
            <button className="rounded-md bg-neutral-900 px-4 py-2 text-sm text-white">Save</button>
          </form>
          <ul className="space-y-3">
            {activities.map((a) => (
              <li key={a.id} className="border-l-2 border-neutral-200 pl-3 text-sm">
                <div>{a.title}</div>
                <div className="text-xs text-neutral-400">
                  {a.type} · {a.actor} · {new Date(a.created_at).toLocaleString()}
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <aside className="space-y-4">
        <section className="rounded-xl bg-white p-5 text-sm shadow-sm">
          <h2 className="mb-3 font-medium">Details</h2>
          <dl className="space-y-2">
            <div><dt className="text-neutral-400">Email</dt><dd>{contact.email ?? "—"}</dd></div>
            <div><dt className="text-neutral-400">Phone</dt><dd>{contact.phone ?? "—"}</dd></div>
            <div><dt className="text-neutral-400">Address</dt><dd>{contact.address ?? "—"}</dd></div>
            <div><dt className="text-neutral-400">Created</dt><dd>{new Date(contact.created_at).toLocaleString()}</dd></div>
            <div><dt className="text-neutral-400">Tags</dt><dd>{(contact.tags ?? []).join(", ") || "—"}</dd></div>
          </dl>
          {Object.keys(contact.custom ?? {}).length > 0 && (
            <>
              <h3 className="mt-4 mb-2 font-medium">Custom fields</h3>
              <dl className="space-y-2">
                {Object.entries(contact.custom!).map(([k, v]) => (
                  <div key={k}><dt className="text-neutral-400">{k}</dt><dd>{String(v)}</dd></div>
                ))}
              </dl>
            </>
          )}
        </section>
      </aside>
    </div>
  );
}
```

- [ ] **Step 5: Wire routes in `crm/admin/src/App.tsx`** — replace the placeholder routes:

```tsx
import { Navigate, Route, Routes } from "react-router-dom";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Contacts from "./pages/Contacts";
import ContactDetail from "./pages/ContactDetail";
import Layout from "./components/Layout";

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<Layout />}>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/contacts" element={<Contacts />} />
        <Route path="/contacts/:id" element={<ContactDetail />} />
      </Route>
    </Routes>
  );
}
```

Delete the now-unused `Placeholder` component.

- [ ] **Step 6: Build + verify in browser**

```bash
export PATH="/c/Program Files/nodejs:$PATH" && cd "/c/Users/Maxwell Berko/Desktop/7-17 Website/crm/admin" && npm run build
```
With `wrangler dev` running: open http://127.0.0.1:8787 → login → Dashboard shows stage tiles; create a lead via curl (`POST /api/lead` with a valid body per Task 5's contract) → it appears under "New leads needing action"; open it, change stage to `contacted`, add a note — timeline updates. Run vitest once more: all PASS.

- [ ] **Step 7: Commit**

```bash
cd "/c/Users/Maxwell Berko/Desktop/7-17 Website" && git add crm && git commit -m "feat(crm): dashboard, contacts list, contact detail pages

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 11: Site cut-over — dual-post every form to the CRM

**Files:**
- Modify: `js/main.js` (single file — the shared handler covers all forms on all pages)

**Interfaces:**
- Consumes: the `POST /api/lead` contract from Task 5 exactly.
- Produces: every successful Formspree submission also posts JSON to the CRM (non-blocking, failure-silent). Source attribution: `promo-popup` (form inside `#promo-modal`), `hero-quote` (index page), `page:ceramic-coating`, `page:paint-correction`, `page:maintenance-plans`, `area:<slug>` (area pages).

- [ ] **Step 1: Add the CRM bridge near the top of the forms section of `js/main.js`** (immediately before the `document.querySelectorAll("form.form")` block at line ~402):

```js
  /* ---------- CRM bridge: mirror every lead into the BH CRM backend ---------- */
  var CRM_ENDPOINT = "http://127.0.0.1:8787/api/lead"; /* TODO(deploy): switch to the workers.dev URL in Task 12 */
  var PAGE_LOADED_AT = Date.now();

  function crmSource(form) {
    var path = location.pathname;
    var area = path.match(/\/areas\/([a-z-]+)\.html$/);
    if (area) return "area:" + area[1];
    if (form.closest("#promo-modal")) return "promo-popup";
    if (path.indexOf("ceramic") !== -1) return "page:ceramic-coating";
    if (path.indexOf("paint-correction") !== -1) return "page:paint-correction";
    if (path.indexOf("maintenance") !== -1) return "page:maintenance-plans";
    return "hero-quote";
  }

  function postToCrm(form) {
    try {
      var fd = new FormData(form);
      fetch(CRM_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: fd.get("name") || "",
          phone: fd.get("phone") || "",
          email: fd.get("email") || "",
          vehicle: fd.get("vehicle") || "",
          message: fd.get("message") || "",
          source: crmSource(form),
          source_detail: location.pathname + location.search,
          ts: PAGE_LOADED_AT,
          website: "",
        }),
      }).catch(function () {});
    } catch (e) { /* never break the user-facing submit */ }
  }
```

- [ ] **Step 2: Call it on successful submission.** Inside the existing `form.addEventListener("submit", ...)` handler, immediately after the line `if (!res.ok) throw new Error("Form submission failed");` and BEFORE `form.reset();` (reset clears the fields), insert:

```js
        postToCrm(form);
```

- [ ] **Step 3: Verify end-to-end locally.** With both servers running (`bh-site` on :4173, `wrangler dev` on :8787 — CORS already allows localhost:4173): open http://localhost:4173, submit the hero form with a test name/phone/email. Expected: the site shows its normal success message (Formspree path unchanged), AND the contact appears in the CRM:

```bash
curl -s -H "Authorization: Bearer dev-agent-key" "http://127.0.0.1:8787/api/contacts?search=<test name>"
```
Expected: `total: 1`, source `hero-quote`. Check the admin UI dashboard shows it under new leads. Note: the submission must happen ≥2 seconds after page load or the timing check silently drops it — that's correct behavior.

- [ ] **Step 4: Commit**

```bash
cd "/c/Users/Maxwell Berko/Desktop/7-17 Website" && git add js/main.js && git commit -m "feat(site): dual-post lead forms to the CRM backend

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 12: Deploy to the user's Cloudflare account — ⚠️ USER-GATED

This task needs the user present. Collect in one message before starting: (a) confirmation they've created a free Cloudflare account, (b) a chosen admin password, (c) where/how the static site is hosted + deployed (needed for real ALLOWED_ORIGINS and to publish the js/main.js change), (d) reminder that `crm/` + `docs/` must be excluded if their host uploads the whole folder.

- [ ] **Step 1: Login** — run `npx wrangler login` (PATH prefix, from crm/); a browser tab opens; user clicks Allow. Verify: `npx wrangler whoami` shows their account.
- [ ] **Step 2: Create the database** — `npx wrangler d1 create bh-crm`. Copy the returned `database_id` into `wrangler.jsonc`, replacing the placeholder.
- [ ] **Step 3: Apply migrations remotely** — `npx wrangler d1 migrations apply bh-crm --remote`. Expected: `0001_init.sql` applied.
- [ ] **Step 4: Set secrets** — for each of `ADMIN_PASSWORD` (user's chosen password), `SESSION_SECRET` (generate: `openssl rand -hex 32`), `AGENT_API_KEY` (generate the same way; save it for Task 13): `npx wrangler secret put <NAME>`.
- [ ] **Step 5: Set real origins** — in `wrangler.jsonc` set `ALLOWED_ORIGINS` to `https://bhcardetails.com,https://www.bhcardetails.com` (plus the site's actual origin if hosted under another domain — from the user's answer).
- [ ] **Step 6: Build + deploy** — `npm run build:admin && npx wrangler deploy`. Note the printed URL `https://bh-crm.<account>.workers.dev`. Verify: `curl -s https://bh-crm.<account>.workers.dev/api/health` → `{"ok":true}`; open the URL, log in with the new password.
- [ ] **Step 7: Point the site at production** — in `js/main.js` set `CRM_ENDPOINT` to `https://bh-crm.<account>.workers.dev/api/lead`. Commit. User publishes the updated site through their normal hosting flow (assist based on their answer to (c)).
- [ ] **Step 8: Live verification** — submit a real test lead on the live bhcardetails.com; confirm it appears in the production admin dashboard. Delete the test contact afterward via the UI or API.
- [ ] **Step 9: Commit** any config changes:

```bash
cd "/c/Users/Maxwell Berko/Desktop/7-17 Website" && git add crm/wrangler.jsonc js/main.js && git commit -m "chore(crm): production deploy config and live endpoint

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 13: HubSpot migration — 142 contacts, cleaned

Runs in a Claude Code session with the HubSpot MCP connected (this one). Target: the PRODUCTION agent API from Task 12 (bearer = production `AGENT_API_KEY`).

- [ ] **Step 1: Pull all contacts** via HubSpot MCP `search_crm_objects` (objectType `contacts`, properties `firstname,lastname,email,phone,lifecyclestage,createdate,hs_object_id`, limit 100, paginate via offset until all ~142 fetched).
- [ ] **Step 2: Clean.** Apply transforms per contact:
  - Strip business-name junk from name fields: if `lastname` (or trailing words of `firstname`) case-insensitively equals or ends with "Car Detailing", "Detailing", "Top Tier Car Detailing" — remove that token; if `firstname` holds "First Last" and `lastname` was junk, split it into first/last.
  - Phones → E.164 via the same rules as `normalizePhone`; emails lowercased; names Title-Cased when ALLCAPS/alllower.
  - Map `lifecyclestage`: `lead → new`, `opportunity → quoted`, `customer → customer`, anything else → `new`.
  - Skip rows with neither email nor phone after cleaning — report them to the user instead of importing.
- [ ] **Step 3: Import** in batches of ≤100 via `POST /api/contacts/bulk` with `source: "hubspot-import"` and `custom: { hubspot_id: <hs_object_id> }` per row. Record `{created, merged, errors}` per batch. (Bulk-import dedupe means re-running is safe.)
- [ ] **Step 4: Verify + report.** `GET /api/contacts?source=hubspot-import&limit=1` → total should equal imported count; spot-check 5 previously-messy names in the admin UI. Present the user a before/after summary: total pulled, cleaned examples (e.g., "Jorge L. Zurita / Top Tier Car Detailing" → "Jorge L. Zurita"), created vs merged vs skipped, and the skipped rows. HubSpot is never written to or deleted from.

---

## Self-Review (completed during plan writing)

- **Spec coverage (Phase 1 scope, spec §13):** repo/git → Task 1; Worker+Hono+migrations → Tasks 1–2; auth → Task 4; contacts+activities+custom fields → Tasks 5–7; public lead endpoint → Task 5; agent API + AGENTS.md → Tasks 4–8; minimal UI → Tasks 9–10; HubSpot import → Tasks 7+13; site cut-over → Tasks 11–12. Sequences/calendar/AI/email intentionally out (Phases 2–4).
- **Type consistency:** `requireAuth()` / `logActivity` / db helper / normalize signatures identical across Tasks 4–10; `/api/contacts/bulk` request/response shape identical between Task 7 (implementation) and Task 13 (consumer); lead body contract identical between Task 5 (server) and Task 11 (site JS).
- **Placeholder scan:** the only "placeholder" is the D1 `database_id` dummy value, which is explicitly replaced in Task 12 Step 2 — intentional, not a gap.
