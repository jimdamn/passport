-- 0010-sale-day.sql
-- Sale Day: yard/barn/moving/estate sales and auctions as scheduled, self-
-- retiring map pins. Diff vs Fresh Today: ONE table (a sale is standalone,
-- no seller profile), a days JSON schedule instead of end-of-day expiry,
-- and an optional event_name for corridor events (US-12 sale). Same admin
-- hide-with-reason, soft delete, and lazy expiry as fresh_stands/fresh_posts
-- (ARCHITECTURE.md §13.10).
-- Apply: wrangler d1 execute krowdkraft-passport --local --file=migrations/0010-sale-day.sql
--        wrangler d1 execute krowdkraft-passport --remote --file=migrations/0010-sale-day.sql

CREATE TABLE IF NOT EXISTS sales (
  id                  TEXT PRIMARY KEY,
  tenant_id           TEXT NOT NULL REFERENCES tenants(id),
  kkauth_uid          INTEGER NOT NULL,
  title               TEXT NOT NULL,
  body                TEXT NOT NULL,
  category            TEXT NOT NULL,
  lat                 REAL NOT NULL,
  lon                 REAL NOT NULL,
  address_hint        TEXT,
  phone               TEXT,
  event_name          TEXT,
  days                TEXT NOT NULL,             -- JSON [{date,open,close}]
  first_date          TEXT NOT NULL,             -- denormalized days[0].date
  last_date           TEXT NOT NULL,             -- denormalized days[n-1].date
  wrapped_date        TEXT,                      -- 'YYYY-MM-DD' of owner wrap
  photo_url           TEXT,
  nearest_city        TEXT,
  nearest_state       TEXT,
  is_hidden           INTEGER NOT NULL DEFAULT 0,  -- owner postpone
  admin_hidden        INTEGER NOT NULL DEFAULT 0,
  admin_hidden_reason TEXT,
  admin_hidden_by     INTEGER,
  deleted_at          INTEGER,
  created_at          INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at          INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_sales_owner  ON sales(kkauth_uid, tenant_id);
CREATE INDEX IF NOT EXISTS idx_sales_public ON sales(tenant_id, is_hidden, admin_hidden, last_date);

INSERT OR IGNORE INTO schema_migrations (name) VALUES ('0010-sale-day');
