# BH CRM — Agent Operator Manual

The CRM for BH Car Detailing (bhcardetails.com). One Cloudflare Worker (Hono, TypeScript),
one D1 database, React admin served from the same Worker. Spec:
`../docs/superpowers/specs/2026-07-17-bh-crm-design.md`.

## Operating rules
- Humans steer, AI executes: NEVER send or schedule customer-facing copy that a human has
  not approved. (Sending arrives in Phase 3 — the rule is stated now so it's never violated.)
- Stages are exactly: new, contacted, quoted, scheduled, customer, lost. Never invent stages.
- Phones are E.164. Timestamps are ISO-8601 UTC. Custom fields live in `contacts.custom`
  (JSON) with definitions in `custom_field_defs`.
- Log every real-world touch (call, text) as an activity — the timeline is the source of truth.

## Auth
`Authorization: Bearer <AGENT_API_KEY>` on every request. The key is a Worker secret
(local dev: `crm/.dev.vars`). Discover the full API: `GET /api/agent/schema`.

## Quick recipes (local dev base URL: http://127.0.0.1:8787)
List new leads:
  curl -s -H "Authorization: Bearer $KEY" "http://127.0.0.1:8787/api/contacts?stage=new"
Log a call:
  curl -s -X POST -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
    -d '{"type":"call_logged","title":"Quoted $750 ceramic over phone"}' \
    "http://127.0.0.1:8787/api/contacts/<id>/activities"
Bulk import:
  POST /api/contacts/bulk  {"contacts":[{"first_name":"...","email":"...","source":"hubspot-import"}]}
Jobs: GET/POST /api/jobs, GET/PATCH/DELETE /api/jobs/:id — statuses: draft|quoted|scheduled|in_progress|completed|paid|cancelled; price_cents is integer cents.
Tasks: GET/POST /api/tasks, GET/PATCH/DELETE /api/tasks/:id — status open|done|dismissed.

## Development (Windows box)
- Node is at C:\Program Files\nodejs — bash sessions need:
  export PATH="/c/Program Files/nodejs:$PATH"
- From crm/: `npm run dev` (wrangler dev on :8787), `npm test` (vitest), `npm run migrate:local`.
- Admin SPA (arrives in a later task): source will live in `crm/admin/`, building into `crm/public/` (served by the Worker).
- When you add or change an endpoint: update `src/routes/agent.ts` schema AND this file.
