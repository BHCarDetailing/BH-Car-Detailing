# BH CRM — Phase 2+ Additions: Messaging, Contact Import, iCloud Calendar Feed

**Date:** 2026-07-21
**Status:** Design — awaiting user review
**Extends:** `docs/superpowers/specs/2026-07-17-bh-crm-design.md` and the committed plan `docs/superpowers/plans/2026-07-21-bh-crm-phase2-pipeline-calendar.md` (Phase 2 core: mobile shell, pipeline, calendar, jobs, tasks, booking email).

## Purpose

Maxwell runs a quote-first, text-first mobile detailing business. This spec adds the capabilities he asked for on top of the Phase 2 core build:

1. **Two-way SMS inside the CRM** (Twilio) — real texting threads, with a zero-cost **tap-to-text bridge** usable immediately while Twilio A2P registration (1–3 weeks) is pending.
2. **iPhone contact import** — bulk-import contacts from an exported vCard (`.vcf`) or CSV file.
3. **iCloud calendar feed** — a private auto-refreshing `.ics` subscription so scheduled jobs appear on his iPhone calendar.

Already shipped in Phase 1 (no work needed): lead-form submissions auto-create/dedupe contacts (`crm/src/routes/public.ts` `/lead`).

## Sequencing

Executed after the Phase 2 core plan, in this order: (A) Messaging, (B) Contact import, (C) iCloud feed, then deploy. Everything reuses Phase 1 patterns: `one/all/run/uuid/nowIso` (`crm/src/lib/db.ts`), `logActivity` (`crm/src/lib/activity.ts`), `requireAuth` (`crm/src/lib/auth.ts`), normalize/dedupe (`crm/src/lib/normalize.ts`), `api()` (`crm/admin/src/api.ts`). Commit trailer: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

## A. Messaging — Twilio 2-way SMS + tap-to-text bridge

### Data model (migration `0003_messaging.sql`)

The Phase 2 `messages` table (migration 0002) is email-shaped. Add SMS columns (all nullable / defaulted so existing email rows are unaffected):

```sql
ALTER TABLE messages ADD COLUMN channel   TEXT NOT NULL DEFAULT 'email';   -- 'email' | 'sms'
ALTER TABLE messages ADD COLUMN direction TEXT NOT NULL DEFAULT 'outbound'; -- 'outbound' | 'inbound'
ALTER TABLE messages ADD COLUMN from_addr TEXT;   -- e164 phone (sms) — sender
ALTER TABLE messages ADD COLUMN to_addr   TEXT;   -- e164 phone (sms) — recipient
CREATE INDEX idx_messages_channel ON messages(channel, contact_id, id DESC);
```
SMS body reuses `body_text`. `provider_id` = Twilio Message SID. `status` values for SMS: `queued|sent|delivered|failed|logged` (`logged` = bridge fallback, no Twilio call). `kind` for SMS = `sms`.

### Env / secrets (added to `Env` in `crm/src/types.ts`, all optional)

```
TWILIO_ACCOUNT_SID?, TWILIO_AUTH_TOKEN?, TWILIO_FROM_NUMBER?  (e164, e.g. +1786...),
TWILIO_MESSAGING_SERVICE_SID?  (preferred over FROM_NUMBER once A2P campaign is attached)
```
Set via `wrangler secret put` — **credentials never committed, never pass through chat in plaintext**; the user runs the `secret put` commands himself.

### SMS module `crm/src/lib/sms.ts`

`sendSms(env, { contactId?, toPhone, body }) → { id, status }`, mirroring the email module's log-or-send fallback:
- Always inserts a `messages` row (`channel='sms'`, `direction='outbound'`).
- **If Twilio not configured** (`TWILIO_ACCOUNT_SID`/`AUTH_TOKEN` absent) → status `logged`, no network call. This is the state during A2P review; the UI shows the message as a bridge draft.
- **If configured** → POST to `https://api.twilio.com/2010-04-01/Accounts/{SID}/Messages.json` (Basic auth = SID:AuthToken), using `MessagingServiceSid` if set else `From=TWILIO_FROM_NUMBER`, with `StatusCallback` → `/public/twilio/status`. Status `sent` (+ Message SID) or `failed` (+ error).

### Routes

**Authenticated** (`crm/src/routes/messages.ts`, mounted `/api/messages`, behind `requireAuth`):
- `GET /api/messages?contact_id=&limit=` → thread for a contact (both directions), ascending by `created_at`.
- `POST /api/messages` body `{ contact_id, body }` → looks up contact phone, calls `sendSms`, logs `sms_logged` activity, advances stage `new→contacted`. Returns `{ id, status }`.
- `GET /api/messages/inbox` → most-recent message per contact that has any SMS, newest first (the Inbox list).

**Public webhooks** (`crm/src/routes/public.ts`, no `requireAuth` but **signature-verified, fail-closed**):
- `POST /public/twilio/inbound` — validates `X-Twilio-Signature` (HMAC-SHA1 of the full URL + sorted POST params, keyed by `TWILIO_AUTH_TOKEN`, via WebCrypto; **reject with 403 if invalid or token unset**). Matches contact by `From` phone (creates a `source='sms-inbound'` contact if unknown), inserts inbound `messages` row, sets `replied_flag=1`, updates `last_activity_at`, logs `sms_logged` (inbound). Responds `<Response></Response>` (empty TwiML).
- `POST /public/twilio/status` — same signature check; updates the matching `messages` row `status` by `MessageSid`.

### Admin UI

- **Inbox** page (`crm/admin/src/pages/Inbox.tsx`, route `/inbox`, added to `NAV_ITEMS`) — mobile-first conversation list; tap opens the thread.
- **Thread** component on `ContactDetail` — message bubbles (in/out), delivery status, composer textarea + Send (≥44px). When Twilio unconfigured, Send still records the outbound row and surfaces the **bridge** link.
- **Bridge**: a **Text** button (contact detail, pipeline card, dashboard lead row) = `sms:{phone}&body={template}` link; a **Call** button = `tel:{phone}`. Tapping fires `POST /api/contacts/:id/touch { channel }` (new lightweight route) to log `sms_logged`/`call_logged`, bump `last_activity_at`, advance `new→contacted`. Message template lives in a `settings` row `sms_template` (editable in Settings, `{first_name}` merge). AI-drafted templates are deferred to Phase 4.

### Agent surface

Add `/api/messages` GET/POST + `/api/messages/inbox` and `/api/contacts/:id/touch` to `crm/src/routes/agent.ts` catalog and `crm/AGENTS.md`. Activity types `sms_logged`/`call_logged` already exist in the spec enum.

---

## B. iPhone / vCard contact import

### Flow
iPhone: Contacts → share/export → vCard (`.vcf`, one or many contacts). CRM **Import** page → pick file → parse in browser → preview counts (`N found: X new, Y already in CRM`) → confirm → bulk upsert. CSV also accepted.

### Parsing (client-side, `crm/admin/src/lib/vcard.ts`)
Parse vCard 3.0/4.0: `FN`/`N` → first/last, `TEL` → phone, `EMAIL` → email, `ADR` → address, `ORG` → note. Handle multiple `VCARD` blocks and folded lines. CSV: header-mapped (`name/first_name/last_name`, `email`, `phone`). Output a normalized `{ first_name?, last_name?, email?, phone?, address? }[]`.

### Endpoint `POST /api/contacts/import` (behind `requireAuth`, in `crm/src/routes/contacts.ts`)
Body `{ contacts: [...] }` (cap 1000/request). For each: normalize email/phone, dedupe by email then phone (same logic as `/lead`), insert new (`source='iphone-import'`) or skip existing (COALESCE-fill missing fields only). Returns `{ created, updated, skipped }`. Logs one `import` activity per created contact.

### UI `crm/admin/src/pages/Import.tsx` (route `/import`)
File input, parse + preview table (first ~10 rows + totals), Import button, result summary. Mobile-first.

---

## C. iCloud calendar feed (one-way subscription)

### Endpoint `GET /public/calendar/:token.ics` (public, token-guarded)
`token` = secret stored in `settings` row `ics_feed_token` (generated once, `crypto.randomUUID()`); mismatch → 404. Emits `text/calendar` VCALENDAR with one `VEVENT` per job where `scheduled_start` is set and `status` in `scheduled|in_progress|completed|paid`:
- `UID` = `{job_id}@bhcardetails.com`, `DTSTART`/`DTEND` from `scheduled_start`/`scheduled_end` (UTC), `SUMMARY` = job title + contact name, `LOCATION` = job address, `DESCRIPTION` = services + price + contact phone. Include `X-WR-CALNAME:BH CRM Jobs`.
- Cache-friendly; iOS re-fetches on its own schedule (~15 min–hourly).

### Setup (user, once)
Settings page shows the feed URL + a "Copy" button and iPhone steps: *Calendar app → Calendars → Add → Add Subscribed Calendar → paste URL*. Regenerate-token button invalidates the old URL.

### Agent surface
Document `GET /public/calendar/:token.ics` in `AGENTS.md` (note it's token-guarded, not bearer-auth).

---

## Out of scope (deferred)
- Two-way calendar sync (CalDAV / Apple credentials).
- AI-drafted SMS/email (Phase 4 brand-brain).
- Email nurture sequences (Phase 3).
- MMS / photo quoting, customer self-booking.

## Security notes
- Twilio webhooks: signature-verified, **fail closed** (reject if signature invalid or `TWILIO_AUTH_TOKEN` unset).
- ICS + inbound webhook are the only new public routes; ICS guarded by unguessable token, no PII in the URL path beyond the token.
- Twilio credentials stored as Worker secrets only.

## Testing
Vitest (`@cloudflare/vitest-pool-workers`), TDD per existing pattern:
- `sms.ts` log-only fallback (no Twilio) + configured send (mock fetch).
- Signature verification accept/reject (known good/bad signature vectors).
- Inbound webhook: creates unknown contact, threads message, sets `replied_flag`.
- `/api/messages` thread + inbox ordering; `/touch` stage advance.
- vCard parser (multi-card, folded lines) + `/api/contacts/import` dedupe (created/updated/skipped).
- ICS feed: valid token returns VEVENTs for scheduled jobs; bad token 404.
