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
