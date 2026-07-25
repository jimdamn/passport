-- 0017-sponsor-drawer-siblings.sql
-- Sponsor Drawer Increment 3: extends route sponsorship beyond Passport to the
-- sibling Hub apps (Exchange, Field Notes, Apps Hub). A bare route string like
-- '/' or '/help' collides across apps (SPONSOR-DRAWER-BUILD-PLAN.md's route
-- list was Passport-only, per 0016's SPONSOR_KNOWN_ROUTES), so every placement
-- now also names which app it targets. Existing rows default to 'passport' -
-- every placement created before this migration was, in fact, a Passport route.
-- Apply: wrangler d1 execute krowdkraft-passport --local --file=migrations/0017-sponsor-drawer-siblings.sql
--        wrangler d1 execute krowdkraft-passport --remote --file=migrations/0017-sponsor-drawer-siblings.sql

ALTER TABLE sponsorship ADD COLUMN app TEXT NOT NULL DEFAULT 'passport';
CREATE INDEX IF NOT EXISTS idx_sponsorship_resolve_app ON sponsorship (tenant_id, app, route, target_kind);

INSERT OR IGNORE INTO schema_migrations (name) VALUES ('0017-sponsor-drawer-siblings');
