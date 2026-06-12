-- Migration 2026-06-12: Kredit-Spend Deals Marketplace
-- New tables only — no changes to existing data.

CREATE TABLE IF NOT EXISTS passport_deals (
  id                   TEXT PRIMARY KEY,
  tenant_id            TEXT NOT NULL REFERENCES tenants(id),
  merchant_id          TEXT NOT NULL,
  merchant_name        TEXT,
  title                TEXT NOT NULL,
  details              TEXT,
  kredit_price         INTEGER NOT NULL CHECK (kredit_price >= 1),
  quantity_left        INTEGER NOT NULL DEFAULT -1,
  per_user_limit       INTEGER NOT NULL DEFAULT 1,
  claim_window_minutes INTEGER NOT NULL DEFAULT 20160,
  is_hot_deal          INTEGER NOT NULL DEFAULT 0,
  is_active            INTEGER NOT NULL DEFAULT 0,
  event_id             TEXT,
  starts_at            INTEGER,
  ends_at              INTEGER,
  created_at           INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_deals_tenant_active ON passport_deals(tenant_id, is_active);

CREATE TABLE IF NOT EXISTS passport_deal_claims (
  id           TEXT PRIMARY KEY,
  token_hash   TEXT UNIQUE NOT NULL,
  tenant_id    TEXT NOT NULL REFERENCES tenants(id),
  deal_id      TEXT NOT NULL REFERENCES passport_deals(id),
  user_id      INTEGER NOT NULL,
  kredits_paid INTEGER NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'claimed', 'refunded')),
  expires_at   INTEGER NOT NULL,
  created_at   INTEGER NOT NULL DEFAULT (unixepoch()),
  claimed_at   INTEGER,
  refunded_at  INTEGER
);
CREATE INDEX IF NOT EXISTS idx_deal_claims_sweep ON passport_deal_claims(status, expires_at);
CREATE INDEX IF NOT EXISTS idx_deal_claims_user  ON passport_deal_claims(user_id, deal_id, status);
CREATE INDEX IF NOT EXISTS idx_deal_claims_deal  ON passport_deal_claims(deal_id);
