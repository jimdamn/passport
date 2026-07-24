-- 0011-community-table.sql
-- Community Table: community-meal Kitchens (fire halls, churches, Legion/VFW)
-- + scheduled single-day Meals. Third board on the Fresh Today primitive.
-- Diff vs donors: two-table shape from fresh_stands/fresh_posts, scheduled
-- clock from sales, plus benefit_line (whose cause the meal helps), a public
-- Cancelled state (a vanished fish fry strands neighbors - cancels stay
-- visible until day end), and optional per-meal venue override (benefit
-- dinners borrow halls). Same admin hide-with-reason, soft delete, lazy
-- expiry (ARCHITECTURE.md §13.10).
-- Apply: wrangler d1 execute krowdkraft-passport --local --file=migrations/0011-community-table.sql
--        wrangler d1 execute krowdkraft-passport --remote --file=migrations/0011-community-table.sql

CREATE TABLE IF NOT EXISTS meal_kitchens (
  id                  TEXT PRIMARY KEY,
  tenant_id           TEXT NOT NULL REFERENCES tenants(id),
  kkauth_uid          INTEGER NOT NULL,
  name                TEXT NOT NULL,
  description         TEXT,
  lat                 REAL NOT NULL,
  lon                 REAL NOT NULL,
  address_hint        TEXT,
  phone               TEXT,
  photo_url           TEXT,
  nearest_city        TEXT,
  nearest_state       TEXT,
  is_hidden           INTEGER NOT NULL DEFAULT 0,   -- owner "Go quiet"
  admin_hidden        INTEGER NOT NULL DEFAULT 0,
  admin_hidden_reason TEXT,
  admin_hidden_by     INTEGER,
  deleted_at          INTEGER,
  created_at          INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at          INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_meal_kitchens_owner  ON meal_kitchens(kkauth_uid, tenant_id);
CREATE INDEX IF NOT EXISTS idx_meal_kitchens_public ON meal_kitchens(tenant_id, is_hidden, admin_hidden);

CREATE TABLE IF NOT EXISTS meals (
  id                  TEXT PRIMARY KEY,
  tenant_id           TEXT NOT NULL REFERENCES tenants(id),
  kitchen_id          TEXT NOT NULL REFERENCES meal_kitchens(id),
  kkauth_uid          INTEGER NOT NULL,
  title               TEXT NOT NULL,
  body                TEXT NOT NULL,
  category            TEXT NOT NULL,
  date                TEXT NOT NULL,               -- 'YYYY-MM-DD' board TZ
  open                TEXT NOT NULL,               -- 'HH:MM'
  close               TEXT NOT NULL,
  benefit_line        TEXT,
  lat                 REAL,                        -- venue override (both or neither)
  lon                 REAL,
  venue_hint          TEXT,
  photo_url           TEXT,
  sold_out            INTEGER NOT NULL DEFAULT 0,
  sold_out_at         INTEGER,
  cancelled_at        INTEGER,
  admin_hidden        INTEGER NOT NULL DEFAULT 0,
  admin_hidden_reason TEXT,
  admin_hidden_by     INTEGER,
  deleted_at          INTEGER,
  created_at          INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at          INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_meals_feed    ON meals(tenant_id, admin_hidden, date);
CREATE INDEX IF NOT EXISTS idx_meals_kitchen ON meals(kitchen_id, date);

INSERT OR IGNORE INTO schema_migrations (name) VALUES ('0011-community-table');
