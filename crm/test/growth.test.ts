import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { all, nowIso, one, run, uuid } from "../src/lib/db";
import {
  DAILY_REACTIVATION_CAP, draftReactivationMessage, quotedCentsFromText,
  reactivationQueue, scoreCandidate, sendReactivation,
} from "../src/lib/reactivation";
import { markReviewLeft, pendingReviewFollowUps, runReviewFollowUps } from "../src/lib/reviews";

const AUTH = { Authorization: "Bearer dev-agent-key", "Content-Type": "application/json" };

interface COpts { source?: string; stage?: string; phone?: string | null; jobCount?: number; vehicle?: string }

async function makeContact(name: string, o: COpts = {}): Promise<string> {
  const id = uuid();
  const now = nowIso();
  await run(env.DB,
    `INSERT INTO contacts (id, first_name, phone, source, stage, job_count, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?)`,
    id, name, o.phone === undefined ? "+1305555" + Math.floor(1000 + Math.random() * 8999) : o.phone,
    o.source ?? "hubspot-import", o.stage ?? "new", o.jobCount ?? 0, now, now);
  if (o.vehicle) {
    await run(env.DB, "INSERT INTO vehicles (id, contact_id, size_class, notes, created_at) VALUES (?,?, 'suv', ?, ?)",
      uuid(), id, o.vehicle, now);
  }
  return id;
}

describe("quotedCentsFromText", () => {
  it("pulls a price out of a legacy contact name", () => {
    expect(quotedCentsFromText("Luis Garcia Car Detailing $90/160 Light/Full Interior")).toBe(9000);
    expect(quotedCentsFromText("Sunny Isles Google Call Guy. $180 Np Quick Emergency Job")).toBe(18000);
    expect(quotedCentsFromText("Jane Smith")).toBeNull();
    expect(quotedCentsFromText("$3")).toBeNull();      // too small to be a real quote
    expect(quotedCentsFromText(null)).toBeNull();
  });
});

describe("scoreCandidate", () => {
  const base = {
    contact_id: "x", first_name: "Test", last_name: null, phone: "+13055550000", email: null,
    source: "hubspot-import", stage: "new", created_at: nowIso(), last_activity_at: null,
    vehicle: null as string | null, size_class: null as string | null,
  };
  const now = Date.now();

  it("ranks a known vehicle and a strong source above a bare import", () => {
    const bare = scoreCandidate(base, now).score;
    const rich = scoreCandidate({ ...base, vehicle: "Range Rover", source: "google_lsa" }, now).score;
    expect(rich).toBeGreaterThan(bare);
  });

  it("rewards a contact who was already quoted a price", () => {
    const plain = scoreCandidate({ ...base, first_name: "Luis" }, now);
    const quoted = scoreCandidate({ ...base, first_name: "Luis", last_name: "Detailing $160 Full" }, now);
    expect(quoted.score).toBeGreaterThan(plain.score);
    expect(quoted.quoted).toBe(16000);
  });
});

describe("reactivation queue", () => {
  it("includes never-bought leads and excludes customers, opt-outs and archived", async () => {
    const lead = await makeContact("Freshlead", { source: "google_lsa", vehicle: "Tesla Model 3" });
    const customer = await makeContact("Regular", { jobCount: 2 });
    const stopped = await makeContact("Stopped");
    await run(env.DB, "UPDATE contacts SET sms_opted_out_at = ? WHERE id = ?", nowIso(), stopped);
    const archived = await makeContact("Archived");
    await run(env.DB, "UPDATE contacts SET deleted_at = ? WHERE id = ?", nowIso(), archived);
    const noPhone = await makeContact("Nophone", { phone: null });

    const ids = (await reactivationQueue(env, Date.now(), 400)).map((r) => r.contact_id);
    expect(ids).toContain(lead);
    expect(ids).not.toContain(customer);
    expect(ids).not.toContain(stopped);
    expect(ids).not.toContain(archived);
    expect(ids).not.toContain(noPhone);
  });

  it("drops anyone already contacted or skipped", async () => {
    const done = await makeContact("Alreadydone");
    const skipped = await makeContact("Skipped");
    await run(env.DB, "UPDATE contacts SET reactivation_sent_at = ? WHERE id = ?", nowIso(), done);
    await run(env.DB, "UPDATE contacts SET reactivation_skipped_at = ? WHERE id = ?", nowIso(), skipped);

    const ids = (await reactivationQueue(env, Date.now(), 400)).map((r) => r.contact_id);
    expect(ids).not.toContain(done);
    expect(ids).not.toContain(skipped);
  });

  it("caps the queue at the daily limit over the API", async () => {
    for (let i = 0; i < DAILY_REACTIVATION_CAP + 6; i++) await makeContact(`Bulk${i}`, { source: "website_form" });
    const r = await SELF.fetch("http://x/api/growth/reactivation/queue", { headers: AUTH });
    const body = (await r.json()) as { items: unknown[]; daily_cap: number };
    expect(body.items.length).toBeLessThanOrEqual(body.daily_cap);
  });
});

describe("reactivation message", () => {
  it("reads as a follow-up to their enquiry, names the business, and offers opt-out", async () => {
    const id = await makeContact("Marco", { source: "google_lsa", vehicle: "Audi Q7" });
    const row = (await reactivationQueue(env, Date.now(), 400)).find((r) => r.contact_id === id)!;
    const msg = draftReactivationMessage(env, row);

    expect(msg).toContain("Marco");
    expect(msg).toContain("Audi Q7");
    expect(msg).toContain("reached out");        // framed as their enquiry, not a cold pitch
    expect(msg).toContain("STOP");               // opt-out on the first message
  });

  it("marks the contact as worked and moves them out of the queue", async () => {
    const id = await makeContact("Worked", { source: "referral" });
    const out = await sendReactivation(env, id, undefined, Date.parse("2026-07-28T15:00:00.000Z"));
    expect(out.ok).toBe(true);

    const c = await one<{ reactivation_sent_at: string | null; stage: string }>(
      env.DB, "SELECT reactivation_sent_at, stage FROM contacts WHERE id = ?", id);
    expect(c?.reactivation_sent_at).toBeTruthy();
    expect(c?.stage).toBe("contacted");
    expect((await reactivationQueue(env, Date.now(), 400)).map((r) => r.contact_id)).not.toContain(id);
  });

  it("refuses to message someone who opted out", async () => {
    const id = await makeContact("Optout");
    await run(env.DB, "UPDATE contacts SET sms_opted_out_at = ? WHERE id = ?", nowIso(), id);
    const out = await sendReactivation(env, id, "hi", Date.parse("2026-07-28T15:00:00.000Z"));
    expect(out.ok).toBe(false);
    expect(out.reason).toBe("opted_out");
  });
});

describe("review follow-ups", () => {
  const midday = Date.parse("2026-07-28T15:00:00.000Z");

  // Storage is isolated per test, so each test that needs the review link sets it.
  const setReviewUrl = () =>
    run(env.DB, "INSERT OR REPLACE INTO settings (key, value) VALUES ('review_url', ?)", "https://g.page/bh/review");

  async function jobAwaitingReview(contactId: string, requestedDaysAgo: number): Promise<string> {
    const id = uuid();
    await run(env.DB,
      `INSERT INTO jobs (id, contact_id, title, services, price_cents, status, review_requested_at, created_at, updated_at)
       VALUES (?,?, 'Full Detail', '[]', 25000, 'completed', ?, ?, ?)`,
      id, contactId, new Date(midday - requestedDaysAgo * 86_400_000).toISOString(), nowIso(), nowIso());
    return id;
  }

  it("chases after five days, but not before", async () => {
    await setReviewUrl();
    const ready = await makeContact("Reviewer");
    const tooSoon = await makeContact("Toosoon");
    const readyJob = await jobAwaitingReview(ready, 6);
    const soonJob = await jobAwaitingReview(tooSoon, 1);

    const pending = (await pendingReviewFollowUps(env, midday)).map((j) => j.id);
    expect(pending).toContain(readyJob);
    expect(pending).not.toContain(soonJob);
  });

  it("never asks twice", async () => {
    await setReviewUrl();
    const cid = await makeContact("Onceonly");
    await jobAwaitingReview(cid, 7);
    const first = await runReviewFollowUps(env, midday);
    expect(first.sent).toBeGreaterThan(0);
    const second = await runReviewFollowUps(env, midday);
    expect(second.sent).toBe(0);
  });

  it("does not chase someone who has written to us since the job", async () => {
    await setReviewUrl();
    const cid = await makeContact("Complainer");
    const jid = await jobAwaitingReview(cid, 6);
    await run(env.DB,
      `INSERT INTO messages (id, contact_id, kind, body_text, status, created_at, channel, direction)
       VALUES (?,?, 'sms', 'there are still swirls on the hood', 'delivered', ?, 'sms', 'inbound')`,
      uuid(), cid, new Date(midday - 86_400_000).toISOString());

    expect((await pendingReviewFollowUps(env, midday)).map((j) => j.id)).not.toContain(jid);
  });

  it("records a received review and reports the funnel", async () => {
    const cid = await makeContact("Fivestar");
    const jid = await jobAwaitingReview(cid, 6);
    const r = await SELF.fetch(`http://x/api/growth/reviews/${jid}/left`, { method: "POST", headers: AUTH });
    expect(r.status).toBe(200);
    expect((await one<{ review_left_at: string | null }>(
      env.DB, "SELECT review_left_at FROM jobs WHERE id = ?", jid))?.review_left_at).toBeTruthy();

    const stats = (await (await SELF.fetch("http://x/api/growth/reviews/stats?days=3650", { headers: AUTH })).json()) as { received: number };
    expect(stats.received).toBeGreaterThan(0);
  });

  it("stays silent when no review link is configured", async () => {
    await run(env.DB, "DELETE FROM settings WHERE key = 'review_url'");
    const cid = await makeContact("Nolink");
    await jobAwaitingReview(cid, 8);
    expect((await runReviewFollowUps(env, midday)).sent).toBe(0);
  });
});

describe("referral attribution", () => {
  it("credits the referrer when a lead arrives through their link", async () => {
    const referrer = await makeContact("Advocate", { jobCount: 3 });

    const res = await SELF.fetch("http://x/api/lead", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Referred Friend", phone: "+13055556161", ts: Date.now() - 5000, ref: referrer,
      }),
    });
    expect(res.status).toBe(200);

    const lead = await one<{ referred_by_contact_id: string | null; source: string }>(
      env.DB, "SELECT referred_by_contact_id, source FROM contacts WHERE phone = ?", "+13055556161");
    expect(lead?.referred_by_contact_id).toBe(referrer);
    expect(lead?.source).toBe("referral");

    const report = (await (await SELF.fetch("http://x/api/growth/referrals", { headers: AUTH })).json()) as {
      items: Array<{ contact_id: string; referred_count: number }>; total_referred: number;
    };
    expect(report.items.find((i) => i.contact_id === referrer)?.referred_count).toBe(1);
    expect(report.total_referred).toBeGreaterThan(0);
  });

  it("ignores a referral code that is not a real contact", async () => {
    await SELF.fetch("http://x/api/lead", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Junk Ref", phone: "+13055556262", ts: Date.now() - 5000, ref: "not-a-contact" }),
    });
    const lead = await one<{ referred_by_contact_id: string | null }>(
      env.DB, "SELECT referred_by_contact_id FROM contacts WHERE phone = ?", "+13055556262");
    expect(lead?.referred_by_contact_id).toBeNull();
  });
});
