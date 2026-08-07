-- Carrier-required HELP reply contact.
--
-- When a customer texts HELP, the auto-reply must name the business and give a
-- way to reach a human; A2P reviewers check this. Seeded with the details
-- already published on bhcardetails.com so the reply is correct from the first
-- message. Editable in Settings → Support contact.
-- Only inserts if unset — never overwrites an edit.
INSERT INTO settings (key, value)
SELECT 'support_contact', '(917) 783-1038 or info@bhcardetails.com'
WHERE NOT EXISTS (SELECT 1 FROM settings WHERE key = 'support_contact');
