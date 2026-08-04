-- 0021: bring the passport scan prize matrix onto the 2026-07-30 economy scale.
--
-- WHY THIS EXISTS: a scan rolls a prize from passport_prizes and shows its
-- value on the reward card, but the wallet is credited by a completely
-- separate call - recordGameAction('passport_scan') - which pays a flat 5.
-- The 2026-07-30 re-denomination cut kkgame actions, quests, hunt tiers and
-- KrowdKwest, but passport_prizes was not in the CREDIT-ECONOMY-EVALUATION.md
-- section 7 table and was never touched. So the floor advertised 25 and paid
-- 5, and a jackpot advertised up to 1000 - more than the entire money supply -
-- and also paid 5. This migration lands the honest values; the handler change
-- that shipped alongside it makes the jackpot actually pay.
--
-- Supersedes migrations/0020-prize-matrix-redenomination.sql, which was
-- committed in 121c5c9 but never applied to any database and carried the wrong
-- ladder. It was deleted rather than run-and-corrected.
--
-- SHAPE: one UPDATE per table region, each column a CASE keyed on the ORIGINAL
-- value. In SQLite every SET right-hand side reads the pre-update row, so all
-- four columns remap in a single pass with no cascade. Sequential per-tier
-- UPDATEs would be a bug: 1000 -> 500 followed by 500 -> 250 lands the top
-- tier at 250. Matching is by prize_type + original value, never by id, so
-- this runs identically against local, seed and production databases.
--
-- RE-RUN GUARD - do not remove. Both UPDATEs are gated on the ledger row not
-- already existing, and the ledger row is written LAST. Without this the
-- migration is DESTRUCTIVE on a second run, because the ladder's targets
-- overlap its own sources: after pass one the Legendary tier sits at value
-- 500, which is also the source value that maps to 250. A second pass
-- therefore collapses Legendary into a duplicate Grand Jackpot and the top
-- prize disappears entirely. Reproduced against a local copy of the real
-- production rows on 2026-08-04 before this guard was added - the second run
-- left two Grand Jackpots and no Legendary.
--
-- Apply: wrangler d1 execute krowdkraft-passport --local  --file=migrations/0021-prize-matrix-redenomination.sql
--        wrangler d1 execute krowdkraft-passport --remote --file=migrations/0021-prize-matrix-redenomination.sql

-- Floor: 25 -> 5, matching kkgame's passport_scan base award.
UPDATE passport_prizes
   SET value = 5, name = 'KrowdKredits'
 WHERE prize_type = 'kredits_base' AND value = 25
   AND NOT EXISTS (SELECT 1 FROM schema_migrations WHERE name = '0021-prize-matrix-redenomination');

-- Jackpot ladder. Value, stock, probability and name all keyed on the ORIGINAL
-- value so each row is remapped exactly once.
UPDATE passport_prizes
   SET value = CASE value
                 WHEN   25 THEN  25
                 WHEN   50 THEN  50
                 WHEN  100 THEN 100
                 WHEN  500 THEN 250
                 WHEN 1000 THEN 500
                 ELSE value END,
       quantity_left = CASE value
                 WHEN   25 THEN 15
                 WHEN   50 THEN 10
                 WHEN  100 THEN  6
                 WHEN  500 THEN  3
                 WHEN 1000 THEN  1
                 ELSE quantity_left END,
       probability = CASE value
                 WHEN   25 THEN 0.030
                 WHEN   50 THEN 0.020
                 WHEN  100 THEN 0.012
                 WHEN  500 THEN 0.005
                 WHEN 1000 THEN 0.002
                 ELSE probability END,
       name = CASE value
                 WHEN   25 THEN 'Free Deal'
                 WHEN   50 THEN 'Big Win'
                 WHEN  100 THEN 'Jackpot'
                 WHEN  500 THEN 'Grand Jackpot'
                 WHEN 1000 THEN 'Legendary'
                 ELSE name END,
       is_active = 1
 WHERE prize_type = 'kredits_jackpot'
   AND NOT EXISTS (SELECT 1 FROM schema_migrations WHERE name = '0021-prize-matrix-redenomination');

-- Written LAST, so the guard above is still false while the UPDATEs run.
INSERT OR IGNORE INTO schema_migrations (name) VALUES ('0021-prize-matrix-redenomination');
