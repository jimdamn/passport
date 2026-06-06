-- ============================================================
-- KrowdKraft Passport  --  D1 Schema v1.1
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
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  kkauth_uid       INTEGER NOT NULL,
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
  UNIQUE (kkauth_uid, tenant_id),
  UNIQUE (email, tenant_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_tenants_hostname   ON tenants(hostname);
CREATE INDEX IF NOT EXISTS idx_users_tenant_email ON users(tenant_id, email);
CREATE INDEX IF NOT EXISTS idx_users_kkauth_uid   ON users(kkauth_uid);

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
  user_id     INTEGER REFERENCES users(kkauth_uid),
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

-- ─────────────────────────────────────────────────────────────────────────────
-- MIGRATION PATTERN FOR LOCAL AND REMOTE DATA PRESERVATION
-- (Run these SQL commands sequentially to transition schemas without dropping databases)
--
-- 1. Migrate users table structure and copy data:
--    ALTER TABLE users RENAME TO users_old;
--    [Create users table as defined above]
--    INSERT INTO users (kkauth_uid, tenant_id, bd_uid, email, display_name, avatar_url, bio, location, is_active, bd_member_since, created_at, updated_at)
--    SELECT CAST(id AS INTEGER), tenant_id, bd_uid, email, display_name, avatar_url, bio, location, is_active, bd_member_since, created_at, updated_at FROM users_old;
--    DROP TABLE users_old;
--    CREATE INDEX IF NOT EXISTS idx_users_tenant_email ON users(tenant_id, email);
--    CREATE INDEX IF NOT EXISTS idx_users_kkauth_uid ON users(kkauth_uid);
--
-- 2. Migrate passport_scans table structure and copy data:
--    ALTER TABLE passport_scans RENAME TO scans_old;
--    [Create passport_scans table as defined above]
--    INSERT INTO passport_scans (id, plaque_id, user_id, guest_ip, credits_won, created_at)
--    SELECT id, plaque_id, CAST(user_id AS INTEGER), guest_ip, credits_won, created_at FROM scans_old;
--    DROP TABLE scans_old;
--    CREATE INDEX IF NOT EXISTS idx_scans_cooldown ON passport_scans(user_id, plaque_id, created_at);
-- ─────────────────────────────────────────────────────────────────────────────
