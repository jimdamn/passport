-- Prize review needs a reason, the same way Volunteer Shifts already has
-- steward_note - "Awaiting review" was indistinguishable from "rejected"
-- with no explanation ever shown to the merchant who submitted it.
-- Apply: wrangler d1 execute krowdkraft-passport --local --file=migrations/2026-07-27-prize-review-reason.sql
--        wrangler d1 execute krowdkraft-passport --remote --file=migrations/2026-07-27-prize-review-reason.sql

ALTER TABLE passport_prizes ADD COLUMN steward_note TEXT;

INSERT OR IGNORE INTO schema_migrations (name) VALUES ('2026-07-27-prize-review-reason');
