-- Wave 3: Stripe deposits/payments on jobs.
-- Dormant until STRIPE_SECRET_KEY is configured; columns are always safe to add.

ALTER TABLE jobs ADD COLUMN deposit_cents INTEGER;          -- required deposit snapshot at checkout
ALTER TABLE jobs ADD COLUMN amount_paid_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE jobs ADD COLUMN paid_at TEXT;                   -- first successful payment
ALTER TABLE jobs ADD COLUMN paid_in_full INTEGER NOT NULL DEFAULT 0;
ALTER TABLE jobs ADD COLUMN stripe_session_id TEXT;
ALTER TABLE jobs ADD COLUMN stripe_payment_intent TEXT;
CREATE INDEX idx_jobs_stripe_session ON jobs (stripe_session_id);
