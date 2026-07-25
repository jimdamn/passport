-- 0018-inline-sponsor-banner.sql
-- Inline Sponsor Banner: a static, always-visible "Brought to you by X" image
-- sitting in normal page flow (not the dismissible Sponsor Drawer). Same
-- sponsorship table, different placement values (INLINE-SPONSOR-BANNER-BUILD-PLAN.md
-- §1). `placement` has held 'route_drawer' unused since 0016 - new values
-- below don't need a schema change:
--   inline_top, inline_footer, inline_mid_feed, inline_mid_story
-- banner_size is new: NULL for route_drawer (the drawer has one fixed shape,
-- always has), required for any inline_* placement (wide | rectangle).
-- show_credit_line is new: defaults to 1 (on) for inline_* placements per
-- Jim's 2026-07-25 decision (credit line included but toggleable); unused for
-- route_drawer, which always shows its "Brought to you by" text block.
-- Enforcement of both allowed-values lists is application-level
-- (handlers/sponsors.ts), matching how app/route are validated.
-- Apply: wrangler d1 execute krowdkraft-passport --local --file=migrations/0018-inline-sponsor-banner.sql
--        wrangler d1 execute krowdkraft-passport --remote --file=migrations/0018-inline-sponsor-banner.sql

ALTER TABLE sponsorship ADD COLUMN banner_size TEXT;
ALTER TABLE sponsorship ADD COLUMN show_credit_line INTEGER NOT NULL DEFAULT 1;

INSERT OR IGNORE INTO schema_migrations (name) VALUES ('0018-inline-sponsor-banner');
