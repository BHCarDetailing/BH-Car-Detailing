CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  vehicle_id TEXT REFERENCES vehicles(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  services TEXT NOT NULL DEFAULT '[]',
  price_cents INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft',
  scheduled_start TEXT,
  scheduled_end TEXT,
  address TEXT,
  travel_buffer_min INTEGER NOT NULL DEFAULT 30,
  notes TEXT,
  confirmation_sent_at TEXT,
  reminder_sent_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_jobs_contact ON jobs(contact_id);
CREATE INDEX idx_jobs_status ON jobs(status);
CREATE INDEX idx_jobs_start ON jobs(scheduled_start);

CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  contact_id TEXT REFERENCES contacts(id) ON DELETE CASCADE,
  job_id TEXT REFERENCES jobs(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  notes TEXT,
  due_at TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  created_by TEXT NOT NULL DEFAULT 'human',
  created_at TEXT NOT NULL,
  done_at TEXT
);
CREATE INDEX idx_tasks_status ON tasks(status, due_at);
CREATE INDEX idx_tasks_contact ON tasks(contact_id);

CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  contact_id TEXT REFERENCES contacts(id) ON DELETE CASCADE,
  job_id TEXT REFERENCES jobs(id) ON DELETE SET NULL,
  kind TEXT NOT NULL,
  to_email TEXT,
  subject TEXT,
  body_html TEXT,
  body_text TEXT,
  provider_id TEXT,
  status TEXT NOT NULL DEFAULT 'queued',
  error TEXT,
  created_at TEXT NOT NULL,
  sent_at TEXT
);
CREATE INDEX idx_messages_contact ON messages(contact_id, id DESC);
CREATE INDEX idx_messages_job ON messages(job_id);
