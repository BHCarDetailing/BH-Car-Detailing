# CRM Pricing + Booking Revamp — Design

**Date:** 2026-08-06
**Status:** Approved by Maxwell, pending write-up review

## Context

Two threads converged into this spec:

1. Maxwell pasted an old-session SEO plan (H1 consistency, nav dropdown, city-page
   content, clean URLs) and asked to resume it, plus two new asks: a page per
   service, and a way to view real pricing and book directly through the CRM.
2. Investigation before touching anything (per "don't assume last session's work is
   gone") found the SEO plan mostly never landed — only the nav dropdown shipped.
   That work is tracked separately and is NOT part of this spec.

This spec covers the pricing + direct-booking piece only, since it was the most
novel and highest-impact of the three, and turned out to require reconciling a
long-diverged git branch before anything else could be built on solid ground.

## Key discovery: branch divergence

`crm/` has two branches that diverged 36 vs. 3 commits ago (merge-base `7382375`):

- **`main`** (deployed to production at `bh-crm.bhdev.workers.dev`, confirmed live
  by Maxwell opening `/book` and reporting the bare 5-option dropdown) — has only
  the original contacts/jobs/tasks/messaging/sequences/labels/missed-call system.
  No services table, no pricing engine, no Stripe, no Quote Builder.
- **`crm-operating-system`** (local + `origin/crm-operating-system`, never merged,
  never deployed) — 14,391 lines of diff. Contains the full services/pricing
  catalog, Stripe deposits, tax, Quote Builder wizard, QR intake, equipment,
  expenses, and the `requires_planning` service flag. Built and tested (298
  tests) but sitting parked.

Even on the parked branch, Maxwell's final locked pricing numbers (from the
pricing-chart sessions) were never written into any database — they stayed
chart-only. Neither branch has real, live pricing data anywhere today.

Three files changed on **both** branches since the split: `index.html`,
`js/main.js`, `terms.html`. The branch's version of these still reflects the old
two-checkbox marketing/transactional SMS consent split — the exact pattern
today's session (commits `2da2e0e`, `709f846`, `f221c50`) deliberately replaced
with a single unified consent checkbox for A2P compliance. A naive merge would
silently reintroduce the two-checkbox flow.

**Separately flagged, not part of this spec's scope:** `js/main.js`'s
`CRM_ENDPOINT` posts leads to `bh-crm.bhcardetails.workers.dev`, but the CRM's
real live subdomain is `bh-crm.bhdev.workers.dev` (confirmed by Maxwell). Website
lead capture into the CRM may be silently failing (the POST is wrapped in
`.catch(() => {})`). Worth checking as its own follow-up.

## Goal

Give website visitors a way to see real pricing and book an appointment directly,
through the CRM's existing booking system — replacing the current Calendly embed,
which shows no pricing and doesn't create CRM records with real service/price
data.

## Phases

### Phase A — Merge `crm-operating-system` into `main`

Reconcile the two branches. On any conflict in `index.html`, `js/main.js`, or
`terms.html` involving consent language or the removed promo modal, **`main`'s
version wins** — pull forward only the non-consent, non-promo parts of the
branch's changes to those files. Everything else (CRM routes, migrations, admin
pages, tests, `wrangler.jsonc` pricing-engine additions) merges in as-is.

Run the full test suite after merging; it should still pass (branch had 298
passing before divergence-widening).

Apply migrations 0007–0020 (present on the branch, never applied to any remote
D1) plus 0021–0023 (already uncommitted in the working tree, built on top of the
branch) in order, to a database — not production. `wrangler d1 migrations apply
bh-crm --remote` against prod is a separate, explicit step later, requiring
Maxwell's direct confirmation before it runs (per the incident logged in the
`crm-booking-machine-audit` memory: deploying before migrations broke prod for
~6 minutes on 2026-07-28 — migrations always go first, confirmed successful,
before any `wrangler deploy`).

This phase does **not** deploy anything to production. It only makes the local
codebase whole.

### Phase B — Real pricing data

Confirm with Maxwell that the previously-locked pricing (Maintenance/Signature/
Complete tiers + add-ons, per-vehicle-size numbers from the pricing-chart
sessions) is still current — it's been about a week. Write it into the merged-in
`services` table via a new migration. The 7 add-ons noted as still-$0 in the
Quote Builder work need real prices before they can appear in the wizard (a
long-standing gap from before this spec).

### Phase C — Rebuild `/book`'s services step

Current `/book` (`Book.tsx` + `POST /api/book` in `public.ts`): hardcoded
5-option service dropdown, no vehicle size, no pricing, `price_cents` never set
(every self-booked job is $0), no SMS consent capture of any kind (an old memory
claimed otherwise; verified directly against current code — it isn't there).

New flow, step-by-step wizard (matches Quote Builder's pattern, per Maxwell's
choice over a single-page pricing-card menu):

1. Vehicle size
2. Tier (Maintenance / Signature / Complete) or standalone specialty/add-on
3. Add-ons
4. Live price total — computed server-side (reusing the branch's pricing calc,
   not re-derived client-side, since a self-submitted price can't be trusted
   when Stripe is involved downstream)
5. For most services: a slot picker (existing `availableSlots`/`businessHours`
   engine, unchanged)
6. For `requires_planning` services (Ceramic Coating, PPF, Vehicle Wraps, Paint
   Correction, Window Tinting, Glass Ceramic Coating): no slot picker — instead
   a "request a call" capture (name/phone/preferred date/notes), creating the
   job as `status='quoted'` with no `scheduled_start`, matching the rule already
   established (but never wired into any public flow) in the Quote Builder work
7. Required single SMS consent checkbox (see Phase E)
8. Confirm — creates the job with real `price_cents`, fires the existing
   confirmation flow

### Phase D — Website integration

- Replace the Calendly inline widget in the `#book` section (`index.html:430`)
  with an `<iframe>` pointing at the CRM's `/book`.
- The per-package "Book" buttons (currently `data-calendly` attributes opening a
  Calendly popup scoped to that package's event type, wired in `js/main.js`)
  instead deep-link to `/book?service=<slug>` to preselect that tier/service in
  the wizard.
- The Google Ads conversion tracker (`js/main.js`, currently listens for
  Calendly's `calendly.event_scheduled` postMessage) is replaced with a listener
  for a postMessage the CRM's `/book` page fires on successful booking — cross-
  origin, since the iframe is a different origin than the site.
- Calendly script loading, the inline-widget intersection observer, and the
  popup-open logic in `js/main.js` are removed once nothing references them.

### Phase E — Consent alignment

`/book` gets the same required, single, non-promotional SMS consent checkbox
introduced on the hero form today (`index.html:311`), same copy, same Terms/
Privacy links. Recorded server-side with IP + timestamp (this doesn't exist in
any current booking path — `/book`'s `POST /api/book` and the branch's
`completeQuote()` both hardcode `email_opt_in = 1` with no real capture).
Necessary because `/book` becomes the site's primary booking surface, and the
Twilio campaign's declared opt-in method needs to match what customers actually
see.

## Deployment sequencing

Nothing in this spec deploys to production automatically. Each of the following
requires Maxwell's explicit go-ahead, in order:

1. Confirm Phase A's merge conflict resolutions before pushing to `origin/main`
2. Apply migrations to remote D1, confirm success
3. `wrangler deploy` the CRM worker
4. Push the website changes (Phase D) — separate deploy path (GitHub Pages off
   `origin/main` of this same repo, confirmed working this session)
5. Re-screenshot the new consent flow and update the Twilio campaign submission
   to reference `/book` as an additional opt-in surface, if the CRM booking page
   ends up reachable independent of the hero form

## Out of scope

- The SEO revamp (H1s, FAQ content, clean URLs, sitemap) — separate, already
  partially scoped from the earlier session, tracked independently
- Per-service pages — needs its own scoping pass (which services need dedicated
  pages vs. already have one)
- Fixing the `CRM_ENDPOINT` subdomain mismatch in `js/main.js` — flagged above,
  not addressed here
- Deposit-required-to-book as a hard gate — Phase C reuses the existing
  deposit-optional pattern; making deposits mandatory for self-booked slots is a
  separate product decision not raised in this session
