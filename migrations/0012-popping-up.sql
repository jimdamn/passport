-- 0012-popping-up.sql
-- Pop-Ups: mobile/pop-up business Vendors + scheduled single-day Stops.
-- Fourth board on the Fresh Today primitive. Diff vs donors: the PROFILE HAS
-- NO PIN - a mobile business's location is wherever today's stop is, so
-- lat/lon (and the nearest-town snapshot) live on the Stop. The board's
-- defining presentation is today-vs-scheduled: fans see where a vendor is
-- now AND where they'll be for the next weeks. Public cancelled state and
-- scheduled clock per Community Table/Sale Day; same admin hide-with-reason,
-- soft delete, lazy expiry (ARCHITECTURE.md §13.10).
-- Apply: wrangler d1 execute krowdkraft-passport --local --file=migrations/0012-popping-up.sql
--        wrangler d1 execute krowdkraft-passport --remote --file=migrations/0012-popping-up.sql

CREATE TABLE IF NOT EXISTS popup_vendors (
  id                  TEXT PRIMARY KEY,
  tenant_id           TEXT NOT NULL REFERENCES tenants(id),
  kkauth_uid          INTEGER NOT NULL,
  name                TEXT NOT NULL,
  category            TEXT NOT NULL,
  description         TEXT,
  phone               TEXT,
  photo_url           TEXT,
  is_hidden           INTEGER NOT NULL DEFAULT 0,   -- owner "Off the road"
  admin_hidden        INTEGER NOT NULL DEFAULT 0,
  admin_hidden_reason TEXT,
  admin_hidden_by     INTEGER,
  deleted_at          INTEGER,
  created_at          INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at          INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_popup_vendors_owner  ON popup_vendors(kkauth_uid, tenant_id);
CREATE INDEX IF NOT EXISTS idx_popup_vendors_public ON popup_vendors(tenant_id, is_hidden, admin_hidden);

CREATE TABLE IF NOT EXISTS popup_stops (
  id                  TEXT PRIMARY KEY,
  tenant_id           TEXT NOT NULL REFERENCES tenants(id),
  vendor_id           TEXT NOT NULL REFERENCES popup_vendors(id),
  kkauth_uid          INTEGER NOT NULL,
  date                TEXT NOT NULL,               -- 'YYYY-MM-DD' board TZ
  open                TEXT NOT NULL,               -- 'HH:MM'
  close               TEXT NOT NULL,
  lat                 REAL NOT NULL,
  lon                 REAL NOT NULL,
  location_hint       TEXT,
  note                TEXT,
  nearest_city        TEXT,
  nearest_state       TEXT,
  checked_in_at       INTEGER,                     -- day-of "I'm here" stamp
  checkin_lat         REAL,                        -- exact pin at check-in
  checkin_lon         REAL,                        -- (scheduled pin is kept - plan vs reality)
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
CREATE INDEX IF NOT EXISTS idx_popup_stops_feed   ON popup_stops(tenant_id, admin_hidden, date);
CREATE INDEX IF NOT EXISTS idx_popup_stops_vendor ON popup_stops(vendor_id, date);

INSERT OR IGNORE INTO schema_migrations (name) VALUES ('0012-popping-up');
