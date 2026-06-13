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
  welcome_credited INTEGER NOT NULL DEFAULT 0,
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
-- is_event = 1: a roving "event plaque" (e.g. QR on a t-shirt). Event plaques
-- skip the geofence check entirely and honor the optional start/end window.
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
  is_event      INTEGER NOT NULL DEFAULT 0,
  event_start   INTEGER,
  event_end     INTEGER,
  created_at    INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Configurable Prize Matrix per Plaque / Tenant
-- plaque_id NULL = available at every plaque in the tenant; set = scoped to one
-- plaque (e.g. an event pool). merchant_id NULL = house prize; set = funded by
-- that merchant. is_paced = 1: stock is released via hidden timed drops in
-- passport_prize_drops instead of the probability roll.
CREATE TABLE IF NOT EXISTS passport_prizes (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL REFERENCES tenants(id),
  name          TEXT NOT NULL,
  prize_type    TEXT NOT NULL CHECK (prize_type IN ('kredits_base', 'kredits_jackpot', 'merchant_coupon', 'merchant_gift', 'cash')),
  value         INTEGER NOT NULL DEFAULT 0,
  details       TEXT,
  probability   REAL NOT NULL,
  quantity_left INTEGER NOT NULL DEFAULT -1,
  is_active     INTEGER NOT NULL DEFAULT 1,
  plaque_id     TEXT,
  merchant_id   TEXT,
  is_paced      INTEGER NOT NULL DEFAULT 0
);

-- Timed prize drops (event pacing)
-- Each row is one unit of a paced prize with a hidden random release time
-- inside the event window. The first eligible scan at/after drop_at wins it —
-- this spreads wins across the event and guarantees the pool empties.
CREATE TABLE IF NOT EXISTS passport_prize_drops (
  id          TEXT PRIMARY KEY,
  prize_id    TEXT NOT NULL REFERENCES passport_prizes(id),
  drop_at     INTEGER NOT NULL,
  won_scan_id TEXT,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_drops_pending ON passport_prize_drops(prize_id, won_scan_id, drop_at);

-- Scan Record & Cooldown Ledger
-- user_id holds a kkauth_uid but is deliberately NOT a foreign key: users
-- enforces uniqueness on (kkauth_uid, tenant_id), and SQLite rejects every
-- write to a child table whose FK targets a non-uniquely-indexed column
-- ("foreign key mismatch").
CREATE TABLE IF NOT EXISTS passport_scans (
  id          TEXT PRIMARY KEY,
  plaque_id   TEXT NOT NULL REFERENCES passport_plaques(id),
  user_id     INTEGER,
  guest_ip    TEXT,
  credits_won INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_scans_guest_cooldown ON passport_scans(guest_ip, plaque_id, created_at);

-- Deferred Claims System (Claim Tokens)
-- Only the SHA-256 hash of the claim code is stored; the raw code is shown
-- once to the guest at scan time and never persisted.
CREATE TABLE IF NOT EXISTS passport_claims (
  token_hash   TEXT PRIMARY KEY,
  tenant_id    TEXT NOT NULL REFERENCES tenants(id),
  plaque_id    TEXT NOT NULL REFERENCES passport_plaques(id),
  prize_id     TEXT NOT NULL REFERENCES passport_prizes(id),
  scan_id      TEXT,
  contact_info TEXT,
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'claimed', 'expired')),
  expires_at   INTEGER NOT NULL,
  created_at   INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Cooldown and coordinate lookup indexes
CREATE INDEX IF NOT EXISTS idx_scans_cooldown ON passport_scans(user_id, plaque_id, created_at);
CREATE INDEX IF NOT EXISTS idx_claims_lookup  ON passport_claims(token_hash, status);
CREATE INDEX IF NOT EXISTS idx_plaques_tenant ON passport_plaques(tenant_id, is_active);

-- ============================================================
-- KREDIT-SPEND DEALS MARKETPLACE (June 2026)
-- ============================================================

-- Merchant deals purchasable with KrowdKredits.
-- is_active = 0: pending admin review (merchants can never self-activate).
-- quantity_left = -1: unlimited. A "hot deal" is just a deal with a short
-- claim_window_minutes plus the is_hot_deal flag for urgency UI treatment.
-- event_id is a dormant hook for the future events micro-app — a deal can be
-- attached to an event posting without any schema change later.
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

-- Purchased deal claims. Hash-only codes (same rule as passport_claims): the
-- raw code is shown to the buyer and never persisted; the owner can rotate it
-- to display a fresh code any time while pending.
-- status 'refunded' = expired unredeemed → kredits returned, slot back in pool.
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
-- 2. If the database was created before raw_code was removed from passport_claims
--    (claim codes must never be stored in plaintext), run:
--    ALTER TABLE passport_claims DROP COLUMN raw_code;
--
-- 2b. If the database predates events / scoped prizes (June 2026), run:
--    ALTER TABLE passport_plaques ADD COLUMN is_event INTEGER NOT NULL DEFAULT 0;
--    ALTER TABLE passport_plaques ADD COLUMN event_start INTEGER;
--    ALTER TABLE passport_plaques ADD COLUMN event_end INTEGER;
--    ALTER TABLE passport_prizes ADD COLUMN plaque_id TEXT;
--    ALTER TABLE passport_prizes ADD COLUMN merchant_id TEXT;
--    ALTER TABLE passport_prizes ADD COLUMN is_paced INTEGER NOT NULL DEFAULT 0;
--    [Create passport_prize_drops table + idx_drops_pending as defined above]
--
-- 2c. If the database predates claim deposits (June 2026), run:
--    ALTER TABLE passport_claims ADD COLUMN scan_id TEXT;
--
-- 2d. If the database predates the deals marketplace (June 2026), run:
--    [Create passport_deals + passport_deal_claims tables and their indexes
--     exactly as defined above — both are new tables, no data migration needed]
--
-- 3. Migrate passport_scans table structure and copy data:
--    ALTER TABLE passport_scans RENAME TO scans_old;
--    [Create passport_scans table as defined above]
--    INSERT INTO passport_scans (id, plaque_id, user_id, guest_ip, credits_won, created_at)
--    SELECT id, plaque_id, CAST(user_id AS INTEGER), guest_ip, credits_won, created_at FROM scans_old;
--    DROP TABLE scans_old;
--    CREATE INDEX IF NOT EXISTS idx_scans_cooldown ON passport_scans(user_id, plaque_id, created_at);
-- ─────────────────────────────────────────────────────────────────────────────
