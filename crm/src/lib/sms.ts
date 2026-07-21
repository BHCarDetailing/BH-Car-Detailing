import type { Env } from "../types";
import { nowIso, run, uuid } from "./db";

const enc = new TextEncoder();

function bufToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

/**
 * Validate Twilio's X-Twilio-Signature. Fails CLOSED: returns false if the auth
 * token or signature is missing/empty, or the computed HMAC does not match.
 * Base string = full request URL + each POST param (sorted by name) as name+value.
 */
export async function verifyTwilioSignature(
  env: Env, url: string, params: Record<string, string>, signature: unknown
): Promise<boolean> {
  const token = env.TWILIO_AUTH_TOKEN;
  if (!token || typeof signature !== "string" || signature.length === 0) return false;
  let data = url;
  for (const key of Object.keys(params).sort()) data += key + params[key];
  const cryptoKey = await crypto.subtle.importKey(
    "raw", enc.encode(token), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(data));
  const expected = bufToBase64(sig);
  // constant-time-ish compare
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  return diff === 0;
}

export interface OutgoingSms {
  contactId?: string;
  toPhone: string;
  body: string;
}

/**
 * Send an SMS via Twilio, or LOG it (bridge fallback) when Twilio is not configured.
 * Always writes a `messages` row (channel='sms', direction='outbound').
 */
export async function sendSms(env: Env, msg: OutgoingSms): Promise<{ id: string; status: string }> {
  const id = uuid();
  const now = nowIso();
  const from = env.TWILIO_FROM_NUMBER ?? null;
  const insert = (status: string, providerId: string | null, error: string | null, sentAt: string | null) =>
    run(env.DB,
      `INSERT INTO messages (id, contact_id, kind, body_text, provider_id, status, error, created_at, sent_at, channel, direction, from_addr, to_addr)
       VALUES (?,?,?,?,?,?,?,?,?, 'sms', 'outbound', ?, ?)`,
      id, msg.contactId ?? null, "sms", msg.body, providerId, status, error, now, sentAt, from, msg.toPhone);

  const configured = env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && (env.TWILIO_MESSAGING_SERVICE_SID || env.TWILIO_FROM_NUMBER);
  if (!configured) {
    await insert("logged", null, null, null);
    return { id, status: "logged" };
  }

  try {
    const form = new URLSearchParams();
    form.set("To", msg.toPhone);
    form.set("Body", msg.body);
    if (env.TWILIO_MESSAGING_SERVICE_SID) form.set("MessagingServiceSid", env.TWILIO_MESSAGING_SERVICE_SID);
    else form.set("From", env.TWILIO_FROM_NUMBER!);
    const auth = btoa(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`);
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`, {
      method: "POST",
      headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });
    if (!res.ok) {
      const error = `twilio_${res.status}: ${(await res.text()).slice(0, 200)}`;
      await insert("failed", null, error, null);
      return { id, status: "failed" };
    }
    const data = (await res.json()) as { sid?: string };
    await insert("sent", data.sid ?? null, null, nowIso());
    return { id, status: "sent" };
  } catch (e) {
    await insert("failed", null, String(e).slice(0, 200), null);
    return { id, status: "failed" };
  }
}
