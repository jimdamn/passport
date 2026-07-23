-- 0008-fresh-today-season-corrections.sql
-- Fresh Today harvest calendar: correct several date ranges against real
-- sourced data (MSU Extension, Purdue University / Indiana State Dept. of
-- Agriculture, Ohio State University Extension) instead of the unsourced
-- approximations 0006 originally seeded, and add six more farm-stand-relevant
-- items (raspberries, rhubarb, garlic, green beans, zucchini & summer squash,
-- cucumbers) that were missing entirely.
-- Apply: wrangler d1 execute krowdkraft-passport --local --file=migrations/0008-fresh-today-season-corrections.sql
--        wrangler d1 execute krowdkraft-passport --remote --file=migrations/0008-fresh-today-season-corrections.sql

INSERT OR IGNORE INTO schema_migrations (name) VALUES ('0008-fresh-today-season-corrections');

-- Corrections (sourced start dates were earlier than the original approximation)
UPDATE fresh_seasons SET start_month = 4,  start_day = 15 WHERE tenant_id = 'lake-locals' AND item_name = 'Asparagus';
UPDATE fresh_seasons SET start_month = 5,  start_day = 25 WHERE tenant_id = 'lake-locals' AND item_name = 'Strawberries';
UPDATE fresh_seasons SET start_month = 6,  start_day = 15 WHERE tenant_id = 'lake-locals' AND item_name = 'Sweet cherries';
UPDATE fresh_seasons SET start_month = 7,  start_day = 15 WHERE tenant_id = 'lake-locals' AND item_name = 'Blueberries';
UPDATE fresh_seasons SET start_month = 7,  start_day = 20, end_month = 10, end_day = 5  WHERE tenant_id = 'lake-locals' AND item_name = 'Melons';
UPDATE fresh_seasons SET start_month = 8,  start_day = 15 WHERE tenant_id = 'lake-locals' AND item_name = 'Apples';
UPDATE fresh_seasons SET start_month = 9,  start_day = 1  WHERE tenant_id = 'lake-locals' AND item_name = 'Fresh cider';

-- New items, continuing sort_order from 0006's 1-15
INSERT INTO fresh_seasons (tenant_id, item_name, start_month, start_day, end_month, end_day, sort_order) VALUES
  ('lake-locals', 'Rhubarb',                4, 20,  6, 20, 16),
  ('lake-locals', 'Garlic',                 6, 25,  7, 15, 17),
  ('lake-locals', 'Raspberries',             7,  1,  9, 15, 18),
  ('lake-locals', 'Zucchini & summer squash',6, 15, 10, 1,  19),
  ('lake-locals', 'Cucumbers',               7,  1,  9, 15, 20),
  ('lake-locals', 'Green beans',             7,  1, 10, 1,  21);
