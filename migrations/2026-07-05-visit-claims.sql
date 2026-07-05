-- P-1 (kk-business EXPANSION-SPEC §8.3): visit-claim gate. One claim per
-- POS ticket EVER, across ALL users - first claimant wins. KKGame's own
-- idempotency is per (user, ref), which stops retries but not a forwarded
-- receipt link claimed by two different people; this PRIMARY KEY stops that.
CREATE TABLE IF NOT EXISTS visit_claims (
  ticket_id  TEXT PRIMARY KEY,               -- pos_tickets.id (Business Hub)
  tenant_id  TEXT NOT NULL,
  user_id    INTEGER NOT NULL,               -- kkauth uid of the first claimant
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_visit_claims_user ON visit_claims(user_id, created_at DESC);
