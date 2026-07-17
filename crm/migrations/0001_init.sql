CREATE TABLE contacts (
  id TEXT PRIMARY KEY,
  first_name TEXT,
  last_name TEXT,
  email TEXT,
  phone TEXT,
  address TEXT,
  city TEXT,
  area_slug TEXT,
  stage TEXT NOT NULL DEFAULT 'new',
  source TEXT,
  source_detail TEXT,
  tags TEXT NOT NULL DEFAULT '[]',
  custom TEXT NOT NULL DEFAULT '{}',
  email_opt_in INTEGER NOT NULL DEFAULT 1,
  email_opt_in_at TEXT,
  sms_opt_in INTEGER NOT NULL DEFAULT 0,
  replied_flag INTEGER NOT NULL DEFAULT 0,
  ai_summary TEXT,
  ai_next_action TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_activity_at TEXT
);
CREATE INDEX idx_contacts_email ON contacts(email);
CREATE INDEX idx_contacts_phone ON contacts(phone);
CREATE INDEX idx_contacts_stage ON contacts(stage);

CREATE TABLE vehicles (
  id TEXT PRIMARY KEY,
  contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  year INTEGER,
  make TEXT,
  model TEXT,
  color TEXT,
  size_class TEXT NOT NULL DEFAULT 'other',
  notes TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_vehicles_contact ON vehicles(contact_id);

CREATE TABLE activities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  payload TEXT,
  actor TEXT NOT NULL DEFAULT 'system',
  created_at TEXT NOT NULL
);
CREATE INDEX idx_activities_contact ON activities(contact_id, id DESC);

CREATE TABLE custom_field_defs (
  key TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'text',
  options TEXT,
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE rl_events (
  bucket TEXT NOT NULL,
  ts INTEGER NOT NULL
);
CREATE INDEX idx_rl ON rl_events(bucket, ts);
