-- Working the dead book: reactivation, review tracking, referral attribution.
-- All additive — safe on the live DB.

-- --- Reactivation. The imported contacts have no recorded consent, so they get
-- worked one at a time by hand, not blasted. These columns track who has
-- already been approached so nobody gets hit twice. ---
ALTER TABLE contacts ADD COLUMN reactivation_sent_at TEXT;
ALTER TABLE contacts ADD COLUMN reactivation_skipped_at TEXT;

-- --- Referral attribution: who sent this customer to us. ---
ALTER TABLE contacts ADD COLUMN referred_by_contact_id TEXT REFERENCES contacts(id) ON DELETE SET NULL;
CREATE INDEX idx_contacts_referred_by ON contacts(referred_by_contact_id);

-- --- Reviews. review_requested_at arrived in 0012; these close the loop. ---
ALTER TABLE jobs ADD COLUMN review_followup_sent_at TEXT;
ALTER TABLE jobs ADD COLUMN review_left_at TEXT;
