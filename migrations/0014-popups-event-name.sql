-- 0014-popups-event-name.sql
-- Pop-Ups Stops gain an optional event_name, mirroring Sale Day's corridor-event
-- field (0010-sale-day.sql): food trucks and market vendors often set up at the
-- same fair, farmers market, or festival on a given day. When two or more visible
-- stops share an event_name, the public board groups them with a shared event
-- chip - same grouping contract as Sale Day's "This weekend" strip.
-- Apply: wrangler d1 execute krowdkraft-passport --local --file=migrations/0014-popups-event-name.sql
--        wrangler d1 execute krowdkraft-passport --remote --file=migrations/0014-popups-event-name.sql

ALTER TABLE popup_stops ADD COLUMN event_name TEXT;

INSERT OR IGNORE INTO schema_migrations (name) VALUES ('0014-popups-event-name');
