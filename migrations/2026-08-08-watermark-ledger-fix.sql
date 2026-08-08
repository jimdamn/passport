-- Catch-up migration (Category Thesis Remediation item 9 / G0-C).
-- 2026-07-26-social-splash-watermark.sql added splash_submissions.image_watermarked_key
-- but never recorded itself in schema_migrations, unlike every sibling migration.
-- That original file is left untouched (already applied in production); this
-- adds the missing ledger row instead of rewriting migration history.
INSERT OR IGNORE INTO schema_migrations (name) VALUES ('2026-07-26-social-splash-watermark');
