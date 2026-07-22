CREATE TABLE sequences (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',   -- draft | active
  trigger TEXT NOT NULL DEFAULT 'manual', -- manual | stage:<stage> | source:<source>
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE sequence_steps (
  id TEXT PRIMARY KEY,
  sequence_id TEXT NOT NULL REFERENCES sequences(id) ON DELETE CASCADE,
  step_order INTEGER NOT NULL DEFAULT 0,
  delay_hours INTEGER NOT NULL DEFAULT 0,  -- delay after the previous step (or enrollment for step 0)
  subject TEXT NOT NULL,
  body_text TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_steps_seq ON sequence_steps(sequence_id, step_order);

CREATE TABLE enrollments (
  id TEXT PRIMARY KEY,
  sequence_id TEXT NOT NULL REFERENCES sequences(id) ON DELETE CASCADE,
  contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'active',  -- active | completed | exited | unsubscribed
  current_step INTEGER NOT NULL DEFAULT 0,
  next_run_at TEXT,
  enrolled_at TEXT NOT NULL,
  completed_at TEXT
);
CREATE INDEX idx_enroll_due ON enrollments(status, next_run_at);
CREATE UNIQUE INDEX idx_enroll_unique ON enrollments(sequence_id, contact_id);
