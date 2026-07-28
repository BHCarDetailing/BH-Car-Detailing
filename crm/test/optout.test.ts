import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { classifyInbound, helpReply } from "../src/lib/optout";
import { handleInboundSms } from "../src/lib/inbound";
import { all, nowIso, one, run, uuid } from "../src/lib/db";

async function contactByPhone(phone: string) {
  return one<{ id: string; sms_opted_out_at: string | null; sms_opt_in: number }>(
    env.DB, "SELECT id, sms_opted_out_at, sms_opt_in FROM contacts WHERE phone = ?", phone);
}

/** Put the contact into an active sequence so pause/exit behaviour is observable. */
async function enrollDirect(contactId: string): Promise<string> {
  const seqId = uuid();
  const now = nowIso();
  await run(env.DB,
    "INSERT INTO sequences (id, name, status, trigger, created_at, updated_at) VALUES (?,?, 'active', 'manual', ?, ?)",
    seqId, "Test seq " + seqId.slice(0, 8), now, now);
  const enrollId = uuid();
  await run(env.DB,
    "INSERT INTO enrollments (id, sequence_id, contact_id, status, current_step, next_run_at, enrolled_at) VALUES (?,?,?, 'active', 1, ?, ?)",
    enrollId, seqId, contactId, now, now);
  return enrollId;
}

const statusOf = async (enrollId: string) =>
  (await one<{ status: string }>(env.DB, "SELECT status FROM enrollments WHERE id = ?", enrollId))?.status;

describe("classifyInbound", () => {
  it("recognises stop keywords regardless of case, spacing and punctuation", () => {
    for (const raw of ["STOP", "stop", " Stop ", "STOP.", "stop!", "UNSUBSCRIBE", "Cancel", "quit", "END"]) {
      expect(classifyInbound(raw)).toBe("stop");
    }
  });

  it("recognises help and start keywords", () => {
    expect(classifyInbound("HELP")).toBe("help");
    expect(classifyInbound("info")).toBe("help");
    expect(classifyInbound("START")).toBe("start");
    expect(classifyInbound("unstop")).toBe("start");
  });

  it("does not treat conversational messages as keywords", () => {
    expect(classifyInbound("please stop by at 3")).toBeNull();
    expect(classifyInbound("can you help me with the interior?")).toBeNull();
    expect(classifyInbound("when do we start?")).toBeNull();
    expect(classifyInbound("")).toBeNull();
    expect(classifyInbound(null)).toBeNull();
  });
});

describe("helpReply", () => {
  it("carries no contact details of its own when none are configured", async () => {
    // The number must always come from settings — a hard-coded one goes stale
    // and gets texted to every customer who asks for help.
    await run(env.DB, "DELETE FROM settings WHERE key = 'support_contact'");
    const reply = await helpReply(env);
    expect(reply).toContain("Reply STOP");
    expect(reply).not.toMatch(/\(\d{3}\)/);
    expect(reply).not.toMatch(/@/);
  });

  it("uses exactly what settings holds", async () => {
    await run(env.DB, "INSERT OR REPLACE INTO settings (key, value) VALUES ('support_contact', ?)", "help@example.com");
    expect(await helpReply(env)).toContain("help@example.com");
  });

  it("ships with the published business details seeded", async () => {
    // Migration 0015 seeds this so the carrier-required reply is correct on
    // day one rather than waiting for someone to fill in a settings field.
    const seeded = await one<{ value: string }>(env.DB, "SELECT value FROM settings WHERE key = 'support_contact'");
    expect(seeded?.value).toBeTruthy();
    expect(await helpReply(env)).toContain(seeded!.value);
  });
});

describe("inbound STOP / HELP / START", () => {
  it("STOP opts the contact out and exits every active sequence", async () => {
    const phone = "+13055551001";
    const first = await handleInboundSms(env, { from: phone, body: "hey how much for a full detail?" });
    const enrollId = await enrollDirect(first.contactId);

    const res = await handleInboundSms(env, { from: phone, body: "STOP" });
    expect(res.outcome).toBe("opted_out");

    const c = await contactByPhone(phone);
    expect(c?.sms_opted_out_at).toBeTruthy();
    expect(c?.sms_opt_in).toBe(0);
    expect(await statusOf(enrollId)).toBe("unsubscribed");
  });

  it("sends exactly one confirmation on STOP", async () => {
    const phone = "+13055551002";
    await handleInboundSms(env, { from: phone, body: "STOP" });
    const c = await contactByPhone(phone);
    const out = await all<{ body_text: string }>(
      env.DB,
      "SELECT body_text FROM messages WHERE contact_id = ? AND direction = 'outbound'", c!.id);
    expect(out).toHaveLength(1);
    expect(out[0].body_text).toContain("unsubscribed");
  });

  it("START clears the opt-out", async () => {
    const phone = "+13055551003";
    await handleInboundSms(env, { from: phone, body: "STOP" });
    expect((await contactByPhone(phone))?.sms_opted_out_at).toBeTruthy();

    const res = await handleInboundSms(env, { from: phone, body: "start" });
    expect(res.outcome).toBe("resubscribed");
    const c = await contactByPhone(phone);
    expect(c?.sms_opted_out_at).toBeNull();
    expect(c?.sms_opt_in).toBe(1);
  });

  it("HELP replies without changing consent", async () => {
    const phone = "+13055551004";
    const res = await handleInboundSms(env, { from: phone, body: "HELP" });
    expect(res.outcome).toBe("help_sent");
    expect((await contactByPhone(phone))?.sms_opted_out_at).toBeNull();
  });
});

describe("a human reply stops the robot", () => {
  it("pauses the contact's active sequence on any ordinary inbound message", async () => {
    const phone = "+13055551005";
    const first = await handleInboundSms(env, { from: phone, body: "hi there" });
    const enrollId = await enrollDirect(first.contactId);
    expect(await statusOf(enrollId)).toBe("active");

    const res = await handleInboundSms(env, { from: phone, body: "yeah Tuesday works for me" });
    expect(res.sequencePaused).toBe(true);
    expect(await statusOf(enrollId)).toBe("paused");
  });

  it("creates a contact for an unknown number and logs the message", async () => {
    const phone = "+13055551006";
    const res = await handleInboundSms(env, { from: phone, body: "do you do ceramic coating?" });
    expect(res.contactId).toBeTruthy();
    const msgs = await all<{ body_text: string; direction: string }>(
      env.DB, "SELECT body_text, direction FROM messages WHERE contact_id = ?", res.contactId);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].direction).toBe("inbound");
  });
});
