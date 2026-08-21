# Google Calendar → Booking Availability

**Date:** 2026-08-21
**Status:** Approved design, not yet implemented

## Problem

The public booking page (`/book`) offers time slots derived only from the CRM's own
`jobs` table. Anything on the owner's personal Google Calendar — a dentist appointment,
a vacation week, a family visit — is invisible to it, so customers can and do book on
top of time that is already spoken for.

The CRM already publishes *outbound* to Google: `/u/calendar/<token>.ics` exposes CRM
jobs as a subscribable feed. This design adds the missing *inbound* direction.

## Goal

An event on the owner's Google Calendar marked **Busy** removes the overlapping booking
slots from the customer-facing picker, and shows as a read-only grey block in the CRM
Calendar page. An event marked **Free** does nothing.

## Non-goals

- Writing to Google Calendar from the CRM. The OAuth scope requested is read-only and
  the CRM cannot create, edit, or delete Google events.
- Multi-user / multi-technician calendars. This is a single-operator business; there is
  one Google account and one set of business hours.
- Replacing the existing outbound `.ics` feed. It stays as-is.

## Behaviour contract

Given a Google event, the CRM blocks the overlapping window when **all** of:

| Condition | Rule |
|---|---|
| `status` | not `cancelled` |
| `transparency` | not `transparent`. Absent means busy (Google API default is `opaque`). |
| self attendance | if the owner is an attendee, `responseStatus` is not `declined` |
| calendar | the event's calendar is in the owner's selected set |
| window | the event falls in the next 60 days |

**Free/Busy is the whole user-facing model.** Multi-day and all-day events are not
special-cased: a two-week "family visiting" span marked Free leaves every slot bookable,
the same span marked Busy clears them all. This is what the owner asked for and it maps
1:1 onto the Google Calendar UI control they already use.

**Edge case worth knowing:** Google Calendar's web UI sets `transparency: transparent`
on all-day events it creates, so all-day entries default to non-blocking. Events
imported from other apps may omit the field entirely, which the API treats as busy. Such
an event will block until the owner opens it and marks it Free. This is correct per the
API contract; it is documented here because the observed default differs by event origin.

The existing `buffer_min` travel buffer (default 30 min) applies around Google events
exactly as it does around jobs.

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
```

`oauth_tokens` is a separate table on purpose. `GET /api/settings` returns **every**
row of the `settings` table to the admin browser; putting a refresh token there would
ship a long-lived Google credential to the frontend on every Settings page load.
No route reads `oauth_tokens` back out to a client.

Non-secret config keeps using `settings`:

- `gcal_calendars` — JSON array of selected calendar ids
- `gcal_last_sync` — UTC ISO of last successful sync
- `gcal_last_error` — last failure message, empty when healthy

### Sync — `crm/src/lib/gcal.ts` (new)

`getAccessToken(env)` — reads `oauth_tokens`, returns the cached access token if it has
more than 60s left, otherwise refreshes against `https://oauth2.googleapis.com/token`
with `grant_type=refresh_token` and writes the new one back.

`listCalendars(env)` — `GET /calendar/v3/users/me/calendarList`, used by the Settings
card to render the checkbox list. The primary calendar's `id` is the account email, so
the connected-account display needs no extra scope.

`syncGoogleBusy(env)` — for each selected calendar:

```
GET /calendar/v3/calendars/{calendarId}/events
    ?singleEvents=true&orderBy=startTime&maxResults=250
    &timeMin=<now>&timeMax=<now+60d>
```

`singleEvents=true` makes Google expand recurring series server-side, including
exceptions and cancelled instances. This is the reason for choosing the API over an
iCal feed: no RRULE / EXDATE / RECURRENCE-ID / VTIMEZONE parser to write or maintain.

Applies the behaviour-contract filter, upserts survivors into `gcal_busy`, then deletes
rows in the window that were not seen this pass (handles deletions in Google).

All-day events arrive as `start.date` / `end.date` where **end is exclusive** (the day
after). Converted to a UTC span using `HOME_TZ` via the existing `zonedToUtcIso()`.

### Blocking — `crm/src/lib/booking.ts` (edited)

`availableSlots()` and `slotIsFree()` currently each carry their own copy of the
overlap-plus-buffer clash test against `jobs`. Two copies of the same rule that can
drift. Extract:

```ts
interface BusyWindow { start: number; end: number }   // epoch ms
async function busyWindows(env, fromIso, toIso): Promise<BusyWindow[]>
```

which unions scheduled/in-progress jobs with `gcal_busy` rows, and a single
`overlaps(slotStart, slotEnd, windows, bufferMs)` helper both callers use. This is a
targeted cleanup of code the feature has to touch anyway — not a general refactor.

### OAuth — `crm/src/routes/google.ts` (new), mounted at `/api/settings/google`

| Route | Auth | Purpose |
|---|---|---|
| `GET /connect` | admin | Returns the Google consent URL |
| `GET /callback` | state HMAC | Exchanges code, stores refresh token, redirects to Settings |
| `GET /status` | admin | connected?, account email, calendars, last sync, last error |
| `GET /events` | admin | Cached Google events in a window, for the Calendar page chips |
| `PUT /calendars` | admin | Save the selected calendar ids |
| `POST /sync` | admin | Force a sync now |
| `POST /disconnect` | admin | Revoke at Google, drop token row, clear `gcal_busy` |

Consent URL: `https://accounts.google.com/o/oauth2/v2/auth` with
`access_type=offline`, `prompt=consent` (forces a refresh token even on reconnect),
`scope=https://www.googleapis.com/auth/calendar.readonly`, and `state` = a nonce
HMAC-signed with the existing `SESSION_SECRET` and stamped with an expiry, verified in
the callback. `/callback` cannot use `requireAuth()` — Google's redirect is a top-level
browser navigation, so the signed `state` is what proves the request originated from the
admin's own `/connect` call.

Redirect URI is derived from `PUBLIC_BASE_URL` and must be registered in Google Cloud
Console exactly. If the CRM is reachable at both the `workers.dev` hostname and a custom
domain, register both.

New secrets, set with `wrangler secret put`: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`.
Both added as optional fields on `Env` in `crm/src/types.ts`, and surfaced in the
existing `GET /api/settings/integrations` presence map as `google_calendar`.

### Freshness

Two triggers, one mechanism (`syncIfStale`, threshold 5 minutes):

1. The existing `*/5 * * * *` cron in `crm/src/index.ts` calls `syncGoogleBusy`.
2. `GET /api/book/availability` and the `POST /api/book` submit path call `syncIfStale`
   before reading, so a customer arriving after a cron miss still gets current data, and
   the slot is re-validated against fresh data at the moment of booking.

Worst-case staleness is therefore ~5 minutes, and effectively zero at submit time.

### Failure handling — fail open

If the refresh token is revoked, the credentials are missing, or Google returns an error:

- The error is written to `gcal_last_error` and the Settings card shows a red
  "Reconnect Google Calendar" banner.
- `gcal_busy` is **not** wiped — the last known-good cache keeps blocking.
- If there is no usable cache, slot generation proceeds on jobs alone.

Slots are never hidden because of a Google failure. Rationale: an occasional
double-booking is a phone call to reschedule, whereas a booking page silently showing
"nothing available" costs every lead for the duration of the outage, with no signal that
anything is wrong. Approved by the owner.

## Admin UI

**`crm/admin/src/pages/Settings.tsx`** — a "Google Calendar" card alongside the existing
integration cards: Connect button (or connected account email), checkbox list of
calendars from `calendarList`, last-sync timestamp, Sync now, Disconnect, and the
reconnect-needed banner when `gcal_last_error` is set.

**`crm/admin/src/pages/Calendar.tsx`** — alongside the existing `/api/jobs` fetch, load
`/api/settings/google/events?from&to` and render Google events as grey, dashed-border,
non-clickable chips. Visually distinct from the coloured `STATUS_COLOR` job chips so
there is no ambiguity about which items are CRM jobs.

## Owner setup — one time

1. Google Cloud Console → new project.
2. OAuth consent screen → **External** user type (the account is consumer Gmail, so
   Internal is unavailable). Add `calendar.readonly` as a scope.
3. **Set publishing status to "In production".** This is not optional: refresh tokens
   issued by an app left in **Testing** are revoked by Google after **7 days**, which
   would silently break the connection every week. Production is required even though
   the app stays unverified — the unverified consent warning is expected and is clicked
   through once by the sole user.
4. Credentials → OAuth client ID → Web application → add the redirect URI.
5. `wrangler secret put GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`.
6. CRM → Settings → Google Calendar → Connect → grant → pick calendars.

## Testing — `crm/test/gcal-blocking.test.ts`

Vitest, matching the existing `crm/test/*.test.ts` pattern.

1. A Busy Google event overlapping a slot removes that slot.
2. The same event marked Free (`transparency: 'transparent'`) leaves the slot available.
3. An event with no `transparency` field blocks (API default is busy).
4. An all-day Busy event clears every slot that day.
5. A multi-day Busy span clears every slot across the whole span.
6. A multi-day span marked Free clears nothing.
7. The `buffer_min` buffer applies around Google events, not just jobs.
8. A `cancelled` event does not block.
9. An event the owner declined does not block.
10. A Google API failure with an empty cache still returns job-derived slots (fail open).
11. A Google API failure with a warm cache keeps blocking from the cache.
12. `slotIsFree()` and `availableSlots()` agree on the same fixture — the regression
    guard for the extracted `busyWindows()` helper.

## Decisions and rejected alternatives

**Google Calendar API over the secret iCal URL.** The iCal route needs no Google Cloud
setup, but requires hand-writing an RRULE/EXDATE/VTIMEZONE expander. Recurring events
are where such a parser fails, and it fails silently — a wrongly-expanded series shows
as slots that should not exist. `singleEvents=true` moves that work to Google.

**Google Calendar API over an Apps Script webhook.** Apps Script syncs faster and skips
OAuth, but puts the sync logic in a Google-hosted script outside this repository, where
neither owner nor agent can read, test, or version it.

**`events.list` over `freeBusy.query`.** `freeBusy` returns busy intervals with no
titles. Since the CRM Calendar page shows Google events as grey blocks, an untitled
"Busy" chip would not tell the owner *why* a slot is gone. `events.list` costs one
extra scope tier and returns `summary`.

**Fail open over fail closed.** See Failure handling.
