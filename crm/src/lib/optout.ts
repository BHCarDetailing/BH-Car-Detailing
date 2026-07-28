/**
 * Carrier-mandated SMS keyword handling (A2P 10DLC / TCPA).
 *
 * Kept pure and separate from the webhook so the classification rules can be
 * tested directly. Carriers require STOP, HELP and START to work regardless of
 * casing, surrounding punctuation, or trailing whitespace.
 */
import type { Env } from "../types";
import { one } from "./db";

export type InboundKeyword = "stop" | "help" | "start" | null;

const STOP_WORDS = new Set(["stop", "stopall", "unsubscribe", "cancel", "end", "quit", "optout", "revoke"]);
const HELP_WORDS = new Set(["help", "info"]);
const START_WORDS = new Set(["start", "unstop", "yes"]);

/**
 * Classify an inbound SMS body. Only a message that is *just* the keyword
 * counts — "please stop by at 3" is a conversation, not an opt-out.
 */
export function classifyInbound(body: string | null | undefined): InboundKeyword {
  if (!body) return null;
  const word = body.trim().toLowerCase().replace(/[^a-z]/g, "");
  if (!word) return null;
  if (STOP_WORDS.has(word)) return "stop";
  if (HELP_WORDS.has(word)) return "help";
  if (START_WORDS.has(word)) return "start";
  return null;
}

const brandOf = (env: Env): string => env.FROM_NAME || "BH Car Detailing";

export const stopConfirmation = (env: Env): string =>
  `${brandOf(env)}: You're unsubscribed and will get no more messages from us. Reply START to resubscribe.`;

export const startConfirmation = (env: Env): string =>
  `${brandOf(env)}: You're resubscribed. Reply STOP at any time to opt out. Msg & data rates may apply.`;

/**
 * Carrier rules require the HELP reply to name the business and give a support
 * contact. The contact details come from settings — never hard-code a number
 * here, or a stale one goes out to every customer who texts HELP.
 */
export async function helpReply(env: Env): Promise<string> {
  const row = await one<{ value: string }>(env.DB, "SELECT value FROM settings WHERE key = 'support_contact'");
  const support = row?.value?.trim();
  return [
    `${brandOf(env)} — mobile detailing.`,
    support ? `Support: ${support}.` : "",
    "Msg & data rates may apply. Reply STOP to unsubscribe.",
  ].filter(Boolean).join(" ");
}
