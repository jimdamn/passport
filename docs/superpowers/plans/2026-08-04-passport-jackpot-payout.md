# Passport Jackpot Payout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every scan prize card true - pay the rolled jackpot into the member's wallet through the one KKCredits ledger, idempotently, with supply bounded by stock, and re-scale the jackpot ladder onto the post-2026-07-30 economy.

**Architecture:** The base `passport_scan` game action is left completely alone (it carries credits, XP, badges and cooldown). A jackpot is a **second, separate** `awardCredits` call layered on top, keyed `(user, 'passport_jackpot', scan_id)` so the same roll pays exactly once whether it settles instantly (logged-in) or later (guest deposit). Total mint is hard-bounded by the existing atomic `quantity_left` decrement; units reserved by a guest who never registers are returned to stock by a new cron sweep.

**Tech Stack:** TypeScript, Hono, Cloudflare Pages Functions, D1 (SQLite), vitest. Repos: `C:\projects\passport` and `C:\projects\passport-cron`.

**Source spec:** `docs/superpowers/specs/2026-07-31-passport-jackpot-payout-design.md` (commit `6d46f77`).

---

## Global Constraints

Every task's requirements implicitly include this section.

- **Single ledger.** All credit movement goes through KKCredits `awardCredits`. Passport keeps no credits ledger or cache.
- **Idempotency key is `(user_id, 'passport_jackpot', scan_id)`** on every jackpot payout, at both entry points. Never the claim token, never the prize id.
- **Migrations only.** Ordered file in `migrations/`, registering itself in `schema_migrations`. Never edit an applied migration; never `db:reset` or run `schema.sql` against remote.
- **Migrations apply immediately.** A migration is not done until it has been applied to remote D1 and verified in the same session.
- **No em-dashes in user-facing copy.** Plain hyphens.
- **No mechanics in copy.** Probabilities, stock counts, caps and cooldowns must never appear in member-facing text. They live in the database and in code comments only.
- **No emojis in UI.**
- **Deploys are HARD-STOP gates.** Tasks 1-5 are code only. Nothing deploys and no remote migration runs until Task 6, which requires Jim's explicit go.
- **Internal route prefix is `/api/internal/...`** (the spec wrote `/internal/passport/...`; the repo's actual convention, set by `deals/sweep`, `kwest/lifecycle` and `support/retention`, is `/api/internal/...`). Corrected here.

### Decisions adopted

The spec left four open. This plan adopts the spec's own recommendations so it is buildable end to end. **Confirm with Jim before starting Task 1** - only D2 and D3 change member-visible outcomes, and both are one-line edits to `src/lib/prize-ladder.ts` if he wants different values.

| # | Decision | Adopted |
|---|---|---|
| D1 | Migration hygiene | Delete the never-applied `0020`, add `0021` landing the final ladder directly against real prod state. |
| D2 | Prize names | Degree names: Free Deal / Big Win / Jackpot / Grand Jackpot / Legendary. |
| D3 | Probabilities | The §2 gradient: 0.030 / 0.020 / 0.012 / 0.005 / 0.002. |
| D4 | Halving | Display and store `issued_amount` returned by KKCredits, not the requested value. Identical today (multiplier is 1). This is a **small addition beyond the spec**, flagged deliberately: it is the same class of defect the whole change exists to remove, and reverting it is one line. |

### The target ladder

| Degree name | Value | Units (`quantity_left`) | Probability | Max lifetime mint |
|---|---:|:---:|:---:|---:|
| Free Deal | 25 | 15 | 0.030 | 375 |
| Big Win | 50 | 10 | 0.020 | 500 |
| Jackpot | 100 | 6 | 0.012 | 600 |
| Grand Jackpot | 250 | 3 | 0.005 | 750 |
| Legendary | 500 | 1 | 0.002 | 500 |

Floor prize (`kredits_base`) stays at **5**, matching what `passport_scan` actually pays. Absolute lifetime ceiling across all tiers: **2,725** credits.

### Current production state (verified 2026-08-04)

`schema_migrations` tops out at `0019-splash-escrow-ref`; `0020` was never applied. All rows are tenant `lake-locals`:

| id | prize_type | value | qty | prob | active |
|---|---|---:|---:|---:|:---:|
| `test-prize-base` | kredits_base | 25 | -1 | 1.0 | 1 |
| `zda8W_cRMG` | kredits_jackpot | 25 | 20 | 0.05 | 1 |
| `gbmFHc2yzw` | kredits_jackpot | 50 | 20 | 0.05 | 1 |
| `P2eI3c8_Md` | kredits_jackpot | 100 | 20 | 0.01 | 1 |
| `c038uGL4ji` | kredits_jackpot | 500 | 20 | 0.01 | 1 |
| `7x5AIvAKSY` | kredits_jackpot | 1000 | 20 | 0.01 | 1 |

The migration matches on `prize_type` + **original value**, never on id, so it is environment-agnostic.

### Testing reality

Passport's suite is **pure-unit vitest with no Worker or D1 harness**. Nothing in `test/` can move real credits or hit a database. Tests here are therefore of two kinds, both already established in this repo:

1. **Pure unit tests** on extracted logic (`test/economy-scale.spec.ts` is the model).
2. **Source-scan tests** asserting a structural property that would have made the bug impossible (`test/splash-escrow-keys.spec.ts` is the model).

Behavioural proof that credits actually land is the Task 6 live verification, not a unit test. Do not pretend otherwise in test names or comments.

---

## File Structure

**passport (`C:\projects\passport`)**

| File | Responsibility |
|---|---|
| `src/lib/prize-ladder.ts` (new) | Single source of truth for the ladder values. Imported by tests; mirrored by the migration and seed. |
| `src/lib/jackpot.ts` (new) | Pure helpers (`isJackpot`, `mergeBadges`, `JACKPOT_REF_TYPE`) plus `restoreQuantity`. |
| `migrations/0021-prize-matrix-redenomination.sql` (new) | Lands the ladder on real prod rows. |
| `migrations/0020-prize-matrix-redenomination.sql` | **Deleted** - never applied anywhere, lands wrong numbers. |
| `seed.sql` | Floor prize target value, so fresh/local DBs match prod. |
| `src/handlers/passport.ts` | Logged-in payout (Task 2); guest deposit payout (Task 3). |
| `src/handlers/passport-internal.ts` (new) | Expiry sweep + its `X-Internal-Secret` endpoint. |
| `functions/api/[[route]].ts` | Registers the internal route. |
| `ui/src/utils/ledgerLabels.ts` | Member-facing label for the new ref_type. |
| `test/prize-ladder.spec.ts` (new) | Ladder invariants + migration/ladder consistency. |
| `test/jackpot-payout-keys.spec.ts` (new) | Idempotency-key and ordering guards + pure helper tests. |

**passport-cron (`C:\projects\passport-cron`)**

| File | Responsibility |
|---|---|
| `src/index.ts` | Adds the sweep to `runDailySweeps`. |
| `wrangler.toml` | The sweep URL var. |

---

### Task 1: Prize ladder and migration 0021

**Files:**
- Create: `src/lib/prize-ladder.ts`
- Create: `migrations/0021-prize-matrix-redenomination.sql`
- Delete: `migrations/0020-prize-matrix-redenomination.sql`
- Modify: `seed.sql:45-53`
- Test: `test/prize-ladder.spec.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `JACKPOT_LADDER: JackpotTier[]`, `FLOOR_VALUE: number` (5), `FLOOR_FROM_VALUE: number` (25), `maxLifetimeMint(ladder?): number`. Nothing in `src/handlers/` imports these - they exist so the migration, the seed and the tests cannot drift.

- [ ] **Step 1: Write the failing test**

Create `test/prize-ladder.spec.ts`:

```ts
// The ladder is the supply lever: KrowdKredits never expire and are never
// clawed back, so `value * units` is permanent supply. These tests pin the
// invariants that keep a big sticker safe (tiny stock) and keep migration
// 0021 in step with the constant the rest of the codebase reasons about.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  JACKPOT_LADDER,
  FLOOR_VALUE,
  FLOOR_FROM_VALUE,
  maxLifetimeMint,
} from '../src/lib/prize-ladder';

const MIGRATION = readFileSync(
  fileURLToPath(new URL('../migrations/0021-prize-matrix-redenomination.sql', import.meta.url)),
  'utf8',
);

describe('jackpot ladder', () => {
  it('caps lifetime jackpot mint at 2725 credits', () => {
    expect(maxLifetimeMint()).toBe(2725);
  });

  it('never maps two source values onto the same row', () => {
    const from = JACKPOT_LADDER.map((t) => t.fromValue);
    expect(new Set(from).size).toBe(from.length);
  });

  it('makes bigger prizes rarer and scarcer', () => {
    for (let i = 1; i < JACKPOT_LADDER.length; i++) {
      expect(JACKPOT_LADDER[i].value).toBeGreaterThan(JACKPOT_LADDER[i - 1].value);
      expect(JACKPOT_LADDER[i].probability).toBeLessThan(JACKPOT_LADDER[i - 1].probability);
      expect(JACKPOT_LADDER[i].units).toBeLessThan(JACKPOT_LADDER[i - 1].units);
    }
  });

  it('keeps the floor below every jackpot tier', () => {
    expect(FLOOR_VALUE).toBeLessThan(Math.min(...JACKPOT_LADDER.map((t) => t.value)));
  });
});

describe('migration 0021', () => {
  it('registers itself in the schema_migrations ledger', () => {
    expect(MIGRATION).toContain(
      "INSERT OR IGNORE INTO schema_migrations (name) VALUES ('0021-prize-matrix-redenomination')",
    );
  });

  it('brings the floor onto the ladder value', () => {
    expect(MIGRATION).toMatch(
      new RegExp(`SET value = ${FLOOR_VALUE}[\\s\\S]*?prize_type = 'kredits_base' AND value = ${FLOOR_FROM_VALUE}`),
    );
  });

  it('remaps every tier keyed on its ORIGINAL value', () => {
    for (const t of JACKPOT_LADDER) {
      expect(MIGRATION).toMatch(new RegExp(`WHEN\\s+${t.fromValue}\\s+THEN\\s+${t.value}\\b`));
      expect(MIGRATION).toMatch(new RegExp(`WHEN\\s+${t.fromValue}\\s+THEN\\s+${t.units}\\b`));
      expect(MIGRATION).toMatch(new RegExp(`WHEN\\s+${t.fromValue}\\s+THEN\\s+'${t.name}'`));
    }
  });

  it('uses exactly two UPDATEs, so no tier can cascade into the next', () => {
    // Sequential per-tier UPDATEs are the trap the old 0020 warned about:
    // 1000 -> 500 followed by 500 -> 250 lands the top tier at 250. One
    // CASE statement per column reads every RHS from the pre-update row.
    expect((MIGRATION.match(/UPDATE passport_prizes/g) ?? []).length).toBe(2);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/prize-ladder.spec.ts`
Expected: FAIL - cannot resolve `../src/lib/prize-ladder` and cannot read the migration file.

- [ ] **Step 3: Create the ladder constant**

Create `src/lib/prize-ladder.ts`:

```ts
/**
 * The passport scan prize ladder - the single source of truth for the values
 * that migration 0021 and seed.sql land in the database.
 *
 * The supply lever is `value * units`, NOT probability. KrowdKredits never
 * expire and are never clawed back, so every jackpot credit ever won is
 * permanent supply. A big sticker is only safe when the stock is small;
 * probability only sets how fast a tier depletes, never how much it can mint.
 *
 * Nothing in src/handlers/ reads this - the database is what the scan roll
 * queries. It exists so the migration, the seed and the tests cannot drift
 * apart silently, which is exactly how the prize matrix got left behind by the
 * 2026-07-30 re-denomination in the first place.
 */

export interface JackpotTier {
  /** The value the row holds in production BEFORE 0021. The migration keys on this. */
  fromValue: number;
  /** The value a winner is actually paid after 0021. */
  value: number;
  /** Degree name. ScanPortal renders this directly above the value. */
  name: string;
  /** quantity_left - a hard lifetime count, not a per-period allowance. */
  units: number;
  /** Per-scan draw probability. Never shown to a member. */
  probability: number;
}

/** Floor prize value. Must equal what kkgame's passport_scan action pays. */
export const FLOOR_VALUE = 5;

/** The floor's pre-0021 production value, which the migration matches on. */
export const FLOOR_FROM_VALUE = 25;

export const JACKPOT_LADDER: JackpotTier[] = [
  { fromValue: 25, value: 25, name: 'Free Deal', units: 15, probability: 0.03 },
  { fromValue: 50, value: 50, name: 'Big Win', units: 10, probability: 0.02 },
  { fromValue: 100, value: 100, name: 'Jackpot', units: 6, probability: 0.012 },
  { fromValue: 500, value: 250, name: 'Grand Jackpot', units: 3, probability: 0.005 },
  { fromValue: 1000, value: 500, name: 'Legendary', units: 1, probability: 0.002 },
];

/** Credits this ladder can ever mint if every single unit is won. */
export function maxLifetimeMint(ladder: JackpotTier[] = JACKPOT_LADDER): number {
  return ladder.reduce((sum, t) => sum + t.value * t.units, 0);
}
```

- [ ] **Step 4: Delete the never-applied 0020**

```bash
git -C "C:/projects/passport" rm migrations/0020-prize-matrix-redenomination.sql
```

It was added by `121c5c9`, was never applied to any database (prod confirms original values intact), and lands the wrong numbers. Deleting an unapplied migration does not violate "never edit an applied migration". The rest of `121c5c9` - `FLOOR_PRIZE_VALUE = 5` and the Help copy fixes - stays.

- [ ] **Step 5: Create migration 0021**

Create `migrations/0021-prize-matrix-redenomination.sql`:

```sql
-- 0021: bring the passport scan prize matrix onto the 2026-07-30 economy scale.
--
-- WHY THIS EXISTS: a scan rolls a prize from passport_prizes and shows its
-- value on the reward card, but the wallet is credited by a completely
-- separate call - recordGameAction('passport_scan') - which pays a flat 5.
-- The 2026-07-30 re-denomination cut kkgame actions, quests, hunt tiers and
-- KrowdKwest, but passport_prizes was not in the CREDIT-ECONOMY-EVALUATION.md
-- section 7 table and was never touched. So the floor advertised 25 and paid
-- 5, and a jackpot advertised up to 1000 - more than the entire money supply -
-- and also paid 5. This migration lands the honest values; the handler change
-- that shipped alongside it makes the jackpot actually pay.
--
-- Supersedes migrations/0020-prize-matrix-redenomination.sql, which was
-- committed in 121c5c9 but never applied to any database and carried the wrong
-- ladder. It was deleted rather than run-and-corrected.
--
-- SHAPE: one UPDATE per table region, each column a CASE keyed on the ORIGINAL
-- value. In SQLite every SET right-hand side reads the pre-update row, so all
-- four columns remap in a single pass with no cascade. Sequential per-tier
-- UPDATEs would be a bug: 1000 -> 500 followed by 500 -> 250 lands the top
-- tier at 250. Matching is by prize_type + original value, never by id, so
-- this runs identically against local, seed and production databases.
--
-- Re-running is a no-op: after the first pass no kredits_base row holds 25 and
-- no jackpot row holds a source value that is not also its target (25/50/100
-- map to themselves, which is idempotent; 500 and 1000 no longer exist).
--
-- Apply: wrangler d1 execute krowdkraft-passport --local  --file=migrations/0021-prize-matrix-redenomination.sql
--        wrangler d1 execute krowdkraft-passport --remote --file=migrations/0021-prize-matrix-redenomination.sql

INSERT OR IGNORE INTO schema_migrations (name) VALUES ('0021-prize-matrix-redenomination');

-- Floor: 25 -> 5, matching kkgame's passport_scan base award.
UPDATE passport_prizes
   SET value = 5, name = 'KrowdKredits'
 WHERE prize_type = 'kredits_base' AND value = 25;

-- Jackpot ladder. Value, stock, probability and name all keyed on the ORIGINAL
-- value so each row is remapped exactly once.
UPDATE passport_prizes
   SET value = CASE value
                 WHEN   25 THEN  25
                 WHEN   50 THEN  50
                 WHEN  100 THEN 100
                 WHEN  500 THEN 250
                 WHEN 1000 THEN 500
                 ELSE value END,
       quantity_left = CASE value
                 WHEN   25 THEN 15
                 WHEN   50 THEN 10
                 WHEN  100 THEN  6
                 WHEN  500 THEN  3
                 WHEN 1000 THEN  1
                 ELSE quantity_left END,
       probability = CASE value
                 WHEN   25 THEN 0.030
                 WHEN   50 THEN 0.020
                 WHEN  100 THEN 0.012
                 WHEN  500 THEN 0.005
                 WHEN 1000 THEN 0.002
                 ELSE probability END,
       name = CASE value
                 WHEN   25 THEN 'Free Deal'
                 WHEN   50 THEN 'Big Win'
                 WHEN  100 THEN 'Jackpot'
                 WHEN  500 THEN 'Grand Jackpot'
                 WHEN 1000 THEN 'Legendary'
                 ELSE name END,
       is_active = 1
 WHERE prize_type = 'kredits_jackpot';
```

- [ ] **Step 6: Update seed.sql**

In `seed.sql`, replace the floor prize insert (currently value `25`) with value `5`, and add the five jackpot tiers so a freshly seeded database matches production. Replace lines 45-53 with:

```sql
-- Guaranteed floor prize. Every winning scan falls through to the kredits_base
-- prize when no upgraded prize is rolled, so this row MUST exist or scans 500.
-- value must equal what kkgame's passport_scan action actually pays (5 base,
-- 10 first-ever) - when the two drifted apart the card promised 25 and paid 5.
-- -1 quantity = unlimited; probability 0 = never in the weighted roll, only
-- the fallback.
INSERT OR IGNORE INTO passport_prizes
  (id, tenant_id, name, prize_type, value, details, probability, quantity_left, is_active, is_paced)
VALUES
  ('kredits-base-lake-locals', 'lake-locals', 'KrowdKredits', 'kredits_base', 5, NULL, 0, -1, 1, 0);

-- Jackpot ladder. Supply lever is value * quantity_left, because KrowdKredits
-- never expire: a big value is only safe on tiny stock. See src/lib/prize-ladder.ts.
INSERT OR IGNORE INTO passport_prizes
  (id, tenant_id, name, prize_type, value, details, probability, quantity_left, is_active, is_paced)
VALUES
  ('kredits-jackpot-1-lake-locals', 'lake-locals', 'Free Deal',     'kredits_jackpot',  25, NULL, 0.030, 15, 1, 0),
  ('kredits-jackpot-2-lake-locals', 'lake-locals', 'Big Win',       'kredits_jackpot',  50, NULL, 0.020, 10, 1, 0),
  ('kredits-jackpot-3-lake-locals', 'lake-locals', 'Jackpot',       'kredits_jackpot', 100, NULL, 0.012,  6, 1, 0),
  ('kredits-jackpot-4-lake-locals', 'lake-locals', 'Grand Jackpot', 'kredits_jackpot', 250, NULL, 0.005,  3, 1, 0),
  ('kredits-jackpot-5-lake-locals', 'lake-locals', 'Legendary',     'kredits_jackpot', 500, NULL, 0.002,  1, 1, 0);
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `npx vitest run test/prize-ladder.spec.ts`
Expected: PASS, 9 tests.

- [ ] **Step 8: Verify the migration against a local database**

```bash
cd C:/projects/passport
npx wrangler d1 execute krowdkraft-passport --local --file=migrations/0021-prize-matrix-redenomination.sql
npx wrangler d1 execute krowdkraft-passport --local --command "SELECT prize_type, name, value, quantity_left, probability, is_active FROM passport_prizes ORDER BY prize_type, value"
```

Expected: floor at 5; jackpots at 25/50/100/250/500 with stock 15/10/6/3/1 and probabilities 0.03/0.02/0.012/0.005/0.002, all `is_active = 1`.

Then prove idempotence - run the same file a second time and re-query:

```bash
npx wrangler d1 execute krowdkraft-passport --local --file=migrations/0021-prize-matrix-redenomination.sql
npx wrangler d1 execute krowdkraft-passport --local --command "SELECT prize_type, name, value, quantity_left FROM passport_prizes ORDER BY prize_type, value"
```

Expected: byte-identical to the first result. If the 250 tier has become 250 -> unchanged and the 500 has not moved, the CASE is behaving. **If any value shifted on the second run, stop - the migration is cascading and must be fixed before going near remote.**

- [ ] **Step 9: Commit**

```bash
git -C "C:/projects/passport" add src/lib/prize-ladder.ts migrations/ seed.sql test/prize-ladder.spec.ts
git -C "C:/projects/passport" commit -m "Land the jackpot ladder in migration 0021 and pin it with tests

- New src/lib/prize-ladder.ts as the single source of truth for the ladder,
  so the migration, seed and tests cannot drift the way passport_prizes
  drifted out of the 2026-07-30 re-denomination
- migrations/0021 remaps floor 25->5 and jackpots 25/50/100/500/1000 ->
  25/50/100/250/500 with stock 15/10/6/3/1, one CASE per column keyed on the
  original value so no tier cascades into the next
- Deleted the never-applied 0020, which carried the wrong ladder
- seed.sql now seeds the same ladder so fresh databases match production"
```

---

### Task 2: Jackpot payout on the logged-in scan

**Files:**
- Create: `src/lib/jackpot.ts`
- Modify: `src/handlers/passport.ts` (imports at :1-8; logged-in branch at :303-375)
- Modify: `ui/src/utils/ledgerLabels.ts:6-16`
- Test: `test/jackpot-payout-keys.spec.ts`

**Interfaces:**
- Consumes: `awardCredits(env, tenantId, userId, amount, reason, refType, refId, tradeCount?) => Promise<{ issued_amount: number; balance: number; new_badges: string[] }>` from `src/lib/credits.ts`; `ensureFloorPrize(env, tenantId) => Promise<DrawnPrize>` already in `passport.ts`.
- Produces: `JACKPOT_REF_TYPE: 'passport_jackpot'`, `isJackpot(prizeType: string): boolean`, `mergeBadges(a: string[], b: string[]): string[]`, `restoreQuantity(env: Env, prizeId: string): Promise<void>`. Task 3 and Task 4 both import from this module.

- [ ] **Step 1: Write the failing test**

Create `test/jackpot-payout-keys.spec.ts`:

```ts
// Guards the two properties that make jackpot payouts safe.
//
// 1. IDEMPOTENCY. Every jackpot award is keyed by the SCAN id, so one roll
//    pays exactly once whether it settles instantly (logged-in) or later
//    (guest deposit), and a retry after a KKCredits blip cannot double-pay.
// 2. ORDERING. The guest claim is closed AFTER the awards, so a KKCredits
//    failure leaves the claim pending and retryable instead of closing it
//    having paid nothing.
//
// WHAT THIS CAN AND CANNOT DO: it is a source scan, not an execution test.
// Passport's suite is pure-unit with no Worker or D1 harness, so nothing here
// moves credits. Behavioural proof that money lands is the live verification
// in the deploy gate. Same shape and same limits as splash-escrow-keys.spec.ts.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isJackpot, mergeBadges, JACKPOT_REF_TYPE } from '../src/lib/jackpot';

const SRC = readFileSync(
  fileURLToPath(new URL('../src/handlers/passport.ts', import.meta.url)),
  'utf8',
);

/** The raw argument text of every awardCredits(...) call in the handler. */
function awardCalls(src: string): string[] {
  const calls: string[] = [];
  const re = /awardCredits\(([\s\S]*?)\n\s*\);/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) calls.push(m[1]);
  return calls;
}

describe('jackpot helpers', () => {
  it('treats only kredits_jackpot as payable', () => {
    expect(isJackpot('kredits_jackpot')).toBe(true);
    expect(isJackpot('kredits_base')).toBe(false);
    expect(isJackpot('merchant_coupon')).toBe(false);
  });

  it('uses a stable ref_type', () => {
    expect(JACKPOT_REF_TYPE).toBe('passport_jackpot');
  });

  it('merges badge lists without duplicates, order stable', () => {
    expect(mergeBadges(['welcome'], ['century', 'welcome'])).toEqual(['welcome', 'century']);
    expect(mergeBadges([], [])).toEqual([]);
  });
});

describe('jackpot payout wiring', () => {
  it('finds both payout sites (guards against the regex matching nothing)', () => {
    expect(awardCalls(SRC).length).toBe(2);
  });

  it('keys every jackpot award by JACKPOT_REF_TYPE and a scan id', () => {
    for (const call of awardCalls(SRC)) {
      expect(call).toContain('JACKPOT_REF_TYPE');
      expect(call).toMatch(/scanId,|claim\.scan_id,/);
    }
  });

  it('restores the reserved unit when the logged-in award throws', () => {
    expect(SRC).toMatch(/catch[\s\S]{0,500}restoreQuantity\(/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/jackpot-payout-keys.spec.ts`
Expected: FAIL - cannot resolve `../src/lib/jackpot`.

- [ ] **Step 3: Create the jackpot helpers**

Create `src/lib/jackpot.ts`:

```ts
/**
 * Scan-jackpot payout helpers.
 *
 * A rolled jackpot is paid as its OWN KKCredits award, separate from the base
 * passport_scan game action. Keeping them separate is deliberate: the base
 * call carries credits, XP, badges and cooldown tracking, none of which may be
 * lost, and a distinct (ref_type, ref_id) fully under passport's control gives
 * clean exactly-once semantics independent of KKGame's internal action keying.
 * It also produces an honest, auditable "Passport jackpot +500" ledger line
 * rather than one opaque +505 recorded as a scan.
 */
import type { Env } from '../types';

/** KKCredits (ref_type, ref_id) namespace for a scan jackpot payout. */
export const JACKPOT_REF_TYPE = 'passport_jackpot';

/** Only kredits_jackpot rows carry a payable jackpot on top of the base award. */
export function isJackpot(prizeType: string): boolean {
  return prizeType === 'kredits_jackpot';
}

/** Union of two badge lists, order-stable, no duplicates. */
export function mergeBadges(a: string[], b: string[]): string[] {
  return [...new Set([...a, ...b])];
}

/**
 * Put one reserved unit back on a limited prize - the release half of the
 * atomic decrement taken at roll time. Mirrors KrowdKwest's awardWithBudget
 * release semantics. The `quantity_left >= 0` guard keeps the unlimited floor
 * prize (-1) untouched.
 */
export async function restoreQuantity(env: Env, prizeId: string): Promise<void> {
  await env.DB.prepare(
    'UPDATE passport_prizes SET quantity_left = quantity_left + 1 WHERE id = ? AND quantity_left >= 0',
  ).bind(prizeId).run();
}
```

- [ ] **Step 4: Add the imports to passport.ts**

In `src/handlers/passport.ts`, after the existing `import { distanceKm } from '../lib/geo';` (line 8), add:

```ts
import { awardCredits } from '../lib/credits';
import { isJackpot, mergeBadges, restoreQuantity, JACKPOT_REF_TYPE } from '../lib/jackpot';
```

- [ ] **Step 5: Pay the jackpot on the logged-in scan**

In `src/handlers/passport.ts`, in the `if (userId)` branch, replace these three lines (currently at :333-335):

```ts
    const freshBalance = gameResult?.credits_balance ?? 0;
    const newBadges = gameResult?.new_badges ?? [];
    const xpAwarded = gameResult?.xp_awarded ?? {};
```

with:

```ts
    let freshBalance = gameResult?.credits_balance ?? 0;
    let newBadges = gameResult?.new_badges ?? [];
    const xpAwarded = gameResult?.xp_awarded ?? {};

    // A rolled jackpot is paid as its own award on top of the base scan above.
    // Runs AFTER recordGameAction, so this award's returned balance is the
    // later of the two and is what the member should see.
    if (isJackpot(rolledPrize.prize_type)) {
      try {
        const jackpot = await awardCredits(
          c.env,
          tenant.id,
          String(userId),
          rolledPrize.value,
          'passport_jackpot',
          JACKPOT_REF_TYPE,
          scanId,
        );
        freshBalance = jackpot.balance;
        newBadges = mergeBadges(newBadges, jackpot.new_badges);

        // Show and store what KKCredits actually ISSUED, not what we asked for.
        // Identical today (the halving multiplier is 1). If halving ever
        // activates, this is what stops the card promising more than it paid -
        // the exact defect this whole change exists to remove.
        if (jackpot.issued_amount !== rolledPrize.value) {
          rolledPrize = { ...rolledPrize, value: jackpot.issued_amount };
          await c.env.DB.prepare('UPDATE passport_scans SET credits_won = ? WHERE id = ?')
            .bind(jackpot.issued_amount, scanId).run();
        }
      } catch (err) {
        // Never promise what we did not pay. Put the reserved unit back, patch
        // the scan record, and downgrade the response to the floor prize. The
        // member still keeps the base award from recordGameAction above.
        console.error('[scanPlaque] jackpot award failed:', err);
        await restoreQuantity(c.env, rolledPrize.id);
        rolledPrize = await ensureFloorPrize(c.env, tenant.id);
        await c.env.DB.prepare('UPDATE passport_scans SET credits_won = ? WHERE id = ?')
          .bind(rolledPrize.value, scanId).run();
      }
    }
```

Nothing else in the branch changes. The response block already reads `rolledPrize` and `freshBalance`, so the downgrade path flows through automatically.

- [ ] **Step 6: Add the ledger label**

In `ui/src/utils/ledgerLabels.ts`, add to `LEDGER_REASON_LABEL` after the `deal_refund` entry:

```ts
  passport_jackpot: 'Passport jackpot',
```

Without it, a member's history shows the raw reason text - the same leak the escrow fix caught with `ledger_correction`.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run`
Expected: PASS. `jackpot-payout-keys` finds 1 award call at this point, so **the "finds both payout sites" test will still fail with `1` - that is correct and expected until Task 3 adds the second.** Leave it failing; do not weaken the assertion.

- [ ] **Step 8: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean. If `rolledPrize` is reported as possibly undefined, that is the pre-existing `DrawnPrize | undefined` declaration - the reassignments here are all inside the `if (userId)` branch which runs after `rolledPrize` is definitely assigned at :299. Add a non-null assertion only if the compiler insists.

- [ ] **Step 9: Commit**

```bash
git -C "C:/projects/passport" add src/lib/jackpot.ts src/handlers/passport.ts ui/src/utils/ledgerLabels.ts test/jackpot-payout-keys.spec.ts
git -C "C:/projects/passport" commit -m "Pay the rolled jackpot on the logged-in scan

- New src/lib/jackpot.ts: JACKPOT_REF_TYPE, isJackpot, mergeBadges and the
  restoreQuantity release helper
- The scan now makes a second, separate awardCredits call keyed
  (user, passport_jackpot, scan_id) so one roll pays exactly once; the base
  passport_scan action is untouched and still carries XP, badges and cooldown
- On a KKCredits failure the reserved unit is restored, credits_won is patched
  and the response downgrades to the floor prize, so the card can never promise
  what the wallet did not receive
- Displays the issued_amount KKCredits returned rather than the requested value
- Ledger label so members see 'Passport jackpot', not the raw reason"
```

---

### Task 3: Jackpot payout on the guest claim deposit

**Files:**
- Modify: `src/handlers/passport.ts` (`attachClaim`, the `if (isKredits)` block at :529-559)
- Test: `test/jackpot-payout-keys.spec.ts` (re-enable the two-site assertion; add the ordering guard)

**Interfaces:**
- Consumes: `isJackpot`, `mergeBadges`, `JACKPOT_REF_TYPE` from `src/lib/jackpot.ts` (Task 2); `awardCredits` from `src/lib/credits.ts`.
- Produces: nothing new.

- [ ] **Step 1: Add the ordering test**

Append to the `describe('jackpot payout wiring', ...)` block in `test/jackpot-payout-keys.spec.ts`:

```ts
  it('closes the guest claim only after the awards have been made', () => {
    // If the claim closed first, a KKCredits failure would burn the code
    // having paid nothing. Awards are idempotent, so paying first and closing
    // last is safe under a concurrent double-deposit.
    const awardIdx = SRC.indexOf('claim.scan_id,');
    const closeIdx = SRC.indexOf("SET status = 'claimed'");
    expect(awardIdx).toBeGreaterThan(-1);
    expect(closeIdx).toBeGreaterThan(awardIdx);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/jackpot-payout-keys.spec.ts`
Expected: FAIL on two tests - "finds both payout sites" gets `1`, and the new ordering test finds no `claim.scan_id,`.

- [ ] **Step 3: Rewrite the isKredits block**

In `src/handlers/passport.ts`, replace the whole `if (isKredits) { ... }` block (:529-560) with:

```ts
  if (isKredits) {
    // The jackpot is paid BEFORE the claim is closed, keyed on the SAME
    // scan_id the original guest roll used. That makes it exactly-once across
    // both entry points, and it means a KKCredits failure leaves the claim
    // pending and retryable rather than closing a code that paid nothing.
    let jackpotBadges: string[] = [];
    if (isJackpot(claim.prize_type)) {
      try {
        const jackpot = await awardCredits(
          c.env,
          tenant.id,
          String(userId),
          claim.prize_value,
          'passport_jackpot',
          JACKPOT_REF_TYPE,
          claim.scan_id,
        );
        jackpotBadges = jackpot.new_badges;
      } catch (err) {
        console.error('[attachClaim] jackpot award failed:', err);
        throw new HTTPException(502, {
          message: 'We could not deposit your win just now. Your claim code is still good - please try again in a moment.',
        });
      }
    }

    // Runs after the jackpot, so this result's balance already includes it.
    const gameResult = await recordGameAction(c.env, {
      user_id: userId,
      action_id: 'passport_scan',
      source_app: 'passport',
      network_id: 'lake-and-locals',
      tenant_id: tenant.id,
      ref_type: 'plaque',
      ref_id: claim.plaque_id,
    });

    // Close last. Both awards above are idempotent on their refs, so under a
    // concurrent double-deposit neither pays twice, and whichever close wins
    // the other is a harmless no-op that surfaces as the 409 below.
    const closed = await c.env.DB.prepare(`
      UPDATE passport_claims SET status = 'claimed', contact_info = ?
      WHERE token_hash = ? AND status = 'pending' AND expires_at > unixepoch()
    `).bind(user.email, tokenHash).run();
    if (closed.meta.changes === 0) {
      throw new HTTPException(409, { message: 'This claim code has already been used or expired.' });
    }

    return c.json({
      data: {
        deposited: true,
        prize: { name: claim.prize_name, prize_type: claim.prize_type, value: claim.prize_value },
        user: {
          balance: gameResult?.credits_balance ?? 0,
          new_badges: mergeBadges(jackpotBadges, gameResult?.new_badges ?? []),
        },
        message: `Deposited! ${claim.prize_name} is now in your account, and the stamp is in your passport.`,
      },
    });
  }
```

**Shared-change note (enumerate before a shared change):** this moves the atomic claim-close from before the base award to after both awards. `attachClaim`'s only consumer is the Passport profile "deposit a claim" UI. The early duplicate rejection at :511 (`status === 'claimed'`) still catches ordinary re-use; the end-of-flow atomic close handles the genuine race. No `quantity_left` change happens here - the unit was reserved at the guest's original roll and correctly stays spent.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run`
Expected: PASS, all suites including "finds both payout sites" now at `2`.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git -C "C:/projects/passport" add src/handlers/passport.ts test/jackpot-payout-keys.spec.ts
git -C "C:/projects/passport" commit -m "Pay the jackpot when a guest deposits their claim

- attachClaim now awards a kredits_jackpot claim before closing it, keyed on
  the same scan_id as the original roll, so instant and deferred payment share
  one idempotency key and a retry cannot double-pay
- Claim close moved to the end of the flow: a KKCredits failure now returns 502
  with the claim still pending and retryable instead of burning the code
- Badges from the jackpot award merge with those from the base action"
```

---

### Task 4: Release units reserved by guest claims that lapse

**Files:**
- Create: `src/handlers/passport-internal.ts`
- Modify: `functions/api/[[route]].ts` (imports near :90; route registration near :420-427)

**Interfaces:**
- Consumes: `matchesInternalSecret(header, env)` from `src/lib/hmac`; `logger` from `src/lib/logger`.
- Produces: `expireJackpotClaimsSweep(env: Env): Promise<number>` and `internalExpireJackpotClaims(c: AppContext)`. Task 5 calls the endpoint over HTTP.

**Why this is needed:** only guest scans create claims for kredits prizes, and the unit is decremented at roll time. A guest who wins a limited prize and never registers lets the claim lapse at +7 days, and today that unit is burned permanently. With Legendary at one unit, a single no-show retires the top prize forever.

- [ ] **Step 1: Write the failing test**

Create `test/jackpot-expiry-sweep.spec.ts`:

```ts
// The sweep returns a reserved prize unit to stock when a guest never deposits
// their claim. Source scan - see the note in jackpot-payout-keys.spec.ts for
// why this repo's money-path tests are structural rather than behavioural.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SRC = readFileSync(
  fileURLToPath(new URL('../src/handlers/passport-internal.ts', import.meta.url)),
  'utf8',
);

describe('jackpot claim expiry sweep', () => {
  it('is gated by the internal secret', () => {
    expect(SRC).toContain('requireInternalSecret');
    expect(SRC).toContain('matchesInternalSecret');
  });

  it('only ever touches limited prizes, never the unlimited floor', () => {
    // quantity_left is -1 on the floor prize. Restoring it would invent stock
    // for something that is already unlimited and corrupt the sentinel.
    expect((SRC.match(/quantity_left >= 0/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it('gates the restore behind an atomic pending -> expired transition', () => {
    // The restore must only run when THIS sweep won the status flip, or a
    // re-run would hand back the same unit twice.
    const flipIdx = SRC.indexOf("SET status = 'expired'");
    const restoreIdx = SRC.indexOf('quantity_left = quantity_left + 1');
    expect(flipIdx).toBeGreaterThan(-1);
    expect(restoreIdx).toBeGreaterThan(flipIdx);
    expect(SRC).toMatch(/changes !== 1[\s\S]{0,200}quantity_left = quantity_left \+ 1/);
  });

  it('reports a processed count so the cron batch loop can terminate', () => {
    expect(SRC).toMatch(/data:\s*\{\s*processed\s*\}/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/jackpot-expiry-sweep.spec.ts`
Expected: FAIL - `passport-internal.ts` does not exist.

- [ ] **Step 3: Create the sweep handler**

Create `src/handlers/passport-internal.ts`:

```ts
/**
 * Passport - cron-called sweep that returns prize units reserved by guest
 * claims which were never deposited. Gated by X-Internal-Secret, mirroring
 * handlers/kwest-internal.ts.
 *
 * A guest scan decrements quantity_left at roll time and issues a 7-day claim
 * token. If the guest never registers, the claim lapses and that unit is
 * burned permanently - fatal for a one-unit tier. This releases it.
 *
 * attachClaim already refuses an expired claim, so a lapsed prize can never be
 * deposited even before this runs. The sweep's only job is returning stock.
 */
import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { Env } from '../types';
import { matchesInternalSecret } from '../lib/hmac';
import { logger } from '../lib/logger';

type AppContext = Context<{ Bindings: Env }>;

const SWEEP_BATCH = 20;

function requireInternalSecret(c: AppContext) {
  if (!matchesInternalSecret(c.req.header('X-Internal-Secret'), c.env)) {
    throw new HTTPException(401, { message: 'Unauthorized' });
  }
}

/**
 * Flip lapsed pending claims to expired and hand their reserved unit back.
 *
 * The atomic status transition GATES the restore: only the caller that
 * actually won the pending -> expired flip restores a unit, so running this
 * twice never hands back the same unit twice. A restore adds exactly the one
 * unit that claim reserved at roll time, so stock can never exceed what was
 * originally rolled out and no separate ceiling is needed.
 *
 * `quantity_left >= 0` limits this to LIMITED prizes - the floor prize carries
 * -1 (unlimited) and must never be touched.
 */
export async function expireJackpotClaimsSweep(env: Env): Promise<number> {
  const { results } = await env.DB.prepare(`
    SELECT cl.token_hash, cl.prize_id
      FROM passport_claims cl
      JOIN passport_prizes p ON p.id = cl.prize_id
     WHERE cl.status = 'pending'
       AND cl.expires_at < unixepoch()
       AND p.quantity_left >= 0
     LIMIT ?
  `).bind(SWEEP_BATCH).all<{ token_hash: string; prize_id: string }>();

  let processed = 0;
  for (const row of results ?? []) {
    try {
      const flip = await env.DB.prepare(
        "UPDATE passport_claims SET status = 'expired' WHERE token_hash = ? AND status = 'pending'",
      ).bind(row.token_hash).run();
      if (flip.meta.changes !== 1) continue; // another sweep already took it

      await env.DB.prepare(
        'UPDATE passport_prizes SET quantity_left = quantity_left + 1 WHERE id = ? AND quantity_left >= 0',
      ).bind(row.prize_id).run();
      processed++;
    } catch (err) {
      logger.error(`Jackpot claim expiry failed for ${row.token_hash}: ${(err as Error).message}`);
    }
  }

  return processed;
}

/** POST /api/internal/passport/expire-jackpot-claims */
export async function internalExpireJackpotClaims(c: AppContext) {
  requireInternalSecret(c);
  const processed = await expireJackpotClaimsSweep(c.env);
  return c.json({ data: { processed } });
}
```

**Deviation from the spec, with reason:** the spec sketched a single `UPDATE ... RETURNING prize_id` driving the batch. This uses the select-then-atomic-flip loop instead, which is the shape `kwest-internal.ts` already uses in this repo for exactly this pattern, and keeps the per-row failure isolation the `try/catch` gives. The idempotency property is identical - the flip still gates the restore.

**Scope note:** the `quantity_left >= 0` join covers every limited prize, not only jackpots, so a lapsed physical-prize claim also returns its unit. That is the correct general behaviour and costs nothing today (production holds only `kredits_base` and `kredits_jackpot` rows). The endpoint keeps the spec's name.

- [ ] **Step 4: Register the route**

In `functions/api/[[route]].ts`, add the import alongside the other internal handlers (near line 90):

```ts
import { internalExpireJackpotClaims } from '../../src/handlers/passport-internal';
```

and register the route next to the other cron backstops (after line 424):

```ts
// Cron backstop returning prize units reserved by guest claims that lapsed
// unclaimed (X-Internal-Secret protected)
app.post('/api/internal/passport/expire-jackpot-claims', internalExpireJackpotClaims);
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run`
Expected: PASS, all suites.

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git -C "C:/projects/passport" add src/handlers/passport-internal.ts functions/api/ test/jackpot-expiry-sweep.spec.ts
git -C "C:/projects/passport" commit -m "Return prize units reserved by guest claims that lapse unclaimed

- New POST /api/internal/passport/expire-jackpot-claims, X-Internal-Secret
  gated, batched, reporting a processed count for the cron loop
- A guest who wins a limited prize and never registers used to burn that unit
  permanently, which with a one-unit tier retires the top prize forever
- The atomic pending -> expired flip gates the restore, so a re-run can never
  hand the same unit back twice; the unlimited floor prize is never touched"
```

---

### Task 5: Wire the sweep into passport-cron

**Files:**
- Modify: `C:\projects\passport-cron\src\index.ts` (`Env` at :1-8; `runDailySweeps` at :58-62)
- Modify: `C:\projects\passport-cron\wrangler.toml` (`[vars]` at :16-20)

**Interfaces:**
- Consumes: `POST /api/internal/passport/expire-jackpot-claims` returning `{ data: { processed } }` (Task 4).
- Produces: nothing.

- [ ] **Step 1: Add the URL to the Env interface**

In `src/index.ts`, add to `interface Env` after `SUPPORT_RETENTION_URL`:

```ts
  EXPIRE_JACKPOT_CLAIMS_URL: string;
```

- [ ] **Step 2: Add the sweep to the daily run**

In `runDailySweeps`, after the support retention line:

```ts
  await runBatchedSweep('jackpot claim expiry', env.EXPIRE_JACKPOT_CLAIMS_URL, env);
```

Daily is the right cadence: the claim window is 7 days, so a unit sitting in limbo for a few extra hours costs nothing, and `attachClaim` already refuses expired claims independently.

- [ ] **Step 3: Add the var**

In `wrangler.toml`, under `[vars]`:

```toml
EXPIRE_JACKPOT_CLAIMS_URL = "https://passport.lakeandlocals.com/api/internal/passport/expire-jackpot-claims"
```

- [ ] **Step 4: Typecheck**

Run: `cd C:/projects/passport-cron && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git -C "C:/projects/passport-cron" add src/index.ts wrangler.toml
git -C "C:/projects/passport-cron" commit -m "Run the jackpot claim expiry sweep in the daily cron

- Adds EXPIRE_JACKPOT_CLAIMS_URL and calls it from runDailySweeps via the
  existing batched loop, so units reserved by guests who never registered
  return to stock"
```

---

### Task 6: Deploy gate - HARD STOP

**This task does not begin without Jim's explicit go.** Values must be correct before payouts go live, or the first winner is paid at the old scale.

- [ ] **Step 1: Confirm the deploying identity**

Run: `npx wrangler@4 whoami`
Expected: `gottabuylocal@gmail.com`, account `943518e1efbb7399d5f04cdf63233024`. If it reports `jodpur@yahoo.com` / `aa3f8a74...`, stop - that account has no access to these resources.

- [ ] **Step 2: Capture the pre-migration state**

```bash
npx wrangler d1 execute krowdkraft-passport --remote --command "SELECT id, prize_type, name, value, quantity_left, probability, is_active FROM passport_prizes ORDER BY prize_type, value"
```

Record the output in the session log. This is the rollback reference.

- [ ] **Step 3: Apply migration 0021 to remote D1**

```bash
npx wrangler d1 execute krowdkraft-passport --remote --file=migrations/0021-prize-matrix-redenomination.sql
```

- [ ] **Step 4: Verify the migration landed**

```bash
npx wrangler d1 execute krowdkraft-passport --remote --command "SELECT prize_type, name, value, quantity_left, probability, is_active FROM passport_prizes ORDER BY prize_type, value"
npx wrangler d1 execute krowdkraft-passport --remote --command "SELECT name FROM schema_migrations ORDER BY rowid DESC LIMIT 3"
```

Expected: floor `KrowdKredits` at 5; `Free Deal` 25/15/0.03, `Big Win` 50/10/0.02, `Jackpot` 100/6/0.012, `Grand Jackpot` 250/3/0.005, `Legendary` 500/1/0.002, all active; `0021-prize-matrix-redenomination` present in the ledger. **Do not proceed to Step 5 unless every row matches.**

- [ ] **Step 5: Deploy passport**

```bash
cd C:/projects/passport && npm run deploy
npx wrangler pages deployment list --project-name krowdkraft-passport
```

Expected: `Environment: Production`, branch `prod`, the commit from Task 4.

- [ ] **Step 6: Deploy passport-cron**

```bash
cd C:/projects/passport-cron && npx wrangler deploy
```

- [ ] **Step 7: Prove the endpoint is gated and reachable**

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://passport.lakeandlocals.com/api/internal/passport/expire-jackpot-claims
```

Expected: `401`. A `404` means the route did not register.

- [ ] **Step 8: Live jackpot verification on the test account**

Using Fred Fender (see the standing test-account rule - create test data, do not delete it):

1. Temporarily raise one jackpot tier's `probability` to `1.0` on remote D1, recording the original value.
2. Scan a plaque as Fred while signed in.
3. Confirm the reward card shows the tier's degree name and value.
4. Query the KKCredits ledger:
   ```sql
   SELECT amount, reason, ref_type, ref_id, created_at
     FROM ledger
    WHERE ref_type = 'passport_jackpot'
    ORDER BY created_at DESC LIMIT 5;
   ```
   Expected: exactly one row for that scan id, amount equal to the tier value, plus the separate base `passport_scan` row. Two rows for one scan id is a failure.
5. Confirm the member's history renders "Passport jackpot", not the raw reason.
6. Confirm `quantity_left` on that tier decremented by exactly one.
7. **Restore the original probability.** Verify it is back before finishing.

- [ ] **Step 9: Report to Jim**

State the pre- and post-migration prize rows, the deployment IDs and environments, the ledger row from the forced win, and confirmation that the test probability was restored.

**Rollback:** re-run the recorded pre-migration values as a one-off `UPDATE`, and `git revert` the Task 2/3/4 commits, then redeploy. No data migration is needed in either direction - credits already paid stay paid, which is correct and is exactly why the values had to be right before this went live.

---

## Self-Review

**Spec coverage**

| Spec section | Covered by |
|---|---|
| §4 Prize matrix migration | Task 1 |
| §5 Logged-in payout | Task 2 |
| §6 Guest claim deposit | Task 3 |
| §7 Expiry restore (endpoint + cron) | Tasks 4 and 5 |
| §8 Ledger label | Task 2, Step 6 |
| §9 Idempotency and concurrency | Enforced in Tasks 2-4, asserted in `jackpot-payout-keys` and `jackpot-expiry-sweep` |
| §12 Testing | Tasks 1-4 test steps, plus Task 6 Step 8 for the behavioural leg the unit suite cannot cover |
| §13 Deploy sequencing | Task 6 |
| §14 Files touched | File Structure table |

Out-of-scope items from §3 (phantom `merchant_coupon` / `merchant_gift` / `cash` prize types, the pre-existing base-scan cooldown race, jackpot celebration UI) are deliberately not implemented.

**Deviations from the spec, all flagged in place:** route prefix corrected to `/api/internal/...`; sweep uses the repo's select-then-flip loop rather than `UPDATE ... RETURNING`; D4 adds `issued_amount` display. Decisions D1-D3 adopt the spec's own recommendations and need Jim's confirmation before Task 1.

**Placeholder scan:** none. Every code step carries the literal content to write.

**Type consistency:** `JACKPOT_REF_TYPE`, `isJackpot`, `mergeBadges`, `restoreQuantity` are defined in Task 2 and consumed under those exact names in Tasks 3 and 4. `expireJackpotClaimsSweep` / `internalExpireJackpotClaims` are defined in Task 4 and consumed by name in Task 5's route. `awardCredits`' return shape (`issued_amount`, `balance`, `new_badges`) matches `src/lib/credits.ts:27`.

**Known ordering asymmetry, deliberate:** on the logged-in path the jackpot award runs *after* `recordGameAction`, so the jackpot's returned `balance` is the fresher number and is used. On the guest path the jackpot runs *before* `recordGameAction`, so `gameResult.credits_balance` is the fresher number and is used. Both display base + jackpot. Do not "tidy" one to match the other without re-checking which call settles last.
