-- Wave 2: services catalog + shareable quotes.

CREATE TABLE services (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  -- Per-vehicle-size prices in cents, JSON keyed by size_class
  -- (sedan|suv|truck|van|exotic|other). base_price_cents is the fallback
  -- when a size has no explicit entry.
  size_pricing TEXT NOT NULL DEFAULT '{}',
  base_price_cents INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_services_active ON services (active, sort);

-- Shareable-quote fields on jobs. A job in 'quoted' status with a quote_token
-- is viewable by the customer at /quote/<token>.
ALTER TABLE jobs ADD COLUMN quote_token TEXT;
ALTER TABLE jobs ADD COLUMN quote_sent_at TEXT;
ALTER TABLE jobs ADD COLUMN quote_viewed_at TEXT;
ALTER TABLE jobs ADD COLUMN quote_accepted_at TEXT;
CREATE INDEX idx_jobs_quote_token ON jobs (quote_token);

-- Seed BH Car Detailing menu (prices editable in Settings → Services).
INSERT INTO services (id, name, description, size_pricing, base_price_cents, active, sort, created_at, updated_at) VALUES
 ('svc_full',    'Full Detail',      'Complete interior + exterior detail.',        '{"sedan":17500,"suv":22500,"truck":25000,"van":27500,"exotic":30000,"other":20000}', 17500, 1, 10, datetime('now'), datetime('now')),
 ('svc_interior','Interior Detail',  'Deep interior clean, vacuum, shampoo, protect.','{"sedan":12000,"suv":15000,"truck":17500,"van":20000,"exotic":22500,"other":14000}', 12000, 1, 20, datetime('now'), datetime('now')),
 ('svc_exterior','Exterior Detail',  'Hand wash, clay, wax, tire + trim dress.',     '{"sedan":10000,"suv":12500,"truck":15000,"van":16000,"exotic":20000,"other":12000}', 10000, 1, 30, datetime('now'), datetime('now')),
 ('svc_washwax', 'Wash & Wax',       'Maintenance hand wash and spray wax.',         '{"sedan":6000,"suv":7500,"truck":9000,"van":10000,"exotic":12000,"other":7000}',     6000, 1, 40, datetime('now'), datetime('now')),
 ('svc_paint',   'Paint Correction', 'Multi-stage machine polish to remove swirls.',  '{"sedan":45000,"suv":55000,"truck":60000,"van":65000,"exotic":80000,"other":50000}', 45000, 1, 50, datetime('now'), datetime('now')),
 ('svc_ceramic', 'Ceramic Coating',  'Professional ceramic coating, multi-year protection.','{"sedan":70000,"suv":80000,"truck":90000,"van":95000,"exotic":120000,"other":75000}',70000, 1, 60, datetime('now'), datetime('now'));
