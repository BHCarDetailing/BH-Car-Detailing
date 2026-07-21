ALTER TABLE messages ADD COLUMN channel   TEXT NOT NULL DEFAULT 'email';   -- 'email' | 'sms'
ALTER TABLE messages ADD COLUMN direction TEXT NOT NULL DEFAULT 'outbound'; -- 'outbound' | 'inbound'
ALTER TABLE messages ADD COLUMN from_addr TEXT;
ALTER TABLE messages ADD COLUMN to_addr   TEXT;
CREATE INDEX idx_messages_channel ON messages(channel, contact_id, id DESC);
