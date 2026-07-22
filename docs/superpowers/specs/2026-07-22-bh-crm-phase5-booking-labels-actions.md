# BH CRM — Phase 5: Self-Booking, Labels, Contact Actions, Bulk Ops, Reviews

**Date:** 2026-07-22
**Status:** Design approved — building
**Extends:** the live CRM (phases 1–4 deployed at `bh-crm.bhcardetails.workers.dev`).

## Purpose

Close the meaningful HubSpot gaps for a mobile-detailing operator and add the contact-management ergonomics Maxwell asked for:

1. **Edit contact info** (UI for the existing update endpoint).
2. **Colored labels = email lists** (one system: a colored tag also defines an email audience).
3. **Contact actions** — a next-step follow-up tracker + one-tap quick-log buttons.
4. **Self-booking** — public page with **live open slots** computed from working hours.
5. **Review requests** — send a Google-review link after a job; optional auto-send on completion.
6. **Contacts list** — sorting + checkbox multi-select with bulk actions.

Deposits/Stripe explicitly deferred to a later round.

## Conventions (unchanged)

Reuse phase-1 patterns: `one/all/run/uuid/nowIso`, `logActivity`, `requireAuth`, normalize/dedupe, `api()`. Stages `new|contacted|quoted|scheduled|customer|lost`. Money = integer cents. Timestamps ISO-8601 UTC; display in `HOME_TZ` (America/New_York). Commit trailer `Co-Authored-By: Claude Opus 4.8`. Every new endpoint added to `agent.ts` + `AGENTS.md`. Node not on PATH — prefix `export PATH="/c/Program Files/nodejs:$PATH"`.

---

## A. Colored labels (migration 0005)

```sql
CREATE TABLE labels (
  key TEXT PRIMARY KEY,               -- slug, e.g. "vip"
  label TEXT NOT NULL,                -- display, e.g. "VIP"
  color TEXT NOT NULL DEFAULT '#6b7280',
  sort INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
```
A contact's labels are stored in the existing `contacts.tags` JSON array (values = label keys). Every label doubles as an email list — no separate list entity.

**Routes** `crm/src/routes/labels.ts` (`/api/labels`, requireAuth): `GET /` list; `POST /` `{key, label, color?}` (validate key `^[a-z0-9_]{1,40}$`, dup → 409); `PATCH /:key` `{label?, color?}`; `DELETE /:key` (also strips the key from all contacts' tags).

## B. Contacts — sort + bulk actions

**Sort:** `GET /api/contacts` gains `order_by` (whitelist: `created_at|last_activity_at|first_name|stage`) + `order` (`asc|desc`, default `desc` for dates, `asc` for name). Reject non-whitelisted columns.

**Bulk action:** `POST /api/contacts/bulk-action` (requireAuth) body `{ ids: string[], op, value? }`, cap 500 ids. Ops:
- `add_label` / `remove_label` — value = label key; mutate each contact's `tags`.
- `set_stage` — value = stage (validated); logs `stage_changed`.
- `enroll_sequence` — value = sequence id; `enrollContact` each.
Returns `{ updated }`.

## C. Contact actions

- **Next step / follow-up** — reuses the tasks system. UI adds a "Set next step" control that creates a `task` with `contact_id`, `title`, `due_at`; the contact's open tasks render pinned near the top; they already appear in the dashboard "Due tasks". No backend change (tasks API exists).
- **Quick-log** — buttons that `POST /api/contacts/:id/activities` with `type` `call_logged` / `note` (endpoint exists). No backend change.
- **Edit info** — Edit toggle on ContactDetail turning first/last/email/phone/address/city into inputs, saved via `PATCH /api/contacts/:id` (allowlist already covers these).

## D. Self-booking — live open slots

**Settings (rows in `settings`):** `business_hours` JSON — `{ days:[0..6], start:"09:00", end:"18:00", slot_min:120, buffer_min:30 }` (default Mon–Sat 9–18, 2h slots, 30m buffer; `days` uses 0=Sun). `review_url`, `review_auto` ("1"/"0").

**Lib `crm/src/lib/booking.ts`:**
- `businessHours(env)` → parsed config (with defaults).
- `zonedToUtcIso(dateStr, "HH:MM", tz)` → UTC instant for a local wall-clock time (offset via `Intl` `shortOffset`, DST-aware).
- `availableSlots(env, dateStr)` → `string[]` of UTC ISO slot starts: generate `start..end` stepped by `slot_min` for that weekday; drop past slots; drop any slot whose `[start-buffer, start+slot_min+buffer]` overlaps an existing `scheduled|in_progress` job that day.

**Public routes (in `public.ts`, CORS like `/lead`):**
- `GET /api/book/availability?date=YYYY-MM-DD` → `{ slots }`.
- `POST /api/book` `{ name, phone, email?, service, address?, slot_start, ts, website }` — spam guard + rate limit (reuse `/lead` pattern); require `phone`; re-validate the slot is still free; upsert contact (dedupe by phone/email, `source='self-booking'`); create a `scheduled` job (`scheduled_start=slot_start`, `scheduled_end=+slot_min`, `title=service`, `address`); log `form_submitted` + `job_created`; fire `sendJobConfirmation` (dormant-safe). Returns `{ ok }`. If slot taken → `409 {error:"slot_taken"}`.

**Booking page:** public SPA route `/book` (outside the auth `Layout`) — service pick → date → live slots (calls availability) → name/phone → book. Mobile-first, spam honeypot + `ts`. Linkable from bhcardetails.com.

## E. Review requests

- `POST /api/jobs/:id/request-review` (requireAuth) — loads job + contact; if `review_url` set, sends SMS (`sendSms`) and/or email (`sendEmail`) with the link, logs `note` activity `"Review requested"`; returns `{ status }`. Dormant-safe (logs until Twilio/Resend live). 400 if no `review_url` configured.
- Optional auto: when `PATCH /api/jobs/:id` sets status `completed` and `settings.review_auto='1'`, call the same send. Guard so it fires once (only on the transition to completed).
- Settings UI: Google review link + an "auto-request on completion" toggle. Job row/ContactDetail get a "Request review" button.

## Frontend summary

- **ContactDetail:** Edit mode; colored label chips (add/remove from label set); next-step (task) pinned + "Set next step"; quick-log buttons (Call/Note); "Request review" on completed jobs.
- **Contacts list:** sortable headers; row checkboxes + select-all; floating bulk bar (Add label / Set stage / Email this list). Colored label chips on rows.
- **Settings:** Labels manager (name + color + delete); Booking settings (days/hours/slot/buffer); Google review link + auto toggle.
- **New public page `/book`.**

## Out of scope (deferred)
Stripe/deposits; embedding the booking page inside bhcardetails.com (needs the site repo); recurring availability exceptions/holidays; multi-user.

## Testing (Vitest, TDD where it has logic)
- `labels` CRUD + delete strips tags from contacts.
- `bulk-action`: add_label / set_stage / enroll across ids.
- contacts sort whitelist (bad `order_by` ignored/rejected).
- `availableSlots`: generates slots, excludes overlapping jobs + buffer, drops past slots; `zonedToUtcIso` DST sanity.
- `POST /api/book`: creates contact+job, rejects a taken slot (409), spam-guarded.
- `request-review`: 400 without `review_url`; logs + sends (logged) with it.
