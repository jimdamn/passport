-- 0005: platform-wide support inbox ("Talk to us"). One-way member-to-admin
-- channel ported from Las Vegas Edge (C:\LVE\src\routers\support.ts +
-- migrations 0001/0004). Unified across passport and kk-business via the
-- source_app column; kkauth_uid stores the KKAuth uid (passport's user.sub),
-- never a local users row id.
-- Apply: wrangler d1 execute krowdkraft-passport --local --file=migrations/0005-support-messages.sql
--        wrangler d1 execute krowdkraft-passport --remote --file=migrations/0005-support-messages.sql

INSERT OR IGNORE INTO schema_migrations (name) VALUES ('0005-support-messages');

CREATE TABLE support_messages (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id   TEXT NOT NULL,
  kkauth_uid  INTEGER,                -- NULL for logged-out submitters
  email       TEXT,                   -- required when kkauth_uid IS NULL
  source_app  TEXT NOT NULL DEFAULT 'passport',   -- 'passport' | 'kk-business'
  category    TEXT NOT NULL CHECK(category IN ('problem','question','idea','business')),
  body        TEXT NOT NULL,
  route       TEXT,
  user_agent  TEXT,
  status      TEXT NOT NULL CHECK(status IN ('new','seen','resolved')) DEFAULT 'new',
  admin_note  TEXT,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX idx_support_tenant_status ON support_messages(tenant_id, status);
CREATE INDEX idx_support_uid ON support_messages(kkauth_uid);
