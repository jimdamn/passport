-- 0002: KrowdKwest core tables (hunts, steps, progress, reveals, finishes,
-- claims, rules acknowledgements, guest keys). Per KROWDKWEST-DEVELOPMENT-PLAN.md
-- Section 2. New tables only — no existing table touched.
-- Apply: wrangler d1 execute krowdkraft-passport --local --file=migrations/0002-kwest-core.sql
--        wrangler d1 execute krowdkraft-passport --remote --file=migrations/0002-kwest-core.sql

INSERT OR IGNORE INTO schema_migrations (name) VALUES ('0002-kwest-core');

CREATE TABLE IF NOT EXISTS kwest_hunts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id     TEXT NOT NULL,
  slug          TEXT NOT NULL,
  name          TEXT NOT NULL,
  narrative     TEXT NOT NULL DEFAULT '',        -- intro story/theme copy
  scope         TEXT NOT NULL CHECK (scope IN ('location_specific','region_wide')),
  location_label TEXT,                           -- e.g. 'Union City, MI'; NULL when region_wide
  status        TEXT NOT NULL DEFAULT 'draft'
                CHECK (status IN ('draft','scheduled','live','paused','ended','archived')),
  starts_at     INTEGER NOT NULL,                -- unixepoch
  ends_at       INTEGER NOT NULL,                -- scheduled end (required - drives official end)
  official_end_at INTEGER,                       -- set when rank-20 finish lands: min(finish+86400, ends_at)
  sponsor_name  TEXT NOT NULL DEFAULT 'Lake & Locals',
  sponsor_business_id INTEGER,                   -- editorial only; NO reputation FK, NO ranking effect
  grand_prize_kredits INTEGER NOT NULL DEFAULT 0,
  grand_prize_description TEXT NOT NULL,         -- '$100 cash' for hunt #1; arbitrary later
  grand_prize_fulfillment TEXT DEFAULT '',       -- internal note: how it gets handed over
  rank2_10_kredits  INTEGER NOT NULL DEFAULT 50, -- per-hunt config (Jim: default 50)
  rank11_20_kredits INTEGER NOT NULL DEFAULT 10, -- per-hunt config (Jim: nominal default)
  step_reward_default INTEGER NOT NULL DEFAULT 10,
  minigame_offer_bp INTEGER NOT NULL DEFAULT 1500, -- offer chance in basis points (15%); NEVER in copy
  minigame_max_award INTEGER NOT NULL DEFAULT 10,  -- per-play ceiling
  kk_budget_cap INTEGER NOT NULL DEFAULT 5000,   -- per-hunt emission ceiling (atomic guard)
  kk_spent      INTEGER NOT NULL DEFAULT 0,      -- atomically incremented before every award
  rules_version INTEGER NOT NULL DEFAULT 1,
  retro_published INTEGER NOT NULL DEFAULT 0,    -- flips 1 at official end; admin can flip back
  weather_paused  INTEGER NOT NULL DEFAULT 0,    -- advisory banner + reveal disabled while 1
  created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at    INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (tenant_id, slug)
);

CREATE TABLE IF NOT EXISTS kwest_steps (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  hunt_id       INTEGER NOT NULL REFERENCES kwest_hunts(id),
  tenant_id     TEXT NOT NULL,
  seq           INTEGER NOT NULL,                -- 1..N, strictly ordered, no max
  clues_json    TEXT NOT NULL,                   -- JSON array [{type, body, media_key?}]
                                                 -- type: riddle|story|photo|local_knowledge|business
  hint_body     TEXT,                            -- optional admin-authored deterministic hint
  hint_after_misses INTEGER NOT NULL DEFAULT 5,  -- surface hint after N misses (0 = never)
  target_lat    REAL NOT NULL,                   -- SECRET - never serialized to players
  target_lng    REAL NOT NULL,                   -- SECRET - never serialized to players
  radius_m      INTEGER NOT NULL DEFAULT 75,     -- generous by default (consumer GPS drifts 20-100m)
  step_reward   INTEGER,                         -- NULL -> hunt.step_reward_default
  minigame_enabled INTEGER NOT NULL DEFAULT 1,   -- composable block: this step may offer a game
  is_final      INTEGER NOT NULL DEFAULT 0,
  field_tested_at INTEGER,                       -- physical field-test record (gates go-live)
  field_tested_by TEXT,
  field_test_json TEXT,                          -- {accuracy_m_observed, fix_seconds, note, public_access:1, safe:1}
  created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (hunt_id, seq)
);

CREATE TABLE IF NOT EXISTS kwest_progress (
  hunt_id       INTEGER NOT NULL REFERENCES kwest_hunts(id),
  player_key    TEXT NOT NULL,                   -- 'u:<kkauth_uid>' or 'g:<guest_key_id>'
  tenant_id     TEXT NOT NULL,
  user_id       TEXT,                            -- kkauth_uid once known
  current_seq   INTEGER NOT NULL DEFAULT 1,
  started_at    INTEGER NOT NULL DEFAULT (unixepoch()),
  finished_at   INTEGER,
  is_test       INTEGER NOT NULL DEFAULT 0,      -- admin test runs; excluded from everything real
  confidence    REAL NOT NULL DEFAULT 1.0,       -- self-healing soft-throttle factor
  updated_at    INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (hunt_id, player_key)
);

CREATE TABLE IF NOT EXISTS kwest_reveals (       -- append-only attempt log = our observability
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  hunt_id       INTEGER NOT NULL,
  step_id       INTEGER NOT NULL,
  tenant_id     TEXT NOT NULL,
  player_key    TEXT NOT NULL,
  result        TEXT NOT NULL CHECK (result IN ('hit','near','miss')),
  device_lat    REAL NOT NULL,
  device_lng    REAL NOT NULL,
  accuracy_m    REAL,                            -- Geolocation API accuracy (diagnostics gold)
  distance_m    REAL NOT NULL,                   -- server-computed; ADMIN-ONLY, never sent to players
  edge_lat      REAL,                            -- cf.latitude soft signal (weak on rural mobile)
  edge_lng      REAL,
  is_test       INTEGER NOT NULL DEFAULT 0,
  sim           INTEGER NOT NULL DEFAULT 0,      -- 1 when coordinates were admin-simulated
  created_at    INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_kwest_reveals_player ON kwest_reveals (hunt_id, player_key, created_at);
CREATE INDEX IF NOT EXISTS idx_kwest_reveals_step   ON kwest_reveals (hunt_id, step_id, created_at);

CREATE TABLE IF NOT EXISTS kwest_finishes (
  hunt_id       INTEGER NOT NULL,
  user_id       TEXT NOT NULL,                   -- finishes REQUIRE a signed-in account
  tenant_id     TEXT NOT NULL,
  finish_rank   INTEGER NOT NULL,
  finished_at   INTEGER NOT NULL,                -- server clock, never client time
  prize_kind    TEXT NOT NULL CHECK (prize_kind IN ('grand','kk_rank','kk_consolation','none')),
  prize_kredits INTEGER NOT NULL DEFAULT 0,      -- snapshot of the tier amount at finish time
  display_choice TEXT NOT NULL DEFAULT 'anonymous' CHECK (display_choice IN ('anonymous','real')),
  display_name_snapshot TEXT NOT NULL,           -- frozen at official end (re-snapshotted on choice edits)
  display_locked INTEGER NOT NULL DEFAULT 0,     -- 1 at official end - never changes after
  is_test       INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (hunt_id, user_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_kwest_finish_rank
  ON kwest_finishes (hunt_id, finish_rank) WHERE is_test = 0;   -- atomic-rank backstop

CREATE TABLE IF NOT EXISTS kwest_claims (        -- grand-prize photo-ID review
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  hunt_id       INTEGER NOT NULL,
  user_id       TEXT NOT NULL,
  tenant_id     TEXT NOT NULL,
  finish_rank   INTEGER NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','contacted','id_verified','paid','rejected','forfeited')),
  claimant_name TEXT,
  contact_json  TEXT,
  id_check_note TEXT,                            -- 'ID verified, DOB confirms 18+' - NEVER an image
  reviewer      TEXT,
  reviewed_at   INTEGER,
  created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (hunt_id, user_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_kwest_one_winner
  ON kwest_claims (hunt_id) WHERE status IN ('id_verified','paid');  -- one winner, DB-enforced

CREATE TABLE IF NOT EXISTS kwest_acknowledgements (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  hunt_id       INTEGER NOT NULL,
  tenant_id     TEXT NOT NULL,
  player_key    TEXT NOT NULL,
  rules_version INTEGER NOT NULL,
  accepted_at   INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (hunt_id, player_key, rules_version)
);

CREATE TABLE IF NOT EXISTS kwest_guest_keys (
  id            TEXT PRIMARY KEY,                -- nanoid(16)
  tenant_id     TEXT NOT NULL,
  created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
  attached_user_id TEXT,                         -- set on OTP attach; key invalid afterward
  attached_at   INTEGER
);
