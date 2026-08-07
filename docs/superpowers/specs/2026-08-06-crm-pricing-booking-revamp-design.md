# CRM Pricing + Booking Revamp — Design

**Date:** 2026-08-06 (revised)
**Status:** Approved by Maxwell, pending write-up review

## Context

Two threads converged into this spec:

1. Maxwell pasted an old-session SEO plan (H1 consistency, nav dropdown, city-page
   content, clean URLs) and asked to resume it, plus two new asks: a page per
   service, and a way to view real pricing and book directly through the CRM.
2. Investigation before touching anything (per "don't assume last session's work is
   gone") found the SEO plan mostly never landed — only the nav dropdown shipped.
   That work is tracked separately and is NOT part of this spec.

This spec covers the pricing + direct-booking piece only.

## Key finding: git `main` doesn't reflect what's actually live

`crm/`'s two branches diverged 36 vs. 3 commits ago (merge-base `7382375`).
`origin/crm-operating-system` was initially assumed to be unmerged, undeployed
parked work — that assumption was wrong. Checked directly against
`wrangler deployments list` for the `bh-crm` worker: deployment timestamps and
version IDs line up with `crm-operating-system`'s commit history through
2026-07-30 (QR intake/equipment/expenses, commit `4f62fbf`). **Production is
running code close to that branch, not bare `main`.** Maxwell confirmed the CRM
itself ("bh-crm is good") — Quote Builder, Stripe deposits, tax, and QR intake
are all live today, reachable through the logged-in admin.

The one page that's genuinely behind on **both** branches is `/book` itself —
diffing `Book.tsx` between `main` and `crm-operating-system` shows only a 24-line
difference (a logo + the old two-checkbox consent block), not the pricing wizard.
So `/book` — the CRM's one public, no-login page — never got the services/pricing
work at all. That's the actual gap this spec closes.

The branch's version of `index.html`/`js/main.js`/`terms.html` still carries the
old two-checkbox marketing/transactional SMS consent split — the exact pattern
today's session (commits `2da2e0e`, `709f846`, `f221c50`) deliberately replaced
with a single unified consent checkbox for A2P compliance. When pulling
`crm-operating-system`'s work into `main`, **`main`'s version wins on any
consent/promo-related lines** in those three files; everything else (CRM routes,
migrations, admin pages, tests, `wrangler.jsonc`) comes in from the branch as-is,
since it's proven code already running in production.

**Bonus fix riding along:** `js/main.js`'s `CRM_ENDPOINT` currently points at
`bh-crm.bhcardetails.workers.dev`, which has never resolved (confirmed by branch
commit `c52e01a`'s own message: "doesn't resolve"). The real subdomain is
`bh-crm.bhdev.workers.dev`. Every website lead form has been silently failing to
reach the CRM (Formspree still received them, so it went unnoticed). The branch
already has the one-line fix — carried forward as part of this merge rather than
tracked separately, since it's touching the same file anyway.

Neither branch has Maxwell's final locked pricing numbers (from the
pricing-chart sessions) written into the database — they stayed chart-only.

## Goal

Give website visitors a way to see real pricing and either book instantly or
start a quote, through the CRM's `/book` page — embedded in the site — instead
of the current Calendly widget, which shows no pricing and creates no priced CRM
record. Also capture leads who start but don't finish, so drop-offs aren't lost.

## Phases

### Phase A — Bring `crm-operating-system`'s CRM code into `main`

Reconcile the two branches per the consent-wins rule above, including the
`CRM_ENDPOINT` fix. Run the full test suite after (298 passing as of the
branch's last commit). Apply migrations 0007–0020 (never applied to any remote
D1 despite being live-deployed via direct `wrangler deploy` from working-tree
state) plus 0021–0023 (already uncommitted in the working tree, built on top of
the branch — refund sync, booking funnel, tier rename) in order, to a database —
not production yet. This phase makes the committed codebase match reality; it
does not itself deploy anything.

### Phase B — Real pricing data

Confirm with Maxwell that the previously-locked pricing (Maintenance/Signature/
Complete tiers + add-ons, per-vehicle-size numbers) is still current. Write it
into the `services` table via a new migration. The 7 add-ons still at $0 need
real prices before they can appear in the wizard.

### Phase C — Rebuild `/book` as a self-serve pricing + quote wizard

Step-by-step flow (matches Quote Builder's pattern):

1. Vehicle size
2. Tier (Maintenance / Signature / Complete) or standalone specialty/add-on
3. Add-ons
4. Live price total — computed **server-side** (reusing the branch's existing
   pricing calc, not re-derived client-side — a self-submitted price can't be
   trusted once Stripe is involved downstream)
5. For most services: the existing slot picker, unchanged
6. For `requires_planning` services (Ceramic Coating, PPF, Vehicle Wraps, Paint
   Correction, Window Tinting, Glass Ceramic Coating): no slot picker — a
   "request a call" capture instead (name/phone/preferred date/notes), job
   created as `status='quoted'`, no `scheduled_start` — the rule already
   established in the Quote Builder work, never wired into a public flow before
7. Required single SMS consent checkbox (Phase E)
8. Confirm — creates the job with real `price_cents`, fires the existing
   confirmation flow

**Visual restyle**, since this becomes an embedded, customer-facing page:
add the BH logo (already sitting unused in `crm/public/brand/`), import Manrope
(the site's font) into the CRM's HTML shell, swap Tailwind's default red for the
site's exact brand red `#c8102e`, loosely match the site's rounded-corner card
feel. Stays a standalone page — no CRM nav/chrome to strip.

### Phase D — Capture leads who don't finish

As soon as a customer enters name + phone at any step of the wizard, upsert a
CRM contact immediately (not waiting for final confirm) — same match-or-create
logic `/api/book` already uses. This contact is **not** enrolled in any SMS
automation and does not get texted — the existing `canSend` guardrail already
requires recorded consent, and consent isn't recorded until the checkbox in
step 7 is actually checked and the flow completes. A partial capture just means
Maxwell can see and call the lead; it does not create an SMS compliance gap.
Tag these contacts distinctly (e.g. `source: quote-wizard-incomplete`) so
they're visibly different from a completed booking in the CRM UI.

**Privacy Policy update required**: the current policy describes data collection
tied to form submission ("When you submit a quote, booking or contact form...").
Needs a line disclosing that partially-completed forms may also be saved,
before this ships.

### Phase E — Consent alignment

`/book` gets the same required, single, non-promotional SMS consent checkbox
as the hero form, same copy, same Terms/Privacy links. Recorded server-side
with IP + timestamp — genuinely new, doesn't exist in any current booking path
(`/book`'s `POST /api/book` and the branch's `completeQuote()` both hardcode
`email_opt_in = 1` with no real capture today).

### Phase F — Website integration

- Replace the Calendly inline widget in the `#book` section (`index.html:430`)
  with an `<iframe>` pointing at the CRM's `/book`.
- Per-package "Book" buttons (currently `data-calendly` popups scoped to a
  package's Calendly event type) instead deep-link to `/book?service=<slug>` to
  preselect that tier in the wizard.
- The Google Ads conversion tracker (currently listens for Calendly's
  `calendly.event_scheduled` postMessage) is replaced with a listener for a
  postMessage the CRM's `/book` page fires on successful booking (cross-origin,
  since the iframe is a different origin than the site).
- Calendly script loading, the inline-widget intersection observer, and popup
  logic in `js/main.js` are removed once nothing references them.

## Deployment sequencing

Nothing in this spec deploys to production automatically. Each step requires
Maxwell's explicit go-ahead, in order:

1. Confirm Phase A's merge conflict resolutions before pushing to `origin/main`
2. Apply migrations to remote D1, confirm success (migrations always before
   deploy — a prior incident broke prod ~6 minutes on 2026-07-28 by deploying
   first)
3. `wrangler deploy` the CRM worker
4. Push the website changes (Phase F) — GitHub Pages off `origin/main`,
   confirmed working this session
5. Re-screenshot the new consent flow and update the Twilio campaign submission
   if `/book` ends up reachable as its own opt-in surface independent of the
   hero form

## Out of scope

- The SEO revamp (H1s, FAQ content, clean URLs, sitemap) — separate, tracked
  independently
- Per-service pages — needs its own scoping pass
- Deposit-required-to-book as a hard gate — Phase C reuses the existing
  deposit-optional pattern; making deposits mandatory is a separate decision
