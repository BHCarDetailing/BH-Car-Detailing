CREATE TABLE missed_calls (
  id TEXT PRIMARY KEY,
  contact_id TEXT,
  from_phone TEXT NOT NULL,
  to_phone TEXT,
  call_sid TEXT,
  dial_status TEXT,                 -- completed | no-answer | busy | failed
  texted INTEGER NOT NULL DEFAULT 0,
  message_id TEXT,                  -- messages.id of the delivered text
  skip_reason TEXT,                 -- answered|cooldown|disabled|unknown_number|self_guard|opt_out|sms_failed
  text_template_snapshot TEXT,      -- exact body delivered (only when sent)
  duration_seconds INTEGER,
  acknowledged_at TEXT,             -- set when owner opens the conversation
  created_at TEXT NOT NULL
);
CREATE INDEX idx_missed_calls_phone ON missed_calls (from_phone, created_at);
CREATE INDEX idx_missed_calls_contact_ack ON missed_calls (contact_id, acknowledged_at);

ALTER TABLE contacts ADD COLUMN sms_opt_out_auto INTEGER NOT NULL DEFAULT 0;
ALTER TABLE contacts ADD COLUMN lead_source TEXT;
ALTER TABLE contacts ADD COLUMN first_contact_method TEXT;
ALTER TABLE contacts ADD COLUMN acquisition_channel TEXT;
