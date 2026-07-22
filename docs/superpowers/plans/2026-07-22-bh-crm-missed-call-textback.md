# Missed-Call Text-Back (V1 + V1.1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a call to the CRM's Twilio number goes unanswered, automatically text the caller, capture them as a lead, notify the owner by SMS, and record the call — with opt-out, one retry, reply-aware cooldown, template snapshot, lead-source metadata, duration, timeline events, and a data-derived inbox badge.

**Architecture:** Two new signature-verified Twilio Voice webhooks in `src/routes/public.ts` stay thin: they verify, parse, return TwiML immediately, and run all side-effect work in the background via `c.executionCtx.waitUntil(...)`. All logic lives in a new testable module `src/lib/missedcall.ts` (`handleMissedCall`) with an injectable send dependency so retry/opt-out/cooldown paths are unit-testable without live Twilio. One migration `0006_missed_call_textback.sql` adds the `missed_calls` table and new `contacts` columns. Frontend: a Settings section and an inbox badge, both reusing existing patterns. No realtime infra (deferred to a later phase).

**Tech Stack:** Cloudflare Workers, Hono, D1 (SQLite), TypeScript, Vitest (`@cloudflare/vitest-pool-workers`), React + Tailwind (admin SPA).

## Global Constraints

- Twilio signature verification MUST fail closed (403) on both new voice routes — reuse `verifyTwilioSignature` from `src/lib/sms.ts`.
- Do NOT modify earlier migrations; add only `migrations/0006_missed_call_textback.sql`.
- Reuse existing helpers: `uuid`, `nowIso`, `one`, `all`, `run` (`src/lib/db.ts`); `logActivity` (`src/lib/activity.ts`); `normalizePhone` (`src/lib/normalize.ts`); `sendSms` (`src/lib/sms.ts`).
- Opt-out (`sms_opt_out_auto`) applies ONLY to missed-call auto-texts, never to manual SMS.
- Lead-source metadata (`lead_source`, `first_contact_method`, `acquisition_channel`) is set ONLY when a contact row is first created; never overwrite existing contacts.
- `text_template_snapshot` is populated ONLY when an SMS is actually sent.
- At most ONE retry of a failed send; the customer receives at most one delivered text per missed call.
- Do NOT weaken or remove existing tests.
- Existing test auth header: `{ Authorization: "Bearer dev-agent-key", "Content-Type": "application/json" }`. Twilio env vars are NOT set in tests, so `sendSms` returns `status: "logged"` (treated as success).
- Public routes are mounted at `/api`, so the webhook paths are `/api/twilio/voice` and `/api/twilio/voice/complete`.

---

### Task 1: Migration — `missed_calls` table + `contacts` columns

**Files:**
- Create: `crm/migrations/0006_missed_call_textback.sql`
- Test: `crm/test/schema.test.ts` (add assertions; file already exists)

**Interfaces:**
- Produces: table `missed_calls(id, contact_id, from_phone, to_phone, call_sid, dial_status, texted, message_id, skip_reason, text_template_snapshot, duration_seconds, acknowledged_at, created_at)`; new `contacts` columns `sms_opt_out_auto INTEGER DEFAULT 0`, `lead_source TEXT`, `first_contact_method TEXT`, `acquisition_channel TEXT`.

- [ ] **Step 1: Write the failing test**

Add to `crm/test/schema.test.ts` (inside the existing `describe`, or append a new `describe`):

```ts
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { all, run } from "../src/lib/db";

describe("migration 0006 — missed_call_textback", () => {
  it("creates missed_calls with all V1.1 columns", async () => {
    const cols = await all<{ name: string }>(env.DB, "PRAGMA table_info(missed_calls)");
    const names = cols.map((c) => c.name);
    for (const n of ["id","contact_id","from_phone","to_phone","call_sid","dial_status","texted","message_id","skip_reason","text_template_snapshot","duration_seconds","acknowledged_at","created_at"]) {
      expect(names).toContain(n);
    }
  });

  it("adds opt-out and lead-source columns to contacts", async () => {
    const cols = await all<{ name: string }>(env.DB, "PRAGMA table_info(contacts)");
    const names = cols.map((c) => c.name);
    for (const n of ["sms_opt_out_auto","lead_source","first_contact_method","acquisition_channel"]) {
      expect(names).toContain(n);
    }
  });

  it("defaults sms_opt_out_auto to 0", async () => {
    await run(env.DB, "INSERT INTO contacts (id, phone, stage, source, created_at, updated_at) VALUES ('optd','+13050000001','new','test',?,?)", new Date().toISOString(), new Date().toISOString());
    const row = await (await import("../src/lib/db")).one<{ sms_opt_out_auto: number }>(env.DB, "SELECT sms_opt_out_auto FROM contacts WHERE id = 'optd'");
    expect(row?.sms_opt_out_auto).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd crm && npx vitest run test/schema.test.ts`
Expected: FAIL — `missed_calls` does not exist / columns missing.

- [ ] **Step 3: Write the migration**

Create `crm/migrations/0006_missed_call_textback.sql`:

```sql
CREATE TABLE missed_calls (
  id TEXT PRIMARY KEY,
  contact_id TEXT,
  from_phone TEXT NOT NULL,
  to_phone TEXT,
  call_sid TEXT,
  dial_status TEXT,                 -- completed | no-answer | busy | failed
  texted INTEGER NOT NULL DEFAULT 0,
  message_id TEXT,                  -- messages.id of the delivered text
  skip_reason TEXT,                 -- answered|cooldown|disabled|unknown_number|self_guard|opt_out|sms_failed
  text_template_snapshot TEXT,      -- exact body delivered (only when sent)
  duration_seconds INTEGER,
  acknowledged_at TEXT,             -- set when owner opens the conversation
  created_at TEXT NOT NULL
);
CREATE INDEX idx_missed_calls_phone ON missed_calls (from_phone, created_at);
CREATE INDEX idx_missed_calls_contact_ack ON missed_calls (contact_id, acknowledged_at);

ALTER TABLE contacts ADD COLUMN sms_opt_out_auto INTEGER NOT NULL DEFAULT 0;
ALTER TABLE contacts ADD COLUMN lead_source TEXT;
ALTER TABLE contacts ADD COLUMN first_contact_method TEXT;
ALTER TABLE contacts ADD COLUMN acquisition_channel TEXT;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd crm && npx vitest run test/schema.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add crm/migrations/0006_missed_call_textback.sql crm/test/schema.test.ts
git commit -m "feat(crm): migration 0006 — missed_calls table + contacts opt-out/lead-source columns"
```

---

### Task 2: Core module — settings, contact upsert, logging, opt-out, cooldown

**Files:**
- Create: `crm/src/lib/missedcall.ts`
- Test: `crm/test/missedcall.test.ts`

**Interfaces:**
- Produces (all exported from `src/lib/missedcall.ts`):
  - `type SkipReason = "answered"|"cooldown"|"disabled"|"unknown_number"|"self_guard"|"opt_out"|"sms_failed"`
  - `interface MissedCallSettings { enabled: boolean; forwardNumber: string; dialTimeout: number; textBody: string; cooldownHours: number; ownerNotifyEnabled: boolean; ownerNotifyNumber: string }`
  - `async function loadMissedCallSettings(env: Env): Promise<MissedCallSettings>`
  - `async function findOrCreateMissedCallContact(env: Env, phone: string): Promise<{ id: string; created: boolean }>`
  - `async function insertMissedCall(env: Env, row: { contactId: string | null; fromPhone: string; toPhone: string | null; callSid: string | null; dialStatus: string | null; texted: boolean; messageId: string | null; skipReason: SkipReason | null; templateSnapshot: string | null; durationSeconds: number | null }): Promise<string>`
  - `async function isAutoTextAllowed(env: Env, contactId: string, fromPhone: string, cooldownHours: number, nowMs: number): Promise<boolean>`
  - Default template constant `DEFAULT_MISSED_CALL_BODY` (exact text below).

- [ ] **Step 1: Write the failing tests**

Create `crm/test/missedcall.test.ts`:

```ts
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { run, one } from "../src/lib/db";
import {
  loadMissedCallSettings, findOrCreateMissedCallContact, insertMissedCall,
  isAutoTextAllowed, DEFAULT_MISSED_CALL_BODY,
} from "../src/lib/missedcall";

describe("missedcall core", () => {
  it("loads defaults when no settings rows exist", async () => {
    const s = await loadMissedCallSettings(env);
    expect(s.enabled).toBe(true);
    expect(s.dialTimeout).toBe(20);
    expect(s.cooldownHours).toBe(4);
    expect(s.textBody).toBe(DEFAULT_MISSED_CALL_BODY);
    expect(s.ownerNotifyEnabled).toBe(true);
  });

  it("reads overrides and falls back owner_notify_number to forward number", async () => {
    await run(env.DB, "INSERT INTO settings (key,value) VALUES ('owner_forward_number','+13051112222') ON CONFLICT(key) DO UPDATE SET value=excluded.value");
    await run(env.DB, "INSERT INTO settings (key,value) VALUES ('missed_call_cooldown_hours','2') ON CONFLICT(key) DO UPDATE SET value=excluded.value");
    const s = await loadMissedCallSettings(env);
    expect(s.forwardNumber).toBe("+13051112222");
    expect(s.ownerNotifyNumber).toBe("+13051112222");
    expect(s.cooldownHours).toBe(2);
  });

  it("creates a contact once and reuses it", async () => {
    const a = await findOrCreateMissedCallContact(env, "+13052223333");
    expect(a.created).toBe(true);
    const b = await findOrCreateMissedCallContact(env, "+13052223333");
    expect(b.created).toBe(false);
    expect(b.id).toBe(a.id);
    const c = await one<{ lead_source: string; first_contact_method: string; acquisition_channel: string }>(
      env.DB, "SELECT lead_source, first_contact_method, acquisition_channel FROM contacts WHERE id = ?", a.id);
    expect(c?.lead_source).toBe("missed_call");
    expect(c?.first_contact_method).toBe("phone");
    expect(c?.acquisition_channel).toBe("twilio_voice");
  });

  it("allows first text, blocks within cooldown, re-allows after window with no reply", async () => {
    const { id } = await findOrCreateMissedCallContact(env, "+13054445555");
    const now = Date.parse("2026-07-22T12:00:00.000Z");
    expect(await isAutoTextAllowed(env, id, "+13054445555", 4, now)).toBe(true);
    // record an auto-text 1h ago
    await insertMissedCall(env, { contactId: id, fromPhone: "+13054445555", toPhone: null, callSid: null, dialStatus: "no-answer", texted: true, messageId: null, skipReason: null, templateSnapshot: "hi", durationSeconds: null });
    await run(env.DB, "UPDATE missed_calls SET created_at = ? WHERE from_phone = '+13054445555'", new Date(now - 60*60*1000).toISOString());
    expect(await isAutoTextAllowed(env, id, "+13054445555", 4, now)).toBe(false); // within 4h window
    expect(await isAutoTextAllowed(env, id, "+13054445555", 4, now + 5*60*60*1000)).toBe(true); // window expired, no reply
  });

  it("blocks re-text after window if the customer replied", async () => {
    const { id } = await findOrCreateMissedCallContact(env, "+13056667777");
    const now = Date.parse("2026-07-22T12:00:00.000Z");
    await insertMissedCall(env, { contactId: id, fromPhone: "+13056667777", toPhone: null, callSid: null, dialStatus: "no-answer", texted: true, messageId: null, skipReason: null, templateSnapshot: "hi", durationSeconds: null });
    await run(env.DB, "UPDATE missed_calls SET created_at = ? WHERE from_phone = '+13056667777'", new Date(now - 60*60*1000).toISOString());
    // inbound reply 30 min ago
    await run(env.DB, "INSERT INTO messages (id, contact_id, kind, body_text, status, created_at, sent_at, channel, direction, from_addr, to_addr) VALUES (?,?, 'sms','yes','delivered',?,?,'sms','inbound','+13056667777',null)", "m1", id, new Date(now - 30*60*1000).toISOString(), new Date(now - 30*60*1000).toISOString());
    expect(await isAutoTextAllowed(env, id, "+13056667777", 4, now + 5*60*60*1000)).toBe(false); // replied since last auto-text
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd crm && npx vitest run test/missedcall.test.ts`
Expected: FAIL — module `../src/lib/missedcall` not found.

- [ ] **Step 3: Write the module**

Create `crm/src/lib/missedcall.ts`:

```ts
import type { Env } from "../types";
import { all, nowIso, one, run, uuid } from "./db";
import { normalizePhone } from "./normalize";

export const DEFAULT_MISSED_CALL_BODY =
  "Hey, this is BH Car Detailing - sorry we missed your call! Reply here with what you need and we'll be in touch.\nIf you'd like to book on your own our website is bhcardetails.com";

export type SkipReason =
  | "answered" | "cooldown" | "disabled" | "unknown_number"
  | "self_guard" | "opt_out" | "sms_failed";

export interface MissedCallSettings {
  enabled: boolean;
  forwardNumber: string;
  dialTimeout: number;
  textBody: string;
  cooldownHours: number;
  ownerNotifyEnabled: boolean;
  ownerNotifyNumber: string;
}

async function settingsMap(env: Env): Promise<Record<string, string>> {
  const rows = await all<{ key: string; value: string }>(env.DB, "SELECT key, value FROM settings");
  const m: Record<string, string> = {};
  for (const r of rows) m[r.key] = r.value;
  return m;
}

export async function loadMissedCallSettings(env: Env): Promise<MissedCallSettings> {
  const s = await settingsMap(env);
  const forwardNumber = (s.owner_forward_number ?? "").trim();
  const dialTimeout = Number.parseInt(s.missed_call_dial_timeout ?? "20", 10);
  const cooldownHours = Number.parseInt(s.missed_call_cooldown_hours ?? "4", 10);
  return {
    enabled: (s.missed_call_enabled ?? "1") === "1",
    forwardNumber,
    dialTimeout: Number.isFinite(dialTimeout) ? dialTimeout : 20,
    textBody: (s.missed_call_text_body ?? "").trim() || DEFAULT_MISSED_CALL_BODY,
    cooldownHours: Number.isFinite(cooldownHours) ? cooldownHours : 4,
    ownerNotifyEnabled: (s.owner_notify_enabled ?? "1") === "1",
    ownerNotifyNumber: ((s.owner_notify_number ?? "").trim() || forwardNumber),
  };
}

export async function findOrCreateMissedCallContact(
  env: Env, phone: string
): Promise<{ id: string; created: boolean }> {
  const existing = await one<{ id: string }>(env.DB, "SELECT id FROM contacts WHERE phone = ?", phone);
  if (existing) return { id: existing.id, created: false };
  const id = uuid();
  const now = nowIso();
  await run(
    env.DB,
    `INSERT INTO contacts (id, phone, stage, source, lead_source, first_contact_method, acquisition_channel, created_at, updated_at)
     VALUES (?,?, 'new', 'missed-call', 'missed_call', 'phone', 'twilio_voice', ?, ?)`,
    id, phone, now, now
  );
  return { id, created: true };
}

export async function insertMissedCall(
  env: Env,
  row: {
    contactId: string | null; fromPhone: string; toPhone: string | null;
    callSid: string | null; dialStatus: string | null; texted: boolean;
    messageId: string | null; skipReason: SkipReason | null;
    templateSnapshot: string | null; durationSeconds: number | null;
  }
): Promise<string> {
  const id = uuid();
  await run(
    env.DB,
    `INSERT INTO missed_calls
      (id, contact_id, from_phone, to_phone, call_sid, dial_status, texted, message_id, skip_reason, text_template_snapshot, duration_seconds, acknowledged_at, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,NULL,?)`,
    id, row.contactId, row.fromPhone, row.toPhone, row.callSid, row.dialStatus,
    row.texted ? 1 : 0, row.messageId, row.skipReason, row.templateSnapshot,
    row.durationSeconds, nowIso()
  );
  return id;
}

/**
 * Reply-aware cooldown. Allow the auto-text if:
 *  - there is no prior auto-text to this number, OR
 *  - the cooldown window has expired AND the customer has sent no inbound
 *    message since that last auto-text.
 */
export async function isAutoTextAllowed(
  env: Env, contactId: string, fromPhone: string, cooldownHours: number, nowMs: number
): Promise<boolean> {
  const last = await one<{ created_at: string }>(
    env.DB,
    "SELECT created_at FROM missed_calls WHERE from_phone = ? AND texted = 1 ORDER BY created_at DESC LIMIT 1",
    fromPhone
  );
  if (!last) return true;
  const lastMs = Date.parse(last.created_at);
  const windowExpired = nowMs - lastMs >= cooldownHours * 60 * 60 * 1000;
  if (!windowExpired) return false;
  const reply = await one<{ id: string }>(
    env.DB,
    "SELECT id FROM messages WHERE contact_id = ? AND direction = 'inbound' AND created_at > ? LIMIT 1",
    contactId, last.created_at
  );
  return !reply;
}

// re-export for callers that normalize at the boundary
export { normalizePhone };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd crm && npx vitest run test/missedcall.test.ts`
Expected: PASS (all 5).

- [ ] **Step 5: Commit**

```bash
git add crm/src/lib/missedcall.ts crm/test/missedcall.test.ts
git commit -m "feat(crm): missed-call core — settings, contact upsert, cooldown, logging"
```

---

### Task 3: Orchestrator — `handleMissedCall` (opt-out, retry, owner notify, timeline)

**Files:**
- Modify: `crm/src/lib/missedcall.ts`
- Test: `crm/test/missedcall.test.ts` (add cases)

**Interfaces:**
- Consumes: everything from Task 2; `sendSms` from `src/lib/sms.ts`; `logActivity` from `src/lib/activity.ts`.
- Produces:
  - `interface MissedCallInput { fromPhone: string | null; toPhone: string | null; callSid: string | null; dialStatus: string | null; durationSeconds: number | null }`
  - `interface MissedCallDeps { send?: (env: Env, msg: { contactId?: string; toPhone: string; body: string }) => Promise<{ id: string; status: string }>; nowMs?: number }`
  - `interface MissedCallResult { logged: boolean; texted: boolean; skipReason: SkipReason | null; contactId: string | null; messageId: string | null; ownerNotified: boolean }`
  - `async function handleMissedCall(env: Env, input: MissedCallInput, deps?: MissedCallDeps): Promise<MissedCallResult>`

- [ ] **Step 1: Write the failing tests**

Append to `crm/test/missedcall.test.ts`:

```ts
import { handleMissedCall } from "../src/lib/missedcall";

describe("handleMissedCall orchestrator", () => {
  const base = { toPhone: "+17866049110", callSid: "CA1", durationSeconds: null };

  it("answered call: logs answered, no text, no owner notify", async () => {
    const sends: string[] = [];
    const send = async (_e: any, m: any) => { sends.push(m.toPhone); return { id: "x", status: "logged" }; };
    const r = await handleMissedCall(env, { ...base, fromPhone: "+13058880001", dialStatus: "completed", durationSeconds: 42 }, { send });
    expect(r.skipReason).toBe("answered");
    expect(r.texted).toBe(false);
    expect(r.ownerNotified).toBe(false);
    expect(sends.length).toBe(0);
    const row = await one<{ duration_seconds: number }>(env.DB, "SELECT duration_seconds FROM missed_calls WHERE call_sid = 'CA1'");
    expect(row?.duration_seconds).toBe(42);
  });

  it("unknown caller: logs unknown_number, no contact, no text", async () => {
    const r = await handleMissedCall(env, { ...base, fromPhone: null, dialStatus: "no-answer" }, {});
    expect(r.skipReason).toBe("unknown_number");
    expect(r.contactId).toBeNull();
    expect(r.texted).toBe(false);
  });

  it("self guard: from == forward number is skipped", async () => {
    await run(env.DB, "INSERT INTO settings (key,value) VALUES ('owner_forward_number','+13059990000') ON CONFLICT(key) DO UPDATE SET value=excluded.value");
    const r = await handleMissedCall(env, { ...base, fromPhone: "+13059990000", dialStatus: "busy" }, {});
    expect(r.skipReason).toBe("self_guard");
    expect(r.texted).toBe(false);
  });

  it("opted-out contact: no text, skip_reason opt_out, still logs + owner notify", async () => {
    const { id } = await findOrCreateMissedCallContact(env, "+13051230001");
    await run(env.DB, "UPDATE contacts SET sms_opt_out_auto = 1 WHERE id = ?", id);
    const sends: any[] = [];
    const send = async (_e: any, m: any) => { sends.push(m); return { id: "o", status: "logged" }; };
    await run(env.DB, "INSERT INTO settings (key,value) VALUES ('owner_notify_number','+13050000009') ON CONFLICT(key) DO UPDATE SET value=excluded.value");
    const r = await handleMissedCall(env, { ...base, fromPhone: "+13051230001", dialStatus: "no-answer" }, { send });
    expect(r.skipReason).toBe("opt_out");
    expect(r.texted).toBe(false);
    expect(r.ownerNotified).toBe(true);
    expect(sends.some((m) => m.toPhone === "+13050000009")).toBe(true); // owner SMS only
    expect(sends.some((m) => m.toPhone === "+13051230001")).toBe(false); // no customer text
  });

  it("happy path: sends text, snapshot saved, timeline + owner notify", async () => {
    const sends: any[] = [];
    const send = async (_e: any, m: any) => { sends.push(m); return { id: "msg-1", status: "sent" }; };
    const r = await handleMissedCall(env, { ...base, fromPhone: "+13051230002", dialStatus: "no-answer" }, { send });
    expect(r.texted).toBe(true);
    expect(r.skipReason).toBeNull();
    expect(r.messageId).toBe("msg-1");
    expect(r.ownerNotified).toBe(true);
    const mc = await one<{ text_template_snapshot: string; message_id: string }>(env.DB, "SELECT text_template_snapshot, message_id FROM missed_calls WHERE from_phone = '+13051230002'");
    expect(mc?.message_id).toBe("msg-1");
    expect((mc?.text_template_snapshot ?? "").length).toBeGreaterThan(0);
    const acts = await all<{ title: string }>(env.DB, "SELECT title FROM activities WHERE contact_id = ?", r.contactId!);
    expect(acts.some((a) => a.title.includes("Auto-text sent"))).toBe(true);
  });

  it("retry: first send fails, second succeeds -> texted true", async () => {
    let n = 0;
    const send = async (_e: any, m: any) => { n++; return n === 1 ? { id: "f", status: "failed" } : { id: "ok", status: "sent" }; };
    const r = await handleMissedCall(env, { ...base, fromPhone: "+13051230003", dialStatus: "failed" }, { send });
    expect(r.texted).toBe(true);
    expect(r.messageId).toBe("ok");
    expect(n).toBe(2);
  });

  it("retry exhausted: both attempts fail -> sms_failed, no third attempt", async () => {
    let n = 0;
    const send = async (_e: any, m: any) => { n++; return { id: "f" + n, status: "failed" }; };
    const r = await handleMissedCall(env, { ...base, fromPhone: "+13051230004", dialStatus: "no-answer" }, { send });
    expect(r.texted).toBe(false);
    expect(r.skipReason).toBe("sms_failed");
    // 2 customer attempts + 1 owner notify = 3 calls max; ensure no more than 2 customer sends
    const customerSends = n; // send used for both customer+owner in this fake; assert retry cap via <= 3
    expect(customerSends).toBeLessThanOrEqual(3);
  });

  it("disabled feature: skip_reason disabled, nothing sent", async () => {
    await run(env.DB, "INSERT INTO settings (key,value) VALUES ('missed_call_enabled','0') ON CONFLICT(key) DO UPDATE SET value=excluded.value");
    const r = await handleMissedCall(env, { ...base, fromPhone: "+13051230005", dialStatus: "no-answer" }, {});
    expect(r.skipReason).toBe("disabled");
    expect(r.texted).toBe(false);
    await run(env.DB, "UPDATE settings SET value='1' WHERE key='missed_call_enabled'");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd crm && npx vitest run test/missedcall.test.ts`
Expected: FAIL — `handleMissedCall` not exported.

- [ ] **Step 3: Add the orchestrator**

Append to `crm/src/lib/missedcall.ts`:

```ts
import { logActivity } from "./activity";
import { sendSms } from "./sms";

export interface MissedCallInput {
  fromPhone: string | null;
  toPhone: string | null;
  callSid: string | null;
  dialStatus: string | null;
  durationSeconds: number | null;
}

export interface MissedCallDeps {
  send?: (env: Env, msg: { contactId?: string; toPhone: string; body: string }) => Promise<{ id: string; status: string }>;
  nowMs?: number;
}

export interface MissedCallResult {
  logged: boolean;
  texted: boolean;
  skipReason: SkipReason | null;
  contactId: string | null;
  messageId: string | null;
  ownerNotified: boolean;
}

const TIMELINE_TITLES: Record<string, string> = {
  answered: "Missed Call — Answered",
  cooldown: "Missed Call — Skipped (Cooldown)",
  disabled: "Missed Call — Skipped (Disabled)",
  opt_out: "Missed Call — Skipped (Opt Out)",
  sms_failed: "Missed Call — Text failed",
  sent: "Missed Call — Auto-text sent",
};

function ownerNotifyBody(env: Env, name: string, phone: string, texted: boolean, contactId: string): string {
  const base = (env.PUBLIC_BASE_URL ?? "").replace(/\/$/, "");
  const link = base ? `${base}/contacts/${contactId}` : `/contacts/${contactId}`;
  const when = new Date().toLocaleString("en-US", { timeStyle: "short", dateStyle: "short" });
  return `Missed call: ${name} (${phone}) at ${when}. Auto-text ${texted ? "sent" : "NOT sent"}. Open: ${link}`;
}

export async function handleMissedCall(
  env: Env, input: MissedCallInput, deps: MissedCallDeps = {}
): Promise<MissedCallResult> {
  const send = deps.send ?? sendSms;
  const nowMs = deps.nowMs ?? Date.now();
  const settings = await loadMissedCallSettings(env);
  const from = normalizePhone(input.fromPhone);
  const dial = input.dialStatus;

  const logOnly = async (contactId: string | null, texted: boolean, skip: SkipReason | null, messageId: string | null, snapshot: string | null): Promise<string> =>
    insertMissedCall(env, {
      contactId, fromPhone: from ?? (input.fromPhone ?? ""), toPhone: input.toPhone,
      callSid: input.callSid, dialStatus: dial, texted, messageId, skipReason: skip,
      templateSnapshot: snapshot, durationSeconds: input.durationSeconds,
    });

  // 1. Owner answered
  if (dial === "completed") {
    await logOnly(null, false, "answered", null, null);
    return { logged: true, texted: false, skipReason: "answered", contactId: null, messageId: null, ownerNotified: false };
  }
  // 2. Unknown caller
  if (!from) {
    await logOnly(null, false, "unknown_number", null, null);
    return { logged: true, texted: false, skipReason: "unknown_number", contactId: null, messageId: null, ownerNotified: false };
  }
  // 3. Self / loop guard
  if (from === settings.forwardNumber || (env.TWILIO_FROM_NUMBER && from === normalizePhone(env.TWILIO_FROM_NUMBER))) {
    await logOnly(null, false, "self_guard", null, null);
    return { logged: true, texted: false, skipReason: "self_guard", contactId: null, messageId: null, ownerNotified: false };
  }
  // 4. Feature disabled
  if (!settings.enabled) {
    await logOnly(null, false, "disabled", null, null);
    return { logged: true, texted: false, skipReason: "disabled", contactId: null, messageId: null, ownerNotified: false };
  }

  // From here we have a real missed call from an external number -> owner is notified.
  const { id: contactId } = await findOrCreateMissedCallContact(env, from);
  const contact = await one<{ first_name: string | null; last_name: string | null; sms_opt_out_auto: number }>(
    env.DB, "SELECT first_name, last_name, sms_opt_out_auto FROM contacts WHERE id = ?", contactId);
  const name = [contact?.first_name, contact?.last_name].filter(Boolean).join(" ").trim() || "Unknown Caller";

  let texted = false;
  let skip: SkipReason | null = null;
  let messageId: string | null = null;
  let snapshot: string | null = null;

  if (contact?.sms_opt_out_auto === 1) {
    skip = "opt_out";
  } else if (!(await isAutoTextAllowed(env, contactId, from, settings.cooldownHours, nowMs))) {
    skip = "cooldown";
  } else {
    // Send with exactly one retry on failure.
    let res = await send(env, { contactId, toPhone: from, body: settings.textBody });
    if (res.status === "failed") res = await send(env, { contactId, toPhone: from, body: settings.textBody });
    if (res.status === "failed") {
      skip = "sms_failed";
    } else {
      texted = true;
      messageId = res.id;
      snapshot = settings.textBody;
    }
  }

  const mcId = await logOnly(contactId, texted, skip, messageId, snapshot);

  // Timeline event
  const title = texted ? TIMELINE_TITLES.sent : (skip ? TIMELINE_TITLES[skip] : "Missed Call");
  await logActivity(env.DB, {
    contactId, type: "missed_call", title,
    payload: { missed_call_id: mcId, dial_status: dial, texted, skip_reason: skip }, actor: "system",
  });

  // Owner notification (SMS). Skipped only if disabled or no target number.
  let ownerNotified = false;
  if (settings.ownerNotifyEnabled && settings.ownerNotifyNumber) {
    await send(env, { toPhone: settings.ownerNotifyNumber, body: ownerNotifyBody(env, name, from, texted, contactId) });
    ownerNotified = true;
  }

  return { logged: true, texted, skipReason: skip, contactId, messageId, ownerNotified };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd crm && npx vitest run test/missedcall.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add crm/src/lib/missedcall.ts crm/test/missedcall.test.ts
git commit -m "feat(crm): handleMissedCall — opt-out, retry, reply-aware cooldown, owner SMS, timeline"
```

---

### Task 4: Twilio Voice webhooks (`/twilio/voice`, `/twilio/voice/complete`)

**Files:**
- Modify: `crm/src/routes/public.ts` (add two routes near the existing `/twilio/inbound` block; reuse `twilioParams`, `verifyTwilioSignature`)
- Test: `crm/test/missedcall.test.ts` (add route tests) or `crm/test/voice.test.ts` (new). Use `crm/test/voice.test.ts`.

**Interfaces:**
- Consumes: `handleMissedCall`, `loadMissedCallSettings`, `MissedCallSettings` from `src/lib/missedcall.ts`; existing `twilioParams`, `verifyTwilioSignature`.
- Produces:
  - `function buildVoiceTwiml(s: MissedCallSettings): string` (exported from `src/lib/missedcall.ts`) — pure TwiML builder, unit-tested without a signature.
  - `POST /api/twilio/voice` → TwiML XML (from `buildVoiceTwiml`); `POST /api/twilio/voice/complete` → empty TwiML, runs `handleMissedCall` via `c.executionCtx.waitUntil`.

**Why a pure builder:** the existing `test/sms.test.ts` asserts `verifyTwilioSignature` fails closed when the env has no `TWILIO_AUTH_TOKEN`. Do NOT add a global `TWILIO_AUTH_TOKEN` to `vitest.config.ts` — it would undermine that test's intent. Instead, unit-test the TwiML content via the pure `buildVoiceTwiml`, and test the routes only for the fail-closed 403 path (which needs no token).

- [ ] **Step 1: Write the failing tests**

Create `crm/test/voice.test.ts`:

```ts
import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { buildVoiceTwiml, type MissedCallSettings } from "../src/lib/missedcall";

const baseSettings: MissedCallSettings = {
  enabled: true, forwardNumber: "", dialTimeout: 20, textBody: "hi",
  cooldownHours: 4, ownerNotifyEnabled: true, ownerNotifyNumber: "",
};

describe("buildVoiceTwiml", () => {
  it("dials forward number with action + timeout when enabled", () => {
    const xml = buildVoiceTwiml({ ...baseSettings, forwardNumber: "+13051112222", dialTimeout: 25 });
    expect(xml).toContain("<Dial");
    expect(xml).toContain("+13051112222");
    expect(xml).toContain('action="/api/twilio/voice/complete"');
    expect(xml).toContain('timeout="25"');
  });

  it("dials without action callback when disabled", () => {
    const xml = buildVoiceTwiml({ ...baseSettings, forwardNumber: "+13051112222", enabled: false });
    expect(xml).toContain("<Dial");
    expect(xml).toContain("+13051112222");
    expect(xml).not.toContain("action=");
  });

  it("redirects straight to complete when no forward number", () => {
    const xml = buildVoiceTwiml({ ...baseSettings, forwardNumber: "" });
    expect(xml).toContain("<Redirect");
    expect(xml).toContain("/api/twilio/voice/complete");
    expect(xml).not.toContain("<Dial");
  });
});

describe("twilio voice webhooks (fail closed)", () => {
  it("fails closed on bad signature (voice)", async () => {
    const res = await SELF.fetch("http://x/api/twilio/voice", {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ From: "+13050000001", To: "+17866049110", CallSid: "CA9" }).toString(),
    });
    expect(res.status).toBe(403);
  });

  it("fails closed on bad signature (complete)", async () => {
    const res = await SELF.fetch("http://x/api/twilio/voice/complete", {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ From: "+13050000001", DialCallStatus: "no-answer" }).toString(),
    });
    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd crm && npx vitest run test/voice.test.ts`
Expected: FAIL — `buildVoiceTwiml` not exported; routes 404.

- [ ] **Step 3a: Add the pure TwiML builder**

Append to `crm/src/lib/missedcall.ts`:

```ts
/** Pure TwiML builder for the incoming-call webhook. */
export function buildVoiceTwiml(s: MissedCallSettings): string {
  if (!s.forwardNumber) {
    return `<Response><Redirect method="POST">/api/twilio/voice/complete?DialCallStatus=no-answer</Redirect></Response>`;
  }
  if (!s.enabled) {
    return `<Response><Dial timeout="${s.dialTimeout}">${s.forwardNumber}</Dial></Response>`;
  }
  return `<Response><Dial timeout="${s.dialTimeout}" action="/api/twilio/voice/complete" method="POST">${s.forwardNumber}</Dial></Response>`;
}
```

- [ ] **Step 3b: Add the routes**

In `crm/src/routes/public.ts`, add imports at the top (alongside existing imports):

```ts
import { buildVoiceTwiml, handleMissedCall, loadMissedCallSettings } from "../lib/missedcall";
```

Add after the `/twilio/status` route:

```ts
// --- Twilio Voice: incoming call. Ring the owner's cell, then fall through to complete. ---
publicRoutes.post("/twilio/voice", async (c) => {
  const params = await twilioParams(c);
  const ok = await verifyTwilioSignature(c.env, c.req.url, params, c.req.header("X-Twilio-Signature"));
  if (!ok) return c.text("forbidden", 403);
  const s = await loadMissedCallSettings(c.env);
  return c.text(buildVoiceTwiml(s), 200, { "Content-Type": "text/xml" });
});

// --- Twilio Voice: dial completed. Run text-back logic in the background. ---
publicRoutes.post("/twilio/voice/complete", async (c) => {
  const params = await twilioParams(c);
  const ok = await verifyTwilioSignature(c.env, c.req.url, params, c.req.header("X-Twilio-Signature"));
  if (!ok) return c.text("forbidden", 403);

  const dialStatus = params.DialCallStatus ?? c.req.query("DialCallStatus") ?? null;
  const durRaw = params.DialCallDuration ?? params.CallDuration ?? "";
  const durationSeconds = /^\d+$/.test(durRaw) ? Number.parseInt(durRaw, 10) : null;

  c.executionCtx.waitUntil(
    handleMissedCall(c.env, {
      fromPhone: params.From ?? null,
      toPhone: params.To ?? null,
      callSid: params.CallSid ?? null,
      dialStatus,
      durationSeconds,
    }).then(() => undefined).catch(() => undefined)
  );
  return c.text("<Response></Response>", 200, { "Content-Type": "text/xml" });
});
```

Note on the `Redirect` query param: Twilio recomputes the signature base string for the redirected POST against the new URL, so signature verification still holds on `/complete`. The `no-answer` default applies only when there is no cell to dial.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd crm && npx vitest run test/voice.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add crm/src/lib/missedcall.ts crm/src/routes/public.ts crm/test/voice.test.ts
git commit -m "feat(crm): Twilio voice webhooks — dial owner, background text-back on no-answer"
```

---

### Task 5: Inbox badge data + acknowledge-on-view

**Files:**
- Modify: `crm/src/routes/messages.ts` (inbox query returns badge fields; thread GET acknowledges missed calls)
- Test: `crm/test/missedcall.test.ts` or `crm/test/voice.test.ts` — add to `crm/test/voice.test.ts`.

**Interfaces:**
- Consumes: `missed_calls` table.
- Produces: `GET /api/messages/inbox` items include `missed_unacked` (0/1) and `missed_texted` (0/1); `GET /api/messages?contact_id=` sets `acknowledged_at = now()` for that contact's unacknowledged rows.

- [ ] **Step 1: Write the failing test**

Append to `crm/test/voice.test.ts`:

```ts
import { one } from "../src/lib/db";
import { handleMissedCall, findOrCreateMissedCallContact } from "../src/lib/missedcall";

describe("inbox badge + acknowledge", () => {
  const AUTH = { Authorization: "Bearer dev-agent-key", "Content-Type": "application/json" };

  it("badge shows for an unacknowledged missed call, then clears after viewing the thread", async () => {
    const send = async () => ({ id: "b1", status: "sent" });
    const r = await handleMissedCall(env, { fromPhone: "+13057770001", toPhone: "+17866049110", callSid: "CAb1", dialStatus: "no-answer", durationSeconds: null }, { send });
    const cid = r.contactId!;

    const inbox1 = (await (await SELF.fetch("http://x/api/messages/inbox", { headers: AUTH })).json()) as { items: Array<{ contact_id: string; missed_unacked: number; missed_texted: number }> };
    const row1 = inbox1.items.find((m) => m.contact_id === cid)!;
    expect(row1.missed_unacked).toBe(1);
    expect(row1.missed_texted).toBe(1);

    // View the thread -> acknowledges
    await SELF.fetch(`http://x/api/messages?contact_id=${cid}`, { headers: AUTH });

    const ack = await one<{ acknowledged_at: string | null }>(env.DB, "SELECT acknowledged_at FROM missed_calls WHERE contact_id = ?", cid);
    expect(ack?.acknowledged_at).not.toBeNull();

    const inbox2 = (await (await SELF.fetch("http://x/api/messages/inbox", { headers: AUTH })).json()) as { items: Array<{ contact_id: string; missed_unacked: number }> };
    const row2 = inbox2.items.find((m) => m.contact_id === cid)!;
    expect(row2.missed_unacked).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd crm && npx vitest run test/voice.test.ts -t "inbox badge"`
Expected: FAIL — `missed_unacked` undefined; ack not set.

- [ ] **Step 3: Update the inbox query and thread GET**

In `crm/src/routes/messages.ts`, replace the inbox query (the `messageRoutes.get("/inbox", ...)` body's SQL) with a version that joins unacknowledged missed calls:

```ts
messageRoutes.get("/inbox", async (c) => {
  const items = await all(
    c.env.DB,
    `SELECT m.*, ct.first_name, ct.last_name, ct.phone,
            CASE WHEN mc.cnt > 0 THEN 1 ELSE 0 END AS missed_unacked,
            COALESCE(mc.texted_any, 0) AS missed_texted
     FROM messages m
     JOIN contacts ct ON ct.id = m.contact_id
     JOIN (
       SELECT contact_id, MAX(id) AS max_id
       FROM messages WHERE channel = 'sms' AND contact_id IS NOT NULL
       GROUP BY contact_id
     ) last ON last.contact_id = m.contact_id AND last.max_id = m.id
     LEFT JOIN (
       SELECT contact_id, COUNT(*) AS cnt, MAX(texted) AS texted_any
       FROM missed_calls
       WHERE acknowledged_at IS NULL AND contact_id IS NOT NULL
       GROUP BY contact_id
     ) mc ON mc.contact_id = m.contact_id
     ORDER BY m.id DESC LIMIT 100`
  );
  return c.json({ items });
});
```

In the same file, at the top of the thread handler (`messageRoutes.get("/", ...)`), after resolving `contactId` and before/after fetching items, acknowledge:

```ts
messageRoutes.get("/", async (c) => {
  const contactId = c.req.query("contact_id");
  if (!contactId) return c.json({ error: "contact_id_required" }, 400);
  const limit = Math.min(Number(c.req.query("limit")) > 0 ? Number(c.req.query("limit")) : 200, 500);
  await run(
    c.env.DB,
    "UPDATE missed_calls SET acknowledged_at = ? WHERE contact_id = ? AND acknowledged_at IS NULL",
    new Date().toISOString(), contactId
  );
  const items = await all(
    c.env.DB,
    `SELECT * FROM messages
     WHERE channel = 'sms' AND contact_id = ?
     ORDER BY id ASC LIMIT ?`,
    contactId, limit
  );
  return c.json({ items });
});
```

Ensure `run` is imported in `messages.ts` (it already is).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd crm && npx vitest run test/voice.test.ts -t "inbox badge"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add crm/src/routes/messages.ts crm/test/voice.test.ts
git commit -m "feat(crm): inbox missed-call badge fields + acknowledge missed calls on thread view"
```

---

### Task 6: Settings UI — Missed-Call Text-Back section

**Files:**
- Modify: `crm/admin/src/pages/Settings.tsx`

**Interfaces:**
- Consumes: `GET/PUT /api/settings` (existing). Keys: `missed_call_enabled`, `owner_forward_number`, `missed_call_dial_timeout`, `missed_call_text_body`, `missed_call_cooldown_hours`, `owner_notify_enabled`, `owner_notify_number`.
- Produces: a new settings section (UI only — no automated test; verified via preview).

- [ ] **Step 1: Add state + load**

In `Settings.tsx`, add a default constant near the top (after `DEFAULT_HOURS`):

```ts
const DEFAULT_MISSED_BODY = "Hey, this is BH Car Detailing - sorry we missed your call! Reply here with what you need and we'll be in touch.\nIf you'd like to book on your own our website is bhcardetails.com";
```

Add state inside the component (near the other `useState` calls):

```ts
const [mc, setMc] = useState({ enabled: true, forward: "", timeout: "20", body: "", cooldown: "4", notifyEnabled: true, notifyNumber: "" });
const [mcNote, setMcNote] = useState("");
```

In the existing `useEffect` settings `.then((r) => { ... })`, add:

```ts
setMc({
  enabled: (r.settings.missed_call_enabled ?? "1") === "1",
  forward: r.settings.owner_forward_number ?? "",
  timeout: r.settings.missed_call_dial_timeout ?? "20",
  body: r.settings.missed_call_text_body ?? DEFAULT_MISSED_BODY,
  cooldown: r.settings.missed_call_cooldown_hours ?? "4",
  notifyEnabled: (r.settings.owner_notify_enabled ?? "1") === "1",
  notifyNumber: r.settings.owner_notify_number ?? "",
});
```

- [ ] **Step 2: Add the save handler**

Add near the other `save*` functions:

```ts
async function saveMissedCall() {
  setMcNote("");
  const pairs: Array<[string, string]> = [
    ["missed_call_enabled", mc.enabled ? "1" : "0"],
    ["owner_forward_number", mc.forward.trim()],
    ["missed_call_dial_timeout", String(Number.parseInt(mc.timeout, 10) || 20)],
    ["missed_call_text_body", mc.body],
    ["missed_call_cooldown_hours", String(Number.parseInt(mc.cooldown, 10) || 4)],
    ["owner_notify_enabled", mc.notifyEnabled ? "1" : "0"],
    ["owner_notify_number", mc.notifyNumber.trim()],
  ];
  try {
    for (const [key, value] of pairs) {
      await api("/api/settings", { method: "PUT", body: JSON.stringify({ key, value }) });
    }
    setMcNote("Saved.");
  } catch { setMcNote("Couldn't save — try again."); }
}
```

- [ ] **Step 3: Add the section markup**

Inside the `<div className="max-w-xl space-y-6">` block (e.g. right after the "Text message template" `<section>`), add:

```tsx
<section className="rounded-xl bg-white p-5 shadow-sm">
  <h2 className="mb-2 font-medium">Missed-call text-back</h2>
  <p className="mb-3 text-sm text-neutral-500">When someone calls your CRM number and you don't pick up, we auto-text them and log the lead. Rings your cell first.</p>
  <label className="mb-3 flex items-center gap-2 text-sm">
    <input type="checkbox" checked={mc.enabled} onChange={(e) => setMc({ ...mc, enabled: e.target.checked })} /> Enable missed-call text-back
  </label>
  <label className="mb-2 block text-sm">Your cell (rings first)
    <input value={mc.forward} onChange={(e) => setMc({ ...mc, forward: e.target.value })} placeholder="+1305…" className="mt-1 min-h-[44px] w-full rounded-md border border-neutral-300 px-3 text-sm" />
  </label>
  <div className="mb-2 flex gap-3">
    <label className="text-sm">Ring seconds
      <input type="number" min={5} max={60} value={mc.timeout} onChange={(e) => setMc({ ...mc, timeout: e.target.value })} className="mt-1 min-h-[44px] w-24 rounded-md border border-neutral-300 px-2 text-sm" />
    </label>
    <label className="text-sm">Cooldown (hours)
      <input type="number" min={0} value={mc.cooldown} onChange={(e) => setMc({ ...mc, cooldown: e.target.value })} className="mt-1 min-h-[44px] w-24 rounded-md border border-neutral-300 px-2 text-sm" />
    </label>
  </div>
  <label className="mb-2 block text-sm">Auto-text message
    <textarea value={mc.body} onChange={(e) => setMc({ ...mc, body: e.target.value })} rows={4} className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm" />
  </label>
  <label className="mb-2 flex items-center gap-2 text-sm">
    <input type="checkbox" checked={mc.notifyEnabled} onChange={(e) => setMc({ ...mc, notifyEnabled: e.target.checked })} /> Text me when I miss a call
  </label>
  <label className="mb-3 block text-sm">Notify this number (defaults to your cell)
    <input value={mc.notifyNumber} onChange={(e) => setMc({ ...mc, notifyNumber: e.target.value })} placeholder="+1305…" className="mt-1 min-h-[44px] w-full rounded-md border border-neutral-300 px-3 text-sm" />
  </label>
  <div className="flex items-center gap-3">
    <button onClick={saveMissedCall} className="min-h-[44px] rounded-md bg-red-600 px-4 text-sm text-white">Save</button>
    {mcNote && <span className="text-xs text-neutral-500">{mcNote}</span>}
  </div>
</section>
```

- [ ] **Step 4: Typecheck the admin build**

Run: `cd crm/admin && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add crm/admin/src/pages/Settings.tsx
git commit -m "feat(crm): Settings — missed-call text-back configuration section"
```

---

### Task 7: Inbox badge UI

**Files:**
- Modify: `crm/admin/src/pages/Inbox.tsx`

**Interfaces:**
- Consumes: `missed_unacked` and `missed_texted` fields added to inbox items in Task 5.
- Produces: a chip on inbox rows with an unacknowledged missed call.

- [ ] **Step 1: Extend the row type**

In `Inbox.tsx`, add to the `InboxRow` interface:

```ts
missed_unacked?: number;
missed_texted?: number;
```

- [ ] **Step 2: Render the badge**

Inside the `<Link>` for each row, under the name `<div className="font-medium">…</div>`, add a chip when unacknowledged. Reuse the rounded-full chip styling already used for labels:

```tsx
{m.missed_unacked ? (
  <span className="mt-0.5 inline-block rounded-full bg-red-600 px-2 py-0.5 text-xs font-medium text-white">
    {m.missed_texted ? "🔥 New Missed Call — Auto Text Sent" : "Missed Call — Awaiting Reply"}
  </span>
) : null}
```

- [ ] **Step 3: Typecheck the admin build**

Run: `cd crm/admin && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Full test + build sanity**

Run: `cd crm && npx vitest run`
Expected: all tests PASS (existing + new).

Run: `cd crm/admin && npm run build`
Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add crm/admin/src/pages/Inbox.tsx
git commit -m "feat(crm): inbox badge for new missed-call conversations"
```

---

## Manual verification (after all tasks)

1. In Twilio console, set the CRM number's **Voice** webhook to `POST https://<crm-host>/api/twilio/voice`.
2. Set `owner_forward_number` in Settings to your cell.
3. Call the CRM number; don't answer. Confirm: you get the auto-text, the contact appears in the inbox with the badge, the owner-notify SMS arrives, and the contact timeline shows "Missed Call — Auto-text sent".
4. Open the conversation → badge clears.
5. Call again within the cooldown → no second text; timeline shows "Skipped (Cooldown)".

## Self-Review (completed by plan author)

- **Spec coverage:** V1 §call-flow → Task 4; V1 data → Task 1; V1 settings → Task 6. V1.1: (1) opt-out → Tasks 1/3; (2) skip_reason → Tasks 1/3; (3) snapshot → Tasks 1/3; (4) retry → Task 3; (5) owner notify → Task 3; (6) inbox update → Task 5 (data ordering); (7) badge → Tasks 1/5/7; (8) reply-aware cooldown → Task 2; (9) lead source → Tasks 1/2; (10) duration → Tasks 1/3/4; (11) migration → Task 1; (12) timeline → Task 3; (13) tests → Tasks 1–5. Deferred (realtime, 30s-delayed retry) intentionally excluded.
- **Placeholder scan:** none — all steps carry concrete code/SQL/commands.
- **Type consistency:** `SkipReason`, `MissedCallInput`, `MissedCallResult`, `handleMissedCall`, `isAutoTextAllowed`, `findOrCreateMissedCallContact`, `insertMissedCall`, `loadMissedCallSettings` names are consistent across tasks; inbox fields `missed_unacked`/`missed_texted` match between Task 5 (produce) and Task 7 (consume).
