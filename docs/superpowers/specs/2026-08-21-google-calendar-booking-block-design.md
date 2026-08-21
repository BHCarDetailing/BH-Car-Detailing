# Google Calendar ↔ CRM

**Date:** 2026-08-21
**Status:** Approved design, not yet implemented
**Revision:** 2 — adds job push and manual blocks (write scope). Revision 1 was read-only.

## Problem

Two gaps, opposite directions.

**Inbound.** The public booking page offers slots derived only from the CRM's own `jobs`
table. Anything on the owner's Google Calendar — a dentist appointment, a vacation week,
a family visit — is invisible to it, so customers book on top of time already spoken for.

**Outbound.** CRM jobs do reach Google today, via the `/u/calendar/<token>.ics`
subscription feed. But Google refreshes external calendar subscriptions on its own
schedule — commonly 8–24 hours — so a job booked this morning may not appear on the
owner's phone until tomorrow, and a reschedule may never visibly land at all.

## Goal

1. A Google event marked **Busy** removes the overlapping booking slots from the
   customer-facing picker, and renders as a read-only grey chip in the CRM Calendar page.
   An event marked **Free** does nothing.
2. A CRM job appears on Google Calendar **immediately**, and follows its reschedules and
   cancellations.
3. The owner can block time on Google directly from the CRM Calendar page.

## Non-goals

- **Editing arbitrary Google events from the CRM** (dragging a dentist appointment in the
  CRM and having it move in Google). Deferred — see *Deferred: general two-way edit*.
- Multi-user / multi-technician calendars. Single-operator business, one Google account,
  one set of business hours.
- Removing the `.ics` feed. It stays for non-Google subscribers.

## Behaviour contract — inbound

A Google event blocks the overlapping window when **all** of:

| Condition | Rule |
|---|---|
| `status` | not `cancelled` |
| `transparency` | not `transparent`. Absent means busy (Google API default is `opaque`). |
| self attendance | if the owner is an attendee, `responseStatus` is not `declined` |
| calendar | the event's calendar is in the owner's selected set |
| window | the event falls in the next 60 days |
| origin | no `extendedProperties.private.bh_job_id` — see *Loop prevention* |

**Free/Busy is the whole user-facing model.** Multi-day and all-day events are not
special-cased: a two-week "family visiting" span marked Free leaves every slot bookable,
the same span marked Busy clears them all. This maps 1:1 onto the Google Calendar UI
control the owner already uses.

**Edge case worth knowing:** Google Calendar's web UI sets `transparency: transparent`
on all-day events it creates, so all-day entries default to non-blocking. Events
imported from other apps may omit the field entirely, which the API treats as busy. Such
an event will block until the owner opens it and marks it Free. This is correct per the
API contract; it is documented because the observed default differs by event origin.

The existing `buffer_min` travel buffer (default 30 min) applies around Google events
exactly as it does around jobs.

### Loop prevention

Once the CRM writes jobs into Google, the inbound sync will read its own writes back. If
those were treated as ordinary busy events they would be double-counted: once as a `jobs`
row, once as a `gcal_busy` row, and would render twice in the CRM Calendar page.

Every event the CRM creates carries `extendedProperties.private.bh_job_id`. The inbound
sync **skips any event carrying that property.** The job row is already the source of
truth for that time.

Manual blocks created via feature (b) carry `bh_block: "1"` instead and are *not* skipped
— they have no `jobs` row, so `gcal_busy` is where they must live.

## Architecture

### Storage — `crm/migrations/0024_google_calendar.sql`

```sql
CREATE TABLE gcal_busy (
  id          TEXT PRIMARY KEY,   -- "<google event id>@<calendar id>"
  calendar_id TEXT NOT NULL,
  summary     TEXT,               -- event title, rendered on the CRM grey chips
  starts_at   TEXT NOT NULL,      -- UTC ISO-8601
  ends_at     TEXT NOT NULL,      -- UTC ISO-8601
  all_day     INTEGER NOT NULL DEFAULT 0,
  is_block    INTEGER NOT NULL DEFAULT 0,  -- created by the CRM "block time" button
  synced_at   TEXT NOT NULL
);
CREATE INDEX gcal_busy_window ON gcal_busy (starts_at, ends_at);

CREATE TABLE oauth_tokens (
  provider      TEXT PRIMARY KEY,  -- 'google'
  refresh_token TEXT NOT NULL,
  access_token  TEXT,
  expires_at    INTEGER,           -- epoch ms
  account_email TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

ALTER TABLE jobs ADD COLUMN gcal_event_id TEXT;      -- Google event created for this job
ALTER TABLE jobs ADD COLUMN gcal_synced_at TEXT;     -- last successful push
ALTER TABLE jobs ADD COLUMN gcal_error TEXT;         -- last push failure, NULL when healthy
```

`oauth_tokens` is a separate table on purpose. `GET /api/settings` returns **every** row
of the `settings` table to the admin browser; putting a refresh token there would ship a
long-lived Google credential to the frontend on every Settings page load. No route reads
`oauth_tokens` back out to a client.

Non-secret config keeps using `settings`:

- `gcal_calendars` — JSON array of selected calendar ids (inbound: what blocks)
- `gcal_write_calendar` — calendar id job events are written to (outbound), default primary
- `gcal_last_sync` / `gcal_last_error`

### `crm/src/lib/gcal.ts` (new)

**Auth.** `getAccessToken(env)` reads `oauth_tokens`, returns the cached access token if
it has more than 60s left, otherwise refreshes against
`https://oauth2.googleapis.com/token` with `grant_type=refresh_token` and writes back.

**Read.** `listCalendars(env)` — `GET /calendar/v3/users/me/calendarList`, for the
Settings checkbox list. The primary calendar's `id` is the account email, so the
connected-account display needs no extra scope.

`syncGoogleBusy(env)` — for each selected calendar:

```
GET /calendar/v3/calendars/{calendarId}/events
    ?singleEvents=true&orderBy=startTime&maxResults=250
    &timeMin=<now>&timeMax=<now+60d>
```

`singleEvents=true` makes Google expand recurring series server-side, including
exceptions and cancelled instances — no RRULE / EXDATE / RECURRENCE-ID / VTIMEZONE
parser to write or maintain. Applies the behaviour contract, upserts survivors into
`gcal_busy`, then deletes rows in the window not seen this pass, so deletions in Google
propagate.

All-day events arrive as `start.date` / `end.date` where **end is exclusive** (the day
after). Converted to a UTC span using `HOME_TZ` via the existing `zonedToUtcIso()`.

**Write.** `pushJobEvent(env, job)` — creates or patches the Google event for a job.
`deleteJobEvent(env, job)` — removes it. `createBlock(env, {start, end, title})` /
`deleteBlock(env, eventId)` — manual blocks.

Job events carry:

```
summary:  "<job title> — <customer name>"
location: job.address
start/end: job.scheduled_start / scheduled_end
extendedProperties.private.bh_job_id: job.id
```

Written to `gcal_write_calendar`. Body mirrors what `buildIcs()` already produces, so the
two outbound paths describe a job identically.

### Job lifecycle → Google — `crm/src/routes/jobs.ts` (edited)

| CRM event | Google action |
|---|---|
| job scheduled (gains `scheduled_start`) | create event, store `gcal_event_id` |
| job rescheduled | patch event times |
| job address / title / customer changed | patch event body |
| job cancelled, or `scheduled_start` cleared | delete event, clear `gcal_event_id` |
| job deleted | delete event |

**Writes never block the CRM operation.** The push runs in `ctx.waitUntil` after the job
row is committed. If Google fails, the job is still saved and the failure lands in
`jobs.gcal_error`; the next cron pass retries any job with a non-NULL `gcal_error` or a
`gcal_synced_at` older than its `updated_at`. A customer booking must never fail because
Google is unreachable — same fail-open principle as the read path.

### Blocking — `crm/src/lib/booking.ts` (edited)

`availableSlots()` and `slotIsFree()` each currently carry their own copy of the
overlap-plus-buffer clash test against `jobs` — two copies of one rule that can drift.
Extract:

```ts
interface BusyWindow { start: number; end: number }   // epoch ms
async function busyWindows(env, fromIso, toIso): Promise<BusyWindow[]>
```

unioning scheduled/in-progress jobs with `gcal_busy` rows, plus a single
`overlaps(slotStart, slotEnd, windows, bufferMs)` helper both callers use. Targeted
cleanup of code this feature has to touch anyway — not a general refactor.

### OAuth — `crm/src/routes/google.ts` (new), mounted at `/api/settings/google`

| Route | Auth | Purpose |
|---|---|---|
| `GET /connect` | admin | Returns the Google consent URL |
| `GET /callback` | state HMAC | Exchanges code, stores refresh token, redirects to Settings |
| `GET /status` | admin | connected?, account email, calendars, last sync, last error |
| `GET /events` | admin | Cached Google events in a window, for the Calendar page chips |
| `PUT /calendars` | admin | Save selected (inbound) and write-target (outbound) calendars |
| `POST /sync` | admin | Force a sync now |
| `POST /blocks` | admin | Create a manual block — feature (b) |
| `DELETE /blocks/:id` | admin | Remove a manual block |
| `POST /disconnect` | admin | Revoke at Google, drop token row, clear `gcal_busy` |

Consent URL: `https://accounts.google.com/o/oauth2/v2/auth` with `access_type=offline`,
`prompt=consent` (forces a refresh token even on reconnect),
`scope=https://www.googleapis.com/auth/calendar.events`, and `state` = a nonce
HMAC-signed with the existing `SESSION_SECRET` and stamped with an expiry, verified in
the callback.

`calendar.events` grants read and write on events across the account's calendars. It
does **not** grant calendar management (create/delete whole calendars) — that would be
the broader `calendar` scope, which this design does not request.

`/callback` cannot use `requireAuth()` — Google's redirect is a top-level browser
navigation, so the signed `state` is what proves the request originated from the admin's
own `/connect` call.

Redirect URI is derived from `PUBLIC_BASE_URL` and must be registered in Google Cloud
Console exactly. If the CRM is reachable at both the `workers.dev` hostname and a custom
domain, register both.

New secrets via `wrangler secret put`: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`. Both
added as optional fields on `Env` in `crm/src/types.ts` and surfaced in the existing
`GET /api/settings/integrations` presence map as `google_calendar`.

### Freshness

Two triggers, one mechanism (`syncIfStale`, threshold 5 minutes):

1. The existing `*/5 * * * *` cron in `crm/src/index.ts` calls `syncGoogleBusy`, then
   retries any job whose push previously failed.
2. `GET /api/book/availability` and the `POST /api/book` submit path call `syncIfStale`
   before reading, so a customer arriving after a cron miss still gets current data, and
   the slot is re-validated against fresh data at the moment of booking.

Worst-case inbound staleness ~5 minutes, effectively zero at submit time. Outbound job
pushes are immediate, not cron-bound.

### Failure handling — fail open, both directions

**Inbound.** If the refresh token is revoked, credentials are missing, or Google errors:
the message lands in `gcal_last_error`, Settings shows a red "Reconnect Google Calendar"
banner, and `gcal_busy` is **not** wiped — the last known-good cache keeps blocking. With
no usable cache, slot generation proceeds on jobs alone. Slots are never hidden because
of a Google failure: an occasional double-booking is a phone call, whereas a booking page
silently showing "nothing available" costs every lead for the outage with no signal that
anything is wrong.

**Outbound.** A failed push never rolls back the job. The error is recorded per-job and
retried by cron. The CRM remains the source of truth for jobs.

## Admin UI

**`Settings.tsx`** — a "Google Calendar" card beside the existing integration cards:
connect button or connected account email, checkbox list of calendars to read, a picker
for which calendar job events are written to, last-sync timestamp, Sync now, Disconnect,
and the reconnect-needed banner when `gcal_last_error` is set.

**`Calendar.tsx`** — alongside the existing `/api/jobs` fetch, load
`/api/settings/google/events?from&to` and render Google events as grey, dashed-border,
non-clickable chips, visually distinct from the coloured `STATUS_COLOR` job chips.
Manual blocks (`is_block = 1`) render the same but with a remove control. Clicking empty
space on a day opens a small "Block this time" form that POSTs to `/blocks`.

## Owner setup — one time

1. Google Cloud Console → new project.
2. OAuth consent screen → **External** user type (consumer Gmail, so Internal is
   unavailable). Add `calendar.events` as a scope.
3. **Set publishing status to "In production".** Not optional: refresh tokens issued by
   an app left in **Testing** are revoked by Google after **7 days**, silently breaking
   the connection every week. Production is required even though the app stays
   unverified — the unverified consent warning is expected and clicked through once.
4. Credentials → OAuth client ID → Web application → add the redirect URI.
5. `wrangler secret put GOOGLE_CLIENT_ID` and `wrangler secret put GOOGLE_CLIENT_SECRET`,
   run by the owner — these are credentials and are not handled by the agent.
6. CRM → Settings → Google Calendar → Connect → grant → pick calendars.
7. **Unsubscribe Google from the old `.ics` feed.** Once job push is live, keeping the
   subscription makes every job appear twice — once from the API event, once from the
   feed. In Google Calendar → Other calendars → the BH CRM subscription → unsubscribe.
   The feed endpoint stays live for iCloud or any other subscriber.

## Testing — `crm/test/gcal-blocking.test.ts`

Vitest, matching the existing `crm/test/*.test.ts` pattern.

**Inbound blocking**
1. A Busy Google event overlapping a slot removes that slot.
2. The same event marked Free (`transparency: 'transparent'`) leaves the slot available.
3. An event with no `transparency` field blocks (API default is busy).
4. An all-day Busy event clears every slot that day.
5. A multi-day Busy span clears every slot across the whole span.
6. A multi-day span marked Free clears nothing.
7. `buffer_min` applies around Google events, not just jobs.
8. A `cancelled` event does not block.
9. An event the owner declined does not block.

**Loop prevention**
10. An event carrying `bh_job_id` is skipped by the sync — its time is blocked once, by
    the job row, not twice.
11. An event carrying `bh_block` is *not* skipped and does block.

**Outbound push**
12. Scheduling a job creates an event tagged with its `bh_job_id`.
13. Rescheduling patches the existing event rather than creating a second one.
14. Cancelling a job deletes its event and clears `gcal_event_id`.
15. A Google write failure leaves the job saved with `gcal_error` set.
16. The cron retry pass clears `gcal_error` on a subsequent success.

**Fail open**
17. A Google API failure with an empty cache still returns job-derived slots.
18. A Google API failure with a warm cache keeps blocking from the cache.

**Regression guard**
19. `slotIsFree()` and `availableSlots()` agree on the same fixture — guards the
    extracted `busyWindows()` helper.

## Build order

Checkpointed so a partial run still leaves a coherent system:

1. Migration, `gcal.ts` read path, OAuth routes, `booking.ts` blocking, unit tests.
2. Settings card — the handshake becomes provable end-to-end.
3. Job push (a) + Calendar grey chips.
4. Manual blocks (b).

Steps 3 and 4 depend on a working connection from step 2, which depends on the owner's
Console setup. Step 1 is fully unit-testable with mocked Google responses before any of
that exists.

## Decisions and rejected alternatives

**Google Calendar API over the secret iCal URL.** The iCal route needs no Google Cloud
setup but requires hand-writing an RRULE/EXDATE/VTIMEZONE expander. Recurring events are
where such a parser fails, and it fails silently — a wrongly-expanded series shows as
slots that should not exist. `singleEvents=true` moves that work to Google. The iCal
route also cannot write, so it cannot deliver goals 2 or 3 at all.

**Google Calendar API over an Apps Script webhook.** Apps Script syncs faster and skips
OAuth, but puts sync logic in a Google-hosted script outside this repository, where
neither owner nor agent can read, test, or version it.

**`events.list` over `freeBusy.query`.** `freeBusy` returns busy intervals with no
titles. Since the CRM Calendar page shows Google events as grey chips, an untitled "Busy"
chip would not tell the owner *why* a slot is gone. `events.list` returns `summary`.

**Tagging over name-matching for loop prevention.** Identifying CRM-created events by
comparing titles or times would misfire the moment the owner edits a title in Google.
`extendedProperties.private` is invisible in the Google UI, survives edits, and is exact.

**Fail open over fail closed, both directions.** See Failure handling.

### Deferred: general two-way edit

Editing arbitrary (non-CRM) Google events from the CRM is deliberately out of scope. It
is not more API surface — it is a different problem, requiring:

- **Conflict resolution.** A job moved in the CRM while the same event moved in Google.
  Either resolution rule silently discards somebody's edit.
- **Deletion semantics.** An event deleted in Google — does that cancel the customer's
  job? If yes, a stray swipe on a phone cancels an appointment with no one notified.
- **Incremental sync.** `syncToken`-based reads instead of re-scanning a 60-day window,
  to stay inside quota once writes are frequent.
- **Push notifications.** `events.watch` channels, which expire and need cron renewal.

The current design avoids all four by the tagging rule: the CRM only ever writes events
it created. Lifting that restriction is its own spec.
