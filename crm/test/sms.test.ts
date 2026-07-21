import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { sendSms, verifyTwilioSignature } from "../src/lib/sms";
import { one } from "../src/lib/db";
import type { Env } from "../src/types";

const encoder = new TextEncoder();

function b64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

async function twilioSig(token: string, url: string, params: Record<string, string>): Promise<string> {
  let data = url;
  for (const k of Object.keys(params).sort()) data += k + params[k];
  const key = await crypto.subtle.importKey("raw", encoder.encode(token), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  return b64(await crypto.subtle.sign("HMAC", key, encoder.encode(data)));
}

describe("sendSms fallback", () => {
  it("logs instead of sending when Twilio is unconfigured", async () => {
    const res = await sendSms(env, { toPhone: "+13055550100", body: "hi" });
    expect(res.status).toBe("logged");
    const row = await one<{ status: string; channel: string; direction: string }>(
      env.DB, "SELECT status, channel, direction FROM messages WHERE id = ?", res.id);
    expect(row?.status).toBe("logged");
    expect(row?.channel).toBe("sms");
    expect(row?.direction).toBe("outbound");
  });
});

describe("verifyTwilioSignature", () => {
  const url = "https://crm.example.com/api/twilio/inbound";
  const params = { From: "+13055550100", To: "+17866049110", Body: "Hello" };

  it("fails closed when no auth token is configured", async () => {
    const sig = await twilioSig("secrettoken", url, params);
    expect(await verifyTwilioSignature(env, url, params, sig)).toBe(false);
  });

  it("accepts a valid signature and rejects a tampered one", async () => {
    const withToken = { ...env, TWILIO_AUTH_TOKEN: "secrettoken" } as Env;
    const sig = await twilioSig("secrettoken", url, params);
    expect(await verifyTwilioSignature(withToken, url, params, sig)).toBe(true);
    expect(await verifyTwilioSignature(withToken, url, { ...params, Body: "tampered" }, sig)).toBe(false);
    expect(await verifyTwilioSignature(withToken, url, params, "")).toBe(false);
  });
});
