-- Service taxonomy: what a service covers, how deep it goes, how long it takes.
--
-- The menu encoded all of this in the NAME ("Full Interior Detail"), which meant
-- nothing could filter, route, or recommend against it. The quote-builder wizard
-- and the Products filters both need it as real fields.
-- All additive.

-- interior | exterior | both | specialty
ALTER TABLE services ADD COLUMN area TEXT;
-- maintenance | light | full | specialty
ALTER TABLE services ADD COLUMN level TEXT;
-- Drives the "estimated appointment length" the customer sees, and calendar blocking.
ALTER TABLE services ADD COLUMN duration_min INTEGER;
-- Add-ons are sold alongside a primary service, never on their own.
ALTER TABLE services ADD COLUMN is_addon INTEGER NOT NULL DEFAULT 0;

-- --- Classify the menu from the words in the name.
-- Keyword rules rather than an exact-name list, so renaming "Full Interior
-- Detail" to "Interior Deep Clean" keeps its classification instead of silently
-- falling back to a generic bucket. Only touches unclassified rows, so it is
-- safe to re-run and never overwrites a hand-set value.
UPDATE services SET area = CASE
    WHEN lower(name) LIKE '%curb%' OR lower(name) LIKE '%rash%' OR lower(name) LIKE '%rim%' THEN 'specialty'
    WHEN lower(name) LIKE '%interior%' AND lower(name) LIKE '%exterior%'                    THEN 'both'
    WHEN lower(name) LIKE '%interior%'                                                      THEN 'interior'
    WHEN lower(name) LIKE '%exterior%' OR lower(name) LIKE '%wash%'
      OR lower(name) LIKE '%wax%'      OR lower(name) LIKE '%correction%'
      OR lower(name) LIKE '%ceramic%'  OR lower(name) LIKE '%polish%'                       THEN 'exterior'
    ELSE 'both'   -- a plain "Detail" covers the whole car
  END
 WHERE area IS NULL;

UPDATE services SET level = CASE
    WHEN lower(name) LIKE '%correction%' OR lower(name) LIKE '%ceramic%'
      OR lower(name) LIKE '%curb%'       OR lower(name) LIKE '%rash%'    THEN 'specialty'
    WHEN lower(name) LIKE '%maintenance%' OR lower(name) LIKE '%wash%'
      OR lower(name) LIKE '%wax%'                                        THEN 'maintenance'
    WHEN lower(name) LIKE '%light%'                                      THEN 'light'
    WHEN lower(name) LIKE '%full%' OR lower(name) LIKE '%detail%'        THEN 'full'
    ELSE 'specialty'
  END
 WHERE level IS NULL;

-- Rough on-site time, refined per service below.
UPDATE services SET duration_min = CASE
    WHEN lower(name) LIKE '%ceramic%'     THEN 360
    WHEN lower(name) LIKE '%correction%'  THEN 480
    WHEN lower(name) LIKE '%curb%'        THEN 90
    WHEN lower(name) LIKE '%maintenance%' OR lower(name) LIKE '%wash%' THEN 60
    WHEN lower(name) LIKE '%light%'       THEN 90
    WHEN lower(name) LIKE '%full%'        THEN 210
    ELSE 120
  END
 WHERE duration_min IS NULL;

-- Exact durations for the live menu, where the keyword guess is too coarse.
UPDATE services SET duration_min = 240 WHERE name = 'Full Detail';
UPDATE services SET duration_min = 180 WHERE name = 'Full Interior Detail';
UPDATE services SET duration_min = 150 WHERE name = 'Full Exterior Detail';
UPDATE services SET duration_min = 150 WHERE name = 'Light Detail';
UPDATE services SET duration_min = 75  WHERE name = 'Light Exterior Detail';

-- --- Exotic pricing correction. ---
-- Exotics were priced BELOW SUVs on seven of ten lines while taking longer and
-- carrying more risk. Levels exotic up to the SUV price wherever it sits lower;
-- lines where exotic is already higher (Paint Correction, Ceramic, Curb Rash)
-- are left untouched. Self-correcting, so re-running changes nothing.
UPDATE services
   SET size_pricing = json_set(size_pricing, '$.exotic', json_extract(size_pricing, '$.suv')),
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
 WHERE json_extract(size_pricing, '$.exotic') IS NOT NULL
   AND json_extract(size_pricing, '$.suv')    IS NOT NULL
   AND json_extract(size_pricing, '$.exotic') < json_extract(size_pricing, '$.suv');

-- --- Add-ons, seeded unpriced. ---
-- Deliberately $0: the wizard hides a $0 add-on, so nothing can be sold at the
-- wrong price. Set them in Settings → Services and they appear immediately.
INSERT OR IGNORE INTO services (id, name, description, size_pricing, base_price_cents, active, sort, area, level, duration_min, is_addon, created_at, updated_at) VALUES
 ('svc_addon_engine',    'Engine Bay',             'Degrease and dress the engine bay.',              '{}', 0, 1, 200, 'exterior',  'specialty', 30, 1, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 ('svc_addon_ceramspray','Ceramic Spray',          'Spray ceramic sealant for months of protection.', '{}', 0, 1, 210, 'exterior',  'specialty', 30, 1, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 ('svc_addon_pethair',   'Pet Hair Removal',       'Heavy pet hair extraction.',                      '{}', 0, 1, 220, 'interior',  'specialty', 45, 1, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 ('svc_addon_shampoo',   'Shampoo / Extraction',   'Hot water extraction of carpets and seats.',      '{}', 0, 1, 230, 'interior',  'specialty', 60, 1, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 ('svc_addon_odor',      'Odor Removal',           'Ozone / enzyme odor treatment.',                  '{}', 0, 1, 240, 'interior',  'specialty', 45, 1, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 ('svc_addon_claybar',   'Clay Bar',               'Clay decontamination for a glass-smooth finish.', '{}', 0, 1, 250, 'exterior',  'specialty', 45, 1, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 ('svc_addon_headlight', 'Headlight Restoration',  'Sand and polish yellowed headlights.',            '{}', 0, 1, 260, 'exterior',  'specialty', 45, 1, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'));

CREATE INDEX IF NOT EXISTS idx_services_taxonomy ON services(is_addon, active, level, area);

-- --- Service address. The customer types this themselves on the handoff screen,
-- and a mobile business needs the whole thing, not one free-text line. ---
ALTER TABLE contacts ADD COLUMN state TEXT;
ALTER TABLE contacts ADD COLUMN zip TEXT;
