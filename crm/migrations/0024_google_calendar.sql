-- Google Calendar two-way sync.
-- gcal_busy is a cache of Google events that block booking slots. It is
-- rebuilt from Google on every sync; nothing here is a source of truth.
CREATE TABLE gcal_busy (
  id          TEXT PRIMARY KEY,   -- "<google event id>@<calendar id>"
  calendar_id TEXT NOT NULL,
  summary     TEXT,
  starts_at   TEXT NOT NULL,
  ends_at     TEXT NOT NULL,
  all_day     INTEGER NOT NULL DEFAULT 0,
  is_block    INTEGER NOT NULL DEFAULT 0,
  synced_at   TEXT NOT NULL
);
CREATE INDEX gcal_busy_window ON gcal_busy (starts_at, ends_at);

-- Deliberately NOT in `settings`: GET /api/settings returns that whole table
-- to the admin browser, which would ship a long-lived Google credential to
-- the frontend on every page load.
CREATE TABLE oauth_tokens (
  provider      TEXT PRIMARY KEY,
  refresh_token TEXT NOT NULL,
  access_token  TEXT,
  expires_at    INTEGER,
  account_email TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

ALTER TABLE jobs ADD COLUMN gcal_event_id TEXT;
ALTER TABLE jobs ADD COLUMN gcal_synced_at TEXT;
ALTER TABLE jobs ADD COLUMN gcal_error TEXT;
