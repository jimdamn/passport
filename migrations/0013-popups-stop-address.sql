-- 0013-popups-stop-address.sql
-- Pop-Ups Stops gain a required formal Address field, geocoded via the
-- shared Census/Nominatim proxy (src/handlers/geocode.ts), alongside the
-- existing informal location_hint description. Protomaps tiles carry no
-- building footprints (ARCHITECTURE.md §13 item 2) - the original drag-only
-- pin flow left an owner with no way to jump near their own spot before
-- fine-tuning. Address is the formal geocoding input and is shown alongside
-- location_hint (the "tell a regular" informal wayfinding note), not instead
-- of it - both serve different readers.
-- Apply: wrangler d1 execute krowdkraft-passport --local --file=migrations/0013-popups-stop-address.sql
--        wrangler d1 execute krowdkraft-passport --remote --file=migrations/0013-popups-stop-address.sql

ALTER TABLE popup_stops ADD COLUMN address TEXT;

INSERT OR IGNORE INTO schema_migrations (name) VALUES ('0013-popups-stop-address');
