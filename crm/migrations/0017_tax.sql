-- Optional sales tax.
--
-- price_cents stays the amount the customer actually pays, so deposits,
-- balances and revenue keep working untouched; tax_cents records the split for
-- the books. Off until switched on in Settings, so nothing changes by default.
ALTER TABLE jobs ADD COLUMN tax_cents INTEGER NOT NULL DEFAULT 0;

INSERT OR IGNORE INTO settings (key, value) VALUES ('tax_enabled', '0');
INSERT OR IGNORE INTO settings (key, value) VALUES ('tax_rate', '7');
INSERT OR IGNORE INTO settings (key, value) VALUES ('tax_label', 'Sales tax');
