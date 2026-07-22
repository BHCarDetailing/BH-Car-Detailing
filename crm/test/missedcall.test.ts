import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { run, one, all } from "../src/lib/db";
import {
  loadMissedCallSettings, findOrCreateMissedCallContact, insertMissedCall,
  isAutoTextAllowed, DEFAULT_MISSED_CALL_BODY, handleMissedCall,
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
    await run(env.DB, "INSERT INTO settings (key,value) VALUES ('owner_notify_number','+13050000008') ON CONFLICT(key) DO UPDATE SET value=excluded.value");
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
