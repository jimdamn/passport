-- 0015-home-safe.sql
-- Home Safe: lost-and-found pet posts. Fifth board on the Fresh Today
-- primitive. Diff vs donors: ONE table, RESOLUTION-based clock (no schedule -
-- visible 30 days per create/renewal, renew-IN-PLACE so circulating share
-- URLs never die), pin = last-seen best guess, contact (phone and/or email,
-- one required) MASKED by default and released only via a logged, signed-in
-- reveal (pet_contact_reveals - posters are private people, not operators),
-- two first-class types (lost/found), and the Home safe terminal state with
-- a 3-day public glow. PERMANENT rule: zero
-- credits/game/monetization surface on this board, ever (decision log).
-- Same admin hide-with-reason, soft delete, lazy retirement
-- (ARCHITECTURE.md §13.10).
-- Apply: wrangler d1 execute krowdkraft-passport --local --file=migrations/0015-home-safe.sql
--        wrangler d1 execute krowdkraft-passport --remote --file=migrations/0015-home-safe.sql

CREATE TABLE IF NOT EXISTS pet_posts (
  id                  TEXT PRIMARY KEY,
  tenant_id           TEXT NOT NULL REFERENCES tenants(id),
  kkauth_uid          INTEGER NOT NULL,
  type                TEXT NOT NULL,               -- 'lost' | 'found'
  species             TEXT NOT NULL,
  pet_name            TEXT,
  body                TEXT NOT NULL,
  lat                 REAL NOT NULL,               -- last-seen / found-at guess
  lon                 REAL NOT NULL,
  location_hint       TEXT,
  seen_date           TEXT,                        -- 'YYYY-MM-DD' optional
  phone               TEXT,                        -- one of phone/email required
  email               TEXT,                        --   (enforced in handler)
  contact_public      INTEGER NOT NULL DEFAULT 0,  -- poster's opt-in to inline display
  photo_url           TEXT,
  nearest_city        TEXT,
  nearest_state       TEXT,
  active_until        INTEGER NOT NULL,            -- now + 30d at create/renew
  renewed_at          INTEGER,
  resolved_at         INTEGER,                     -- Home safe
  admin_hidden        INTEGER NOT NULL DEFAULT 0,
  admin_hidden_reason TEXT,
  admin_hidden_by     INTEGER,
  deleted_at          INTEGER,
  created_at          INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at          INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_pet_posts_owner  ON pet_posts(kkauth_uid, tenant_id);
CREATE INDEX IF NOT EXISTS idx_pet_posts_public ON pet_posts(tenant_id, admin_hidden, active_until, resolved_at);

CREATE TABLE IF NOT EXISTS pet_contact_reveals (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id   TEXT NOT NULL REFERENCES tenants(id),
  post_id     TEXT NOT NULL REFERENCES pet_posts(id),
  kkauth_uid  INTEGER NOT NULL,                    -- who asked
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_pet_reveals_once ON pet_contact_reveals(post_id, kkauth_uid);
CREATE INDEX IF NOT EXISTS idx_pet_reveals_user ON pet_contact_reveals(kkauth_uid, created_at);

INSERT OR IGNORE INTO schema_migrations (name) VALUES ('0015-home-safe');
