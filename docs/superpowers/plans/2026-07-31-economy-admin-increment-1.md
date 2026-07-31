# Economy Admin Route — Increment 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `/profile/admin/economy` in Passport — a read-only view of every credit-earning value with one global modifier that rescales all of them from an immutable baseline.

**Architecture:** A registry table in Passport holds the baseline and description for each value plus a pointer to its real home; the engines keep reading exactly what they read today, so no award path changes. Reads fan out to KKGame and Exchange over Service Bindings; writes recompute every value from baseline (never from the current value) and fan back out, making retry idempotent.

**Tech Stack:** Cloudflare Pages + Hono + D1, React/Vite frontend, vitest for pure-logic tests.

**Spec:** `docs/superpowers/specs/2026-07-31-economy-admin-design.md`. Read it before starting.

## Global Constraints

- **Increment 1 excludes the hunt migration.** No change to `digital_hunt_config` in KV, and no change to `loadConfig` in `kkgame/src/routers/hunt.ts`. That is increment 2.
- **The registry never becomes the value.** Live values stay in their home tables; the engines are untouched.
- **Rounding lives in exactly one function.** `scaleValue` in `src/lib/economy-scale.ts`. The browser never recomputes it.
- **Modifier range** `0 <= modifier <= 5`, at most 2 decimal places. `0.00` is explicitly valid.
- **Migrations only, never edit `schema.sql` in place.** Ordered file in `migrations/`, named `YYYY-MM-DD-name.sql`, and the file's last statement inserts its own id into `schema_migrations`.
- **A migration is not done until it is applied to remote D1 and verified in the same session.**
- **API responses** use the `{ data }` / `{ error }` envelope.
- **No em-dashes in any user-facing copy.** Plain hyphens.
- **No emojis in UI.** Use lucide icons.
- **Mobile-first:** fully functional at 375px before it is considered complete.
- **No deploys without Jim's explicit go.**

---

## File Structure

**Passport — create**
- `src/lib/economy-scale.ts` — pure arithmetic: `scaleValue`, `computePlan`. No I/O, no bindings.
- `src/lib/economy-registry.ts` — registry reads, live-value fan-out, apply fan-out. Dependencies injected.
- `src/lib/economy-guards.ts` — the static guard descriptors and ratio computation.
- `src/handlers/economy.ts` — the three HTTP handlers.
- `migrations/2026-07-31-economy-registry.sql` — three tables plus 33 seeded rows.
- `ui/src/pages/profile/AdminEconomy.tsx` — the screen.
- `ui/src/api/economy.ts` — typed client.
- `vitest.config.mts`, `test/economy-scale.spec.ts`, `test/economy-plan.spec.ts`

**Passport — modify**
- `functions/api/[[route]].ts` — mount the economy routes.
- `ui/src/App.tsx` — lazy route for `/profile/admin/economy`.
- `src/handlers/kwest-admin.ts` — hunt creation reads defaults from `tenants.config.kwest`.
- `package.json` — vitest devDependency and `test` script.

**KKGame — create/modify**
- `src/routers/internal.ts` (create) — `GET /internal/economy/values`, `POST /internal/economy/apply`.
- `src/index.ts` (modify) — mount the internal router.
- `src/routers/admin.ts` (modify) — reject credit-field writes.

**Exchange — create/modify**
- `src/handlers/economy-internal.ts` (create) — the same two endpoints for its tenant config.
- `functions/api/[[route]].ts` (modify) — mount them.

---

## Task 1: Rounding arithmetic and test harness

**Files:**
- Create: `vitest.config.mts`, `src/lib/economy-scale.ts`, `test/economy-scale.spec.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: nothing.
- Produces: `scaleValue(baseline: number, modifier: number): number`

Passport has no test runner today. This adds plain vitest (not `@cloudflare/vitest-pool-workers`, which KKCredits uses for a Worker — Passport is a Pages app and its entry is `functions/api/[[route]].ts`, so a workerd harness is disproportionate here). All logic that needs testing in this plan is written pure and injectable so it needs no bindings.

- [ ] **Step 1: Add vitest**

```bash
cd C:/projects/passport && npm install -D vitest@^4.1.10
```

Then add to `package.json` scripts:
```json
"test": "vitest run"
```

- [ ] **Step 2: Create `vitest.config.mts`**

```ts
import { defineConfig } from 'vitest/config';

// Plain node environment: everything under test here is pure and takes its
// dependencies as arguments, so no workerd/miniflare harness is needed.
export default defineConfig({
  test: { include: ['test/**/*.spec.ts'] },
});
```

- [ ] **Step 3: Write the failing test**

`test/economy-scale.spec.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { scaleValue } from '../src/lib/economy-scale';

describe('scaleValue', () => {
  it('returns the baseline unchanged at 1.0', () => {
    expect(scaleValue(25, 1.0)).toBe(25);
  });

  it('returns exactly 0 only when the modifier is exactly 0', () => {
    expect(scaleValue(25, 0)).toBe(0);
    expect(scaleValue(0, 0)).toBe(0);
  });

  it('never drops to 0 at a nonzero modifier', () => {
    expect(scaleValue(1, 0.01)).toBe(1);
    expect(scaleValue(5, 0.04)).toBe(1);
  });

  it('rounds up on a half', () => {
    expect(scaleValue(5, 0.5)).toBe(3);
    expect(scaleValue(25, 0.5)).toBe(13);
  });

  it('is idempotent: applying twice equals applying once', () => {
    const once = scaleValue(50, 0.5);
    const twice = scaleValue(50, 0.5);
    expect(twice).toBe(once);
  });

  it('scales up as well as down', () => {
    expect(scaleValue(10, 2.5)).toBe(25);
  });
});
```

- [ ] **Step 4: Run it and confirm it fails**

Run: `npm test`
Expected: FAIL, cannot resolve `../src/lib/economy-scale`.

- [ ] **Step 5: Implement**

`src/lib/economy-scale.ts`:
```ts
/**
 * The ONLY place credit-scaling arithmetic exists. The preview endpoint and
 * the apply endpoint both call this; the browser never recomputes it. Two
 * implementations that agree today is the exact shape of the bug this whole
 * feature exists to prevent (see the 2026-07-30 evaluation).
 *
 * modifier === 0 is an explicit kill switch. At any nonzero modifier a value
 * floors at 1, so an award can never silently stop paying because the
 * arithmetic happened to land under a half.
 */
export function scaleValue(baseline: number, modifier: number): number {
  if (modifier === 0) return 0;
  if (baseline === 0) return 0;
  return Math.max(1, Math.ceil(baseline * modifier));
}
```

- [ ] **Step 6: Run and confirm pass**

Run: `npm test`
Expected: PASS, 6 tests.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json vitest.config.mts src/lib/economy-scale.ts test/economy-scale.spec.ts
git commit -m "Add vitest and the single credit-scaling function

scaleValue is the only place this arithmetic lives. Preview and apply
both call it so they cannot diverge. 0.00 is an explicit kill switch;
any nonzero modifier floors at 1 so an award never silently stops
paying because rounding landed under a half."
```

---

## Task 2: Registry schema and seed

**Files:**
- Create: `migrations/2026-07-31-economy-registry.sql`

**Interfaces:**
- Produces: tables `economy_values`, `economy_modifier`, `economy_history`, seeded with 33 rows.

Baseline values are the 2026-07-30 applied scale. Verify each against production before writing the file — do not trust this document's numbers blindly:

```bash
npx wrangler d1 execute kkgame-db --remote --command \
  "SELECT id, base_credits FROM actions ORDER BY id;"
npx wrangler d1 execute kkgame-db --remote --command \
  "SELECT id, reward_credits FROM quests ORDER BY id;"
```

- [ ] **Step 1: Write the migration**

`migrations/2026-07-31-economy-registry.sql`:
```sql
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

INSERT INTO schema_migrations (id) VALUES ('2026-07-31-economy-registry');
```

- [ ] **Step 2: Apply locally first**

Run: `npx wrangler d1 execute krowdkraft-passport --local --file=migrations/2026-07-31-economy-registry.sql`
Expected: no errors.

- [ ] **Step 3: Apply to remote and verify**

```bash
npx wrangler d1 execute krowdkraft-passport --remote -y --file=migrations/2026-07-31-economy-registry.sql
npx wrangler d1 execute krowdkraft-passport --remote --command \
  "SELECT group_key, COUNT(*) n, SUM(baseline) total FROM economy_values GROUP BY group_key;"
```
Expected: `actions 15`, `quests 10`, `kwest 5`, `onboarding 3`. 33 rows total, no `hunt` group (that is increment 2).

- [ ] **Step 4: Commit**

```bash
git add migrations/2026-07-31-economy-registry.sql
git commit -m "Add the economy registry tables and seed 33 baseline rows

Baseline is the 2026-07-30 re-denominated scale. The dial is a single
global row: kkgame actions and quests are network-wide, and credits are
universal per ARCHITECTURE.md:650, so a per-tenant modifier would let
one region rescale another. Zero-value actions are included on purpose;
the page's job is the complete earning surface, and 'this pays nothing'
is information."
```

---

## Task 3: KrowdKwest creation defaults

**Files:**
- Create: `src/lib/kwest-defaults.ts`
- Modify: `src/handlers/kwest-admin.ts` (hunt creation)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `getKwestDefaults(env, tenantId): Promise<KwestDefaults>`, `setKwestDefaults(env, tenantId, patch): Promise<KwestDefaults>`

Copies the `src/lib/splash-config.ts` pattern exactly — same `tenants.config` JSON column, same KV cache invalidation. Read it first.

- [ ] **Step 1: Create the helper**

`src/lib/kwest-defaults.ts`:
```ts
/**
 * KrowdKwest hunt-creation defaults. Lives in tenants.config under a `kwest`
 * key, the same place and shape as splash-config.ts, per the 2026-07-26
 * decision that tunable config is tenants.config and not KV or module
 * constants (ARCHITECTURE.md:1101).
 *
 * These set what a NEW hunt is created with. A hunt snapshots them at
 * creation and is never rescaled afterwards: a running hunt's grand prize
 * must not change under people who already entered.
 */
import type { Env } from '../types';

export interface KwestDefaults {
  step_reward_default: number;
  rank2_10_kredits: number;
  rank11_20_kredits: number;
  grand_prize_kredits: number;
  minigame_max_award: number;
}

export const KWEST_DEFAULTS: KwestDefaults = {
  step_reward_default: 2,
  rank2_10_kredits: 10,
  rank11_20_kredits: 2,
  grand_prize_kredits: 25,
  minigame_max_award: 2,
};

export async function getKwestDefaults(env: Env, tenantId: string): Promise<KwestDefaults> {
  const row = await env.DB.prepare('SELECT config FROM tenants WHERE id = ?')
    .bind(tenantId).first<{ config: string }>();
  const config = JSON.parse(row?.config || '{}');
  return { ...KWEST_DEFAULTS, ...(config.kwest ?? {}) };
}

export async function setKwestDefaults(
  env: Env, tenantId: string, patch: Partial<KwestDefaults>,
): Promise<KwestDefaults> {
  const row = await env.DB.prepare('SELECT config, hostname FROM tenants WHERE id = ?')
    .bind(tenantId).first<{ config: string; hostname: string }>();
  if (!row) throw new Error('Tenant not found');

  const config = JSON.parse(row.config || '{}');
  const merged: KwestDefaults = { ...KWEST_DEFAULTS, ...(config.kwest ?? {}), ...patch };
  config.kwest = merged;

  await env.DB.prepare('UPDATE tenants SET config = ? WHERE id = ?')
    .bind(JSON.stringify(config), tenantId).run();
  await Promise.all([
    env.PASSPORT_CONFIG.delete(`tenant:slug:${tenantId}`),
    env.PASSPORT_CONFIG.delete(`tenant:host:${row.hostname}`),
  ]);
  return merged;
}
```

- [ ] **Step 2: Seed the current defaults into the live tenant row**

```bash
npx wrangler d1 execute krowdkraft-passport --remote -y --command \
  "UPDATE tenants SET config = json_set(config, '\$.kwest', json('{\"step_reward_default\":2,\"rank2_10_kredits\":10,\"rank11_20_kredits\":2,\"grand_prize_kredits\":25,\"minigame_max_award\":2}')) WHERE id = 'lake-locals';"
npx wrangler d1 execute krowdkraft-passport --remote --command \
  "SELECT json_extract(config,'\$.kwest') FROM tenants WHERE id='lake-locals';"
```
Expected: the five fields echo back.

- [ ] **Step 3: Wire hunt creation to the defaults**

In `src/handlers/kwest-admin.ts`, find the hunt-creation INSERT. Replace any hardcoded prize/step values with values read from `getKwestDefaults(c.env, tenant.id)`. If the create form supplies explicit values, those still win — the defaults only fill what the caller omitted.

- [ ] **Step 4: Verify existing hunts are untouched**

```bash
npx wrangler d1 execute krowdkraft-passport --remote --command \
  "SELECT id, step_reward_default, grand_prize_kredits, kk_budget_cap FROM kwest_hunts;"
```
Expected: hunt 1 unchanged at 2 / 25 / 750. Confirms defaults do not reach back into existing hunts.

- [ ] **Step 5: Commit**

```bash
git add src/lib/kwest-defaults.ts src/handlers/kwest-admin.ts
git commit -m "Move KrowdKwest prize values to tenants.config as creation defaults

Follows splash-config.ts and the 2026-07-26 rule that tunable config is
tenants.config, not KV and not module constants. A new hunt is created
from these; existing hunts snapshot at creation and are never rescaled,
so a running hunt's grand prize cannot change under entrants."
```

---

## Task 4: KKGame internal economy endpoints

**Files:**
- Create: `C:/projects/kkgame/src/routers/internal.ts`
- Modify: `C:/projects/kkgame/src/index.ts`

**Interfaces:**
- Produces: `GET /internal/economy/values` → `{ data: { values: Array<{ ref: string; kind: 'action'|'quest'; credits: number }> } }`; `POST /internal/economy/apply` with `{ values: Array<{ ref: string; kind: string; credits: number }> }` → `{ data: { updated: number } }`

Auth is `X-Internal-Secret`, matching Passport's existing internal-route convention.

- [ ] **Step 1: Create the router**

```ts
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { Env } from '../types';

const router = new Hono<{ Bindings: Env }>();

router.use('/internal/economy/*', async (c, next) => {
  const secret = c.req.header('X-Internal-Secret');
  if (!c.env.INTERNAL_SECRET || secret !== c.env.INTERNAL_SECRET) {
    throw new HTTPException(401, { message: 'Unauthorized' });
  }
  await next();
});

router.get('/internal/economy/values', async (c) => {
  const actions = await c.env.DB.prepare(
    'SELECT id AS ref, base_credits AS credits FROM actions'
  ).all<{ ref: string; credits: number }>();
  const quests = await c.env.DB.prepare(
    'SELECT id AS ref, reward_credits AS credits FROM quests'
  ).all<{ ref: string; credits: number }>();

  return c.json({
    data: {
      values: [
        ...(actions.results ?? []).map((r) => ({ ...r, kind: 'action' as const })),
        ...(quests.results ?? []).map((r) => ({ ...r, kind: 'quest' as const })),
      ],
    },
  });
});

router.post('/internal/economy/apply', async (c) => {
  const body = await c.req.json<{ values: Array<{ ref: string; kind: string; credits: number }> }>();
  if (!Array.isArray(body?.values)) {
    throw new HTTPException(400, { message: 'values array is required' });
  }

  const stmts = body.values.map((v) =>
    v.kind === 'action'
      ? c.env.DB.prepare('UPDATE actions SET base_credits = ? WHERE id = ?').bind(v.credits, v.ref)
      : c.env.DB.prepare('UPDATE quests SET reward_credits = ? WHERE id = ?').bind(v.credits, v.ref)
  );
  if (stmts.length) await c.env.DB.batch(stmts);

  return c.json({ data: { updated: stmts.length } });
});

export default router;
```

- [ ] **Step 2: Mount it**

In `src/index.ts`, alongside the existing `app.route(...)` calls:
```ts
import internalRouter from './routers/internal';
app.route('/', internalRouter);
```

- [ ] **Step 3: Typecheck**

Run: `cd C:/projects/kkgame && npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 4: Confirm `INTERNAL_SECRET` exists on kkgame**

Run: `npx wrangler secret list --name kkgame`
If absent, set it to the same value Passport uses. Do not invent a new one.

- [ ] **Step 5: Commit**

```bash
cd C:/projects/kkgame
git add src/routers/internal.ts src/index.ts
git commit -m "Add internal economy read/apply endpoints

Service-binding only, X-Internal-Secret auth. Lets Passport's economy
admin read and rescale action and quest credits without KKGame owning
the registry."
```

---

## Task 5: Exchange internal economy endpoints

**Files:**
- Create: `C:/projects/krowdkraft-exchange/src/handlers/economy-internal.ts`
- Modify: `C:/projects/krowdkraft-exchange/functions/api/[[route]].ts`

**Interfaces:**
- Produces: the same two endpoint shapes as Task 4, over `tenants.config` keys `welcome_credits` and `upgrade_credits`.

- [ ] **Step 1: Create the handlers**

```ts
import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { Env } from '../types';

type AppContext = Context<{ Bindings: Env }>;

const KEYS = ['welcome_credits', 'upgrade_credits'] as const;

export async function getEconomyValues(c: AppContext) {
  const rows = await c.env.DB.prepare('SELECT id, config FROM tenants').all<{ id: string; config: string }>();
  const values: Array<{ ref: string; tenant_id: string; credits: number }> = [];
  for (const row of rows.results ?? []) {
    const cfg = JSON.parse(row.config || '{}');
    for (const k of KEYS) values.push({ ref: k, tenant_id: row.id, credits: Number(cfg[k] ?? 0) });
  }
  return c.json({ data: { values } });
}

export async function applyEconomyValues(c: AppContext) {
  const body = await c.req.json<{ values: Array<{ ref: string; tenant_id: string; credits: number }> }>();
  if (!Array.isArray(body?.values)) throw new HTTPException(400, { message: 'values array is required' });

  const byTenant = new Map<string, Record<string, number>>();
  for (const v of body.values) {
    if (!KEYS.includes(v.ref as typeof KEYS[number])) continue;
    const bucket = byTenant.get(v.tenant_id) ?? {};
    bucket[v.ref] = v.credits;
    byTenant.set(v.tenant_id, bucket);
  }

  let updated = 0;
  for (const [tenantId, patch] of byTenant) {
    const row = await c.env.DB.prepare('SELECT config FROM tenants WHERE id = ?')
      .bind(tenantId).first<{ config: string }>();
    if (!row) continue;
    const cfg = { ...JSON.parse(row.config || '{}'), ...patch };
    await c.env.DB.prepare('UPDATE tenants SET config = ? WHERE id = ?')
      .bind(JSON.stringify(cfg), tenantId).run();
    updated += Object.keys(patch).length;
  }
  return c.json({ data: { updated } });
}
```

- [ ] **Step 2: Mount with the same secret guard**

In `functions/api/[[route]].ts`, register `GET /api/internal/economy/values` and `POST /api/internal/economy/apply`, both behind an `X-Internal-Secret` check matching Task 4's middleware.

- [ ] **Step 3: Typecheck**

Run: `cd C:/projects/krowdkraft-exchange && npx tsc --noEmit -p tsconfig.json`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
cd C:/projects/krowdkraft-exchange
git add src/handlers/economy-internal.ts functions/api/'[[route]]'.ts
git commit -m "Add internal economy read/apply endpoints for tenant credit config

Exposes welcome_credits and upgrade_credits so Passport's economy admin
can read and rescale them. X-Internal-Secret, service-binding only."
```

---

## Task 6: The plan computation, pure and tested

**Files:**
- Create: `test/economy-plan.spec.ts`
- Modify: `src/lib/economy-scale.ts`

**Interfaces:**
- Consumes: `scaleValue` from Task 1.
- Produces: `computePlan(rows: RegistryRow[], modifier: number): PlanEntry[]`, plus the `RegistryRow` and `PlanEntry` types.

This is the fan-out's brain, kept pure so it needs no bindings to test.

- [ ] **Step 1: Write the failing test**

`test/economy-plan.spec.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { computePlan, type RegistryRow } from '../src/lib/economy-scale';

const rows: RegistryRow[] = [
  { id: 'a', source_kind: 'kkgame_action', source_ref: 'passport_scan', tenant_id: null, baseline: 5 },
  { id: 'b', source_kind: 'kkgame_quest', source_ref: 'q_first_steps', tenant_id: null, baseline: 10 },
  { id: 'c', source_kind: 'exchange_tenant_config', source_ref: 'welcome_credits', tenant_id: 'lake-locals', baseline: 10 },
];

describe('computePlan', () => {
  it('computes every row from baseline, never from a previous result', () => {
    const first = computePlan(rows, 0.5);
    const second = computePlan(rows, 0.5);
    expect(second).toEqual(first);
    expect(first.map((p) => p.computed)).toEqual([3, 5, 5]);
  });

  it('returns exactly the baseline at 1.0', () => {
    expect(computePlan(rows, 1.0).map((p) => p.computed)).toEqual([5, 10, 10]);
  });

  it('zeroes everything at 0.00', () => {
    expect(computePlan(rows, 0).every((p) => p.computed === 0)).toBe(true);
  });

  it('preserves the source pointer so the fan-out knows where each value goes', () => {
    const plan = computePlan(rows, 1.0);
    expect(plan[2]).toMatchObject({
      source_kind: 'exchange_tenant_config', source_ref: 'welcome_credits', tenant_id: 'lake-locals',
    });
  });
});
```

- [ ] **Step 2: Run and confirm it fails**

Run: `npm test`
Expected: FAIL, `computePlan` is not exported.

- [ ] **Step 3: Implement**

Append to `src/lib/economy-scale.ts`:
```ts
export type SourceKind =
  | 'kkgame_action' | 'kkgame_quest' | 'kwest_defaults'
  | 'passport_tenant_config' | 'exchange_tenant_config' | 'hunt_tiers';

export interface RegistryRow {
  id: string;
  source_kind: SourceKind;
  source_ref: string;
  tenant_id: string | null;
  baseline: number;
  // Display fields. Optional so the pure tests can build rows without them,
  // but always present on rows read from the database.
  group_key?: string;
  label?: string;
  clue?: string;
  rate_note?: string | null;
  sort_order?: number;
}

export interface PlanEntry extends RegistryRow {
  computed: number;
}

/**
 * Every entry is derived from `baseline`, never from a current or previously
 * computed value. That is what makes apply idempotent, which in turn is what
 * makes retry-after-partial-failure safe across three services with no
 * distributed transaction.
 */
export function computePlan(rows: RegistryRow[], modifier: number): PlanEntry[] {
  return rows.map((r) => ({ ...r, computed: scaleValue(r.baseline, modifier) }));
}
```

- [ ] **Step 4: Run and confirm pass**

Run: `npm test`
Expected: PASS, 10 tests total.

- [ ] **Step 5: Commit**

```bash
git add src/lib/economy-scale.ts test/economy-plan.spec.ts
git commit -m "Add computePlan, derived from baseline only

Deriving every entry from the immutable baseline rather than the current
value is what makes apply idempotent, which is the entire recovery story
for a partial failure across three services with no distributed
transaction: press it again."
```

---

## Task 7: Registry service — read fan-out and apply fan-out

**Files:**
- Create: `src/lib/economy-registry.ts`

**Interfaces:**
- Consumes: `computePlan`, `RegistryRow`, `PlanEntry`.
- Produces: `readRegistry(db)`, `readLiveValues(clients)`, `applyPlan(plan, clients)` returning `{ outcome: 'applied'|'partial'|'failed'; perTarget: Record<string, 'ok'|'failed'> }`

Dependencies are injected as a `clients` object so this is testable without bindings and so a failing target can be simulated.

- [ ] **Step 1: Implement**

```ts
import type { PlanEntry, RegistryRow } from './economy-scale';

export interface EconomyClients {
  kkgame: {
    read(): Promise<Array<{ ref: string; kind: string; credits: number }>>;
    apply(values: Array<{ ref: string; kind: string; credits: number }>): Promise<void>;
  };
  exchange: {
    read(): Promise<Array<{ ref: string; tenant_id: string; credits: number }>>;
    apply(values: Array<{ ref: string; tenant_id: string; credits: number }>): Promise<void>;
  };
  passport: {
    read(): Promise<Array<{ ref: string; tenant_id: string; credits: number }>>;
    apply(values: Array<{ ref: string; tenant_id: string; credits: number }>): Promise<void>;
  };
}

export async function readRegistry(db: D1Database): Promise<RegistryRow[]> {
  const { results } = await db.prepare(
    `SELECT id, tenant_id, group_key, label, clue, rate_note,
            source_kind, source_ref, baseline, sort_order, is_active
     FROM economy_values WHERE is_active = 1 ORDER BY sort_order`
  ).all<any>();
  return (results ?? []) as RegistryRow[];
}

/**
 * Reads the CURRENT live value for every registry row from its home store.
 * A target that throws yields `null` for its rows, never 0 — an unreachable
 * service must not render as "this award pays nothing."
 */
export async function readLiveValues(
  rows: RegistryRow[], clients: EconomyClients,
): Promise<{ live: Map<string, number | null>; reachable: Record<string, boolean> }> {
  const live = new Map<string, number | null>();

  const safe = async <T>(fn: () => Promise<T[]>): Promise<T[] | null> => {
    try { return await fn(); } catch { return null; }
  };

  const [kk, ex, pp] = await Promise.all([
    safe(() => clients.kkgame.read()),
    safe(() => clients.exchange.read()),
    safe(() => clients.passport.read()),
  ]);

  for (const row of rows) {
    let value: number | null = null;
    if (row.source_kind === 'kkgame_action' || row.source_kind === 'kkgame_quest') {
      const want = row.source_kind === 'kkgame_action' ? 'action' : 'quest';
      value = kk?.find((v) => v.ref === row.source_ref && v.kind === want)?.credits ?? null;
    } else if (row.source_kind === 'exchange_tenant_config') {
      value = ex?.find((v) => v.ref === row.source_ref && v.tenant_id === row.tenant_id)?.credits ?? null;
    } else {
      value = pp?.find((v) => v.ref === row.source_ref && v.tenant_id === row.tenant_id)?.credits ?? null;
    }
    live.set(row.id, value);
  }

  // `reachable` is what lets the caller tell "the service is down" from "this
  // row's source no longer exists" (spec §11). Both produce a null value, but
  // they mean opposite things: the first is transient, the second is an
  // orphaned registry row that must be excluded from apply.
  return { live, reachable: { kkgame: kk !== null, exchange: ex !== null, passport: pp !== null } };
}

/**
 * Applies in a fixed order and records per-target outcome. There is no
 * distributed transaction across three services, so a partial result is
 * possible and is reported rather than hidden. Retry is safe because the plan
 * derives from baseline (see computePlan).
 */
export async function applyPlan(plan: PlanEntry[], clients: EconomyClients) {
  const perTarget: Record<string, 'ok' | 'failed'> = {};

  const targets: Array<[string, () => Promise<void>]> = [
    ['kkgame', () => clients.kkgame.apply(
      plan.filter((p) => p.source_kind === 'kkgame_action' || p.source_kind === 'kkgame_quest')
          .map((p) => ({ ref: p.source_ref, kind: p.source_kind === 'kkgame_action' ? 'action' : 'quest', credits: p.computed })))],
    ['exchange', () => clients.exchange.apply(
      plan.filter((p) => p.source_kind === 'exchange_tenant_config')
          .map((p) => ({ ref: p.source_ref, tenant_id: p.tenant_id!, credits: p.computed })))],
    ['passport', () => clients.passport.apply(
      plan.filter((p) => p.source_kind === 'passport_tenant_config' || p.source_kind === 'kwest_defaults')
          .map((p) => ({ ref: p.source_ref, tenant_id: p.tenant_id!, credits: p.computed })))],
  ];

  for (const [name, run] of targets) {
    try { await run(); perTarget[name] = 'ok'; }
    catch { perTarget[name] = 'failed'; }
  }

  const oks = Object.values(perTarget).filter((v) => v === 'ok').length;
  const outcome = oks === targets.length ? 'applied' : oks === 0 ? 'failed' : 'partial';
  return { outcome: outcome as 'applied' | 'partial' | 'failed', perTarget };
}
```

- [ ] **Step 2: Write the partial-failure test**

Append to `test/economy-plan.spec.ts`:
```ts
import { applyPlan } from '../src/lib/economy-registry';

function clients(failing?: string) {
  const mk = (name: string) => ({
    read: async () => [],
    apply: async () => { if (name === failing) throw new Error('down'); },
  });
  return { kkgame: mk('kkgame'), exchange: mk('exchange'), passport: mk('passport') } as any;
}

describe('applyPlan', () => {
  const plan = computePlan(rows, 0.5);

  it('reports applied when every target succeeds', async () => {
    expect((await applyPlan(plan, clients())).outcome).toBe('applied');
  });

  it('reports partial and names the failing target', async () => {
    const r = await applyPlan(plan, clients('exchange'));
    expect(r.outcome).toBe('partial');
    expect(r.perTarget.exchange).toBe('failed');
    expect(r.perTarget.kkgame).toBe('ok');
  });

  it('converges on retry once the target recovers', async () => {
    expect((await applyPlan(plan, clients('exchange'))).outcome).toBe('partial');
    expect((await applyPlan(plan, clients())).outcome).toBe('applied');
  });
});
```

- [ ] **Step 3: Run and confirm pass**

Run: `npm test`
Expected: PASS, 13 tests.

- [ ] **Step 4: Commit**

```bash
git add src/lib/economy-registry.ts test/economy-plan.spec.ts
git commit -m "Add the registry read and apply fan-out with injected clients

Injection keeps this testable without bindings and lets the
partial-failure path be exercised directly. A failing target is reported
per-target rather than hidden, and retry converges because the plan is
baseline-derived."
```

---

## Task 8: Guards panel

**Files:**
- Create: `src/lib/economy-guards.ts`

**Interfaces:**
- Produces: `describeGuards(largestConfiguredAward: number, largestBaselineAward: number): GuardRow[]`

Guards are deploy-gated and never written here. This module only describes them and computes drift.

- [ ] **Step 1: Implement**

```ts
/**
 * Guards are deploy-gated on purpose: a backstop must not share a failure
 * domain with the thing it backstops. This module never writes them. It
 * exists so guard drift is visible, which is the failure that went unnoticed
 * on 2026-07-30 when rewards fell ~10x and every ceiling stayed put.
 */
export interface GuardRow {
  key: string;
  label: string;
  value: string;
  home: string;
  deployTarget: string;
  ratioNow: string | null;
  ratioAtBaseline: string | null;
  outOfBand: boolean;
}

export function describeGuards(largestNow: number, largestBaseline: number): GuardRow[] {
  const ratio = (guard: number, largest: number) => (largest > 0 ? guard / largest : null);
  const fmt = (r: number | null) => (r === null ? null : `${Math.round(r)}x largest award`);

  const maxSingle = 500;
  const rNow = ratio(maxSingle, largestNow);
  const rBase = ratio(maxSingle, largestBaseline);

  return [
    {
      key: 'KWEST_MAX_SINGLE_AWARD',
      label: 'Max single KrowdKwest award',
      value: String(maxSingle),
      home: 'passport/src/lib/kwest-economy.ts',
      deployTarget: 'Passport',
      ratioNow: fmt(rNow),
      ratioAtBaseline: fmt(rBase),
      outOfBand: rNow !== null && rBase !== null && rNow > rBase * 2,
    },
    {
      key: 'AWARD_DAILY_CEILINGS',
      label: 'Daily mint ceiling per app',
      value: 'passport 2000, exchange 2000, kkgame 5000, kk-apps-hub 2000, legacy 5000',
      home: 'KKCredits/wrangler.toml',
      deployTarget: 'KKCredits',
      ratioNow: null, ratioAtBaseline: null,
      outOfBand: false,
    },
    {
      key: 'FALLBACK_CEILING',
      label: 'Fallback daily ceiling',
      value: '1000',
      home: 'KKCredits/src/lib/ceiling.ts',
      deployTarget: 'KKCredits',
      ratioNow: null, ratioAtBaseline: null,
      outOfBand: false,
    },
  ];
}
```

- [ ] **Step 2: Test the drift flag**

Append to `test/economy-plan.spec.ts`:
```ts
import { describeGuards } from '../src/lib/economy-guards';

describe('describeGuards', () => {
  it('does not flag when the ratio is unchanged', () => {
    expect(describeGuards(100, 100)[0].outOfBand).toBe(false);
  });
  it('flags when the largest award shrinks far below baseline', () => {
    expect(describeGuards(25, 100)[0].outOfBand).toBe(true);
  });
});
```

- [ ] **Step 3: Run and commit**

Run: `npm test` (expected PASS, 15 tests), then:
```bash
git add src/lib/economy-guards.ts test/economy-plan.spec.ts
git commit -m "Add guard descriptors and drift detection

Read-only. Guards stay deploy-gated; this only makes it visible when
they fall out of proportion to the rewards, which is what nobody could
see on 2026-07-30."
```

---

## Task 9: HTTP handlers and routing

**Files:**
- Create: `src/handlers/economy.ts`
- Modify: `functions/api/[[route]].ts`

**Interfaces:**
- Consumes: everything from Tasks 6-8.
- Produces: `GET /api/t/:tenant/admin/economy`, `POST /api/t/:tenant/admin/economy/preview`, `POST /api/t/:tenant/admin/economy/apply`

Mount behind the same admin guard the other `/profile/admin/*` handlers use — read `src/handlers/admin.ts` and copy its check exactly. Do not invent a new role.

- [ ] **Step 1: Implement the three handlers**

`src/handlers/economy.ts` exports `getEconomy`, `previewEconomy`, `applyEconomy`.

- `getEconomy`: `readRegistry` → `computePlan(rows, currentModifier)` → `readLiveValues` → merge into rows carrying `{ baseline, computed, live, drift, status }`, plus `describeGuards(...)` and the current modifier.
  - `live === null` **never renders as 0**; an unreachable service must not look like an award that pays nothing.
  - Use `reachable` to set `status`: target down → `'unavailable'`, `drift: false`. Target up but ref absent → `'orphaned'`, `drift: false`, and **excluded from apply** (spec §11). Otherwise `'ok'` with `drift: live !== computed`.
- `previewEconomy`: validates the candidate modifier, returns the same shape with `computed` recalculated. Writes nothing.
- `applyEconomy`: validates, `computePlan` from baseline, `applyPlan`, then writes `economy_modifier` and one `economy_history` row containing `outcome`, `applied_by` from JWT `sub`, and `result_json` mapping every value id to its new number.

Validation, shared by preview and apply:
```ts
function parseModifier(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > 5) {
    throw new HTTPException(400, { message: 'Modifier must be between 0 and 5.' });
  }
  if (Math.round(n * 100) !== n * 100) {
    throw new HTTPException(400, { message: 'Modifier can have at most 2 decimal places.' });
  }
  return n;
}
```

- [ ] **Step 2: Mount the routes**

In `functions/api/[[route]].ts`, inside the existing `tenantApp`, register the three routes behind the admin guard.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/handlers/economy.ts functions/api/'[[route]]'.ts
git commit -m "Add economy read, preview and apply endpoints

Preview is a server round-trip on purpose so it runs the identical
function apply runs. An unreachable service renders live as null, never
0, so a read failure cannot look like an award that pays nothing."
```

---

## Task 10: Lock the credit fields in KKGame's admin

**Files:**
- Modify: `C:/projects/kkgame/src/routers/admin.ts`

Without this the baseline is fiction: `POST /admin/actions` and `POST /admin/quests` write the same columns the modifier writes, so there would be two writers on one value. Server-enforced, not a disabled input.

- [ ] **Step 1: Reject credit changes**

In `POST /admin/actions`, before the UPDATE, compare the submitted `base_credits` against the stored value and reject a change:
```ts
if (existing && body.base_credits !== undefined && Number(body.base_credits) !== existing.base_credits) {
  throw new HTTPException(409, {
    message: 'Credit values are managed at /profile/admin/economy in the Passport admin. Change the economy modifier there instead.',
  });
}
```
Apply the identical guard to `POST /admin/quests` for `reward_credits`. Every other field stays editable.

- [ ] **Step 2: Reflect it in the dashboard UI**

In `src/routers/dashboardHtml.ts`, mark the credit inputs readonly with a short note pointing at the Passport route. The server guard is the enforcement; this only stops the form promising something it cannot do.

- [ ] **Step 3: Verify the rejection against a running dev worker**

```bash
cd C:/projects/kkgame && npx wrangler dev &
curl -s -X POST http://localhost:8787/admin/actions \
  -H 'Content-Type: application/json' \
  -d '{"id":"passport_scan","base_credits":999}' | head -5
```
Expected: HTTP 409 with the message above. Kill the dev worker **by PID**, never by process name.

- [ ] **Step 4: Commit**

```bash
git add src/routers/admin.ts src/routers/dashboardHtml.ts
git commit -m "Make credit fields read-only in the KKGame admin

These columns are now owned by the economy registry in Passport. Left
editable they would be a second writer on the same value and the
baseline becomes fiction the first time the old form is used. Enforced
with a 409, not just a disabled input."
```

---

## Task 11: The screen

**Files:**
- Create: `ui/src/api/economy.ts`, `ui/src/pages/profile/AdminEconomy.tsx`
- Modify: `ui/src/App.tsx`

Follow `ui/src/pages/profile/AdminSplash.tsx` for structure, and the design language for styling. Read both before starting.

- [ ] **Step 1: Typed client**

`ui/src/api/economy.ts` with `getEconomy(tenant)`, `previewEconomy(tenant, modifier)`, `applyEconomy(tenant, modifier)`.

- [ ] **Step 2: The page**

Requirements, all non-negotiable:
- Modifier text input, debounced 250ms, calling the **preview endpoint**. No arithmetic in the browser.
- Rows grouped by `group_key` with the group name as a heading, in `sort_order`.
- Each row shows label, clue, rate note, and four numbers: baseline, computed, live, plus a drift indicator when they disagree.
- A clear unsaved state while the preview differs from what is saved.
- Save button disabled until the modifier differs from the stored value.
- `live === null` renders as "unavailable", never as 0.
- Guards section, visually separated, read-only, each row carrying its deploy target and its out-of-band flag.
- Lucide icons only, no emojis. No em-dashes in any copy.
- Fully usable at 375px: the four numeric columns must not force horizontal page scroll. Give the table its own `overflow-x: auto` container.

- [ ] **Step 3: Route it**

In `ui/src/App.tsx`, following the `AdminSplash` pattern exactly:
```tsx
const AdminEconomy = lazy(() => import('./pages/profile/AdminEconomy'));
// ...
<Route path="/profile/admin/economy" element={<AdminEconomy />} />
```

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: exit 0, no TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add ui/src/api/economy.ts ui/src/pages/profile/AdminEconomy.tsx ui/src/App.tsx
git commit -m "Add the economy admin screen

Read-only values with one modifier. Preview is a server round-trip so
it cannot diverge from what save writes. An unreachable service shows
as unavailable rather than zero."
```

---

## Task 12: Completeness test and end-to-end verification

**Files:**
- Create: `test/economy-completeness.spec.ts`

This is the test that stops a future award being added without appearing on the page — the exact gap that made the first pass of the economic evaluation incomplete.

- [ ] **Step 1: Write it**

The test reads a JSON fixture of every credit-bearing value across the three databases (generated by the command below) and asserts each has a registry row.

Generate both fixtures. Regenerate them whenever an award is added — the test is only as current as they are.

```bash
mkdir -p test/fixtures
npx wrangler d1 execute kkgame-db --remote --json --command \
  "SELECT id FROM actions UNION ALL SELECT id FROM quests;" > test/fixtures/kkgame-values.json
npx wrangler d1 execute krowdkraft-passport --remote --json --command \
  "SELECT source_ref FROM economy_values WHERE source_kind IN ('kkgame_action','kkgame_quest');" \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);process.stdout.write(JSON.stringify(j[0].results))})" \
  > test/fixtures/registry-refs.json
```

```ts
import { describe, it, expect } from 'vitest';
import fixture from './fixtures/kkgame-values.json';
import registry from './fixtures/registry-refs.json';

describe('registry completeness', () => {
  it('has a registry row for every kkgame credit-bearing value', () => {
    const refs = new Set(registry.map((r: any) => r.source_ref));
    const missing = fixture[0].results
      .map((r: any) => r.id)
      .filter((id: string) => !refs.has(id));
    expect(missing).toEqual([]);
  });
});
```

- [ ] **Step 2: Run**

Run: `npm test`
Expected: PASS. If it fails, the named values need registry rows — add them to a follow-up migration rather than editing the applied one.

- [ ] **Step 3: Browser verification**

With `npm run dev` running, in the browser:
1. Visit `/profile/admin/economy`. All 33 rows render, grouped, with clues.
2. Every row shows baseline == computed == live, no drift, modifier 1.00.
3. Type `0.5`. Preview updates. `passport_scan` shows 3, `exchange_post` shows 1, nothing shows 0.
4. Type `0`. Every computed value shows 0.
5. Type `1`. Everything returns exactly to the baseline column.
6. Type `0.5` and save. Live values update, drift clears.
7. Save `0.5` again. Nothing changes — proves idempotency against the real stack.
8. Save `1`. Everything returns exactly. **This is the reversibility guarantee; do not skip it.**
9. Resize to 375px. No horizontal page scroll.

- [ ] **Step 4: Restore and commit**

Leave the modifier at `1.00`. Verify against production that the values match the 2026-07-30 scale before finishing.

```bash
git add test/economy-completeness.spec.ts test/fixtures/
git commit -m "Add the registry completeness test

Asserts every credit-bearing value in kkgame has a registry row, so a
future award cannot be added without appearing on the economy page.
That gap is what made the first pass of the economic evaluation
incomplete."
```

---

## Deploy gate

Nothing in this plan deploys. Passport and Exchange are Pages apps and KKGame is a Worker; all three need Jim's explicit go. State plainly at handoff which of the three need deploying and what is not live until they are.

## Out of scope for increment 1

- The hunt config migration from KV, the payout/guard split, and the `loadConfig` change. That is increment 2, behind its own gate.
- The -50 escrow hole and the missing supply-vs-balances reconciliation.
- The dead `trade_complete_credits` key in the Exchange tenant config.
- Any spend-side value: deal prices, the merchant price floor, merchant pricing guidance.
