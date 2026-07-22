-- 0006-fresh-today.sql
-- Fresh Today: producer stands + self-expiring daily posts + harvest calendar.
-- Stands are resident-owned (NO merchant verification required - any signed-in
-- local can sell eggs). Posts copy the Happenings lifecycle: lazy expiry at end
-- of board day, no cron. Admin hides carry stored, owner-visible reasons per
-- the CRUD gate (ARCHITECTURE.md Section 13, item 10).
-- Apply: wrangler d1 execute krowdkraft-passport --local --file=migrations/0006-fresh-today.sql
--        wrangler d1 execute krowdkraft-passport --remote --file=migrations/0006-fresh-today.sql

INSERT OR IGNORE INTO schema_migrations (name) VALUES ('0006-fresh-today');

CREATE TABLE IF NOT EXISTS fresh_stands (
  id                  TEXT PRIMARY KEY,
  tenant_id           TEXT NOT NULL REFERENCES tenants(id),
  kkauth_uid          INTEGER NOT NULL,
  name                TEXT NOT NULL,
  description         TEXT,
  lat                 REAL NOT NULL,
  lon                 REAL NOT NULL,
  address_hint        TEXT,
  phone               TEXT,
  categories          TEXT NOT NULL DEFAULT '[]',   -- JSON array of FRESH_CATEGORIES slugs
  photo_url           TEXT,
  is_hidden           INTEGER NOT NULL DEFAULT 0,    -- owner pause (orthogonal to admin_hidden)
  admin_hidden        INTEGER NOT NULL DEFAULT 0,
  admin_hidden_reason TEXT,
  admin_hidden_by     INTEGER,
  deleted_at          INTEGER,
  created_at          INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at          INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_fresh_stands_owner  ON fresh_stands(kkauth_uid, tenant_id);
CREATE INDEX IF NOT EXISTS idx_fresh_stands_public ON fresh_stands(tenant_id, is_hidden, admin_hidden);

CREATE TABLE IF NOT EXISTS fresh_posts (
  id                  TEXT PRIMARY KEY,
  tenant_id           TEXT NOT NULL REFERENCES tenants(id),
  stand_id            TEXT NOT NULL REFERENCES fresh_stands(id),
  kkauth_uid          INTEGER NOT NULL,
  body                TEXT NOT NULL,
  photo_url           TEXT,
  sold_out            INTEGER NOT NULL DEFAULT 0,
  sold_out_at         INTEGER,
  is_active           INTEGER NOT NULL DEFAULT 1,    -- owner early removal
  admin_hidden        INTEGER NOT NULL DEFAULT 0,
  admin_hidden_reason TEXT,
  admin_hidden_by     INTEGER,
  expires_at          INTEGER NOT NULL,
  created_at          INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_fresh_posts_feed  ON fresh_posts(tenant_id, is_active, admin_hidden, expires_at);
CREATE INDEX IF NOT EXISTS idx_fresh_posts_stand ON fresh_posts(stand_id, created_at);

CREATE TABLE IF NOT EXISTS fresh_seasons (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id   TEXT NOT NULL REFERENCES tenants(id),
  item_name   TEXT NOT NULL,
  start_month INTEGER NOT NULL,  start_day INTEGER NOT NULL,
  end_month   INTEGER NOT NULL,  end_day   INTEGER NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0
);

INSERT INTO fresh_seasons (tenant_id, item_name, start_month, start_day, end_month, end_day, sort_order) VALUES
  ('lake-locals', 'Maple syrup',     2, 15,  4, 15,  1),
  ('lake-locals', 'Asparagus',       5,  1,  6, 15,  2),
  ('lake-locals', 'Strawberries',    6,  5,  7,  5,  3),
  ('lake-locals', 'Sweet cherries',  6, 25,  7, 20,  4),
  ('lake-locals', 'Blueberries',     7,  5,  8, 15,  5),
  ('lake-locals', 'Sweet corn',      7, 15,  9, 15,  6),
  ('lake-locals', 'Tomatoes',        7, 15, 10,  1,  7),
  ('lake-locals', 'Peaches',         7, 25,  9, 10,  8),
  ('lake-locals', 'Melons',          8,  1,  9, 20,  9),
  ('lake-locals', 'Apples',          8, 25, 10, 31, 10),
  ('lake-locals', 'Grapes',          8, 25, 10,  5, 11),
  ('lake-locals', 'Winter squash',   9,  1, 11, 15, 12),
  ('lake-locals', 'Pumpkins',        9, 15, 10, 31, 13),
  ('lake-locals', 'Fresh cider',     9, 15, 11, 15, 14),
  ('lake-locals', 'Christmas trees',11, 20, 12, 24, 15);
