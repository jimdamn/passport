-- Economy registry. The registry holds the BASELINE and the description for
-- each credit-earning value plus a pointer to its real home. It never becomes
-- the value: live values stay in their own tables and the engines are
-- untouched. See docs/superpowers/specs/2026-07-31-economy-admin-design.md
-- Apply: npx wrangler d1 execute krowdkraft-passport --remote --file=migrations/2026-07-31-economy-registry.sql

CREATE TABLE IF NOT EXISTS economy_values (
  id          TEXT    PRIMARY KEY,
  tenant_id   TEXT    REFERENCES tenants(id),   -- NULL = network-wide
  group_key   TEXT    NOT NULL
                CHECK (group_key IN ('actions','quests','kwest','hunt','onboarding')),
  label       TEXT    NOT NULL,
  clue        TEXT    NOT NULL,
  rate_note   TEXT,
  source_kind TEXT    NOT NULL
                CHECK (source_kind IN ('kkgame_action','kkgame_quest','kwest_defaults',
                                       'passport_tenant_config','exchange_tenant_config',
                                       'hunt_tiers')),
  source_ref  TEXT    NOT NULL,
  baseline    INTEGER NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  is_active   INTEGER NOT NULL DEFAULT 1,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at  INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Single row. The dial is GLOBAL: kkgame actions/quests are network-wide
-- (every live row has tenant_id NULL) and ARCHITECTURE.md:650 makes credits
-- universal, so a per-tenant dial would let one region rescale another.
CREATE TABLE IF NOT EXISTS economy_modifier (
  id         INTEGER PRIMARY KEY CHECK (id = 1),
  modifier   REAL    NOT NULL DEFAULT 1.0 CHECK (modifier >= 0 AND modifier <= 5),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_by INTEGER
);
INSERT OR IGNORE INTO economy_modifier (id, modifier) VALUES (1, 1.0);

CREATE TABLE IF NOT EXISTS economy_history (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  from_value  REAL    NOT NULL,
  to_value    REAL    NOT NULL,
  applied_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  applied_by  INTEGER,
  outcome     TEXT    NOT NULL CHECK (outcome IN ('applied','partial','failed')),
  result_json TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_economy_history_time ON economy_history(applied_at DESC);

-- ── Actions (15) ───────────────────────────────────────────────────────────
INSERT OR IGNORE INTO economy_values
  (id, tenant_id, group_key, label, clue, rate_note, source_kind, source_ref, baseline, sort_order) VALUES
('kkgame.action.bd_member_linked', NULL, 'actions', 'Link a Lake & Locals membership',
 'A member connects their existing Lake & Locals account.', 'Once ever', 'kkgame_action', 'bd_member_linked', 15, 10),
('kkgame.action.local_purchase', NULL, 'actions', 'Verified local purchase',
 'A confirmed purchase at a member business.', 'Up to 3 a day', 'kkgame_action', 'local_purchase', 10, 20),
('kkgame.action.exchange_referral_bonus', NULL, 'actions', 'A neighbour you invited trades',
 'Someone you invited completes their first trade.', 'Up to 5 a day', 'kkgame_action', 'exchange_referral_bonus', 10, 30),
('kkgame.action.exchange_referral_welcome', NULL, 'actions', 'Welcome for joining by invitation',
 'You were invited, and you completed your first trade.', 'Once ever', 'kkgame_action', 'exchange_referral_welcome', 10, 40),
('kkgame.action.passport_scan', NULL, 'actions', 'Scan a plaque',
 'Scanning a physical plaque at a member business.', 'Once per plaque per day', 'kkgame_action', 'passport_scan', 5, 50),
('kkgame.action.exchange_trade_complete', NULL, 'actions', 'Complete a trade',
 'Both sides of an Exchange trade confirm it happened.', 'No cap. First trade ever pays 5x', 'kkgame_action', 'exchange_trade_complete', 5, 60),
('kkgame.action.field_notes_submitted', NULL, 'actions', 'Submit a Field Note',
 'A member submits a story for review.', 'Once a day', 'kkgame_action', 'field_notes_submitted', 5, 70),
('kkgame.action.field_notes_published', NULL, 'actions', 'Field Note published',
 'A submitted story is approved and goes live.', 'Up to 2 a day. First one pays 1.5x', 'kkgame_action', 'field_notes_published', 5, 80),
('kkgame.action.exchange_post', NULL, 'actions', 'Post an Exchange offer',
 'Listing something you have, want, or are asking for.', 'Up to 5 a day. First post pays 3x', 'kkgame_action', 'exchange_post', 2, 90),
('kkgame.action.account_created', NULL, 'actions', 'Create an account',
 'Joining the network. Pays no credits today.', 'Once ever', 'kkgame_action', 'account_created', 0, 100),
('kkgame.action.profile_complete', NULL, 'actions', 'Complete your profile',
 'Filling out member profile details. Pays no credits today.', 'Once ever', 'kkgame_action', 'profile_complete', 0, 110),
('kkgame.action.volunteer_signup', NULL, 'actions', 'Sign up to volunteer',
 'Signing up for a shift. Pays no credits today.', 'No cap', 'kkgame_action', 'volunteer_signup', 0, 120),
('kkgame.action.volunteer_task_complete', NULL, 'actions', 'Complete a volunteer shift',
 'A verified community shift. Pays no credits today.', 'Once a day', 'kkgame_action', 'volunteer_task_complete', 0, 130),
('kkgame.action.volunteer_shift_confirmed', NULL, 'actions', 'Volunteer shift confirmed',
 'A business confirms a volunteer shift. Pays no credits today.', 'Once a day', 'kkgame_action', 'volunteer_shift_confirmed', 0, 140),
('kkgame.action.krowdlift', NULL, 'actions', 'KrowdLift',
 'A KKPulse lift. Pays no credits today.', 'No cap', 'kkgame_action', 'krowdlift', 0, 150),

-- ── Quests (10) ────────────────────────────────────────────────────────────
('kkgame.quest.q_pathfinders_journey', NULL, 'quests', 'Pathfinder''s Journey',
 'Scan 50 different plaques.', 'Once ever', 'kkgame_quest', 'q_pathfinders_journey', 100, 210),
('kkgame.quest.q_community_pillar', NULL, 'quests', 'Community Pillar',
 'Reach Tier 3 on both the Explorer and Helper paths.', 'Once ever', 'kkgame_quest', 'q_community_pillar', 60, 220),
('kkgame.quest.q_trade_veteran', NULL, 'quests', 'Trade Veteran',
 'Complete 10 Exchange trades.', 'Once ever', 'kkgame_quest', 'q_trade_veteran', 50, 230),
('kkgame.quest.q_stamped_all_over', NULL, 'quests', 'Stamped All Over',
 'Scan 20 different plaques.', 'Once ever', 'kkgame_quest', 'q_stamped_all_over', 40, 240),
('kkgame.quest.q_local_expert', NULL, 'quests', 'Local Expert',
 'Accumulate 2000 Explorer XP.', 'Once ever', 'kkgame_quest', 'q_local_expert', 20, 250),
('kkgame.quest.q_reliable_neighbor', NULL, 'quests', 'Reliable Neighbor',
 'Retired. A 7-day streak, which is an anxiety mechanic we do not ship.', 'Inactive', 'kkgame_quest', 'q_reliable_neighbor', 20, 260),
('kkgame.quest.q_cross_region_scout', NULL, 'quests', 'Cross-Region Scout',
 'Scan a plaque outside your home region.', 'Once ever', 'kkgame_quest', 'q_cross_region_scout', 15, 270),
('kkgame.quest.q_first_steps', NULL, 'quests', 'Explorer''s First Steps',
 'Scan 5 different plaques.', 'Once ever', 'kkgame_quest', 'q_first_steps', 10, 280),
('kkgame.quest.q_first_helper', NULL, 'quests', 'First Helper',
 'Complete your first Exchange trade.', 'Once ever', 'kkgame_quest', 'q_first_helper', 10, 290),
('kkgame.quest.q_wanderers_mark', NULL, 'quests', 'Wanderer''s Mark',
 'Accumulate 500 Explorer XP.', 'Once ever', 'kkgame_quest', 'q_wanderers_mark', 5, 300),

-- ── KrowdKwest creation defaults (5) ───────────────────────────────────────
-- These set what a NEW hunt is created with. Existing hunts snapshot their
-- values at creation and are never rescaled: a running hunt's grand prize must
-- not change under people who already entered.
('kwest.default.step_reward', 'lake-locals', 'kwest', 'KrowdKwest step reward',
 'Default paid per step on a new hunt.', 'Per step, per hunt', 'kwest_defaults', 'step_reward_default', 2, 410),
('kwest.default.rank2_10', 'lake-locals', 'kwest', 'KrowdKwest finish, places 2-10',
 'Default paid to finishers ranked 2nd through 10th on a new hunt.', 'Once per hunt', 'kwest_defaults', 'rank2_10_kredits', 10, 420),
('kwest.default.rank11_20', 'lake-locals', 'kwest', 'KrowdKwest finish, places 11-20',
 'Default paid to finishers ranked 11th through 20th on a new hunt.', 'Once per hunt', 'kwest_defaults', 'rank11_20_kredits', 2, 430),
('kwest.default.grand_prize', 'lake-locals', 'kwest', 'KrowdKwest grand prize',
 'Default KrowdKredits for the winner, released after ID verification.', 'Once per hunt', 'kwest_defaults', 'grand_prize_kredits', 25, 440),
('kwest.default.minigame_max', 'lake-locals', 'kwest', 'KrowdKwest mini-game maximum',
 'Most a single mini-game can pay on a new hunt.', 'Per play, when it pays', 'kwest_defaults', 'minigame_max_award', 2, 450),

-- ── Onboarding (3) ─────────────────────────────────────────────────────────
('passport.tenant.welcome_credits', 'lake-locals', 'onboarding', 'Passport welcome bonus',
 'Given once when someone joins the Passport.', 'Once ever', 'passport_tenant_config', 'welcome_credits', 10, 510),
('exchange.tenant.welcome_credits', 'lake-locals', 'onboarding', 'Exchange welcome bonus',
 'Given once when someone joins the Exchange.', 'Once ever', 'exchange_tenant_config', 'welcome_credits', 10, 520),
('exchange.tenant.upgrade_credits', 'lake-locals', 'onboarding', 'Exchange upgrade bonus',
 'Given once when a member links a paid Lake & Locals membership.', 'Once ever', 'exchange_tenant_config', 'upgrade_credits', 10, 530);

INSERT OR IGNORE INTO schema_migrations (name) VALUES ('2026-07-31-economy-registry');
