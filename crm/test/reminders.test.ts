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
    const msgs = await all(env.DB, "SELECT * FROM messages WHERE job_id = ? AND kind = 'reminder'", jid);
    expect(msgs.length).toBe(1);
    expect(second.sent).toBe(0);
  });
});
