-- Expenses (for profit/margin) and the equipment shopping list.

CREATE TABLE IF NOT EXISTS expenses (
  id           TEXT PRIMARY KEY,
  label        TEXT NOT NULL,
  amount_cents INTEGER NOT NULL DEFAULT 0,
  category     TEXT NOT NULL DEFAULT 'other',   -- supplies|equipment|fuel|marketing|software|insurance|fees|other
  occurred_at  TEXT,
  vendor       TEXT,
  note         TEXT,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_expenses_occurred ON expenses(occurred_at DESC);

-- Gear still to buy before the mobile setup is done. Separate from Products
-- (the service menu) and from Expenses (money already spent) — this is the
-- shopping list that turns into an expense once it's actually purchased.
CREATE TABLE IF NOT EXISTS equipment_items (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  category       TEXT NOT NULL DEFAULT 'other',  -- washing|polishing|interior|power|storage|safety|other
  est_cost_cents INTEGER NOT NULL DEFAULT 0,
  priority       TEXT NOT NULL DEFAULT 'nice_to_have', -- must_have|should_have|nice_to_have
  purchased      INTEGER NOT NULL DEFAULT 0,
  purchased_at   TEXT,
  notes          TEXT,
  sort           INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_equipment_purchased ON equipment_items(purchased, sort);
