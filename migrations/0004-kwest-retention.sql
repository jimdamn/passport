-- 0004: relax kwest_reveals.device_lat/device_lng to nullable so the
-- retention sweep (KROWDKWEST-DEVELOPMENT-PLAN.md Section 9) can truncate
-- raw coordinates on reveals older than a hunt's official end + 30 days
-- without violating a NOT NULL constraint. SQLite has no ALTER COLUMN, so
-- this recreates the table. No data loss: every existing row's coordinates
-- are copied over unchanged; only the constraint changes.
-- Apply: wrangler d1 execute krowdkraft-passport --local --file=migrations/0004-kwest-retention.sql
--        wrangler d1 execute krowdkraft-passport --remote --file=migrations/0004-kwest-retention.sql

INSERT OR IGNORE INTO schema_migrations (name) VALUES ('0004-kwest-retention');

CREATE TABLE kwest_reveals_new (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  hunt_id       INTEGER NOT NULL,
  step_id       INTEGER NOT NULL,
  tenant_id     TEXT NOT NULL,
  player_key    TEXT NOT NULL,
  result        TEXT NOT NULL CHECK (result IN ('hit','near','miss')),
  device_lat    REAL,                            -- nullable: retention sweep truncates after 30d
  device_lng    REAL,                            -- nullable: retention sweep truncates after 30d
  accuracy_m    REAL,
  distance_m    REAL NOT NULL,
  edge_lat      REAL,
  edge_lng      REAL,
  is_test       INTEGER NOT NULL DEFAULT 0,
  sim           INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL DEFAULT (unixepoch())
);

INSERT INTO kwest_reveals_new
  (id, hunt_id, step_id, tenant_id, player_key, result, device_lat, device_lng,
   accuracy_m, distance_m, edge_lat, edge_lng, is_test, sim, created_at)
SELECT
  id, hunt_id, step_id, tenant_id, player_key, result, device_lat, device_lng,
  accuracy_m, distance_m, edge_lat, edge_lng, is_test, sim, created_at
FROM kwest_reveals;

DROP TABLE kwest_reveals;
ALTER TABLE kwest_reveals_new RENAME TO kwest_reveals;

CREATE INDEX IF NOT EXISTS idx_kwest_reveals_player ON kwest_reveals (hunt_id, player_key, created_at);
CREATE INDEX IF NOT EXISTS idx_kwest_reveals_step   ON kwest_reveals (hunt_id, step_id, created_at);
