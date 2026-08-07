-- Solo maintenance options + the specialty menu.

-- Some work cannot be sold on the spot: it needs product ordered, a bay, and a
-- day set aside. Those services are shown, quoted and followed up — never
-- dropped straight onto the calendar next to the customer's car.
ALTER TABLE services ADD COLUMN requires_planning INTEGER NOT NULL DEFAULT 0;

-- Whether a service can be sold on its own. Separating this from is_addon lets
-- one row be both — Headlight Restoration is a job you can book by itself AND
-- something to tack onto a detail — without duplicating it on the menu, which
-- is how "Full Detail (Sedan)" ended up listed twice at different prices.
ALTER TABLE services ADD COLUMN standalone INTEGER NOT NULL DEFAULT 1;

-- Existing add-ons are add-ons only...
UPDATE services SET standalone = 0 WHERE is_addon = 1;
-- ...except the ones that are also real jobs in their own right.
UPDATE services SET standalone = 1 WHERE id IN ('svc_addon_headlight');

-- --- Solo maintenance. Priced off Maintenance Mobile Wash: 60% exterior, 65%
-- interior, rounded to the nearest $5. Approved 2026-07-29.
-- Sedan $118 → ext $70 / int $75.  SUV, truck, van, exotic $140 → ext $85 / int $90.
-- The two solos together cost more than the full wash, so the bundle stays the
-- better deal — one visit doing both is less work than two. ---
INSERT OR IGNORE INTO services
  (id, name, description, size_pricing, base_price_cents, active, sort, area, level, duration_min, is_addon, standalone, requires_planning, created_at, updated_at)
VALUES
 ('svc_maint_ext', 'Solo Exterior Maintenance', 'Maintenance wash, exterior only.',
  '{"sedan":7000,"suv":8500,"truck":8500,"van":8500,"exotic":8500}', 7000, 1, 41, 'exterior', 'maintenance', 40, 0, 1, 0,
  strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 ('svc_maint_int', 'Solo Interior Maintenance', 'Maintenance clean, interior only.',
  '{"sedan":7500,"suv":9000,"truck":9000,"van":9000,"exotic":9000}', 7500, 1, 42, 'interior', 'maintenance', 45, 0, 1, 0,
  strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'));

-- --- Specialty work that has to be planned. No price seeded on purpose: these
-- are quoted after seeing the car, and the wizard shows them as quote-only
-- rather than inventing a number. ---
INSERT OR IGNORE INTO services
  (id, name, description, size_pricing, base_price_cents, active, sort, area, level, duration_min, is_addon, standalone, requires_planning, created_at, updated_at)
VALUES
 ('svc_ppf', 'Paint Protection Film (PPF)', 'Protective film applied to paint. Quoted after we see the car.',
  '{}', 0, 1, 51, 'exterior', 'specialty', 480, 0, 1, 1,
  strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 ('svc_wrap', 'Vinyl Wrap', 'Full or partial colour change wrap. Quoted after we see the car.',
  '{}', 0, 1, 52, 'exterior', 'specialty', 960, 0, 1, 1,
  strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 ('svc_scratch', 'Scratch Removal', 'Targeted scratch and blemish removal.',
  '{}', 0, 1, 53, 'exterior', 'specialty', 60, 0, 1, 0,
  strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'));

-- Ceramic and paint correction were already on the menu; they need planning too.
UPDATE services SET requires_planning = 1
 WHERE lower(name) LIKE '%ceramic%' OR lower(name) LIKE '%correction%';

-- Curb rash, headlights and scratch removal are same-day work.
UPDATE services SET requires_planning = 0
 WHERE lower(name) LIKE '%curb%' OR lower(name) LIKE '%headlight%' OR lower(name) LIKE '%scratch%';

CREATE INDEX IF NOT EXISTS idx_services_standalone ON services(standalone, active, level);
