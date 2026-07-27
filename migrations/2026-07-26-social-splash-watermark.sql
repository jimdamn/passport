-- Social Splash: pre-license photo watermark (SOCIAL-SPLASH-WATERMARK-DESIGN.md).
-- Additive only - new column, no data migration, no backfill (existing rows
-- simply have NULL here and serve the clean file to everyone, unchanged
-- behavior from before this feature).

ALTER TABLE splash_submissions ADD COLUMN image_watermarked_key TEXT;
