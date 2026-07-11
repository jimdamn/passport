-- 0001: the migration ledger itself. Every subsequent migration's FIRST
-- statement records its own name here; check the table before applying a
-- file so no migration ever runs twice. Mirrors the kkgame convention
-- (migrations/0001-schema-migrations.sql there).
-- Apply: wrangler d1 execute krowdkraft-passport --local --file=migrations/0001-schema-migrations.sql
--        wrangler d1 execute krowdkraft-passport --remote --file=migrations/0001-schema-migrations.sql
--
-- NOTE: schema.sql remains the canonical fresh-DB bootstrap for the tables
-- that predate this ledger. Every NEW change from here on ships as an ordered
-- migration file, never an in-place edit of schema.sql.

CREATE TABLE IF NOT EXISTS schema_migrations (
  name       TEXT PRIMARY KEY,
  applied_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Backfill the four pre-ledger dated migrations that already ran against
-- both local and remote D1 before this ledger existed.
INSERT OR IGNORE INTO schema_migrations (name) VALUES
  ('2026-06-12-deals-marketplace'),
  ('2026-06-12-welcome-credited'),
  ('2026-06-13-plaques-services-category'),
  ('2026-07-05-visit-claims');

INSERT OR IGNORE INTO schema_migrations (name) VALUES ('0001-schema-migrations');
