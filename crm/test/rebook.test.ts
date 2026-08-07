import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { all, nowIso, one, run, uuid } from "../src/lib/db";
import {
  DAY_MS, bucketFor, dueList, onJobCompleted, rebookDaysForJob, recomputeAllDueDates,
  runRebook, sendRebookOffer, snoozeRebook,
} from "../src/lib/rebook";
import { canSend } from "../src/lib/guardrails";

const AUTH = { Authorization: "Bearer dev-agent-key", "Content-Type": "application/json" };

async function makeContact(first: string, phone: string): Promise<string> {
  const id = uuid();
  const now = nowIso();
  await run(env.DB,
    "INSERT INTO contacts (id, first_name, phone, stage, source, created_at, updated_at) VALUES (?,?,?, 'customer', 'test', ?, ?)",
    id, first, phone, now, now);
  return id;
}

async function makeJob(
  contactId: string, opts: { services?: unknown[]; price?: number; status?: string } = {}
): Promise<string> {
  const id = uuid();
  const now = nowIso();
  await run(env.DB,
    `INSERT INTO jobs (id, contact_id, title, services, price_cents, status, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?)`,
    id, contactId, "Test job", JSON.stringify(opts.services ?? []), opts.price ?? 25000,
    opts.status ?? "scheduled", now, now);
  return id;
}

const contact = (id: string) => one<{
  job_count: number; lifetime_value_cents: number; next_due_at: string | null;
  last_service_at: string | null; rebook_snooze_until: string | null;
}>(env.DB, "SELECT job_count, lifetime_value_cents, next_due_at, last_service_at, rebook_snooze_until FROM contacts WHERE id = ?", id);

describe("cadence resolution", () => {
  it("uses the longest cadence among the job's services (the anchor service)", async () => {
    const cid = await makeContact("Cadence", "+13055552001");
    // Wash & Wax (14d) bundled with a Full Detail (60d) — the detail governs.
    const jid = await makeJob(cid, { services: [{ service_id: "svc_washwax" }, { service_id: "svc_full" }] });
    const job = await one(env.DB, "SELECT * FROM jobs WHERE id = ?", jid);
    expect(await rebookDaysForJob(env, job as never)).toBe(60);
  });

  it("lets a per-contact override beat the service default", async () => {
    const cid = await makeContact("Override", "+13055552002");
    await run(env.DB, "UPDATE contacts SET rebook_days_override = 21 WHERE id = ?", cid);
    const jid = await makeJob(cid, { services: [{ service_id: "svc_full" }] });
    const job = await one(env.DB, "SELECT * FROM jobs WHERE id = ?", jid);
    expect(await rebookDaysForJob(env, job as never)).toBe(21);
  });

  it("falls back to the default when the job has no linked services", async () => {
    const cid = await makeContact("Custom", "+13055552003");
    const jid = await makeJob(cid, { services: [{ name: "Custom one-off", price_cents: 9000 }] });
    const job = await one(env.DB, "SELECT * FROM jobs WHERE id = ?", jid);
    expect(await rebookDaysForJob(env, job as never)).toBe(60);
  });
});

describe("onJobCompleted", () => {
  it("stamps completion, rolls up totals, and sets the due date", async () => {
    const cid = await makeContact("Closer", "+13055552010");
    const jid = await makeJob(cid, { services: [{ service_id: "svc_full" }], price: 30000 });
    await run(env.DB, "UPDATE jobs SET status = 'completed' WHERE id = ?", jid);

    const now = Date.parse("2026-07-28T15:00:00.000Z");
    const res = await onJobCompleted(env, jid, now);
    expect(res.status).toBe("completed");

    const c = await contact(cid);
    expect(c?.job_count).toBe(1);
    expect(c?.lifetime_value_cents).toBe(30000);
    expect(c?.last_service_at).toBeTruthy();
    // svc_full seeds at 60 days
    expect(Date.parse(c!.next_due_at!) - now).toBe(60 * DAY_MS);
  });

  it("is idempotent — a second call cannot double-count revenue", async () => {
    const cid = await makeContact("Doubler", "+13055552011");
    const jid = await makeJob(cid, { services: [{ service_id: "svc_full" }], price: 20000 });
    await run(env.DB, "UPDATE jobs SET status = 'completed' WHERE id = ?", jid);

    await onJobCompleted(env, jid);
    const second = await onJobCompleted(env, jid);
    expect(second.status).toBe("already_completed");

    const c = await contact(cid);
    expect(c?.job_count).toBe(1);
    expect(c?.lifetime_value_cents).toBe(20000);
  });

  it("schedules no rebook for services with no cadence (one-off work)", async () => {
    const cid = await makeContact("OneOff", "+13055552012");
    const sid = uuid();
    await run(env.DB,
      "INSERT INTO services (id, name, size_pricing, base_price_cents, rebook_days, created_at, updated_at) VALUES (?,?, '{}', ?, NULL, ?, ?)",
      sid, "Curb Rash", 15500, nowIso(), nowIso());
    const jid = await makeJob(cid, { services: [{ service_id: sid }] });
    await run(env.DB, "UPDATE jobs SET status = 'completed' WHERE id = ?", jid);

    const res = await onJobCompleted(env, jid);
    expect(res.next_due_at).toBeNull();
    expect((await contact(cid))?.next_due_at).toBeNull();
  });

  it("fires from the job PATCH route", async () => {
    const cid = await makeContact("Patched", "+13055552013");
    const jid = await makeJob(cid, { services: [{ service_id: "svc_washwax" }], price: 12000 });

    const r = await SELF.fetch(`http://x/api/jobs/${jid}`, {
      method: "PATCH", headers: AUTH, body: JSON.stringify({ status: "completed" }),
    });
    expect(r.status).toBe(200);

    const c = await contact(cid);
    expect(c?.job_count).toBe(1);
    expect(c?.next_due_at).toBeTruthy();   // Wash & Wax → 14 days out
  });
});

describe("due buckets", () => {
  const now = Date.parse("2026-07-28T12:00:00.000Z");
  it("classifies by how far out the due date is", () => {
    expect(bucketFor(now + 30 * DAY_MS, now)).toBeNull();      // beyond the horizon
    expect(bucketFor(now + 3 * DAY_MS, now)).toBe("due_soon");
    expect(bucketFor(now, now)).toBe("due_now");
    expect(bucketFor(now - 20 * DAY_MS, now)).toBe("overdue");
    expect(bucketFor(now - 90 * DAY_MS, now)).toBe("lapsing");
  });
});

describe("dueList", () => {
  it("ranks by lifetime value and hides opted-out, archived and snoozed contacts", async () => {
    const now = Date.parse("2026-08-01T15:00:00.000Z");
    const due = new Date(now + 2 * DAY_MS).toISOString();

    const big = await makeContact("Whale", "+13055552020");
    const small = await makeContact("Minnow", "+13055552021");
    const stopped = await makeContact("Stopped", "+13055552022");
    const archived = await makeContact("Archived", "+13055552023");
    const snoozed = await makeContact("Snoozed", "+13055552024");

    await run(env.DB, "UPDATE contacts SET next_due_at = ?, lifetime_value_cents = 500000 WHERE id = ?", due, big);
    await run(env.DB, "UPDATE contacts SET next_due_at = ?, lifetime_value_cents = 10000 WHERE id = ?", due, small);
    await run(env.DB, "UPDATE contacts SET next_due_at = ?, sms_opted_out_at = ? WHERE id = ?", due, nowIso(), stopped);
    await run(env.DB, "UPDATE contacts SET next_due_at = ?, deleted_at = ? WHERE id = ?", due, nowIso(), archived);
    await run(env.DB, "UPDATE contacts SET next_due_at = ?, rebook_snooze_until = ? WHERE id = ?",
      due, new Date(now + 10 * DAY_MS).toISOString(), snoozed);

    const rows = await dueList(env, now, { limit: 200 });
    const ids = rows.map((r) => r.contact_id);

    expect(ids).toContain(big);
    expect(ids).toContain(small);
    expect(ids).not.toContain(stopped);
    expect(ids).not.toContain(archived);
    expect(ids).not.toContain(snoozed);
    expect(ids.indexOf(big)).toBeLessThan(ids.indexOf(small));   // best customer first
  });

  it("serves the worklist over the API with a draft message per row", async () => {
    const now = Date.now();
    const cid = await makeContact("Worklist", "+13055552030");
    await run(env.DB, "UPDATE contacts SET next_due_at = ?, lifetime_value_cents = 40000 WHERE id = ?",
      new Date(now + DAY_MS).toISOString(), cid);

    const r = await SELF.fetch("http://x/api/rebook/due?limit=200", { headers: AUTH });
    expect(r.status).toBe(200);
    const body = (await r.json()) as { items: Array<{ contact_id: string; draft: string; can_send: boolean; blocked_reason: string | null }> };
    const row = body.items.find((i) => i.contact_id === cid);
    expect(row).toBeTruthy();
    expect(row!.draft).toContain("Worklist");
    expect(row!.draft).toContain("Reply STOP");
  });
});

describe("guardrails", () => {
  const midday = Date.parse("2026-07-28T15:00:00.000Z");   // 11am ET — inside sending hours

  it("allows a clean contact", async () => {
    const cid = await makeContact("Clean", "+13055552040");
    expect((await canSend(env, cid, midday)).ok).toBe(true);
  });

  it("blocks opted-out, do-not-contact, archived and phoneless contacts", async () => {
    const stopped = await makeContact("Stop", "+13055552041");
    await run(env.DB, "UPDATE contacts SET sms_opted_out_at = ? WHERE id = ?", nowIso(), stopped);
    expect((await canSend(env, stopped, midday)).reason).toBe("opted_out");

    const dnc = await makeContact("Dnc", "+13055552042");
    await run(env.DB, "UPDATE contacts SET do_not_contact = 1 WHERE id = ?", dnc);
    expect((await canSend(env, dnc, midday)).reason).toBe("do_not_contact");

    const gone = await makeContact("Gone", "+13055552043");
    await run(env.DB, "UPDATE contacts SET deleted_at = ? WHERE id = ?", nowIso(), gone);
    expect((await canSend(env, gone, midday)).reason).toBe("archived");

    const noPhone = await makeContact("NoPhone", "+13055552044");
    await run(env.DB, "UPDATE contacts SET phone = NULL WHERE id = ?", noPhone);
    expect((await canSend(env, noPhone, midday)).reason).toBe("no_phone");
  });

  it("blocks a contact messaged within the last 7 days", async () => {
    const cid = await makeContact("Recent", "+13055552045");
    await run(env.DB,
      `INSERT INTO messages (id, contact_id, kind, body_text, status, created_at, channel, direction)
       VALUES (?,?, 'rebook', 'hi', 'sent', ?, 'sms', 'outbound')`,
      uuid(), cid, new Date(midday - 2 * DAY_MS).toISOString());
    expect((await canSend(env, cid, midday)).reason).toBe("recent_contact");
  });

  it("blocks when the customer is waiting on a reply", async () => {
    const cid = await makeContact("Waiting", "+13055552046");
    await run(env.DB,
      `INSERT INTO messages (id, contact_id, kind, body_text, status, created_at, channel, direction)
       VALUES (?,?, 'sms', 'you around?', 'delivered', ?, 'sms', 'inbound')`,
      uuid(), cid, new Date(midday - 3600_000).toISOString());
    expect((await canSend(env, cid, midday)).reason).toBe("awaiting_reply");
  });

  it("blocks outside 9am-8pm local time", async () => {
    const cid = await makeContact("Nightowl", "+13055552047");
    const threeAmEt = Date.parse("2026-07-28T07:00:00.000Z");
    expect((await canSend(env, cid, threeAmEt)).reason).toBe("quiet_hours");
  });
});

describe("send + snooze", () => {
  it("refuses to send to an opted-out contact even on an explicit tap", async () => {
    const cid = await makeContact("Refuser", "+13055552050");
    await run(env.DB, "UPDATE contacts SET sms_opted_out_at = ? WHERE id = ?", nowIso(), cid);
    const out = await sendRebookOffer(env, cid, "hello");
    expect(out.ok).toBe(false);
    expect(out.reason).toBe("opted_out");
  });

  it("snooze pushes the contact out of the worklist", async () => {
    const now = Date.now();
    const cid = await makeContact("Snoozer", "+13055552051");
    await run(env.DB, "UPDATE contacts SET next_due_at = ? WHERE id = ?", new Date(now + DAY_MS).toISOString(), cid);
    expect((await dueList(env, now, { limit: 200 })).map((r) => r.contact_id)).toContain(cid);

    await snoozeRebook(env, cid, 14, now);
    expect((await dueList(env, now, { limit: 200 })).map((r) => r.contact_id)).not.toContain(cid);
  });
});

describe("daily pass", () => {
  it("posts one digest to the updates feed and does not repeat it", async () => {
    const now = Date.parse("2026-09-01T13:00:00.000Z");
    const cid = await makeContact("Digest", "+13055552060");
    await run(env.DB, "UPDATE contacts SET next_due_at = ? WHERE id = ?", new Date(now + DAY_MS).toISOString(), cid);

    const first = await runRebook(env, now);
    expect(first.due).toBeGreaterThan(0);
    expect(first.posted).toBe(true);

    const second = await runRebook(env, now);
    expect(second.posted).toBe(false);

    const posts = await all<{ body: string }>(
      env.DB, "SELECT body FROM updates WHERE category = 'rebook' AND created_at > ?",
      new Date(now - 3600_000).toISOString());
    expect(posts).toHaveLength(1);
  });

  it("sends nothing to customers — draft-for-approval only", async () => {
    const now = Date.parse("2026-10-01T13:00:00.000Z");
    const cid = await makeContact("Untouched", "+13055552061");
    await run(env.DB, "UPDATE contacts SET next_due_at = ? WHERE id = ?", new Date(now + DAY_MS).toISOString(), cid);

    await runRebook(env, now);
    const sent = await all(env.DB,
      "SELECT id FROM messages WHERE contact_id = ? AND direction = 'outbound'", cid);
    expect(sent).toHaveLength(0);
  });
});

describe("recompute", () => {
  it("re-derives due dates from real service cadences", async () => {
    const cid = await makeContact("Recompute", "+13055552070");
    const jid = await makeJob(cid, { services: [{ service_id: "svc_washwax" }] });
    const completedAt = new Date(Date.now() - 5 * DAY_MS).toISOString();
    await run(env.DB, "UPDATE jobs SET status = 'completed', completed_at = ? WHERE id = ?", completedAt, jid);
    await run(env.DB, "UPDATE contacts SET last_service_at = ?, next_due_at = ? WHERE id = ?",
      completedAt, new Date(Date.now() + 55 * DAY_MS).toISOString(), cid);

    await recomputeAllDueDates(env);

    const c = await contact(cid);
    // Wash & Wax is a 14-day cadence, measured from completion.
    expect(Date.parse(c!.next_due_at!) - Date.parse(completedAt)).toBe(14 * DAY_MS);
  });
});
