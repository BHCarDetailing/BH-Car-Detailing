import type { Env } from "../types";
import { one } from "./db";

const enc = new TextEncoder();

export function stripeConfigured(env: Env): boolean {
  return !!env.STRIPE_SECRET_KEY;
}

/** Deposit config, runtime-editable in Settings. */
export async function loadPaymentSettings(env: Env): Promise<{ enabled: boolean; percent: number; allowFull: boolean }> {
  const rows = await one<{ enabled?: string; percent?: string; allow_full?: string }>(
    env.DB,
    `SELECT
       MAX(CASE WHEN key='payments_enabled' THEN value END) AS enabled,
       MAX(CASE WHEN key='deposit_percent' THEN value END) AS percent,
       MAX(CASE WHEN key='deposit_allow_full' THEN value END) AS allow_full
     FROM settings WHERE key IN ('payments_enabled','deposit_percent','deposit_allow_full')`
  );
  const percent = Math.min(100, Math.max(0, Number.parseInt(rows?.percent ?? "25", 10) || 25));
  return {
    enabled: (rows?.enabled ?? "1") === "1",
    percent,
    allowFull: (rows?.allow_full ?? "1") === "1",
  };
}

/** Deposit amount in cents for a job total, given the configured percent. */
export function depositForTotal(totalCents: number, percent: number): number {
  return Math.max(0, Math.round((totalCents * percent) / 100));
}

interface CheckoutArgs {
  jobId: string;
  amountCents: number;
  label: string;
  kind: "deposit" | "full";
  customerEmail?: string | null;
  successUrl: string;
  cancelUrl: string;
}

/** Create a Stripe Checkout Session. Returns the hosted-page URL, or null if
 *  Stripe isn't configured / the API call fails. Card data never touches us. */
export async function createCheckoutSession(env: Env, a: CheckoutArgs): Promise<string | null> {
  if (!env.STRIPE_SECRET_KEY || a.amountCents < 50) return null; // Stripe min ~$0.50
  const form = new URLSearchParams();
  form.set("mode", "payment");
  form.set("success_url", a.successUrl);
  form.set("cancel_url", a.cancelUrl);
  form.set("client_reference_id", a.jobId);
  form.set("metadata[job_id]", a.jobId);
  form.set("metadata[kind]", a.kind);
  form.set("payment_intent_data[metadata][job_id]", a.jobId);
  if (a.customerEmail) form.set("customer_email", a.customerEmail);
  form.set("line_items[0][quantity]", "1");
  form.set("line_items[0][price_data][currency]", "usd");
  form.set("line_items[0][price_data][unit_amount]", String(a.amountCents));
  form.set("line_items[0][price_data][product_data][name]", a.label.slice(0, 250));

  const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form.toString(),
  });
  if (!res.ok) return null;
  const json = (await res.json()) as { url?: string };
  return json.url ?? null;
}

/** Verify a Stripe webhook signature (t=…,v1=…). Fails closed. */
export async function verifyStripeWebhook(env: Env, rawBody: string, sigHeader: unknown): Promise<boolean> {
  const secret = env.STRIPE_WEBHOOK_SECRET;
  if (!secret || typeof sigHeader !== "string") return false;
  const parts = Object.fromEntries(sigHeader.split(",").map((kv) => kv.split("=") as [string, string]));
  const t = parts.t;
  const v1 = parts.v1;
  if (!t || !v1) return false;
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(`${t}.${rawBody}`));
  const bytes = new Uint8Array(sig);
  let hex = "";
  for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, "0");
  if (hex.length !== v1.length) return false;
  let diff = 0;
  for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ v1.charCodeAt(i);
  return diff === 0;
}
