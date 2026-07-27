-- QoL Phase 1: revenue events rework, universal timestamps, GTM entities.
-- All additive. Existing data preserved.

-- Revenue events: richer per-entry fields. `kind` kept (nullable) for back-compat.
ALTER TABLE revenue_entries ADD COLUMN occurred_at TEXT;
ALTER TABLE revenue_entries ADD COLUMN customer TEXT;
ALTER TABLE revenue_entries ADD COLUMN service TEXT;
ALTER TABLE revenue_entries ADD COLUMN status TEXT NOT NULL DEFAULT 'paid';
-- Backfill occurred_at from created_at for existing rows.
UPDATE revenue_entries SET occurred_at = substr(created_at, 1, 10) WHERE occurred_at IS NULL;

-- Universal timestamps: add created_at to tables that lacked it.
ALTER TABLE kpis ADD COLUMN created_at TEXT;
ALTER TABLE products ADD COLUMN created_at TEXT;
UPDATE kpis SET created_at = datetime('now') WHERE created_at IS NULL;
UPDATE products SET created_at = datetime('now') WHERE created_at IS NULL;

-- GTM: prospecting pipeline
CREATE TABLE IF NOT EXISTS prospects (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  source        TEXT,
  status        TEXT NOT NULL DEFAULT 'new',
  next_follow_up TEXT,
  notes         TEXT,
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_prospects_status ON prospects(status);

-- GTM: marketing campaigns (manual metrics now; API-ready shape)
CREATE TABLE IF NOT EXISTS marketing_campaigns (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  channel     TEXT NOT NULL DEFAULT 'other',
  status      TEXT NOT NULL DEFAULT 'active',
  spend_cents INTEGER NOT NULL DEFAULT 0,
  leads       INTEGER NOT NULL DEFAULT 0,
  start_date  TEXT,
  end_date    TEXT,
  notes       TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_campaigns_channel ON marketing_campaigns(channel);

-- GTM: content calendar
CREATE TABLE IF NOT EXISTS content_items (
  id            TEXT PRIMARY KEY,
  title         TEXT NOT NULL,
  channel       TEXT NOT NULL DEFAULT 'instagram',
  body          TEXT,
  scheduled_for TEXT,
  status        TEXT NOT NULL DEFAULT 'draft',
  media_key     TEXT,
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_content_sched ON content_items(scheduled_for);
