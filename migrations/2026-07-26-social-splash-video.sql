-- 2026-07-26-social-splash-video.sql
-- Social Splash Increment 5: video via Cloudflare Stream. A pending row
-- binds a Stream direct-upload session to the caller BEFORE the client
-- uploads bytes straight to Stream (bypassing this Worker entirely) - submit
-- checks this row exists for the caller before trusting a client-supplied
-- stream_uid, then consumes (deletes) it. splash_submissions.stream_uid and
-- .duration_seconds already exist (Increment 2's original migration was
-- forward-looking for this).
-- Apply: wrangler d1 execute krowdkraft-passport --local --file=migrations/2026-07-26-social-splash-video.sql
--        wrangler d1 execute krowdkraft-passport --remote --file=migrations/2026-07-26-social-splash-video.sql

CREATE TABLE IF NOT EXISTS splash_video_uploads (
  stream_uid  TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  kkauth_uid  INTEGER NOT NULL,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_splash_video_uploads_owner ON splash_video_uploads(tenant_id, kkauth_uid, created_at);

INSERT OR IGNORE INTO schema_migrations (name) VALUES ('2026-07-26-social-splash-video');
