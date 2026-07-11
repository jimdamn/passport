-- 0003: KrowdKwest mini-game plays table. Per KROWDKWEST-DEVELOPMENT-PLAN.md
-- Section 2. New table only.
-- Apply: wrangler d1 execute krowdkraft-passport --local --file=migrations/0003-kwest-minigames.sql
--        wrangler d1 execute krowdkraft-passport --remote --file=migrations/0003-kwest-minigames.sql

INSERT OR IGNORE INTO schema_migrations (name) VALUES ('0003-kwest-minigames');

CREATE TABLE IF NOT EXISTS kwest_minigame_plays (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  offer_id      TEXT NOT NULL UNIQUE,            -- nanoid; idempotency for play + award
  hunt_id       INTEGER NOT NULL,
  step_id       INTEGER NOT NULL,
  tenant_id     TEXT NOT NULL,
  player_key    TEXT NOT NULL,
  user_id       TEXT,
  game          TEXT NOT NULL CHECK (game IN ('chest_pick','compass_stop','scratch_off')),
  tease_variant INTEGER NOT NULL DEFAULT 0,      -- which tease line was shown
  status        TEXT NOT NULL DEFAULT 'offered' CHECK (status IN ('offered','played','expired')),
  input_json    TEXT,                            -- player's interaction (chest index, stop time, scratch)
  outcome_kredits INTEGER,                       -- server-decided; 0 = played, won nothing
  offered_at    INTEGER NOT NULL DEFAULT (unixepoch()),
  played_at     INTEGER,
  expires_at    INTEGER NOT NULL,                -- offered_at + 1800 (30 min) - play it or lose it
  is_test       INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_kwest_minigame_player ON kwest_minigame_plays (hunt_id, player_key);
