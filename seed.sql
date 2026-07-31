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

-- Explore niche
INSERT OR REPLACE INTO niches (id, tenant_id, slug, name, description, icon, accent_color, sort_order, config) VALUES (
  'll-explore', 'lake-locals', 'explore', 'Explore',
  'Visit local shops, parks, and dining to scan stamps and earn KrowdKredits.',
  'compass', '#c8860a', 1,
  '{"require_reciprocal": false, "show_duration_field": false}'
);

-- Explore categories (Stamps / Places)
INSERT OR REPLACE INTO categories (id, niche_id, slug, name, icon, sort_order) VALUES
  ('pass-dining',      'll-explore', 'dining',      'Dining & Drinks',    '🍔', 1),
  ('pass-shopping',    'll-explore', 'shopping',    'Boutiques & Shops',  '🛍️', 2),
  ('pass-recreation',  'll-explore', 'recreation',  'Parks & Recreation',  '🌲', 3),
  ('pass-attractions', 'll-explore', 'attractions', 'Local Attractions',  '🏛️', 4),
  ('pass-lodging',     'll-explore', 'lodging',     'Lodging & B&Bs',     '🏨', 5),
  ('pass-farmfood',    'll-explore', 'farmfood',    'Farm & Fresh Food',  '🌾', 6);

-- Guaranteed floor prize. Every winning scan falls through to the kredits_base
-- prize when no upgraded prize is rolled, so this row MUST exist or scans 500.
-- value is display-only (the real KrowdKredits award is issued by KKGame's
-- passport_scan action); -1 quantity = unlimited; probability 0 = never in the
-- weighted roll, only the fallback.
INSERT OR IGNORE INTO passport_prizes
  (id, tenant_id, name, prize_type, value, details, probability, quantity_left, is_active, is_paced)
VALUES
  ('kredits-base-lake-locals', 'lake-locals', 'KrowdKredits', 'kredits_base', 25, NULL, 0, -1, 1, 0);
