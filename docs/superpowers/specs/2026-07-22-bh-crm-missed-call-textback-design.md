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

Migration `0006_missed_call_textback.sql` (the single V1.1 migration also carries the V1.1 columns — see V1.1 §11). Base `missed_calls` shape:

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

---

# V1.1 Enhancements

Extensions on top of V1 above. Same architecture, style, DB patterns, Twilio fail-closed verification, settings store, activity timeline, and Vitest conventions. Two design forks were resolved by the user:

- **Fork 1 (realtime) = B — deferred.** No realtime infra exists (no WebSocket / Durable Object / SSE / polling; inbox loads once on mount). True push is its own future phase. V1.1 ships all data + logic, an owner **SMS** notification (fires even when the CRM is closed), and a data-derived inbox badge. Inbox/badge refresh on next load/navigation, not via push.
- **Fork 2 (retry) = A — single immediate retry.** No 30s delay (a Twilio webhook must respond in seconds and Workers can't sleep in-handler). One immediate retry inside the background task.

## Execution model (applies to all missed-call handling)

The `/twilio/voice/complete` handler returns TwiML **immediately**, then runs all text-back / logging / notification work in the background via `c.executionCtx.waitUntil(...)`. This keeps the webhook fast and lets the single retry happen without blocking Twilio.

## V1.1 features

### 1. Contact SMS opt-out (auto only)

- New column `contacts.sms_opt_out_auto INTEGER NOT NULL DEFAULT 0` (`0` = auto-texts allowed, `1` = never auto-text).
- Applies **only** to missed-call auto-texts. Manual SMS sending is unaffected.
- If `1`: log the missed call (`texted=0`, `skip_reason='opt_out'`), log a timeline event, send no SMS.

### 2. Skip reasons

- New column `missed_calls.skip_reason TEXT NULL`.
- Allowed: `answered`, `cooldown`, `disabled`, `unknown_number`, `self_guard`, `opt_out`, `sms_failed`.
- Set on every non-texted outcome per the mapping in the source spec (answered / cooldown / disabled / unknown / self-guard / opt-out / sms-failed). When a text **is** sent: `texted=1`, `skip_reason` NULL.

### 3. Template snapshot

- New column `missed_calls.text_template_snapshot TEXT NULL`.
- Populated **only when an SMS is actually sent** — the exact delivered body. Preserves historical accuracy if the Settings template changes later.

### 4. Retry failed SMS (Fork 2 = A)

- If `sendSms` reports failure, retry **exactly once, immediately**, inside the background task.
- Retry succeeds → normal (`texted=1`, snapshot saved, `message_id` linked).
- Retry fails → `texted=0`, `skip_reason='sms_failed'`. Never more than one retry. No duplicate `messages` rows (reuse the existing single-insert path; a failed `sendSms` already logs its own `messages` row with `status='failed'` — the retry is a fresh send attempt, and only the successful/last attempt is linked as `message_id`).

### 5. Owner notification (Fork 1 = B → SMS)

- Whenever a call reaches the text-back flow (missed), notify the owner by **SMS** to a configured number.
- Content: contact name (or `Unknown Caller`), phone number, time, whether the auto-text was sent, and a link to open the conversation (deep link to the CRM inbox thread, e.g. `{app_url}/inbox?contact={id}`).
- New settings: `owner_notify_enabled` (default `"1"`), `owner_notify_number` (default empty → falls back to `owner_forward_number`; if both empty, skip).
- In-app real-time owner toast is deferred to the realtime phase; the inbox badge (below) covers in-app visibility on load.

### 6. Inbox conversation update (data-derived, no push)

- A missed call find-or-creates the contact and writes the inbound-side records so the conversation exists and sorts to the top of the inbox by recency on next load (inbox already orders by newest message/activity).
- No WebSocket in V1.1 — refresh happens on next inbox load/navigation. The realtime phase later upgrades this to push without changing the data model.

### 7. Missed-call badge (data-derived, auto-clears on view)

- New column `missed_calls.acknowledged_at TEXT NULL`.
- Badge shows on an inbox conversation while that contact has any `missed_calls` row with `acknowledged_at IS NULL`. Label reflects state: **"🔥 New Missed Call — Auto Text Sent"** when `texted=1`, **"Missed Call — Awaiting Reply"** otherwise.
- Opening the contact's conversation (existing thread GET) sets `acknowledged_at = now()` on that contact's unacknowledged rows → badge disappears on next render.
- Reuse existing badge/chip components; no hardcoded styling.

### 8. Reply-aware cooldown (replaces V1 cooldown)

- Suppress a second auto-text until **either** the cooldown window expires **or** the customer replies — whichever gates. Specifically: on a new missed call, send the auto-text **only if** there is no prior auto-text (`missed_calls.texted=1`) to this `from_phone` within `missed_call_cooldown_hours` **AND** (if within the window) the customer has sent no inbound message since that last auto-text. Once the customer replies, the conversation is engaged and repeated auto-texts are avoided until the window has fully expired with no further engagement.
- Prevents spamming already-engaged customers.

### 9. Lead source tracking (first contact only)

- New columns on `contacts`: `lead_source TEXT NULL`, `first_contact_method TEXT NULL`, `acquisition_channel TEXT NULL`.
- On **first** creation via missed call, set `lead_source='missed_call'`, `first_contact_method='phone'`, `acquisition_channel='twilio_voice'`.
- Never overwrite these for existing contacts — populate only when the contact row is newly created.

### 10. Call duration

- New column `missed_calls.duration_seconds INTEGER NULL`.
- Populate from Twilio's duration params (e.g. `DialCallDuration` / `CallDuration`) whenever provided (answered calls always; others if present). Otherwise NULL.

### 11. Migration

- Single new migration `0006_missed_call_textback.sql`, next in sequence, creating the `missed_calls` table (with V1 columns **plus** `skip_reason`, `text_template_snapshot`, `duration_seconds`, `acknowledged_at`) and `ALTER TABLE contacts ADD COLUMN` for `sms_opt_out_auto`, `lead_source`, `first_contact_method`, `acquisition_channel`. Do not modify earlier migrations.

### 12. Activity timeline

- Every missed call adds a timeline event using existing activity patterns, alongside SMS history:
  - Auto-text sent → "Missed Call — Auto-text sent"
  - Cooldown → "Missed Call — Skipped (Cooldown)"
  - Opt-out → "Missed Call — Skipped (Opt Out)"
  - Answered → "Missed Call — Answered"
  - (and the remaining skip reasons, one event each)

### 13. Testing (extends the Vitest suite, no weakening of existing tests)

- Contact opted out → no SMS, `skip_reason='opt_out'`, timeline event.
- Retry succeeds → `texted=1`, snapshot saved, no duplicate message.
- Retry fails → `texted=0`, `skip_reason='sms_failed'`.
- Each `skip_reason` value set correctly for its scenario.
- Template snapshot persisted only when sent, and frozen against later template edits.
- Owner notification SMS fired with correct fields; falls back / skips per settings.
- Inbox ordering: new missed-call conversation sorts to top on load.
- Badge: shows while unacknowledged, clears after conversation viewed.
- Reply-aware cooldown: no 2nd text within window; reply keeps it suppressed; expiry allows again.
- Duration saved when Twilio provides it.
- Lead-source metadata set on first creation only; not overwritten for existing contacts.

## Updated data summary

`missed_calls` (created in `0006`): V1 columns + `skip_reason TEXT`, `text_template_snapshot TEXT`, `duration_seconds INTEGER`, `acknowledged_at TEXT`.

`contacts` (altered in `0006`): + `sms_opt_out_auto INTEGER DEFAULT 0`, `lead_source TEXT`, `first_contact_method TEXT`, `acquisition_channel TEXT`.

## Updated settings summary

V1 keys + `owner_notify_enabled` (default `"1"`), `owner_notify_number` (default empty → falls back to `owner_forward_number`). Optional `app_url` for the deep link in the owner SMS (default the deployed CRM origin).

## Deferred to realtime phase (explicitly not in V1.1)

- WebSocket / Durable Object push layer.
- Live inbox reorder and badge without reload.
- In-app real-time owner toast (V1.1 uses owner SMS instead).
- 30s-delayed retry via Queue/Cron (V1.1 uses one immediate retry).
