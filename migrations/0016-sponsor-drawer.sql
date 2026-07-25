-- 0016-sponsor-drawer.sql
-- Sponsor Drawer: a calm, dismissible "Brought to you by X" bottom card
-- crediting a member business sponsoring a route (optionally scoped to a
-- sub-location). Admin-created only in v1 (SPONSOR-DRAWER-BUILD-PLAN.md).
-- No FK from sponsorship into users/reputation/directory tables -
-- sponsor_kkauth_uid is a plain text column, deliberately not a constraint
-- (plan §5.1). sponsor_impressions is daily aggregates only - no user
-- identifier is ever stored with an impression (no-per-user-tracking rule).
-- Apply: wrangler d1 execute krowdkraft-passport --local --file=migrations/0016-sponsor-drawer.sql
--        wrangler d1 execute krowdkraft-passport --remote --file=migrations/0016-sponsor-drawer.sql

INSERT OR IGNORE INTO schema_migrations (name) VALUES ('0016-sponsor-drawer');

CREATE TABLE IF NOT EXISTS sponsorship (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id     TEXT NOT NULL,
  placement     TEXT NOT NULL DEFAULT 'route_drawer',  -- never 'directory_rank'; see plan §0
  route         TEXT NOT NULL,                          -- '*' or '/path'
  target_kind   TEXT NOT NULL DEFAULT 'region',         -- region | city | zip
  target_value  TEXT,                                   -- NULL | 'City, ST' | '49036'
  sponsor_name  TEXT NOT NULL,
  message       TEXT NOT NULL,
  link_url      TEXT,
  image_url     TEXT,
  sponsor_kkauth_uid TEXT,                              -- future self-serve linkage
  is_active     INTEGER NOT NULL DEFAULT 1,
  starts_at     TEXT,
  ends_at       TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_sponsorship_resolve ON sponsorship (tenant_id, route, target_kind);

CREATE TABLE IF NOT EXISTS sponsor_impressions (
  placement_id  INTEGER NOT NULL,
  day           TEXT NOT NULL,                          -- 'YYYY-MM-DD' board TZ
  shows         INTEGER NOT NULL DEFAULT 0,
  dismisses     INTEGER NOT NULL DEFAULT 0,
  taps          INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (placement_id, day)
);
