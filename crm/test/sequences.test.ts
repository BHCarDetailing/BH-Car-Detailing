import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { runSequences, unsubToken } from "../src/lib/sequences";
import { one } from "../src/lib/db";

const AUTH = { Authorization: "Bearer dev-agent-key", "Content-Type": "application/json" };
// 10 days out so step 0 (delay 0) is certainly due, pinned to 15:00 UTC so the
// run lands inside sending hours — sends are now gated on quiet hours, not just
// scheduled around them.
const FUTURE = (() => {
  const d = new Date(Date.now() + 10 * 86400_000);
  d.setUTCHours(15, 0, 0, 0);
  return d.getTime();
})();

async function makeContact(email: string) {
  const r = await SELF.fetch("http://x/api/contacts", { method: "POST", headers: AUTH, body: JSON.stringify({ first_name: "Seq", email }) });
  return ((await r.json()) as { id: string }).id;
}

describe("nurture sequences", () => {
  it("creates, enrolls, sends step 0 on cron, advances, and does not double-send", async () => {
    const create = await SELF.fetch("http://x/api/sequences", {
      method: "POST", headers: AUTH,
      body: JSON.stringify({ name: "New lead nurture", trigger: "manual", steps: [
        { delay_hours: 0, subject: "Hi {first_name}", body_text: "Thanks for reaching out, {first_name}!" },
        { delay_hours: 48, subject: "Still here", body_text: "Following up on your quote." },
      ] }),
    });
    expect(create.status).toBe(201);
    const seqId = ((await create.json()) as { id: string }).id;

    const cid = await makeContact("seq1@x.com");
    const enroll = await SELF.fetch(`http://x/api/sequences/${seqId}/enroll`, { method: "POST", headers: AUTH, body: JSON.stringify({ contact_id: cid }) });
    expect(enroll.status).toBe(201);
    // idempotent
    expect(((await (await SELF.fetch(`http://x/api/sequences/${seqId}/enroll`, { method: "POST", headers: AUTH, body: JSON.stringify({ contact_id: cid }) })).json()) as { status: string }).status).toBe("already_enrolled");

    const first = await runSequences(env, FUTURE);
    expect(first.sent).toBeGreaterThanOrEqual(1);
    const e1 = await one<{ current_step: number; status: string }>(env.DB, "SELECT current_step, status FROM enrollments WHERE sequence_id = ? AND contact_id = ?", seqId, cid);
    expect(e1?.current_step).toBe(1);
    expect(e1?.status).toBe("active");

    // step 1 is scheduled ~48h after FUTURE -> not due at FUTURE
    const second = await runSequences(env, FUTURE);
    expect(second.sent).toBe(0);
  });

  it("unsubscribe opts the contact out and exits enrollments; bad token rejected", async () => {
    const seqId = ((await (await SELF.fetch("http://x/api/sequences", { method: "POST", headers: AUTH, body: JSON.stringify({ name: "S2", steps: [{ delay_hours: 0, subject: "Hi", body_text: "yo" }] }) })).json()) as { id: string }).id;
    const cid = await makeContact("unsub@x.com");
    await SELF.fetch(`http://x/api/sequences/${seqId}/enroll`, { method: "POST", headers: AUTH, body: JSON.stringify({ contact_id: cid }) });

    const bad = await SELF.fetch(`http://x/api/unsubscribe/${cid}/deadbeef`);
    expect(bad.status).toBe(400);

    const sig = await unsubToken(env.SESSION_SECRET, cid);
    const good = await SELF.fetch(`http://x/api/unsubscribe/${cid}/${sig}`);
    expect(good.status).toBe(200);

    const contact = await one<{ email_opt_in: number }>(env.DB, "SELECT email_opt_in FROM contacts WHERE id = ?", cid);
    expect(contact?.email_opt_in).toBe(0);
    const enr = await one<{ status: string }>(env.DB, "SELECT status FROM enrollments WHERE sequence_id = ? AND contact_id = ?", seqId, cid);
    expect(enr?.status).toBe("unsubscribed");
  });
});
