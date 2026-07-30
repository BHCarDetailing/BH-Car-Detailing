-- Customer intake links: the "hand to customer" step, but the customer opens
-- it on their OWN phone via a QR code or a copied link instead of yours.
--
-- Max picks the vehicle and service (the part that requires judgment); the
-- customer fills in their own details and books (the part that's just typing).
-- The token is single-use once it produces a job, so a link can't be replayed
-- into a second booking after the fact.
CREATE TABLE IF NOT EXISTS quote_intents (
  id               TEXT PRIMARY KEY,
  token             TEXT NOT NULL UNIQUE,
  vehicle_type      TEXT NOT NULL,
  vehicle_notes     TEXT,
  lines             TEXT NOT NULL,     -- JSON [{service_id, qty}], chosen by Max
  price_override_cents INTEGER,
  created_by        TEXT NOT NULL DEFAULT 'human',
  created_at        TEXT NOT NULL,
  completed_job_id  TEXT REFERENCES jobs(id) ON DELETE SET NULL,
  completed_at      TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_quote_intents_token ON quote_intents(token);
