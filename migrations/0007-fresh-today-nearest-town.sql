-- 0007-fresh-today-nearest-town.sql
-- Fresh Today: snapshot the nearest known town/state onto each stand.
-- The service region spans dozens of towns across three states, so the map
-- pin plus optional free-text address_hint aren't enough as an at-a-glance
-- location label. Derived once at create/update time via KKAuth's
-- GET /internal/nearest-place?lat=&lon= (same snapshot-don't-fan-out reasoning
-- as Happenings' merchant contact snapshot) rather than looked up on every
-- public read. Both columns are nullable: null means either the lookup
-- hasn't run yet (pre-migration row) or KKAuth found nothing within 50 miles
-- - both are normal "no auto-label available" outcomes, not error states.
-- Apply: wrangler d1 execute krowdkraft-passport --local --file=migrations/0007-fresh-today-nearest-town.sql
--        wrangler d1 execute krowdkraft-passport --remote --file=migrations/0007-fresh-today-nearest-town.sql

INSERT OR IGNORE INTO schema_migrations (name) VALUES ('0007-fresh-today-nearest-town');

ALTER TABLE fresh_stands ADD COLUMN nearest_city TEXT;
ALTER TABLE fresh_stands ADD COLUMN nearest_state TEXT;
