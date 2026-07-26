-- 2026-07-26-social-splash.sql
-- Social Splash: private guest-content pipeline. A member who scanned a
-- participating business's plaque in the last 24h can submit one photo or
-- video per business per day to that business's private inbox. Content is
-- NEVER displayed anywhere on the platform - the business licenses it for
-- their own marketing (SOCIAL-SPLASH-BUILD-PLAN.md Part C is the full spec;
-- this file matches it verbatim).
-- Apply: wrangler d1 execute krowdkraft-passport --local --file=migrations/2026-07-26-social-splash.sql
--        wrangler d1 execute krowdkraft-passport --remote --file=migrations/2026-07-26-social-splash.sql

CREATE TABLE IF NOT EXISTS splash_settings (
  tenant_id    TEXT NOT NULL REFERENCES tenants(id),
  business_id  TEXT NOT NULL,            -- KKAuth business id (matches passport_plaques.merchant_id)
  opt_in       INTEGER NOT NULL DEFAULT 0,
  blurb        TEXT,                     -- merchant's invitation line, <= 200 chars
  updated_at   INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (tenant_id, business_id)
);

CREATE TABLE IF NOT EXISTS splash_submissions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id     TEXT NOT NULL REFERENCES tenants(id),
  kkauth_uid    INTEGER NOT NULL,        -- guest (JWT sub)
  business_id   TEXT NOT NULL,
  business_name TEXT NOT NULL,           -- denormalized for guest display (from passport_plaques.name at submit time)
  media_type    TEXT NOT NULL CHECK (media_type IN ('image','video')),
  image_key     TEXT,                    -- image-api private optimized key
  image_original_key TEXT,               -- image-api private retained original
  stream_uid    TEXT,                    -- Cloudflare Stream video UID (Increment 5)
  duration_seconds INTEGER,
  caption       TEXT,
  scan_ref      TEXT NOT NULL,           -- provenance: passport_scans.id of the qualifying scan
  created_day   TEXT NOT NULL,           -- YYYY-MM-DD America/New_York, for the daily cap
  status        TEXT NOT NULL DEFAULT 'submitted'
                CHECK (status IN ('submitted','held','licensed','declined','removed')),
  held_at       INTEGER,
  hold_expires_at INTEGER,
  licensed_at   INTEGER,
  declined_at   INTEGER,
  destroy_after INTEGER,                 -- set when declined/removed
  original_unlocked INTEGER NOT NULL DEFAULT 0,  -- $1.99 paid (Increment 6, set via kk-business webhook bridge)
  admin_removed_reason TEXT,
  admin_removed_by TEXT,
  created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (tenant_id, kkauth_uid, business_id, created_day)
);
CREATE INDEX IF NOT EXISTS idx_splash_biz ON splash_submissions(tenant_id, business_id, status);
CREATE INDEX IF NOT EXISTS idx_splash_mine ON splash_submissions(tenant_id, kkauth_uid, created_at DESC);

CREATE TABLE IF NOT EXISTS splash_offers (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id     TEXT NOT NULL REFERENCES tenants(id),
  submission_id INTEGER NOT NULL REFERENCES splash_submissions(id),
  business_id   TEXT NOT NULL,
  merchant_uid  INTEGER NOT NULL,        -- owner uid that made the offer
  consideration_type TEXT NOT NULL CHECK (consideration_type IN ('credits','gift_certificate')),
  credits_amount INTEGER,                -- required iff credits
  cert_value_cents INTEGER,              -- required iff gift_certificate
  cert_description TEXT,                 -- e.g. "Dinner for two, up to $50"
  status        TEXT NOT NULL DEFAULT 'open'
                CHECK (status IN ('open','agreed','passed','withdrawn','expired')),
  expires_at    INTEGER NOT NULL,
  agreed_at     INTEGER,
  created_at    INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_splash_offer_open
  ON splash_offers(submission_id) WHERE status = 'open';

-- Platform-issued gift certificates. Never expire. Never deleted.
CREATE TABLE IF NOT EXISTS splash_certificates (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id     TEXT NOT NULL REFERENCES tenants(id),
  offer_id      INTEGER NOT NULL UNIQUE REFERENCES splash_offers(id),
  business_id   TEXT NOT NULL,
  business_name TEXT NOT NULL,
  kkauth_uid    INTEGER NOT NULL,        -- holder (the guest)
  value_cents   INTEGER NOT NULL,
  description   TEXT NOT NULL,
  token_hash    TEXT UNIQUE,             -- LL- code, sha256 hash only (deals.ts/redeem.ts pattern)
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','redeemed')),
  redeemed_at   INTEGER,
  created_at    INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_splash_cert_holder ON splash_certificates(tenant_id, kkauth_uid);

-- Owner-visible record after destruction (90-day display, then prunable).
CREATE TABLE IF NOT EXISTS splash_tombstones (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id     TEXT NOT NULL REFERENCES tenants(id),
  kkauth_uid    INTEGER NOT NULL,
  business_name TEXT NOT NULL,
  final_status  TEXT NOT NULL,           -- 'declined' | 'removed' | 'withdrawn'
  destroyed_at  INTEGER NOT NULL
);

INSERT OR IGNORE INTO schema_migrations (name) VALUES ('2026-07-26-social-splash');
