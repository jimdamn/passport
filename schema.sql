-- ============================================================
-- KrowdKraft Passport  --  D1 Schema v1.0
-- ============================================================
-- PRAGMA journal_mode = WAL;
-- PRAGMA foreign_keys = ON;

-- Tenants
CREATE TABLE IF NOT EXISTS tenants (
  id          TEXT PRIMARY KEY,
  hostname    TEXT UNIQUE NOT NULL,
  name        TEXT NOT NULL,
  region      TEXT,
  config      TEXT NOT NULL DEFAULT '{}',
  is_active   INTEGER NOT NULL DEFAULT 1,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Users
CREATE TABLE IF NOT EXISTS users (
  id               TEXT PRIMARY KEY,
  tenant_id        TEXT NOT NULL REFERENCES tenants(id),
  bd_uid           TEXT,
  email            TEXT NOT NULL,
  display_name     TEXT NOT NULL DEFAULT 'Member',
  avatar_url       TEXT,
  bio              TEXT,
  location         TEXT,
  is_active        INTEGER NOT NULL DEFAULT 1,
  merged_into      TEXT,
  bd_member_since  INTEGER,
  created_at       INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at       INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (tenant_id, email)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_tenants_hostname   ON tenants(hostname);
CREATE INDEX IF NOT EXISTS idx_users_tenant_email ON users(tenant_id, email);

-- ============================================================
-- PASSPORT PROJECT SPECIFIC TABLES
-- ============================================================

-- Scannable Plaque Locations (Physical Stations)
CREATE TABLE IF NOT EXISTS passport_plaques (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL REFERENCES tenants(id),
  merchant_id   TEXT,
  name          TEXT NOT NULL,
  location_name TEXT NOT NULL,
  lat           REAL NOT NULL,
  lon           REAL NOT NULL,
  category      TEXT NOT NULL CHECK (category IN ('dining', 'shopping', 'farmfood', 'recreation', 'attractions', 'lodging')),
  is_active     INTEGER NOT NULL DEFAULT 1,
  created_at    INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Configurable Prize Matrix per Plaque / Tenant
CREATE TABLE IF NOT EXISTS passport_prizes (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL REFERENCES tenants(id),
  name          TEXT NOT NULL,
  prize_type    TEXT NOT NULL CHECK (prize_type IN ('kredits_base', 'kredits_jackpot', 'merchant_coupon', 'merchant_gift', 'cash')),
  value         INTEGER NOT NULL DEFAULT 0,
  details       TEXT,
  probability   REAL NOT NULL,
  quantity_left INTEGER NOT NULL DEFAULT -1,
  is_active     INTEGER NOT NULL DEFAULT 1
);

-- Scan Record & Cooldown Ledger
CREATE TABLE IF NOT EXISTS passport_scans (
  id          TEXT PRIMARY KEY,
  plaque_id   TEXT NOT NULL REFERENCES passport_plaques(id),
  user_id     TEXT,
  guest_ip    TEXT,
  credits_won INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Deferred Claims System (Claim Tokens)
CREATE TABLE IF NOT EXISTS passport_claims (
  token_hash   TEXT PRIMARY KEY,
  tenant_id    TEXT NOT NULL REFERENCES tenants(id),
  plaque_id    TEXT NOT NULL REFERENCES passport_plaques(id),
  prize_id     TEXT NOT NULL REFERENCES passport_prizes(id),
  raw_code     TEXT NOT NULL,
  contact_info TEXT,
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'claimed', 'expired')),
  expires_at   INTEGER NOT NULL,
  created_at   INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Cooldown and coordinate lookup indexes
CREATE INDEX IF NOT EXISTS idx_scans_cooldown ON passport_scans(user_id, plaque_id, created_at);
CREATE INDEX IF NOT EXISTS idx_claims_lookup  ON passport_claims(token_hash, status);
CREATE INDEX IF NOT EXISTS idx_plaques_tenant ON passport_plaques(tenant_id, is_active);
