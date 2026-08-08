-- ============================================================
-- KrowdKraft Passport  --  Seed Data v1.0  (Explore first)
-- ============================================================

-- Lake & Locals tenant
INSERT OR REPLACE INTO tenants (id, hostname, name, region, config) VALUES (
  'lake-locals',
  'passport.lakeandlocals.com',
  'Lake & Locals Passport',
  'Tri-State Lakes Region',
  json('{
    "bd_domain": "lakeandlocals.com",
    "brand_name": "Lake & Locals",
    "brand_color_primary": "#1e3320",
    "brand_color_accent": "#c8860a",
    "credits_name": "KrowdKredits",
    "member_login_url": "https://www.lakeandlocals.com/login",
    "welcome_credits": 10,
    "upgrade_credits": 25,
    "trade_complete_credits": 10,
    "five_star_bonus_credits": 5,
    "referral_credits": 15,
    "boost_cost_credits": 5,
    "active_niches": ["explore"]
  }')
);

-- Guaranteed floor prize. Every winning scan falls through to the kredits_base
-- prize when no upgraded prize is rolled, so this row MUST exist or scans 500.
-- value MUST equal what kkgame's passport_scan action actually pays (5 base,
-- 10 first-ever) - when the two drifted apart the card promised 25 and paid 5.
-- -1 quantity = unlimited; probability 0 = never in the weighted roll, only
-- the fallback.
INSERT OR IGNORE INTO passport_prizes
  (id, tenant_id, name, prize_type, value, details, probability, quantity_left, is_active, is_paced)
VALUES
  ('kredits-base-lake-locals', 'lake-locals', 'KrowdKredits', 'kredits_base', 5, NULL, 0, -1, 1, 0);

-- Jackpot ladder. The supply lever is value * quantity_left, because
-- KrowdKredits never expire: a big value is only safe on tiny stock. Kept in
-- step with src/lib/prize-ladder.ts and migration 0021.
INSERT OR IGNORE INTO passport_prizes
  (id, tenant_id, name, prize_type, value, details, probability, quantity_left, is_active, is_paced)
VALUES
  ('kredits-jackpot-1-lake-locals', 'lake-locals', 'Free Deal',     'kredits_jackpot',  25, NULL, 0.030, 15, 1, 0),
  ('kredits-jackpot-2-lake-locals', 'lake-locals', 'Big Win',       'kredits_jackpot',  50, NULL, 0.020, 10, 1, 0),
  ('kredits-jackpot-3-lake-locals', 'lake-locals', 'Jackpot',       'kredits_jackpot', 100, NULL, 0.012,  6, 1, 0),
  ('kredits-jackpot-4-lake-locals', 'lake-locals', 'Grand Jackpot', 'kredits_jackpot', 250, NULL, 0.005,  3, 1, 0),
  ('kredits-jackpot-5-lake-locals', 'lake-locals', 'Legendary',     'kredits_jackpot', 500, NULL, 0.002,  1, 1, 0);
