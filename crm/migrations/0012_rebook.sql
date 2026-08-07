-- Rebook engine: know when every customer is next due, and who to work this
-- week. Also the compliance columns the inbound STOP handler needs.
-- All additive — safe on the live DB.

-- --- Contacts: the rebook clock lives here, because "who should I call this
-- week" is a per-customer question, not a per-job one. ---
ALTER TABLE contacts ADD COLUMN last_service_at      TEXT;    -- last completed/paid job
ALTER TABLE contacts ADD COLUMN next_due_at          TEXT;    -- powers the due-this-week worklist
ALTER TABLE contacts ADD COLUMN job_count            INTEGER NOT NULL DEFAULT 0;
ALTER TABLE contacts ADD COLUMN lifetime_value_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE contacts ADD COLUMN rebook_snooze_until  TEXT;    -- hidden from the worklist until then
ALTER TABLE contacts ADD COLUMN rebook_days_override INTEGER; -- per-customer cadence beats the service default
ALTER TABLE contacts ADD COLUMN sms_opted_out_at     TEXT;    -- texted STOP; never auto-message again
ALTER TABLE contacts ADD COLUMN do_not_contact       INTEGER NOT NULL DEFAULT 0;

CREATE INDEX idx_contacts_next_due ON contacts(next_due_at);
CREATE INDEX idx_contacts_optout   ON contacts(sms_opted_out_at);

-- --- Services: how often this service should bring a customer back.
-- NULL means one-off work that never triggers a rebook. ---
ALTER TABLE services ADD COLUMN rebook_days INTEGER;

-- --- Jobs: completion is now a distinct, stamped event (status alone could not
-- tell us *when*), plus the two send-stamps the worklist reads. ---
ALTER TABLE jobs ADD COLUMN completed_at         TEXT;
ALTER TABLE jobs ADD COLUMN review_requested_at  TEXT;
ALTER TABLE jobs ADD COLUMN rebook_offer_sent_at TEXT;

CREATE INDEX idx_jobs_completed ON jobs(completed_at);

-- --- Recurring plans: maintenance work is a subscription in disguise. ---
CREATE TABLE recurring_plans (
  id            TEXT PRIMARY KEY,
  contact_id    TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  service_id    TEXT REFERENCES services(id) ON DELETE SET NULL,
  interval_days INTEGER NOT NULL,
  price_cents   INTEGER NOT NULL DEFAULT 0,
  next_run_at   TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'active',   -- active | paused | cancelled
  notes         TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX idx_plans_due     ON recurring_plans(status, next_run_at);
CREATE INDEX idx_plans_contact ON recurring_plans(contact_id);

-- --- Seed cadences on the standard menu (tighter maintenance cadence, agreed
-- 2026-07-28). Matched by id, falling back to name so a regenerated services
-- table still gets seeded. Only fills blanks — never overwrites an edit. ---
UPDATE services SET rebook_days = 14
  WHERE rebook_days IS NULL AND (id = 'svc_washwax' OR lower(name) LIKE '%wash%');
UPDATE services SET rebook_days = 60
  WHERE rebook_days IS NULL AND (id IN ('svc_full','svc_interior','svc_exterior') OR lower(name) LIKE '%detail%');
UPDATE services SET rebook_days = 180
  WHERE rebook_days IS NULL AND (id = 'svc_ceramic' OR lower(name) LIKE '%ceramic%');
UPDATE services SET rebook_days = 365
  WHERE rebook_days IS NULL AND (id = 'svc_paint' OR lower(name) LIKE '%correction%');

-- --- Backfill from existing history. ---

-- Completed/paid jobs predate the completed_at column; date them from the best
-- signal available.
UPDATE jobs
   SET completed_at = COALESCE(paid_at, scheduled_start, updated_at)
 WHERE completed_at IS NULL AND status IN ('completed','paid');

-- Job count and lifetime value. Value = money actually collected, or the agreed
-- price where a completed job was never marked paid.
UPDATE contacts SET
  job_count = (
    SELECT COUNT(*) FROM jobs j
     WHERE j.contact_id = contacts.id AND j.status IN ('completed','paid')
  ),
  lifetime_value_cents = COALESCE((
    SELECT SUM(MAX(j.amount_paid_cents, j.price_cents)) FROM jobs j
     WHERE j.contact_id = contacts.id AND j.status IN ('completed','paid')
  ), 0),
  last_service_at = (
    SELECT MAX(j.completed_at) FROM jobs j
     WHERE j.contact_id = contacts.id AND j.status IN ('completed','paid')
  );

-- A provisional next_due_at so the worklist is useful the moment this ships.
-- POST /api/rebook/recompute refines it per contact using the real cadence of
-- the services on their last job.
UPDATE contacts
   SET next_due_at = strftime('%Y-%m-%dT%H:%M:%fZ', last_service_at, '+60 days')
 WHERE last_service_at IS NOT NULL AND next_due_at IS NULL;
