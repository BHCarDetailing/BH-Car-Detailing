-- Multi-channel sequences + a real trigger engine.
--
-- The book is almost entirely phone numbers, but every sequence step was
-- email-only. Steps can now pick a channel, and 'auto' resolves to whatever
-- that contact can actually receive.
-- All additive — safe on the live DB.

-- sms | email | auto  (auto = SMS if they consented, else email, else a task)
ALTER TABLE sequence_steps ADD COLUMN channel TEXT NOT NULL DEFAULT 'auto';

-- A contact may be in only ONE active sequence at a time; when two compete,
-- the higher priority wins. Booking beats post-job beats rebook beats
-- reactivation beats referral.
ALTER TABLE sequences ADD COLUMN priority INTEGER NOT NULL DEFAULT 50;

-- Why an enrollment ended: replied | booked | opted_out | superseded | manual
ALTER TABLE enrollments ADD COLUMN exit_reason TEXT;
ALTER TABLE enrollments ADD COLUMN last_sent_at TEXT;

CREATE INDEX idx_enroll_contact_status ON enrollments(contact_id, status);

-- Seed priorities for the sequences already in the account, matched by name.
UPDATE sequences SET priority = 90 WHERE lower(name) LIKE '%booking%' OR lower(name) LIKE '%appointment%';
UPDATE sequences SET priority = 80 WHERE lower(name) LIKE '%post-detail%' OR lower(name) LIKE '%post detail%' OR lower(name) LIKE '%follow-up%';
UPDATE sequences SET priority = 70 WHERE lower(name) LIKE '%review%';
UPDATE sequences SET priority = 60 WHERE lower(name) LIKE '%quote%';
UPDATE sequences SET priority = 50 WHERE lower(name) LIKE '%maintenance%' OR lower(name) LIKE '%rebook%';
UPDATE sequences SET priority = 40 WHERE lower(name) LIKE '%reactivat%' OR lower(name) LIKE '%win%back%';
UPDATE sequences SET priority = 30 WHERE lower(name) LIKE '%referral%';

-- Existing steps were written as emails; keep them explicitly email so the new
-- 'auto' default never silently turns a long email body into a text message.
UPDATE sequence_steps SET channel = 'email';
