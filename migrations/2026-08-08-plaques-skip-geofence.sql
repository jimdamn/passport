-- Catch-up migration (Category Thesis Remediation item 9 / G0-C).
-- passport_plaques.skip_geofence has been live in production since before this
-- repo tracked it (added by an undocumented manual ALTER, first referenced by
-- the merchant-address-privacy fix). A fresh/local database has never had
-- this column. This migration is safe to run everywhere:
--   - fresh/local: the ALTER creates the column.
--   - production: the column already exists, so only the ledger row below is
--     applied there (the ALTER is skipped manually at apply time - see
--     deploy notes for this migration).
ALTER TABLE passport_plaques ADD COLUMN skip_geofence INTEGER NOT NULL DEFAULT 0;

INSERT OR IGNORE INTO schema_migrations (name) VALUES ('2026-08-08-plaques-skip-geofence');
