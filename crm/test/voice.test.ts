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
