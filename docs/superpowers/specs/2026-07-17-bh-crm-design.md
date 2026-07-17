# BH CRM — Design Spec

**Date:** 2026-07-17
**Status:** Approved by Maxwell (design presentation) — pending final spec review
**Replaces:** HubSpot (142 contacts, account 245547344, US/Eastern, USD)
**Site:** bhcardetails.com — static HTML/CSS/JS in this repo, forms currently POST to Formspree (`https://formspree.io/f/xlgapllq`)

---

## 1. Purpose

A custom CRM for BH Car Detailing that replaces HubSpot for lead management, pipeline, calendars, custom fields, workflows, and email nurturing. Designed AI-native: humans set strategy and approve copy; AI drafts, summarizes, and executes approved playbooks.

### Operating principles

1. **Humans steer, AI executes.** AI never sends net-new copy without human approval. Automated sends happen only through human-activated sequences/workflows.
2. **Two front doors, equal power.** Every capability is available via the human admin UI *and* a token-secured JSON agent API. Parity by construction.
3. **Boring, ownable tech.** One Worker, one SQLite database, raw SQL, minimal dependencies. Any agent or developer can hold the system in context. One-click CSV export forever.
4. **~$0/month.** Cloudflare free tier + Resend free tier. Only variable cost: Anthropic API pennies per generation.
5. **Event log as source of truth.** The activity timeline is the spine; the UI is a lens over it.

## 2. Recorded decisions

| Decision | Choice | Alternatives rejected |
|---|---|---|
| Hosting | User's own Cloudflare account (Workers + D1 + cron) | Higgsfield platform (lock-in, free-plan limits); managed Node host ($5/mo, account friction) |
| AI layer | Hybrid: built-in generation (user's Anthropic key) + agent API for Claude Code | Built-in only; Claude-Code-only |
| Email | Resend, sending from bhcardetails.com (SPF/DKIM via 3 DNS records), Reply-To → Gmail | Gmail app password (limits, deliverability); phased approach |
| Calendar | Internal drag-and-drop jobs calendar; auto confirmations/reminders | Customer self-booking (phase 2 candidate); Calendly sync |
| Auth | Single user (password → signed session cookie). HubSpot shows one owner. Multi-user is a schema-compatible later add. | Multi-user roles v1 (YAGNI) |
| SMS | Phase 2 (Twilio A2P registration takes weeks). V1 bridge: click-to-text buttons with AI-drafted message pre-filled, logged as activity. | Building SMS sending v1 |
| Admin URL | `*.workers.dev` subdomain first; `crm.bhcardetails.com` optional later (requires zone on Cloudflare) | Blocking launch on DNS moves |

## 3. Architecture

**Chosen shape: single Cloudflare Worker ("boring stack").**

- **Runtime:** one Worker, TypeScript, **Hono** router.
- **Database:** **D1** (SQLite), raw SQL via prepared statements + small typed helpers. Migrations via `wrangler d1 migrations` (numbered `.sql` files). No ORM.
- **Admin UI:** React 18 + Vite SPA (TypeScript, Tailwind CSS v4, TanStack Query, @dnd-kit for board/calendar drag). Built to static assets, served by the same Worker (assets binding). No SSR — private tool, no SEO needs.
- **Scheduler:** Worker cron trigger every 5 minutes (`*/5 * * * *`) drives the nurture engine, reminders, digests. Additional daily/weekly logic gates on time-of-day inside the handler.
- **Email:** Resend REST API. Open/click tracking via Resend webhooks → Worker endpoint (signature-verified).
- **AI:** Anthropic Messages API (`claude-sonnet-5` for drafting, `claude-haiku-4-5-20251001` for cheap classification/summaries). Called server-side; key in Worker secret.
- **Repo layout:** CRM lives in `crm/` inside this site repo (one repo for site + CRM):

```
7-17 Website/
  index.html, areas/, js/, ...      # existing static site (forms get re-pointed)
  crm/
    wrangler.jsonc                  # Worker config: D1 binding, cron, assets, vars
    package.json
    migrations/0001_init.sql, ...
    src/                            # Worker: index.ts, routes/, engine/, ai/, email/, lib/
    admin/                          # Vite React app → builds into crm/public/
    test/                           # vitest + @cloudflare/vitest-pool-workers
    AGENTS.md                       # the agent operator manual
  docs/superpowers/specs/           # this spec
```

⚠️ **Hosting note:** if the static site is deployed by uploading this whole folder to a static host, exclude `crm/` and `docs/` from the upload (host ignore config). No secrets ever live in the repo (all via `wrangler secret`), so worst case is source-code exposure, not credential exposure.

### Secrets & config

Secrets (`wrangler secret put`): `ADMIN_PASSWORD`, `SESSION_SECRET`, `AGENT_API_KEY`, `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`, `ANTHROPIC_API_KEY`.
Vars (wrangler.jsonc): `FROM_EMAIL` (e.g. hello@bhcardetails.com), `FROM_NAME`, `REPLY_TO` (Gmail), `ALLOWED_ORIGINS` (site origins for CORS), `HOME_TZ=America/New_York`, `QUIET_HOURS=08:00-20:00`, `BUSINESS_ADDRESS` (CAN-SPAM footer).

## 4. Data model (D1)

All ids are UUIDs (TEXT) unless noted. All timestamps ISO-8601 UTC TEXT.

- **contacts** — `id, first_name, last_name, email, phone, address, city, area_slug, stage` (`new|contacted|quoted|scheduled|customer|lost`, default `new`), `source` (e.g. `hero-quote`, `promo-popup`, `area:brickell`, `manual`, `hubspot-import`), `source_detail`, `tags` (JSON array), `custom` (JSON object keyed by custom_field_defs.key), `email_opt_in` (default 1) + `email_opt_in_at`, `sms_opt_in` (default 0), `ai_summary`, `ai_next_action`, `replied_flag` (manual "they replied" marker), `created_at, updated_at, last_activity_at`.
  Dedupe at capture in code (match on normalized email OR phone → merge + log activity), no UNIQUE constraint (emails nullable/variant-prone).
- **vehicles** — `id, contact_id, year, make, model, color, size_class` (`sedan|suv|truck|van|exotic|other`), `notes, created_at`.
- **jobs** — `id, contact_id, vehicle_id?, title, services` (JSON: service keys + tier), `price_cents, status` (`draft|quoted|scheduled|in_progress|completed|paid|cancelled`), `scheduled_start, scheduled_end, address, travel_buffer_min` (default 30), `notes, created_at, updated_at`. Completed+paid jobs = revenue record.
- **activities** — `id` (INTEGER autoincrement), `contact_id, type` (`form_submitted|email_sent|email_opened|email_clicked|email_bounced|note|call_logged|sms_logged|stage_changed|job_created|job_scheduled|job_completed|task_done|enrolled|exited|unsubscribed|ai_summary|import`), `title, payload` (JSON), `actor` (`human|ai|system|workflow:<id>`), `created_at`. Append-only.
- **custom_field_defs** — `key` (PK), `label, type` (`text|number|select|date|checkbox`), `options` (JSON, for select), `sort`.
- **sequences** — `id, name, goal, status` (`draft|active|paused|archived`), `brief` (the original human brief — first-class!), `enroll_trigger` (JSON, nullable — auto-enroll rule), `exit_rules` (JSON; defaults: booked, stage-advance, unsubscribe, replied_flag), `created_by` (`human|ai`), `created_at, updated_at`.
- **sequence_steps** — `id, sequence_id, position, delay_hours` (from previous send, or from enrollment for step 1), `subject, body_html, body_text, skip_if` (JSON, nullable — e.g. skip if previous opened), `updated_at`.
- **enrollments** — `id, contact_id, sequence_id, status` (`active|sending|completed|exited|paused`; `sending` is the transient claim state — deferred sends reset to `active` with a new `next_run_at`), `current_position` (default 0; position of last completed step), `next_run_at, enrolled_at, ended_at, exit_reason`. One active enrollment per (contact, sequence) enforced in code.
- **messages** — `id, contact_id, enrollment_id?, step_id?, kind` (`sequence|transactional|oneoff|digest|backup`), `to_email, subject, body_html, provider_id, status` (`queued|sent|delivered|opened|clicked|bounced|complained|failed`), `error, sent_at, opened_at, clicked_at`.
- **workflows** — `id, name, trigger_type` (`lead_created|stage_changed|job_completed|email_clicked|tag_added|no_activity_days`), `conditions` (JSON: field/source/tag matchers), `actions` (JSON list: `enroll_sequence|exit_sequence|add_tag|set_stage|create_task|notify_owner`), `status` (`active|paused`), `created_at, updated_at, last_fired_at`. Flat trigger→conditions→actions in v1; no branching graphs.
- **tasks** — `id, contact_id?, title, notes, due_at, status` (`open|done|dismissed`), `created_by` (`human|ai|workflow:<id>`), `created_at, done_at`.
- **brain_docs** — `key` (PK: `tone_of_voice|offers|audience|examples|rules|business_facts` + user-defined), `title, content_md, updated_at`. Injected into every AI generation.
- **suppressions** — `email` (PK), `reason` (`unsubscribe|bounce|complaint|manual`), `created_at`. Checked before EVERY send.
- **ai_runs** — `id, kind` (`sequence_draft|step_redraft|lead_summary|digest|first_reply|other`), `brief, input_context, output, model, input_tokens, output_tokens, cost_usd, status` (`draft|accepted|rejected`), `created_at`.
- **settings** — `key, value` (runtime-editable settings the UI exposes).
- **rl_events** — `bucket, ts` (login + public-endpoint rate limiting).

Unsubscribe tokens are stateless: `token = HMAC(SESSION_SECRET, contact_id)` — no table.

## 5. API surface

One Hono app; admin/agent routes share handlers with two auth modes: session cookie (UI) or `Authorization: Bearer <AGENT_API_KEY>` (agents).

**Public (CORS: ALLOWED_ORIGINS; rate-limited):**
- `POST /api/lead` — lead capture. Payload: name, email, phone, vehicle, message?, source, source_detail?, honeypot field `website` (must be empty), `ts` (form-render timestamp; reject <2s). Dedupes/merges, logs activity, fires `lead_created` workflows, kicks async AI summary. During transition the site dual-posts to Formspree too.
- `GET /u/:token` — one-click unsubscribe (adds suppression, exits enrollments, logs, shows plain confirmation page).
- `POST /api/hooks/resend` — Resend webhook (svix signature verified): delivery/open/click/bounce/complaint → update messages, log activities, fire `email_clicked` workflows, auto-suppress on bounce/complaint.
- `GET /api/health`.

**Auth:** `POST /api/auth/login` (password → HMAC-signed HttpOnly Secure cookie, 30-day; rate-limited), `POST /api/auth/logout`.

**Admin + Agent (full CRUD):** `/api/contacts` (+ `/:id`, `/:id/activities`, `/:id/vehicles`, merge, bulk), `/api/jobs`, `/api/sequences` (+ steps reorder), `/api/enrollments` (enroll/pause/exit), `/api/workflows`, `/api/tasks`, `/api/brain`, `/api/custom-fields`, `/api/settings`, `/api/messages` (send one-off; test-send to self), `/api/export.csv` (contacts+jobs+activities zip), `/api/ai/compose-sequence`, `/api/ai/redraft-step`, `/api/ai/lead-summary/:id`, `/api/stats` (dashboard + per-sequence funnel).
- `GET /api/agent/schema` — self-describing JSON listing every endpoint, its schema, and examples. `crm/AGENTS.md` documents the same for agent sessions.

## 6. The engine (cron, every 5 minutes)

1. **Claim due enrollment steps**: `UPDATE enrollments SET status='sending' ... WHERE status='active' AND next_run_at <= now RETURNING` (optimistic claim → idempotent under overlapping crons).
2. Per claimed step, in order: check **exit rules** (stage advanced beyond enrollment-time stage / job booked / replied_flag / unsubscribed) → exit instead of send. Check **suppression + email_opt_in**. Check **quiet hours** (08:00–20:00 America/New_York; outside → defer to next window). Check **frequency cap** (max 1 marketing email/contact/day → defer 24h). Evaluate `skip_if`. Then render (merge fields: first_name, vehicle, offer links; CAN-SPAM footer with unsubscribe link + business address), send via Resend, record message, log activity, advance `current_position`, set `next_run_at = sent_at + next_step.delay_hours`, or mark `completed`.
3. **Job reminders**: T-24h and T-2h before `scheduled_start` → confirmation/reminder emails (transactional kind — not subject to marketing frequency cap, still suppression-checked).
4. **Daily digest** (first run after 08:00 ET): new leads (with AI reads), today's jobs, stale leads, due tasks → email to owner.
5. **`no_activity_days` workflow sweep** (daily).
6. **Weekly backup** (Sunday): full CSV export emailed to owner.

**Event-driven workflows:** every activity insert evaluates active workflows matching the trigger type (inline, via `waitUntil`). Actions execute sequentially; failures log to activities with `actor=system`.

## 7. AI layer

- **Sequence Composer** (`/api/ai/compose-sequence`): input = human brief + knobs (email count, spacing, offer, audience). Context = all brain_docs + house best-practice system prompt (subject-line rules, one-CTA-per-email, mobile-length paragraphs, spam-trigger avoidance, sequence pacing). Output = full draft sequence (steps, delays, exit-rule suggestions) stored as `status=draft` + ai_run record. UI: inline edit, per-step regenerate with feedback, activate. **Draft → human review → activate. No exceptions.**
- **Lead intelligence**: on lead capture (async): Haiku classifies service intent + segment, writes 2-line summary, suggested next action, and a drafted first reply (used by click-to-text and quick-email). Stored on contact + activity log.
- **Morning digest** narrative written by Haiku from the day's data.
- **Click-to-text bridge**: lead card buttons open `sms:`/`tel:` links with the AI-drafted message pre-filled; one tap logs the touch as an activity (SMS proper is phase 2).
- Every AI call recorded in ai_runs with token counts + cost.

## 8. Admin UI (7 screens)

1. **Dashboard** — action queue: new leads w/ AI read + draft reply + quick actions (log call/text, quick email, quote, enroll); today's jobs; due tasks; pipeline snapshot; activity feed.
2. **Pipeline** — kanban by stage, drag between columns (drag → stage_changed activity → workflows fire). Filters: source, tag, service interest.
3. **Contacts** — searchable/sortable table, saved filters, bulk actions (tag, enroll, export). Detail drawer: timeline, vehicles, jobs, enrollments, custom fields, notes, AI summary.
4. **Calendar** — week/day views; drag to schedule/reschedule jobs (reschedule prompts before re-sending customer notice); travel buffers rendered; color by job status.
5. **Sequences** — list w/ funnel stats (sent→opened→clicked→booked); composer flow (brief → AI draft → edit → test-send to self → activate); enrollment management.
6. **Workflows** — rule rows rendered in plain English ("When lead arrives from any Area page → wait 5 min → enroll in Website Welcome → notify me"); toggle active/paused; fire history.
7. **Brand Brain & Settings** — editable brain docs; custom field builder; sending identity + quiet hours; suppression list; CSV export; agent API token reveal/rotate; API-keys status panel.

Seed content on first deploy: BH service menu w/ real prices (ceramic $750, paint correction $550, detail packages from the site), 4 stock sequences drafted in site voice (**Website Welcome**, **Quote Follow-up**, **Review & Referral**, **Cold Re-engage**, all `draft` until user activates), starter brain docs harvested from existing site copy, default workflows (paused): "New website lead → Welcome sequence + notify", "Job completed → Review & Referral", "Quoted, no booking in 3 days → Quote Follow-up", "No activity 30 days → Cold Re-engage".

## 9. Site integration (cut-over)

- `js/main.js` form handler posts JSON to `https://<worker>/api/lead` with per-form `source` + page `source_detail` (+ UTM passthrough), honeypot + ts fields added to forms.
- Dual-post to Formspree for the first 2 weeks (belt and suspenders), then remove.
- `privacy-policy.html` updated: first-party data storage, email tracking disclosure, unsubscribe rights.
- Area pages become measurable acquisition channels via `source_detail`.

## 10. HubSpot migration

Via HubSpot MCP in a Claude Code session (agent API as import target): pull all 142 contacts + any notes/deals → AI cleanup (un-jam "Car Detailing" from last names, normalize phones to E.164, title-case names, dedupe on email/phone) → import tagged `hubspot-import` with mapped stages → before/after summary presented to user for review. HubSpot stays read-accessible until user cancels it; no data is deleted at source.

## 11. Deliverability & compliance (built-in, non-optional)

- SPF + DKIM via Resend domain verification (3 DNS records user pastes; exact values generated at setup). DMARC quarantine record recommended in the same step.
- CAN-SPAM: unsubscribe link + physical business address in every marketing email footer; suppression checked at send time; transactional (booking/reminder) emails exempt from marketing rules but still suppression-aware.
- Consent: `email_opt_in_at` recorded from form submissions; imports marked with source.
- Sending posture: 142 contacts needs no warm-up, but engine's frequency cap + quiet hours keep volume shaped.

## 12. Testing

- **Framework:** Vitest + `@cloudflare/vitest-pool-workers` (tests run in real workerd with real D1 semantics, local + CI-able).
- **TDD on the engine** (the code that emails customers): quiet-hour clamping across DST, frequency cap, suppression enforcement, exit-rule evaluation, claim idempotency under overlapping crons, delay arithmetic, merge-field rendering incl. footer presence.
- **Integration:** lead capture (dedupe/merge, honeypot, CORS), unsubscribe round-trip, Resend webhook state transitions, auth (login rate limit, cookie signing), agent API auth.
- **UI:** smoke-level (build passes, key routes render); heavier E2E deferred.
- **Local dev:** `wrangler dev` (local D1) + Vite dev server w/ proxy — full system runs before any account exists.

## 13. Build phases (each shippable)

1. **Foundation** — repo/git, Worker + Hono + migrations, auth, contacts + activities + custom fields, public lead endpoint, agent API core + AGENTS.md, minimal UI (dashboard skeleton, contacts), HubSpot import, site forms cut-over. → *Leads flow into the backend.*
2. **Pipeline & Calendar** — kanban, jobs, calendar UI, booking confirmation/reminder emails, tasks.
3. **Nurture & Workflows** — sequences, enrollments, cron engine, suppression/unsubscribe, Resend webhooks, workflow rules, stock sequences + default workflows.
4. **AI layer & polish** — Brand Brain UI, sequence composer, lead intelligence, digest, click-to-text, stats, weekly backup, privacy-policy update.

## 14. What the user must provide (collected at deploy time, not blocking dev)

1. Cloudflare account (free) + one browser click for `wrangler login` — Claude drives everything else.
2. Resend account (free) + API key + paste 3 DNS records at the bhcardetails.com registrar.
3. Anthropic API key (console.anthropic.com, ~$5 credit).
4. Where/how the static site is currently hosted+deployed (for cut-over + exact ALLOWED_ORIGINS).
5. Business mailing address for CAN-SPAM footer; preferred From name/address (suggest `hello@bhcardetails.com`).

## 15. Out of scope v1 (recorded for phase 2+)

SMS sending (Twilio A2P — **start registration early**), inbound email parsing (reply detection), customer self-booking page, multi-user/roles, payments/invoicing, MMS photo-based quoting, branching workflow graphs, MCP server endpoint (agent JSON API suffices), custom admin domain.

## 16. Known risks & mitigations

| Risk | Mitigation |
|---|---|
| Replies invisible to CRM v1 | Reply-To → Gmail; one-click "they replied" exits sequences; auto-exit on booking/stage change |
| User becomes the vendor | Boring stack, engine tests, AGENTS.md, git history, weekly CSV backup email, one-click export |
| Whole-folder static uploads exposing `crm/` source | Host ignore rules documented; zero secrets in repo |
| Cron overlap double-sends | Optimistic row claims (UPDATE…RETURNING) + frequency cap as backstop |
| Formspree cut-over drops leads | 2-week dual-posting window |
| AI drafts off-brand copy | Brand Brain injected into every generation; draft-only status until human activates |

## 17. Success criteria

1. A form submitted on bhcardetails.com appears in the CRM within seconds, with AI summary + drafted reply.
2. All 142 HubSpot contacts imported, cleaned, correctly staged.
3. User writes a brief → AI drafts sequence → user edits → test-send lands in user's inbox → activation sends to a real enrollment respecting quiet hours; unsubscribe link works end-to-end.
4. A job dragged on the calendar sends (after confirm) the correct customer notice.
5. Weekly backup CSV arrives by email; export works from Settings.
6. A fresh Claude Code session, given only `AGENTS.md` + the agent token, can list, create, and enroll contacts (proven during migration).
