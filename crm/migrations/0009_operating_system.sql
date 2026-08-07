-- Operating-system layer: internal business tooling that sits alongside the
-- existing lead/contact CRM. Every table here is additive and self-contained;
-- nothing references or alters the existing contacts/jobs/tasks schema.
-- Served through the generic collections engine (src/routes/collections.ts).

-- Dashboard + team update feed (shared by Dashboard composer and Updates page)
CREATE TABLE IF NOT EXISTS updates (
  id          TEXT PRIMARY KEY,
  category    TEXT NOT NULL DEFAULT 'general',
  body        TEXT NOT NULL,
  author      TEXT,
  pinned      INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_updates_created ON updates(created_at DESC);

-- Client management (distinct from lead-stage contacts; these are booked/managed accounts)
CREATE TABLE IF NOT EXISTS clients (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  type        TEXT NOT NULL DEFAULT 'residential',
  stage       TEXT NOT NULL DEFAULT 'lead',
  email       TEXT,
  notes       TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

-- Revenue ledger. kind: arr | mrr | pipeline | active
CREATE TABLE IF NOT EXISTS revenue_entries (
  id           TEXT PRIMARY KEY,
  label        TEXT NOT NULL,
  kind         TEXT NOT NULL DEFAULT 'active',
  amount_cents INTEGER NOT NULL DEFAULT 0,
  note         TEXT,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_revenue_kind ON revenue_entries(kind);

-- Team roster
CREATE TABLE IF NOT EXISTS team_members (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  role        TEXT,
  focus       TEXT,
  bandwidth   TEXT,
  created_at  TEXT NOT NULL
);

-- Accountability tasks. bucket: today | week | month | wins
-- status: not_started | started | needs_attention | done | flagged
CREATE TABLE IF NOT EXISTS acct_tasks (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  bucket      TEXT NOT NULL DEFAULT 'today',
  status      TEXT NOT NULL DEFAULT 'not_started',
  progress    INTEGER NOT NULL DEFAULT 0,
  owner       TEXT,
  due_date    TEXT,
  sort        INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_acct_bucket ON acct_tasks(bucket, sort);

-- Editable KPIs
CREATE TABLE IF NOT EXISTS kpis (
  id          TEXT PRIMARY KEY,
  label       TEXT NOT NULL,
  target      TEXT,
  current     TEXT,
  unit        TEXT,
  sort        INTEGER NOT NULL DEFAULT 0
);

-- Onboarding checklist for team members / new users
CREATE TABLE IF NOT EXISTS onboarding_items (
  id          TEXT PRIMARY KEY,
  subject     TEXT NOT NULL,
  step        TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'todo',
  sort        INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL
);

-- Product / service catalog
CREATE TABLE IF NOT EXISTS products (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  price_cents  INTEGER NOT NULL DEFAULT 0,
  description  TEXT,
  sort         INTEGER NOT NULL DEFAULT 0
);

-- Partners & SDRs. kind: partner | sdr
CREATE TABLE IF NOT EXISTS partners (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  kind        TEXT NOT NULL DEFAULT 'partner',
  email       TEXT,
  phone       TEXT,
  notes       TEXT,
  created_at  TEXT NOT NULL
);

-- Advisors + outreach cadence
CREATE TABLE IF NOT EXISTS advisors (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  email         TEXT,
  cadence       TEXT DEFAULT 'monthly',
  last_contact  TEXT,
  notes         TEXT,
  created_at    TEXT NOT NULL
);

-- Discovery: early lead details, call notes, research
CREATE TABLE IF NOT EXISTS discovery_notes (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  contact     TEXT,
  body        TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_discovery_created ON discovery_notes(created_at DESC);

-- Docs & legal references
CREATE TABLE IF NOT EXISTS docs (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  category    TEXT DEFAULT 'general',
  url         TEXT,
  notes       TEXT,
  created_at  TEXT NOT NULL
);

-- Seed editable KPI defaults for a service business (only if table is empty)
INSERT INTO kpis (id, label, target, current, unit, sort)
SELECT 'kpi_jobs',    'Jobs completed',   '80',  '', '/mo',  1 WHERE NOT EXISTS (SELECT 1 FROM kpis);
INSERT INTO kpis (id, label, target, current, unit, sort)
SELECT 'kpi_ticket',  'Avg ticket',       '250', '', '$',    2 WHERE NOT EXISTS (SELECT 1 FROM kpis WHERE id = 'kpi_ticket');
INSERT INTO kpis (id, label, target, current, unit, sort)
SELECT 'kpi_leads',   'New leads',        '40',  '', '/wk',  3 WHERE NOT EXISTS (SELECT 1 FROM kpis WHERE id = 'kpi_leads');
INSERT INTO kpis (id, label, target, current, unit, sort)
SELECT 'kpi_booked',  'Lead to booked',   '35',  '', '%',    4 WHERE NOT EXISTS (SELECT 1 FROM kpis WHERE id = 'kpi_booked');
INSERT INTO kpis (id, label, target, current, unit, sort)
SELECT 'kpi_rebook',  'Rebook rate',      '50',  '', '%',    5 WHERE NOT EXISTS (SELECT 1 FROM kpis WHERE id = 'kpi_rebook');
INSERT INTO kpis (id, label, target, current, unit, sort)
SELECT 'kpi_reviews', '5-star reviews',   '20',  '', '/mo',  6 WHERE NOT EXISTS (SELECT 1 FROM kpis WHERE id = 'kpi_reviews');
INSERT INTO kpis (id, label, target, current, unit, sort)
SELECT 'kpi_revenue', 'Revenue',          '20000', '', '$/mo', 7 WHERE NOT EXISTS (SELECT 1 FROM kpis WHERE id = 'kpi_revenue');
