-- 0009-around-interests.sql
-- Around Town redesign: per-member interest picks that order the lens row and
-- set the default lens. Explicit user choice only - never inferred (mission:
-- no algorithmic personalization). Private to the member; no public read, no
-- admin surface. Empty picks = "everything" and suppresses the picker nag.
-- Apply: wrangler d1 execute krowdkraft-passport --local --file=migrations/0009-around-interests.sql
--        wrangler d1 execute krowdkraft-passport --remote --file=migrations/0009-around-interests.sql

CREATE TABLE IF NOT EXISTS around_interests (
  kkauth_uid  INTEGER NOT NULL,
  tenant_id   TEXT NOT NULL REFERENCES tenants(id),
  interests   TEXT NOT NULL DEFAULT '[]',   -- JSON array of lens slugs, pick order preserved
  chosen_at   INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (kkauth_uid, tenant_id)
);

INSERT OR IGNORE INTO schema_migrations (name) VALUES ('0009-around-interests');
