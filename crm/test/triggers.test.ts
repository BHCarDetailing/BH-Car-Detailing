import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { all, nowIso, one, run, uuid } from "../src/lib/db";
import { enrollContact, resolveChannel, runSequences, exitEnrollments } from "../src/lib/sequences";
import { fireTrigger, runTimeTriggers } from "../src/lib/triggers";
import { handleInboundSms } from "../src/lib/inbound";

const AUTH = { Authorization: "Bearer dev-agent-key", "Content-Type": "application/json" };

interface SeqOpts {
  trigger?: string;
  priority?: number;
  status?: string;
  channel?: string;
  delayHours?: number;
}

async function makeSequence(name: string, o: SeqOpts = {}): Promise<string> {
  const id = uuid();
  const now = nowIso();
  await run(env.DB,
    "INSERT INTO sequences (id, name, status, trigger, priority, created_at, updated_at) VALUES (?,?,?,?,?,?,?)",
    id, name, o.status ?? "active", o.trigger ?? "manual", o.priority ?? 50, now, now);
  await run(env.DB,
    "INSERT INTO sequence_steps (id, sequence_id, step_order, delay_hours, subject, body_text, channel, created_at) VALUES (?,?,0,?,?,?,?,?)",
    uuid(), id, o.delayHours ?? 0, "Step one", "Hi {first_name}, checking in.", o.channel ?? "auto", now);
  return id;
}

interface ContactOpts {
  phone?: string | null;
  email?: string | null;
  smsOptIn?: number;
  emailOptIn?: number;
  jobCount?: number;
}

async function makeContact(first: string, o: ContactOpts = {}): Promise<string> {
  const id = uuid();
  const now = nowIso();
  await run(env.DB,
    `INSERT INTO contacts (id, first_name, phone, email, sms_opt_in, email_opt_in, job_count, stage, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?, 'customer', ?, ?)`,
    id, first, o.phone ?? null, o.email ?? null,
    o.smsOptIn ?? 0, o.emailOptIn ?? 1, o.jobCount ?? 0, now, now);
  return id;
}

const enrollmentsFor = (contactId: string) =>
  all<{ sequence_id: string; status: string; exit_reason: string | null }>(
    env.DB, "SELECT sequence_id, status, exit_reason FROM enrollments WHERE contact_id = ?", contactId);

describe("resolveChannel", () => {
  const base = { phone: "+13055550001", email: "a@b.com", email_opt_in: 1, sms_opt_in: 1, sms_opted_out_at: null };

  it("auto prefers SMS when they consented to texts", () => {
    expect(resolveChannel("auto", base).channel).toBe("sms");
  });

  it("auto falls back to email without SMS consent", () => {
    expect(resolveChannel("auto", { ...base, sms_opt_in: 0 }).channel).toBe("email");
  });

  it("auto falls back to a task when neither channel is reachable", () => {
    const r = resolveChannel("auto", { ...base, sms_opt_in: 0, email: null });
    expect(r.channel).toBe("task");
    expect(r.reason).toContain("needs a call");
  });

  it("an SMS step never silently becomes an email", () => {
    expect(resolveChannel("sms", { ...base, sms_opt_in: 0 }).channel).toBe("task");
  });

  it("respects a STOP even when sms_opt_in is still set", () => {
    expect(resolveChannel("sms", { ...base, sms_opted_out_at: nowIso() }).channel).toBe("task");
  });
});

describe("one active sequence at a time", () => {
  it("a higher-priority sequence supersedes a running one", async () => {
    const cid = await makeContact("Prio", { email: "prio@x.com" });
    const low = await makeSequence("Low nurture", { priority: 30 });
    const high = await makeSequence("Booking flow", { priority: 90 });

    expect((await enrollContact(env, low, cid)).status).toBe("enrolled");
    expect((await enrollContact(env, high, cid)).status).toBe("enrolled");

    const rows = await enrollmentsFor(cid);
    expect(rows.find((r) => r.sequence_id === low)?.status).toBe("exited");
    expect(rows.find((r) => r.sequence_id === low)?.exit_reason).toBe("superseded");
    expect(rows.find((r) => r.sequence_id === high)?.status).toBe("active");
  });

  it("a lower-priority sequence does not interrupt a running one", async () => {
    const cid = await makeContact("Prio2", { email: "prio2@x.com" });
    const high = await makeSequence("Post-job", { priority: 80 });
    const low = await makeSequence("Referral ask", { priority: 30 });

    await enrollContact(env, high, cid);
    expect((await enrollContact(env, low, cid)).status).toBe("lower_priority");

    const rows = await enrollmentsFor(cid);
    expect(rows.filter((r) => r.status === "active")).toHaveLength(1);
  });

  it("never enrolls an archived or do-not-contact person", async () => {
    const archived = await makeContact("Archie", { email: "a@x.com" });
    await run(env.DB, "UPDATE contacts SET deleted_at = ? WHERE id = ?", nowIso(), archived);
    const dnc = await makeContact("Dontcall", { email: "d@x.com" });
    await run(env.DB, "UPDATE contacts SET do_not_contact = 1 WHERE id = ?", dnc);
    const seq = await makeSequence("Anything");

    expect((await enrollContact(env, seq, archived)).status).toBe("contact_archived");
    expect((await enrollContact(env, seq, dnc)).status).toBe("do_not_contact");
  });
});

describe("event triggers", () => {
  it("job:completed enrolls via the job PATCH route", async () => {
    const cid = await makeContact("Finisher", { email: "fin@x.com" });
    const seq = await makeSequence("Post-Detail Follow-Up", { trigger: "job:completed", priority: 80 });
    const jid = uuid();
    await run(env.DB,
      `INSERT INTO jobs (id, contact_id, title, services, price_cents, status, created_at, updated_at)
       VALUES (?,?, 'Full Detail', '[{"service_id":"svc_full"}]', 25000, 'scheduled', ?, ?)`,
      jid, cid, nowIso(), nowIso());

    await SELF.fetch(`http://x/api/jobs/${jid}`, {
      method: "PATCH", headers: AUTH, body: JSON.stringify({ status: "completed" }),
    });

    const rows = await enrollmentsFor(cid);
    expect(rows.find((r) => r.sequence_id === seq)?.status).toBe("active");
  });

  it("the referral trigger waits for the third completed job", async () => {
    const referral = await makeSequence("Referral Campaign", { trigger: "job:completed:3", priority: 30 });

    const oneJob = await makeContact("Newbie", { email: "n@x.com", jobCount: 1 });
    await fireTrigger(env, "job:completed:3", oneJob);   // fired directly: only count matters below

    const loyal = await makeContact("Loyal", { email: "l@x.com", jobCount: 3 });
    await fireTrigger(env, "job:completed:3", loyal);

    expect((await enrollmentsFor(loyal)).find((r) => r.sequence_id === referral)?.status).toBe("active");
  });

  it("inactive sequences never enroll anyone", async () => {
    const cid = await makeContact("Drafty", { email: "dr@x.com" });
    await makeSequence("Draft seq", { trigger: "stage:new", status: "draft" });
    expect((await fireTrigger(env, "stage:new", cid)).enrolled).toBe(0);
  });
});

describe("exit conditions", () => {
  it("booking exits every active sequence", async () => {
    const cid = await makeContact("Booker", { email: "b@x.com" });
    const seq = await makeSequence("Nurture", { priority: 50 });
    await enrollContact(env, seq, cid);

    await exitEnrollments(env, cid, "booked");

    const row = (await enrollmentsFor(cid))[0];
    expect(row.status).toBe("exited");
    expect(row.exit_reason).toBe("booked");
  });

  it("a scheduled job exits sequences through the API", async () => {
    const cid = await makeContact("Scheduler", { email: "s@x.com" });
    const seq = await makeSequence("Nurture 2", { priority: 50 });
    await enrollContact(env, seq, cid);

    const jid = uuid();
    await run(env.DB,
      "INSERT INTO jobs (id, contact_id, title, services, price_cents, status, created_at, updated_at) VALUES (?,?, 'Detail', '[]', 20000, 'quoted', ?, ?)",
      jid, cid, nowIso(), nowIso());
    await SELF.fetch(`http://x/api/jobs/${jid}`, {
      method: "PATCH", headers: AUTH, body: JSON.stringify({ status: "scheduled" }),
    });

    expect((await enrollmentsFor(cid))[0].exit_reason).toBe("booked");
  });

  it("a reply pauses rather than kills, and can be resumed by hand", async () => {
    const phone = "+13055553100";
    const first = await handleInboundSms(env, { from: phone, body: "hi" });
    const seq = await makeSequence("Chatty", { priority: 50 });
    await run(env.DB, "UPDATE contacts SET email = 'chatty@x.com' WHERE id = ?", first.contactId);
    await enrollContact(env, seq, first.contactId);

    await handleInboundSms(env, { from: phone, body: "sounds good, what time?" });
    const paused = (await enrollmentsFor(first.contactId))[0];
    expect(paused.status).toBe("paused");
    expect(paused.exit_reason).toBe("replied");

    const eid = (await one<{ id: string }>(
      env.DB, "SELECT id FROM enrollments WHERE contact_id = ?", first.contactId))!.id;
    const r = await SELF.fetch(`http://x/api/sequences/${seq}/enrollments/${eid}/resume`, { method: "POST", headers: AUTH });
    expect(r.status).toBe(200);
    expect((await enrollmentsFor(first.contactId))[0].status).toBe("active");
  });
});

describe("multi-channel sending", () => {
  const midday = Date.parse("2026-07-28T15:00:00.000Z");   // 11am ET

  it("texts a consented contact and stamps the message with its sequence", async () => {
    const cid = await makeContact("Texter", { phone: "+13055553200", smsOptIn: 1 });
    const seq = await makeSequence("SMS nurture", { channel: "sms" });
    await enrollContact(env, seq, cid);
    await run(env.DB, "UPDATE enrollments SET next_run_at = ? WHERE contact_id = ?",
      new Date(midday - 1000).toISOString(), cid);

    const out = await runSequences(env, midday);
    expect(out.sent).toBeGreaterThan(0);

    const msg = await one<{ channel: string; body_text: string; sequence_id: string }>(
      env.DB, "SELECT channel, body_text, sequence_id FROM messages WHERE contact_id = ? AND direction = 'outbound'", cid);
    expect(msg?.channel).toBe("sms");
    expect(msg?.sequence_id).toBe(seq);
    expect(msg?.body_text).toContain("Reply STOP");   // required on automated marketing texts
  });

  it("creates a task instead of dropping an unreachable contact", async () => {
    const cid = await makeContact("Unreachable", { phone: null, email: null });
    const seq = await makeSequence("Auto nurture", { channel: "auto" });
    await enrollContact(env, seq, cid);
    await run(env.DB, "UPDATE enrollments SET next_run_at = ? WHERE contact_id = ?",
      new Date(midday - 1000).toISOString(), cid);

    const out = await runSequences(env, midday);
    expect(out.tasks).toBeGreaterThan(0);

    const task = await one<{ title: string }>(env.DB, "SELECT title FROM tasks WHERE contact_id = ?", cid);
    expect(task?.title).toContain("Reach out to");
  });

  it("defers instead of sending during quiet hours", async () => {
    const threeAmEt = Date.parse("2026-07-28T07:00:00.000Z");
    const cid = await makeContact("Sleeper", { phone: "+13055553201", smsOptIn: 1 });
    const seq = await makeSequence("Late nurture", { channel: "sms" });
    await enrollContact(env, seq, cid);
    await run(env.DB, "UPDATE enrollments SET next_run_at = ? WHERE contact_id = ?",
      new Date(threeAmEt - 1000).toISOString(), cid);

    const out = await runSequences(env, threeAmEt);
    expect(out.deferred).toBeGreaterThan(0);
    expect(await all(env.DB, "SELECT id FROM messages WHERE contact_id = ? AND direction = 'outbound'", cid)).toHaveLength(0);
    // still active, just later
    expect((await enrollmentsFor(cid))[0].status).toBe("active");
  });

  it("a sequence's own cadence is not blocked by the anti-pile-on rule", async () => {
    const cid = await makeContact("Cadenced", { phone: "+13055553202", smsOptIn: 1 });
    const seq = await makeSequence("Two-step", { channel: "sms" });
    await run(env.DB,
      "INSERT INTO sequence_steps (id, sequence_id, step_order, delay_hours, subject, body_text, channel, created_at) VALUES (?,?,1,0,?,?, 'sms', ?)",
      uuid(), seq, "Step two", "Second touch.", nowIso());
    await enrollContact(env, seq, cid);
    await run(env.DB, "UPDATE enrollments SET next_run_at = ? WHERE contact_id = ?",
      new Date(midday - 1000).toISOString(), cid);

    await runSequences(env, midday);
    await run(env.DB, "UPDATE enrollments SET next_run_at = ? WHERE contact_id = ?",
      new Date(midday).toISOString(), cid);
    await runSequences(env, midday + 60_000);

    const msgs = await all(env.DB, "SELECT id FROM messages WHERE contact_id = ? AND direction = 'outbound'", cid);
    expect(msgs).toHaveLength(2);
  });
});

describe("time triggers", () => {
  it("enrolls a stale quote after 48h, and leaves a fresh one alone", async () => {
    await makeSequence("Quote nudge", { trigger: "quote:sent", priority: 60 });
    const stale = await makeContact("Ghosted", { email: "g@x.com" });
    const fresh = await makeContact("Justquoted", { email: "j@x.com" });

    await run(env.DB,
      "INSERT INTO jobs (id, contact_id, title, services, price_cents, status, quote_sent_at, created_at, updated_at) VALUES (?,?, 'Quote', '[]', 30000, 'quoted', ?, ?, ?)",
      uuid(), stale, new Date(Date.now() - 5 * 86_400_000).toISOString(), nowIso(), nowIso());
    await run(env.DB,
      "INSERT INTO jobs (id, contact_id, title, services, price_cents, status, quote_sent_at, created_at, updated_at) VALUES (?,?, 'Quote', '[]', 30000, 'quoted', ?, ?, ?)",
      uuid(), fresh, nowIso(), nowIso(), nowIso());

    await runTimeTriggers(env, Date.now());

    expect((await enrollmentsFor(stale)).some((r) => r.status === "active")).toBe(true);
    expect(await enrollmentsFor(fresh)).toHaveLength(0);
  });

  it("skips anyone already in an active sequence", async () => {
    await makeSequence("Rebook nudge", { trigger: "next_due", priority: 50 });
    const busy = await makeContact("Busy", { email: "busy@x.com" });
    const other = await makeSequence("Something else", { priority: 90 });
    await enrollContact(env, other, busy);
    await run(env.DB, "UPDATE contacts SET next_due_at = ? WHERE id = ?",
      new Date(Date.now() - 86_400_000).toISOString(), busy);

    await runTimeTriggers(env, Date.now());

    const active = (await enrollmentsFor(busy)).filter((r) => r.status === "active");
    expect(active).toHaveLength(1);
    expect(active[0].sequence_id).toBe(other);
  });
});
