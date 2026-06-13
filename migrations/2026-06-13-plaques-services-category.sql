-- Add 'services' to passport_plaques category CHECK constraint
-- SQLite requires full table recreation to modify a CHECK constraint.
-- Uses explicit column lists to handle column-order differences from ALTER TABLE history.

PRAGMA foreign_keys = OFF;

CREATE TABLE passport_plaques_new (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL REFERENCES tenants(id),
  merchant_id   TEXT,
  name          TEXT NOT NULL,
  location_name TEXT NOT NULL,
  lat           REAL NOT NULL,
  lon           REAL NOT NULL,
  category      TEXT NOT NULL CHECK (category IN ('dining', 'shopping', 'farmfood', 'recreation', 'attractions', 'lodging', 'services')),
  is_active     INTEGER NOT NULL DEFAULT 1,
  is_event      INTEGER NOT NULL DEFAULT 0,
  event_start   INTEGER,
  event_end     INTEGER,
  created_at    INTEGER NOT NULL DEFAULT (unixepoch())
);

INSERT INTO passport_plaques_new (id, tenant_id, merchant_id, name, location_name, lat, lon, category, is_active, is_event, event_start, event_end, created_at)
SELECT id, tenant_id, merchant_id, name, location_name, lat, lon, category, is_active, is_event, event_start, event_end, COALESCE(created_at, unixepoch())
FROM passport_plaques;

DROP TABLE passport_plaques;

ALTER TABLE passport_plaques_new RENAME TO passport_plaques;

CREATE INDEX IF NOT EXISTS idx_plaques_tenant ON passport_plaques(tenant_id, is_active);

PRAGMA foreign_keys = ON;

-- Create plaque for existing verified merchant (KrowdKraft, business id=1)
INSERT OR IGNORE INTO passport_plaques (id, tenant_id, merchant_id, name, location_name, lat, lon, category, is_active)
VALUES ('1', 'lake-locals', '1', 'KrowdKraft', '1255 North 170 West', 41.6563, -85.0198, 'dining', 1);
