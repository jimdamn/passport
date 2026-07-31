-- Follow-up to 2026-07-31-economy-registry.sql. The registry's job is the
-- complete earning surface, and retired/zero-value entries are already
-- included on that principle (q_reliable_neighbor, six zero-credit actions).
-- exchange_five_star_rating was missed in the first pass; this adds it.
-- Apply: npx wrangler d1 execute krowdkraft-passport --remote --file=migrations/2026-07-31-economy-registry-five-star.sql

INSERT OR IGNORE INTO economy_values
  (id, tenant_id, group_key, label, clue, rate_note, source_kind, source_ref, baseline, sort_order) VALUES
('kkgame.action.exchange_five_star_rating', NULL, 'actions', 'Five-star rating received',
 'Retired. The Exchange replaced numeric star ratings with Verified Endorsements, which carry no score.', 'Inactive', 'kkgame_action', 'exchange_five_star_rating', 0, 160);

INSERT OR IGNORE INTO schema_migrations (name) VALUES ('2026-07-31-economy-registry-five-star');
