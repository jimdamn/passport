-- 0020: bring the passport prize matrix onto the economy baseline.
--
-- The 2026-07-30 re-denomination (CREDIT-ECONOMY-EVALUATION.md §7) cut every
-- kkgame action, quest, treasure-hunt tier and KrowdKwest payout by roughly 10x.
-- `passport_prizes` was not in that table and was never touched, so the scan
-- prize matrix stayed at the old scale while the wallet moved to the new one.
--
-- That mattered more than a stale number, because the two are separate systems:
-- ScanPortal.tsx renders `+{prize.value} KrowdKredits` from THIS table, while
-- the member's wallet is credited by recordGameAction('passport_scan') in
-- kkgame. rolledPrize.value is written to passport_scans.credits_won and shown
-- to the member, but is never sent to KKCredits. So the scan card was promising
-- 25 and paying 5, and a jackpot roll would have promised up to 1000.
--
-- Anchor (unchanged): a typical deal costs 25; ordinary monthly participation
-- earns 50 to 70. Against that, one scan is about a fifth of a deal, and the top
-- jackpot is four deals - a real windfall that is still legible next to what a
-- member actually spends credits on.
--
--   kredits_base      25 ->   5   (matches passport_scan: 5 base / 10 first-ever)
--   kredits_jackpot 1000 -> 100
--   kredits_jackpot  500 ->  50
--   kredits_jackpot  100 ->  10
--   kredits_jackpot   50 ->   5
--   kredits_jackpot   25 -> retired (is_active = 0)
--
-- The 25 tier is retired rather than repriced: a 10x cut puts it at 2, below the
-- guaranteed floor, so it would have been a "jackpot" worth less than the prize
-- every scan already wins. The 50 tier lands exactly on the floor at 5 and is
-- kept only because it is the bottom rung of a ladder that still climbs.
--
-- STILL OPEN AFTER THIS MIGRATION: jackpot values are displayed but never paid.
-- This migration makes the promise smaller and the scale coherent; it does NOT
-- close the gap between what a jackpot roll shows and what the wallet receives.
-- Only the kredits_base floor now matches its payout.
--
-- Apply: wrangler d1 execute krowdkraft-passport --local  --file=migrations/0020-prize-matrix-redenomination.sql
--        wrangler d1 execute krowdkraft-passport --remote --file=migrations/0020-prize-matrix-redenomination.sql

INSERT OR IGNORE INTO schema_migrations (name) VALUES ('0020-prize-matrix-redenomination');

-- ONE statement, deliberately. Sequential UPDATEs would cascade: setting
-- 1000 -> 100 and then 100 -> 10 would catch the row just rewritten and land it
-- at 10 instead of 100. A single CASE evaluates every row against its ORIGINAL
-- value, so each tier moves exactly once.
UPDATE passport_prizes
   SET value = CASE
         WHEN prize_type = 'kredits_base'    AND value =   25 THEN   5
         WHEN prize_type = 'kredits_jackpot' AND value = 1000 THEN 100
         WHEN prize_type = 'kredits_jackpot' AND value =  500 THEN  50
         WHEN prize_type = 'kredits_jackpot' AND value =  100 THEN  10
         WHEN prize_type = 'kredits_jackpot' AND value =   50 THEN   5
         ELSE value
       END,
       is_active = CASE
         WHEN prize_type = 'kredits_jackpot' AND value = 25 THEN 0
         ELSE is_active
       END
 WHERE prize_type IN ('kredits_base', 'kredits_jackpot');

-- Names carry the OLD amounts ("1000 KrowdKredits"), and ScanPortal renders the
-- name directly above the value - so an un-rewritten name would have the card
-- contradicting itself. Runs after the values are final.
UPDATE passport_prizes
   SET name = CASE WHEN is_active = 1 THEN value || ' KrowdKredits'
                   ELSE 'Retired jackpot tier' END
 WHERE prize_type = 'kredits_jackpot';
