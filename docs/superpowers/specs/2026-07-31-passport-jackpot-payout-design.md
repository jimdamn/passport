# Passport Jackpot Payout — Design Spec

**Date:** 2026-07-31
**Repo:** `C:\projects\passport` (+ `C:\projects\passport-cron`)
**Status:** Design approved by Jim; ready for implementation plan.

---

## 1. Problem

A passport scan rolls a prize from `passport_prizes`. The rolled prize's value is
shown to the member on the reward card and written to `passport_scans.credits_won`,
but the wallet is credited by a **completely separate** call —
`recordGameAction('passport_scan')` — which always pays the flat `passport_scan`
amount (5 base, 10 first-ever) no matter what was rolled.

The floor prize (`kredits_base`) only *looks* honored by coincidence: it shows 5 and
`passport_scan` pays 5. Every `kredits_jackpot` shows its value (up to 1000 today) and
still pays 5. **Jackpots are advertised but never paid.**

This spec makes jackpots real: the wallet receives the jackpot value, through the one
KKCredits ledger, idempotently, with supply bounded by stock — and re-scales the
jackpot ladder onto the post-2026-07-30 economy.

Two entry points have the identical defect and both must be fixed:
- **Logged-in scan** — `src/handlers/passport.ts:323`
- **Guest claim deposit** — `src/handlers/passport.ts:539` (`attachClaim`), where a guest
  who won a jackpot registers and deposits the claim, and also gets the flat 5.

---

## 2. The jackpot ladder (agreed)

Effort-denominated, never dollars (fiat pegs are doctrine-banned). Anchors: a scan = 5,
a deal = 25, a full month of exploring = 50–70, richest account today = 337, total
supply today = 977.

The supply lever is **`value × quantity_left`** — because KrowdKredits never expire and
are never clawed back, every jackpot credit is permanent supply. A big sticker is safe
only when the stock is small.

| Degree name    | Value | Units ever (`quantity_left`) | Probability (per scan) | Max lifetime mint |
|----------------|------:|:----------------------------:|:----------------------:|------------------:|
| Free Deal      |  **25** | 15 | 0.030 | 375 |
| Big Win        |  **50** | 10 | 0.020 | 500 |
| Jackpot        | **100** |  6 | 0.012 | 600 |
| Grand Jackpot  | **250** |  3 | 0.005 | 750 |
| Legendary      | **500** |  1 | 0.002 | 500 |

Floor prize (`kredits_base`) stays at **5**, matching `passport_scan` (5 / 10 first-ever).

- **Absolute ceiling** if every unit is ever won: **2,725** credits, spread over the
  entire life of the program and realizable only at jackpot-rare odds — realistically a
  fraction of that. `quantity_left` is a hard count; it physically cannot overshoot.
- **Probabilities are a tunable** (see §11, decision D3). They set how fast each tier
  depletes, never how much it can mint. The gradient above makes bigger prizes rarer;
  cumulative any-jackpot chance ≈ 6.9%.
- Top held at **500**, not the original 1000: at ~977 supply a 1000 prize is more than the
  entire economy in one scan. A 1000 "legendary" is a future unlock once supply supports
  it (bump from the economy admin screen), consistent with "jackpots scale with the
  economy."

---

## 3. Scope

**In scope**
1. Re-denominate the prize matrix to the §2 ladder (migration).
2. Honor jackpot payouts on the logged-in scan path.
3. Honor jackpot payouts on the guest → claim-deposit path.
4. Restore a reserved `quantity_left` unit when a guest jackpot claim expires unclaimed
   (passport internal endpoint + passport-cron sweep).
5. Ledger label so members never see the raw `passport_jackpot` reason.
6. Tests for each of the above.

**Out of scope (follow-ups, not built here)**
- The three advertised-but-nonexistent prize types (`merchant_coupon`, `merchant_gift`,
  `cash`). They have never had rows in prod and are a separate feature — see
  `project_passport_help_audit`.
- The pre-existing base-scan cooldown race (two sub-second double-submits could each pass
  the pre-roll cooldown check and each pay the base 5). It predates this work and is
  bounded for jackpots by the atomic `quantity_left` decrement (§7). Noted, not fixed.
- Any "you hit the jackpot!" celebratory UI treatment. The reward card already displays
  the prize name + value; this spec makes the number true. Visual polish is a separate ask.

---

## 4. Component A — Prize matrix migration

**Current prod state** (confirmed by query 2026-07-31 — migration `0020` was never applied,
so prod still holds the original values):

| id | prize_type | value | qty | prob | active |
|----|-----------|------:|----:|-----:|:------:|
| `test-prize-base` | kredits_base | 25 | -1 | 1.0 | 1 |
| `zda8W_cRMG` | kredits_jackpot | 25 | 20 | 0.05 | 1 |
| `gbmFHc2yzw` | kredits_jackpot | 50 | 20 | 0.05 | 1 |
| `P2eI3c8_Md` | kredits_jackpot | 100 | 20 | 0.01 | 1 |
| `c038uGL4ji` | kredits_jackpot | 500 | 20 | 0.01 | 1 |
| `7x5AIvAKSY` | kredits_jackpot | 1000 | 20 | 0.01 | 1 |

**Target state** = the §2 ladder. Value remap: base 25→5; jackpots 25→25, 50→50, 100→100,
**500→250**, **1000→500**. All five jackpot tiers stay `is_active = 1`.

**Migration hygiene (decision D1, recommended path):** commit `121c5c9` added
`migrations/0020-prize-matrix-redenomination.sql`, which was **never applied to any
database** (prod query confirms original values intact) and lands the wrong numbers
(100/50/10/5, retires the 25 tier). Rather than run a wrong migration and correct it:
- **Delete** `migrations/0020-prize-matrix-redenomination.sql`.
- **Add** `migrations/0021-prize-matrix-redenomination.sql` that lands the §2 ladder
  directly against the actual current prod state, and registers itself in
  `schema_migrations`.
- Keep the good, already-correct parts of `121c5c9` (`FLOOR_PRIZE_VALUE = 5` in code, all
  Help.tsx copy fixes). Those stand.

This respects "never edit an applied migration" (0020 was never applied) and
"ordered migrations + `schema_migrations` ledger."

**Migration shape** — one `UPDATE` with per-column `CASE` keyed on the **original** value.
In SQLite every `SET` RHS sees the pre-update row, so value/quantity/probability/name can
all be remapped in a single statement with no cascade (the bug the old 0020 header warned
about). Match by `prize_type` + original `value` (env-agnostic, not by id).

```sql
INSERT OR IGNORE INTO schema_migrations (name) VALUES ('0021-prize-matrix-redenomination');

-- Floor: 25 -> 5 (matches passport_scan base).
UPDATE passport_prizes
   SET value = 5, name = 'KrowdKredits'
 WHERE prize_type = 'kredits_base' AND value = 25;

-- Jackpot ladder: value / quantity / probability / name, all keyed on the
-- ORIGINAL value in one statement so each row is remapped exactly once.
UPDATE passport_prizes
   SET value = CASE value
                 WHEN   25 THEN  25  WHEN 50 THEN  50  WHEN 100 THEN 100
                 WHEN  500 THEN 250  WHEN 1000 THEN 500 ELSE value END,
       quantity_left = CASE value
                 WHEN   25 THEN 15  WHEN 50 THEN 10  WHEN 100 THEN 6
                 WHEN  500 THEN 3   WHEN 1000 THEN 1  ELSE quantity_left END,
       probability = CASE value
                 WHEN   25 THEN 0.030 WHEN 50 THEN 0.020 WHEN 100 THEN 0.012
                 WHEN  500 THEN 0.005 WHEN 1000 THEN 0.002 ELSE probability END,
       name = CASE value
                 WHEN   25 THEN 'Free Deal'     WHEN 50 THEN 'Big Win'
                 WHEN  100 THEN 'Jackpot'       WHEN 500 THEN 'Grand Jackpot'
                 WHEN 1000 THEN 'Legendary'     ELSE name END,
       is_active = 1
 WHERE prize_type = 'kredits_jackpot';
```

`seed.sql` is updated to the same target values so fresh/local DBs match prod.

Names use the **degree** names, not "N KrowdKredits", because ScanPortal renders the name
directly above the value — "Legendary" + "500" reads as a real win. (Decision D2: confirm
degree names vs. value-strings.)

---

## 5. Component B — Jackpot payout on the logged-in scan

**File:** `src/handlers/passport.ts`, logged-in branch (~303–375).

The base `passport_scan` call is **unchanged** — it still delivers base credits, XP,
badges, and cooldown tracking, none of which may be lost. The jackpot is a **separate,
additional** `awardCredits` call layered on top. Member nets base + jackpot (505 on a 500);
the ledger shows two honest lines. This mirrors the KrowdKwest jackpot precedent
(`lib/kwest-economy.ts` `awardWithBudget` → `lib/credits.ts` `awardCredits`), which is the
established pattern for a chance prize with a supply guard.

**Flow (minimal change to the shared scan/claim inserts):**
1. INSERT `passport_scans` with `credits_won = rolledPrize.value` — unchanged.
2. `recordGameAction('passport_scan')` — unchanged (base + XP + badges).
3. **New:** if `rolledPrize.prize_type === 'kredits_jackpot'`:
   ```
   try:
     const res = await awardCredits(
       env, tenant.id, String(userId),
       rolledPrize.value,              // the jackpot amount
       'passport_jackpot',             // reason (mapped by ledgerLabels)
       'passport_jackpot',             // ref_type
       scanId,                         // ref_id — unique per roll
     )
     freshBalance = res.balance        // reflects base + jackpot
     newBadges = merge(newBadges, res.new_badges)
   catch:
     // KKCredits unreachable/failed — never promise what we didn't pay.
     await restoreQuantity(rolledPrize.id)                  // quantity_left + 1
     await DB('UPDATE passport_scans SET credits_won = ? WHERE id = ?', FLOOR, scanId)
     rolledPrize = await ensureFloorPrize(env, tenant.id)   // response downgrades to floor
     log.error(...)
   ```
4. Build the response from the (possibly downgraded) `rolledPrize` and `freshBalance`.

**Why separate award, not `credits_override` on the scan call:** a distinct
`(user, 'passport_jackpot', scanId)` key is fully under passport's control and gives clean
exactly-once semantics independent of KKGame's internal action-idempotency keying. It also
produces a transparent, auditable "Jackpot +500" ledger line rather than a single opaque
+505 recorded as a scan.

**Balance note:** `gameResult.credits_balance` reflects only the base award. When a jackpot
is paid, use `awardCredits`' returned `balance` for `freshBalance`.

Logged-in `kredits` prizes create **no** claim row (only non-kredits do, `:313`), so the
logged-in path has no expiry concern — the jackpot is paid instantly.

---

## 6. Component C — Jackpot payout on the guest claim deposit

**File:** `src/handlers/passport.ts`, `attachClaim` (~491–560).

A guest scan already decremented `quantity_left` at roll time and issued a claim token for
the rolled prize (including jackpots). When the guest registers and deposits the claim, the
jackpot must be paid. The claim carries `prize_value`, `prize_type`, and `scan_id`.

**Idempotency is the guard, not locking.** The jackpot award is keyed
`(user, 'passport_jackpot', claim.scan_id)` — the **same** `scan_id` as the original roll —
so it is exactly-once whether paid instantly (logged-in) or deferred (guest), and safe to
retry. Ordering changes so a KKCredits failure leaves the claim retryable:

1. Pre-checks (claim exists / not already claimed / not expired) — unchanged (`:508–516`).
2. Move the guest scan into the user (`UPDATE passport_scans SET user_id`) — unchanged.
3. **New:** if `prize_type === 'kredits_jackpot'`, `awardCredits(prize_value,
   'passport_jackpot', 'passport_jackpot', claim.scan_id)`. On throw → return 502; the claim
   is still `pending`, and a retry re-issues idempotently (KKCredits dedupes).
4. `recordGameAction('passport_scan')` base award — unchanged.
5. **Close the claim atomically** (`status='claimed'`) as the **final** step. Concurrent
   double-deposit is safe: both awards dedupe on their refs; whichever close wins, the
   other is a no-op.

**Shared-change note (enumerate-before-shared-change):** this moves the atomic claim-close
from before the base award to after the awards. The early duplicate rejection at `:511`
(pre-check `status === 'claimed'`) still catches normal re-use; the end-of-flow atomic close
handles the race. Consumers of `attachClaim` are the profile "deposit a claim" UI only.

No `quantity_left` change happens at deposit time — the unit was reserved at the guest's
original roll. If the guest deposits within 7 days, the reservation correctly stays spent.

---

## 7. Component D — Restore reserved units on guest-claim expiry

Only **guest** scans create claims for `kredits` prizes; logged-in jackpots are instant and
never reserved-then-abandoned. A guest who wins a limited jackpot and never registers lets
the claim lapse at +7 days — today that **permanently burns the reserved unit**, and with
the Legendary at 1 unit a single no-show retires the top prize forever. This component
releases the reservation on expiry.

**passport internal endpoint** (new): `POST /internal/passport/expire-jackpot-claims`,
guarded by `X-Internal-Secret` (matching existing sweep endpoints). Batched, returns
`{ data: { processed } }` so it slots into the existing `runBatchedSweep` loop.

Logic, per batch (`LIMIT` N), fully idempotent — the atomic status transition gates the
restore so a unit is released **exactly once**:
```
-- Select expired, still-pending claims on LIMITED prizes (quantity_left >= 0).
-- For each, atomically flip pending -> expired; only on a real transition,
-- restore one unit. A single UPD..RETURNING drives the batch.
UPDATE passport_claims
   SET status = 'expired'
 WHERE token_hash IN (
   SELECT cl.token_hash FROM passport_claims cl
   JOIN passport_prizes p ON p.id = cl.prize_id
   WHERE cl.status = 'pending' AND cl.expires_at < unixepoch()
     AND p.quantity_left >= 0            -- limited prizes only; floor is -1 (unlimited)
   LIMIT ?)
 RETURNING prize_id;
-- Then, for the returned prize_ids: UPDATE passport_prizes
--   SET quantity_left = quantity_left + 1 WHERE id = ? AND quantity_left >= 0;
```
`status = 'expired'` is already a recognized claim state (`redeem.ts:106`), so no schema
change. The `quantity_left >= 0` guard keeps the unlimited floor prize (`-1`) untouched.
A restore adds exactly one unit per lapsed claim — the same unit that claim reserved at
roll time — so stock can never exceed what was originally rolled out; no separate ceiling
is needed.

**passport-cron** (`C:\projects\passport-cron\src\index.ts`): add
`EXPIRE_JACKPOT_CLAIMS_URL` to `Env`, and call it inside `runDailySweeps` via
`runBatchedSweep('jackpot claim expiry', env.EXPIRE_JACKPOT_CLAIMS_URL, env)`. Add the URL
to `wrangler.toml` vars. It also runs on the manual `fetch` trigger, like the others.

Lazy backstop: `attachClaim` already refuses an expired claim (`:514`), so even before the
sweep runs a lapsed jackpot can't be deposited; the sweep's job is purely to return the
unit to stock.

---

## 8. Component E — Ledger label

`ui/src/utils/ledgerLabels.ts` — add to `LEDGER_REASON_LABEL`, keyed by `ref_type`:
```
passport_jackpot: 'Passport jackpot',
```
Without it, the member's history shows the raw reason. (Same class of leak the escrow fix
caught with `ledger_correction`.) Display-only; changes nothing the ledger stores.

---

## 9. Idempotency & concurrency (summary)

- **Every jackpot award** is keyed `(user_id, 'passport_jackpot', scan_id)` — KKCredits
  enforces `UNIQUE(user_id, ref_type, ref_id)`, so the same roll pays exactly once across
  instant payment, guest deposit, and any retry.
- **Total mint is hard-bounded by `quantity_left`.** The decrement at roll (`:291–294`) is an
  atomic conditional `UPDATE ... WHERE quantity_left > 0`; concurrent scans racing for the
  last unit resolve to one winner, the loser drops to the floor. This is the primary supply
  guard and it holds regardless of request races.
- **Reservation release on failure** (logged-in KKCredits error, §5) and **on expiry**
  (guest no-show, §7) both restore exactly one unit via gated atomic updates, mirroring
  `awardWithBudget`'s release semantics.
- **Guest deposit** relies on idempotent refs rather than the claim-close lock, so a
  KKCredits blip is safely retryable.

---

## 10. Doctrine compliance (krowdkraft-economic-safety)

- **Single ledger:** all payment via KKCredits `awardCredits`; passport keeps no credits
  ledger. ✓
- **Gamified award routing:** a scan prize is a game reward; it routes through the same
  `awardCredits` client the KrowdKwest chance prize uses. ✓
- **Never expire / no clawback:** paid credits are permanent; no TTL touches KKCredits. The
  only "expiry" here is on the *claim token* (a 7-day deposit window), never on credits. ✓
- **Idempotent, stable `(ref_type, ref_id)`:** yes (§9). ✓
- **No fiat peg / no cash-out:** values are effort-denominated; no conversion path. ✓
- **Supply discipline:** `value × quantity_left` bounded; big values gated by tiny stock. ✓
- **Predictable-vs-random caveat (honest flag):** a chance draw with big rare prizes is the
  most slot-machine-shaped form of the mechanic, which the doctrine cautions against. Jim
  holds a standing decision that the per-scan draw stays (`project_prize_draw_mechanic`);
  this spec honors that decision and keeps the top prize a *community windfall* (500, a
  fraction of a growing economy) rather than a Vegas number, which is the on-mission and
  supply-safe posture within that decision.

---

## 11. Decisions to confirm before/within the plan

- **D1 — Migration hygiene:** delete unshipped `0020`, add `0021` landing the final ladder
  directly. *(Recommended; §4.)*
- **D2 — Prize names:** degree names (Free Deal / Big Win / Jackpot / Grand Jackpot /
  Legendary) vs. value-strings ("500 KrowdKredits"). *(Recommend degree names.)*
- **D3 — Probabilities:** the rarity gradient in §2 (0.030 → 0.002). Tunable; confirm or
  adjust. This is the one change beyond "payout wiring + values" and is flagged rather than
  assumed.

---

## 12. Testing

- **Migration:** apply to a local copy of the real rows; assert final value/qty/prob/name
  per tier, base = 5, all five tiers active, `schema_migrations` row present. Assert idempotent
  re-run is a no-op (matches on original values only).
- **Logged-in jackpot:** a forced jackpot roll credits the wallet by base + jackpot with a
  single `(user, 'passport_jackpot', scanId)` ledger row; a second submit of the same scanId
  does not double-pay.
- **Logged-in failure path:** stub `awardCredits` to throw → `quantity_left` restored,
  `credits_won` patched to floor, response shows the floor prize, member still got base.
- **Guest deposit:** guest jackpot → claim → deposit credits base + jackpot; re-deposit is a
  no-op; a KKCredits failure leaves the claim `pending` and retry pays exactly once.
- **Expiry restore:** a pending guest jackpot claim past `expires_at` → sweep flips it to
  `expired` and restores one unit; re-running the sweep does not restore twice; the unlimited
  floor prize is never touched.
- **Quantity race:** two concurrent last-unit rolls → one jackpot, one floor; stock never
  goes negative.

Follow the repo's existing money-path test style (source-scan + behavioral where a live
KKCredits isn't available), consistent with the escrow-fix test approach.

---

## 13. Deploy sequencing

Values must be correct **before** payouts go live, or the first winner pays out at the old
scale. Order:
1. Apply migration `0021` to remote D1 (prod values become the §2 ladder).
2. Deploy passport Worker (payout wiring + label + internal expiry endpoint).
3. Deploy passport-cron with the new sweep URL/binding.
4. Verify: forced jackpot on a test account (Fred Fender) credits base + jackpot with one
   labeled ledger row; deploy shows Environment = Production.

All deploys are HARD-STOP gates requiring Jim's go, per standing instruction.

---

## 14. Files touched

- `migrations/0021-prize-matrix-redenomination.sql` (new); delete
  `migrations/0020-prize-matrix-redenomination.sql`
- `seed.sql` (prize target values)
- `src/handlers/passport.ts` (logged-in payout §5; guest deposit §6; new internal expiry
  endpoint §7)
- `src/routers/*` (register the internal expiry route)
- `ui/src/utils/ledgerLabels.ts` (label §8)
- `C:\projects\passport-cron\src\index.ts` + `wrangler.toml` (sweep wiring §7)
- tests per §12
