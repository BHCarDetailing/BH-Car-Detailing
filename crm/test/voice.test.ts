import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { one } from "../src/lib/db";
import { buildVoiceTwiml, handleMissedCall, findOrCreateMissedCallContact, type MissedCallSettings } from "../src/lib/missedcall";

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
