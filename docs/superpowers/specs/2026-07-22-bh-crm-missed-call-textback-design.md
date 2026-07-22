# BH CRM — Missed-Call Text-Back — Design

**Date:** 2026-07-22
**Status:** Approved (design), pending implementation plan
**Milestone context:** First GoHighLevel-parity feature. Auto-texts callers when a call to the CRM's Twilio number goes unanswered.

## Goal

When someone calls the business's Twilio number and the owner does not answer, automatically send the caller a text so no lead is lost. Every missed call is captured as a trackable CRM lead.

## User decisions (locked)

1. **Call flow:** Ring the owner's real cell first (Twilio `<Dial>`). If unanswered, auto-text the caller. Owner can still answer live calls.
2. **On fall-through:** Text only. No voicemail, no recording. Call ends after the dial completes.
3. **Message content:** One fixed template, editable in Settings.
4. **Dedup:** Text once per caller per cooldown window (default 4 hours), editable.
5. **Unknown caller:** Auto-create a contact (`source='missed-call'`, `stage='new'`), log the call and auto-text in their timeline.

## Architecture — call flow

The Twilio number gets a **Voice webhook** configured on the number (parallel to the existing SMS webhook). Two new routes, added to the existing public Twilio webhook file, following the existing signature-verified, fail-closed pattern.

1. **Incoming call** → Twilio POSTs `POST /twilio/voice`.
   - Signature-verified via `verifyTwilioSignature` (fail-closed → 403 on mismatch).
   - If `missed_call_enabled` is off → still ring the cell if `owner_forward_number` is set (plain `<Dial>`, no `action` callback), else return an empty `<Response/>` hangup. No text-back logic either way.
   - If `owner_forward_number` is set → return TwiML:
     `<Response><Dial timeout={missed_call_dial_timeout} action="/twilio/voice/complete">{owner_forward_number}</Dial></Response>`
   - If `owner_forward_number` is empty → skip dial, run the missed/text-back path immediately (feature works before the cell is configured).
2. **Dial ends** → Twilio POSTs `POST /twilio/voice/complete` with `DialCallStatus`.
   - Signature-verified, fail-closed.
   - `completed` → owner answered → log an answered `missed_calls` row (`texted=0`, `dial_status='completed'`), no text.
   - `no-answer` | `busy` | `failed` → **missed** → run text-back logic.
   - Return empty `<Response/>`.
3. **Text-back logic:**
   - Normalize `From`. If missing/unknown → log the call only, no text, no contact.
   - If `From` equals the Twilio number or `owner_forward_number` → skip (self/loop guard).
   - Find-or-create contact by phone (existing upsert pattern; `source='missed-call'`, `stage='new'`).
   - **Cooldown check:** if a `missed_calls` row exists for this `from_phone` with `texted=1` within `missed_call_cooldown_hours` → log the call (`texted=0`), skip the SMS.
   - Otherwise `sendSms` the template, log the `missed_calls` row (`texted=1`, `message_id` linked), log activity on the contact timeline.

## Data

New migration `0006_missed_calls.sql`:

```sql
CREATE TABLE missed_calls (
  id TEXT PRIMARY KEY,
  contact_id TEXT,
  from_phone TEXT NOT NULL,
  to_phone TEXT,
  call_sid TEXT,
  dial_status TEXT,          -- no-answer | busy | failed | completed
  texted INTEGER DEFAULT 0,  -- 1 if text-back sent
  message_id TEXT,           -- FK-ish link to messages.id
  created_at TEXT NOT NULL
);
CREATE INDEX idx_missed_calls_phone ON missed_calls (from_phone, created_at);
```

Rationale for a dedicated table (vs. reusing `messages`): clean call log, powers the cooldown query, and later feeds call analytics. Answered calls are logged too (`texted=0`, `dial_status='completed'`).

Contact handling reuses the existing find-by-phone + upsert pattern already used by the inbound SMS webhook.

## Settings (new keys in the existing key/value store)

| Key | Default | Purpose |
|-----|---------|---------|
| `missed_call_enabled` | `"1"` | Master toggle |
| `owner_forward_number` | *(empty)* | Cell to ring. Empty → skip dial, straight to text-back |
| `missed_call_dial_timeout` | `"20"` | Seconds to ring before considered missed |
| `missed_call_text_body` | *(default template below)* | The auto-text |
| `missed_call_cooldown_hours` | `"4"` | Dedup window |

**Default template:**

```
Hey, this is BH Car Detailing - sorry we missed your call! Reply here with what you need and we'll be in touch.
If you'd like to book on your own our website is bhcardetails.com
```

**Settings UI:** add a "Missed-Call Text-Back" section to the existing Settings page — toggle, forward number, dial timeout, template, cooldown. Reuses the current `GET`/`PUT /settings` endpoints and store.

## Edge cases & security

- Both voice routes fail-closed via `verifyTwilioSignature`; non-Twilio POST → 403.
- No forward number set → skip `<Dial>`, go straight to text-back.
- Disabled toggle → no text-back logic runs.
- Cooldown hit → log call (`texted=0`), no SMS.
- Twilio unconfigured (no creds) → `sendSms` already logs instead of sending; no crash.
- Blocked/unknown caller ID (`From` missing) → log call only, skip text and contact creation.
- Self/loop guard → never text the Twilio number or the owner's forward number.
- Owner answers (`DialCallStatus='completed'`) → no text, just logged.

## Testing

Vitest, matching existing `test/` patterns:

- Bad/missing signature → 403 on both voice routes.
- Incoming call → TwiML `<Dial>` with forward number + timeout; empty forward number → text-back path.
- Missed (`no-answer`/`busy`/`failed`) → creates contact, sends text, logs `missed_calls` row `texted=1` with linked `message_id`.
- Answered (`completed`) → logs row `texted=0`, no SMS.
- Cooldown → 2nd missed call within window → logged, no 2nd text.
- Unknown `From` → log only, no text, no contact.
- Disabled toggle → no text-back.
- Existing contact → reused, not duplicated.

Manual: set the Twilio number's Voice webhook to `/twilio/voice` in the Twilio console; place a real test call.

## Out of scope (future)

- Voicemail recording + transcription (deferred; explicitly dropped in Q2).
- Business-hours vs after-hours templates (Q3 chose single template).
- AI-drafted per-caller text (Q3).
- Call analytics dashboard (the `missed_calls` table is designed to support it later).
