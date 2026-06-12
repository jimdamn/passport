-- Migration 2026-06-12: track welcome-bonus delivery per user
-- Passport's signup flow was missing the welcome-credit award entirely.
-- The flag lets login self-heal: any user with welcome_credited = 0 gets
-- the award attempted on next login (KKCredits dedupes by ref, so users
-- already credited by the Exchange are marked done without a double award).

ALTER TABLE users ADD COLUMN welcome_credited INTEGER NOT NULL DEFAULT 0;
