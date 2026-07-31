-- 0019: give every Social Splash offer its own escrow idempotency key.
--
-- THE DEFECT THIS CLOSES (live incident, 2026-07-26):
-- makeSplashOffer escrowed the merchant's credits with the idempotency key
-- ('splash_offer_escrow', <submission_id>), while every escrow-OUT leg
-- (withdraw / pass / expire refunds, and the license settlement) used
-- ('splash_offer_refund'|'splash_license', <offer_id>). A submission can host
-- more than one offer in sequence, so the SECOND credits offer on a submission
-- re-used the first offer's escrow-in key. KKCredits matched it as a replay,
-- returned 200 without moving any money, and passport recorded a funded offer
-- that had never been funded. Withdrawing it then ran a refund under a fresh
-- key, which executed for real - paying out of an escrow account that held
-- nothing. Offers 2 and 5 (both on submission 4) did exactly this and created
-- 50 credits that were never minted; ledger ids 60/61 in kkcredits-db.
--
-- The fix: one opaque escrow_ref per offer, generated BEFORE the escrow-in
-- transfer, used as the ref_id on every leg of that offer's money movement.
-- Because in and out now share a ref value, the two sides of escrow can also
-- finally be auto-matched for reconciliation - they never could before.
--
-- Apply: wrangler d1 execute krowdkraft-passport --local  --file=migrations/0019-splash-escrow-ref.sql
--        wrangler d1 execute krowdkraft-passport --remote --file=migrations/0019-splash-escrow-ref.sql

INSERT OR IGNORE INTO schema_migrations (name) VALUES ('0019-splash-escrow-ref');

ALTER TABLE splash_offers ADD COLUMN escrow_ref TEXT;

-- Backfill pre-existing offers with their own offer id as the ref. Those rows'
-- exit legs were already written to the KKCredits ledger keyed by offer id, so
-- this keeps the new code producing byte-identical idempotency keys for them -
-- a retried refund on a legacy offer still replays instead of double-paying.
-- New offers get an opaque nanoid, which can never collide with these.
UPDATE splash_offers SET escrow_ref = CAST(id AS TEXT) WHERE escrow_ref IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_splash_offer_escrow_ref
  ON splash_offers(escrow_ref);
