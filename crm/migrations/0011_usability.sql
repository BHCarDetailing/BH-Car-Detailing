-- Core CRM usability: soft-delete (archive) contacts, link revenue events to a
-- real contact, and tag sequence emails so a per-sequence send-log is possible.
-- All additive — safe on the live DB.

-- Soft delete: a non-null deleted_at means the contact is archived (hidden
-- everywhere, fully restorable). Nothing is ever hard-deleted from the UI.
ALTER TABLE contacts ADD COLUMN deleted_at TEXT;
CREATE INDEX idx_contacts_deleted ON contacts(deleted_at);

-- Revenue events can now point at a contact instead of a free-text name.
ALTER TABLE revenue_entries ADD COLUMN contact_id TEXT;
CREATE INDEX idx_revenue_contact ON revenue_entries(contact_id);

-- Stamp outbound sequence emails with their sequence so the Sequences page can
-- show a real send-log. (Email bodies were already stored in `messages`.)
ALTER TABLE messages ADD COLUMN sequence_id TEXT;
CREATE INDEX idx_messages_sequence ON messages(sequence_id);
