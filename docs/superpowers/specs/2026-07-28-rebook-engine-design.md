# BH CRM — Batch 1: Action Core (rebook engine + SMS compliance)

**Date:** 2026-07-28
**Branch:** `crm-operating-system`
**Source:** "Turn the CRM into a Booking Machine" spec (Phases 0/2.5/3/5.3), reconciled against the actual codebase.

## Why this batch

The external spec was written from the live UI, not the code. An audit of `crm/` on
2026-07-28 found roughly 60% of it already built: D1 with `contacts`/`vehicles`/`jobs`/
`services`, a working `/book` flow that creates a contact + scheduled job + consent record
+ confirmation, live Stripe deposits, Twilio webhooks with fail-closed signature
validation, missed-call text-back, and an email sequence engine with quiet hours.

Two genuine gaps remain, and they are the two the spec calls highest-value:

1. **No rebook engine.** Nothing computes when a customer is next due. `reminders.ts`
   only sends 2h/24h appointment reminders. Rebook rate is 25% against a 50% target —
   the largest untapped lever in the business.
2. **No SMS opt-out handling.** The inbound Twilio handler at `public.ts:478` logs the
   message and sets `replied_flag`, but never checks for STOP/HELP/START and never pauses
   an active sequence when a human replies. This is a compliance hole (TCPA statutory
   damages run $500–$1,500 per message) and the single fastest way to burn a customer.

## Scope

In: rebook data model, job-completion side-effects, send guardrails, STOP/HELP/START,
reply-pauses-sequence, daily rebook cron, "Due This Week" worklist on `/home`.

Out (later batches): multi-channel sequence steps, the remaining trigger types,
reactivation worklist, referral automation, pricing corrections (business data, not code).

## Decisions

Settled with Maxwell 2026-07-28 via AskUserQuestion — do not re-litigate:

- **Draft for approval, never autosend.** The cron computes the due list and pre-fills a
  message. Nothing leaves the system until Maxwell taps send. Rationale: the 164 imported
  contacts have no recorded consent, and Twilio A2P is still in review, so automated sends
  would be both non-compliant and carrier-filtered.
- **Tighter maintenance cadence:** Wash & Wax 14 days, Interior/Exterior/Full Detail 60,
  Ceramic Coating 180, Paint Correction 365. Editable per service in Settings, overridable
  per contact.

## Data model — migration `0012_rebook.sql`

Additive only; no table rewrites, no destructive statements.

```sql
ALTER TABLE contacts ADD COLUMN last_service_at      TEXT;
ALTER TABLE contacts ADD COLUMN next_due_at          TEXT;
ALTER TABLE contacts ADD COLUMN job_count            INTEGER NOT NULL DEFAULT 0;
ALTER TABLE contacts ADD COLUMN lifetime_value_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE contacts ADD COLUMN rebook_snooze_until  TEXT;
ALTER TABLE contacts ADD COLUMN rebook_days_override INTEGER;
ALTER TABLE contacts ADD COLUMN sms_opted_out_at     TEXT;
ALTER TABLE contacts ADD COLUMN do_not_contact       INTEGER NOT NULL DEFAULT 0;
ALTER TABLE services ADD COLUMN rebook_days          INTEGER;
ALTER TABLE jobs     ADD COLUMN completed_at         TEXT;
ALTER TABLE jobs     ADD COLUMN review_requested_at  TEXT;
ALTER TABLE jobs     ADD COLUMN rebook_offer_sent_at TEXT;

CREATE TABLE recurring_plans (
  id            TEXT PRIMARY KEY,
  contact_id    TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  service_id    TEXT REFERENCES services(id) ON DELETE SET NULL,
  interval_days INTEGER NOT NULL,
  price_cents   INTEGER NOT NULL DEFAULT 0,
  next_run_at   TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'active',
  notes         TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
```

Indexes on `contacts(next_due_at)`, `jobs(completed_at)`, `recurring_plans(status, next_run_at)`.

The migration backfills `job_count`, `lifetime_value_cents`, and `last_service_at` from
existing completed/paid jobs, seeds `rebook_days` on the six seeded services at the agreed
cadence, and derives an initial `next_due_at` for every contact with service history.

`next_due_at` lives on `contacts`, not `jobs`, because the question it answers is "who
should I call this week" — a per-customer question. Per-job history stays in `jobs`.

## Components

Each unit has one job and is testable without the others.

**`src/lib/rebook.ts`** — the domain logic.
- `rebookDaysFor(env, job)` → contact override, else the job's service `rebook_days`, else
  null (meaning: never rebook, e.g. one-off work).
- `onJobCompleted(env, jobId)` → the single side-effect funnel. Stamps `completed_at`,
  increments `job_count` and `lifetime_value_cents`, sets `last_service_at`, computes
  `next_due_at`, and queues the review request. Idempotent: guarded on `completed_at`
  being null, so a double PATCH cannot double-count revenue.
- `dueList(env, now, opts)` → the worklist, bucketed DUE_SOON (≤7d out) / DUE_NOW
  (±1d) / OVERDUE (7–30d past) / LAPSING (>60d past), sorted by
  `lifetime_value_cents DESC, next_due_at ASC`.
- `runRebook(env, now)` → the daily cron entry point. In draft-for-approval mode it
  refreshes the list and records a single Updates-feed post; it sends nothing.

**`src/lib/guardrails.ts`** — one gate every automated send passes through.
`canSend(env, contactId, now)` returns `{ ok: true }` or `{ ok: false, reason }` for:
opted out (`sms_opted_out_at`) or `do_not_contact`; messaged within the last 7 days;
an inbound message on the thread newer than our last outbound (they asked something and
nobody answered); outside 9am–8pm ET; more than 40 automated messages sent today.
Extracted as its own module so later batches (sequences, reactivation) reuse it rather
than reimplementing the rules.

**`src/lib/optout.ts`** — keyword classification, pure and unit-testable.
`classifyInbound(body)` → `'stop' | 'help' | 'start' | null`.

**Inbound handler** (`public.ts`) gains, after the message insert: keyword handling
(STOP sets `sms_opted_out_at` + `sms_opt_in=0` + exits active enrollments + sends one
confirmation; HELP replies with brand and contact; START clears the opt-out) and, for any
other inbound message, pausing the contact's active enrollment so no robot talks over a
live conversation.

**Cron** (`index.ts` + `wrangler.jsonc`). Triggers become `["*/5 * * * *", "0 13 * * *"]`.
The scheduled handler switches on `event.cron`: the 5-minute tick keeps running reminders
and sequences; the 13:00 UTC tick (9am ET) runs the rebook pass.

**API** (`src/routes/rebook.ts`): `GET /api/rebook/due`, `POST /api/rebook/:contactId/snooze`,
`POST /api/rebook/:contactId/send` (explicit, human-initiated, still guardrail-checked),
`POST /api/rebook/recompute`.

**UI** (`admin/src/pages/Home.tsx`): a "Due This Week" card listing each due customer with
their vehicle, last service, and suggested price, and per-row `Text offer` / `Book now` /
`Snooze 2w` actions.

## Data flow

```
job PATCH status=completed ──▶ onJobCompleted ──▶ contacts.next_due_at set
                                              └─▶ review request queued

daily cron 13:00 UTC ──▶ runRebook ──▶ dueList ──▶ /home worklist
                                                        │
                                          Maxwell taps  ▼
                                              POST /rebook/:id/send
                                                        │
                                                    canSend? ──no──▶ blocked, reason shown
                                                        │yes
                                                     sendSms
```

## Error handling

Cron work is wrapped so one failing contact cannot abort the pass. Guardrail failures are
returned as structured reasons and surfaced in the UI, never swallowed. `onJobCompleted`
is idempotent. Twilio inbound continues to fail closed on a bad signature — unchanged.
Sends remain dormant-safe: without Twilio credentials `sendSms` logs instead of sending,
so nothing in this batch breaks before A2P approval.

## Testing

New `test/rebook.test.ts` and `test/optout.test.ts` covering: cadence resolution and
override precedence; `onJobCompleted` idempotency (double-PATCH does not double revenue);
each due bucket boundary; every guardrail rejection reason; STOP/HELP/START classification
including case and punctuation; STOP exits enrollments; a normal inbound reply pauses an
active enrollment. Existing 154 tests must continue to pass.

## Deployment

Nothing deploys without Maxwell's approval. Migration 0011 is also still pending on
remote D1, so the order is: `wrangler d1 migrations apply bh-crm --remote` (applies 0011
then 0012), then build admin, then `wrangler deploy`.
