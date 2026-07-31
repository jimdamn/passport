# Design: Economy admin route (`/profile/admin/economy`)

**Date:** 2026-07-31
**Status:** design approved by Jim, not yet planned or built
**Owner app:** Passport (`C:\projects\passport`)
**Touches:** Passport, KKGame, Exchange, kkgame KV

---

## 1. Why this exists

The 2026-07-30 economic evaluation (`C:\projects\CREDIT-ECONOMY-EVALUATION.md`) found that credit
values were scattered across five stores with no single view, no shared scale, and no way to see the
whole earning surface at once. Two concrete failures followed from that:

1. The Exchange displayed a trade award of 10 while the ledger issued 50, for weeks, because two
   stores each held a copy of one number and nothing compared them.
2. The 2026-07-30 re-denomination cut rewards roughly 10x while every guard stayed at its old
   absolute value, silently making every ceiling ~10x looser. Nothing surfaced it; it was found by
   reading code for an unrelated reason.

This route makes the earning surface visible in one place, gives it a single dial, and makes both
classes of drift loud instead of silent.

---

## 2. Decisions (all settled with Jim, 2026-07-30/31)

| # | Decision | Reason |
|---|---|---|
| D1 | **Baseline + modifier**, not compounding | Applying the same modifier twice must give the same result, and `1.00` must return exactly to the reference scale. Compounding is a one-way door, and credits already issued can never be clawed back. |
| D2 | **The baseline is the 2026-07-30 re-denominated scale** | Anchor: a typical deal costs 25; ordinary monthly participation earns 50-70. |
| D3 | **Modifier must support `0.00`** | An economy-wide kill switch that needs no deploy. Useful the day an exploit appears. |
| D4 | **Rounding:** `modifier === 0 ? 0 : max(1, ceil(baseline × modifier))` | Nothing silently drops to zero at a nonzero modifier. `0.00` means off, unambiguously, and can't be stumbled into at `0.04`. |
| D5 | **Guards stay deploy-gated (option A)** | A backstop must not share a failure domain with the thing it backstops. The route makes guard drift visible and generates the diff; a human applies it in a deploy. |
| D6 | **Route lives at Passport `/profile/admin/economy`** | Jim's day-to-day admin surface, shared design language, mobile-first. No app owns all the data, so cross-service calls are unavoidable either way. |
| D7 | **Migrate the KV hunt config into `tenants.config`** | The treasure hunt is 32.8% of all credits ever minted; leaving it in KV means the modifier misses a third of minting. Also settles the contradiction between `ARCHITECTURE.md:1585` (hunt config is KV) and `ARCHITECTURE.md:1101`, dated 2026-07-26 ("not KV, not module constants"). |
| D8 | **Values are read-only; the modifier is the only writable control** | One dial, one scale. Per-value editing is what produced the current spread. |
| D9 | **Keep the drift column** | It is the detector for the exact failure that caused this work. |

---

## 3. Architecture

### 3.1 The registry never becomes the value

Each credit-bearing value keeps living where it lives today, and **the engines keep reading exactly
what they read today**. No change to any award path, so this feature carries no risk of breaking
minting.

The registry holds the *baseline* and the *description*, plus a pointer to the value's real home.

```
Passport D1
  economy_values     one row per credit-earning value: baseline, clue, pointer
  economy_modifier   one row per tenant: the current dial position
  economy_history    every save, with the full resulting value map

Live values stay in:
  kkgame-db          actions.base_credits, quests.reward_credits
  passport D1        kwest_hunts.*, tenants.config
  exchange D1        tenants.config
```

### 3.2 Schema

```sql
-- Passport D1
CREATE TABLE economy_values (
  id          TEXT    PRIMARY KEY,          -- 'kkgame.action.passport_scan'
  -- NULL = network-wide (actions, quests). Non-null = tenant-scoped
  -- (kwest_hunts, tenant config). See §3.4 on why the dial itself is global.
  tenant_id   TEXT    REFERENCES tenants(id),
  group_key   TEXT    NOT NULL              -- 'actions'|'quests'|'kwest'|'hunt'|'onboarding'
                CHECK (group_key IN ('actions','quests','kwest','hunt','onboarding')),
  label       TEXT    NOT NULL,             -- "Scan a plaque"
  clue        TEXT    NOT NULL,             -- what triggers it, plain language
  rate_note   TEXT,                         -- "once per plaque per day", "once ever"
  source_kind TEXT    NOT NULL
                CHECK (source_kind IN ('kkgame_action','kkgame_quest','kwest_hunt',
                                       'passport_tenant_config','exchange_tenant_config',
                                       'hunt_tiers')),
  source_ref  TEXT    NOT NULL,             -- row id, column, or JSON path
  baseline    INTEGER NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  is_active   INTEGER NOT NULL DEFAULT 1,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at  INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Single row, id fixed at 1. The dial is GLOBAL, not per-tenant — see §3.4.
CREATE TABLE economy_modifier (
  id         INTEGER PRIMARY KEY CHECK (id = 1),
  modifier   REAL NOT NULL DEFAULT 1.0 CHECK (modifier >= 0 AND modifier <= 5),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_by INTEGER                        -- kkauth_uid
);

CREATE TABLE economy_history (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  from_value  REAL    NOT NULL,
  to_value    REAL    NOT NULL,
  applied_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  applied_by  INTEGER,
  outcome     TEXT    NOT NULL CHECK (outcome IN ('applied','partial','failed')),
  result_json TEXT    NOT NULL              -- {value_id: new_value} for every row
);
```

`result_json` is the forensic record. It is what answers "what was a plaque scan worth on
2026-08-15" when reconciling the ledger months later. Without it, a historical award amount cannot be
explained from the data.

`modifier` is capped at 5.0 so a typo cannot 100x the economy. `0.00` is explicitly permitted (D3).

### 3.4 The dial is global, the values are mixed

`kkgame.actions` and `kkgame.quests` carry a nullable `tenant_id`, and **every live row is NULL** —
they are network-wide. `kwest_hunts` and both `tenants.config` blobs are tenant-scoped.

The modifier is therefore **global, not per-tenant**. A tenant-keyed dial would let one region's
modifier silently rescale another's action credits, and it would contradict `ARCHITECTURE.md:650`,
where identity and credits are explicitly universal across the network: `KKAuth.users` has no
`tenant_id` and `KKCredits.ledger` has no `tenant_id`. A credit is a credit everywhere, so the scale
that defines it is network-wide too.

Consequence for apply: a registry row with `tenant_id IS NULL` is written once; a tenant-scoped row is
written for **every active tenant**. Today that is one tenant (`lake-locals`) in each app, so the
distinction costs nothing now and prevents a silent cross-region bug the day a second region exists.

### 3.3 Rounding — one function, one home

```ts
// passport/src/lib/economy-scale.ts — the ONLY place this arithmetic exists.
export function scaleValue(baseline: number, modifier: number): number {
  if (modifier === 0) return 0;
  return Math.max(1, Math.ceil(baseline * modifier));
}
```

The preview endpoint and the save endpoint both call this. **The browser never recomputes it.** A
second implementation that agrees today is the exact shape of the bug this work exists to prevent.

---

## 4. Read path

`GET /api/admin/economy` returns, for every registry row: baseline, computed (`scaleValue`), and the
**live** value fanned out from its home store, plus the clue and rate note.

Live reads:
- KKGame → `GET /internal/economy/values` (new, Service Binding, returns action + quest credits)
- Exchange → `GET /internal/economy/values` (new, Service Binding, returns its tenant config values)
- Passport → direct D1

**Drift** is `live !== computed`, flagged per row. Causes include someone editing KKGame's admin, a
reseed, or a partially-applied save. The page surfaces it; it does not auto-correct, because silently
overwriting a value someone deliberately set is how this problem started.

---

## 5. Preview

The modifier field is debounced (~250ms) and calls `POST /api/admin/economy/preview` with the
candidate modifier. The server returns the same shape as the read path, with `computed` recalculated.
Nothing is written. The page shows a clear unsaved state.

Preview is a server round-trip specifically so preview and save cannot diverge (§3.3).

---

## 6. Write path

`POST /api/admin/economy/apply` with `{ modifier }`.

1. Validate `0 <= modifier <= 5`, at most 2 decimal places.
2. Recompute every registry row from **baseline**, never from the live value.
3. Fan out, in fixed order: KKGame → Exchange → Passport-local.
4. Write `economy_modifier` and an `economy_history` row with the per-target outcome.

**There is no distributed transaction across three services.** A partial failure is possible and is
recorded as `outcome = 'partial'`, with the page showing which targets succeeded and a retry button.

Retry is safe because every value derives from the immutable baseline, so **applying the same
modifier repeatedly is idempotent**. This is the property that makes D1 worth its extra column, and
it is the entire failure-recovery story.

Write endpoints on the other services:
- KKGame → `POST /internal/economy/apply` (Service Binding, `X-Internal-Secret`)
- Exchange → `POST /internal/economy/apply` (Service Binding, `X-Internal-Secret`)

---

## 7. Guards panel (read-only, deploy-gated)

Listed with the ratio that matters, not just the absolute number, plus the ratio **at baseline** so
drift is visible as a change rather than requiring judgement.

| Guard | Value | Home | Deploy needed |
|---|---|---|---|
| `KWEST_MAX_SINGLE_AWARD` | 500 | `passport/src/lib/kwest-economy.ts` | Passport |
| `AWARD_DAILY_CEILINGS` | passport 2000, exchange 2000, kkgame 5000, kk-apps-hub 2000, legacy 5000 | `KKCredits/wrangler.toml` | KKCredits |
| `FALLBACK_CEILING` | 1000 | `KKCredits/src/lib/ceiling.ts` | KKCredits |
| Hunt `cooldown_seconds` | 5 | Passport code after D7 | Passport |
| Hunt `per_user_daily_cap` | 3 | Passport code after D7 | Passport |
| Hunt `tenant_daily_award_cap` | 2000 | Passport code after D7 | Passport |

The panel computes e.g. *"max single award is 20x the largest configured award; it was 5x at
baseline"* and, when out of band, renders the exact constant and `wrangler.toml` changes to make. It
never writes them.

---

## 8. Two changes this forces

### 8.1 KKGame's admin loses its credit fields

`kkgame/src/routers/admin.ts` exposes `POST /admin/actions` and `POST /admin/quests`, which today
write `base_credits` and `reward_credits` directly. Left as-is they are a second writer and the
baseline becomes fiction the first time the old form is used.

Those two fields become read-only in the KKGame dashboard, **enforced server-side**: a request
attempting to change them returns `409` naming `/profile/admin/economy`. A disabled input is not
sufficient — same principle as the CRUD gate's rule that admin restrictions are enforced with a
status code, never a missing button. Every other field in that dashboard is untouched.

### 8.2 The hunt config migrates and splits (D7)

`digital_hunt_config:{tenant_id}` in KV becomes `tenants.config.hunt` in Passport D1, split by role:

| Field | Destination | Why |
|---|---|---|
| `enabled` | `tenants.config.hunt` | tunable |
| `roll_odds` | `tenants.config.hunt` | tunable; shapes the experience |
| `amount_tiers` | `tenants.config.hunt` | **reward — the modifier scales these** |
| `cooldown_seconds` | Passport code constant | guard |
| `per_user_daily_cap` | Passport code constant | guard |
| `tenant_daily_award_cap` | Passport code constant | guard |

`loadConfig` in `kkgame/src/routers/hunt.ts` changes from a KV read to a Passport-sourced read.
Runtime counters (`hunt:cd:`, `hunt:ud:`, `hunt:td:`) **stay in KV** — they are ephemeral with TTLs,
which is what KV is for.

The existing KV key is deleted only after the D1 path is verified in production.

---

## 9. The registry contents

Seeded by migration from the 2026-07-30 applied values. 34 rows.

- **Actions (15)** — all of `kkgame.actions`, including the six that currently pay 0
  (`account_created`, `profile_complete`, `volunteer_signup`, `volunteer_task_complete`,
  `volunteer_shift_confirmed`, `krowdlift`). Zero-value rows are included deliberately: the page's
  job is to show the complete earning surface, and "this pays nothing" is information.
- **Quests (10)** — including the retired `q_reliable_neighbor`, shown as inactive.
- **KrowdKwest (5)** — `step_reward_default`, `rank2_10_kredits`, `rank11_20_kredits`,
  `grand_prize_kredits`, `minigame_max_award`. **Per-hunt**, so the count grows with each hunt. The
  seeder enumerates hunts rather than hardcoding hunt 1, and hunt creation in `kwest-admin.ts` gains
  a hook that registers the new hunt's five values against the *current* modifier, so a hunt created
  while the dial sits at 0.5 starts correctly scaled instead of at baseline. The completeness test
  (§12) is the backstop if that hook is ever missed.
- **Hunt payout tiers (1)** — the tier table scaled as a unit.
- **Onboarding (3)** — Passport `welcome_credits`, Exchange `welcome_credits`, Exchange
  `upgrade_credits`.

### Clues

Stored as data so wording changes need no deploy. Seeded from the existing `description` on actions
and quests; **written fresh for KrowdKwest, the hunt tiers and the welcome bonuses**, which have no
description anywhere today.

Each row shows what triggers it and how often it can fire. A number without its rate is not
interpretable: `local_purchase` at 10 capped at 3/day and `bd_member_linked` at 15 once in a lifetime
are not comparable without both facts. Admin copy states caps and cooldowns plainly — the
no-mechanics-in-copy rule governs member-facing text, not the operator console.

---

## 10. Access control

Reuses Passport's existing `/profile/admin/*` gate. No new role. Every write records `updated_by` /
`applied_by` from the JWT `sub`.

---

## 11. Error handling

| Case | Behaviour |
|---|---|
| Modifier out of range or >2dp | `400`, field-level message, nothing written |
| A downstream service is unreachable during apply | `outcome='partial'`, per-target detail shown, retry offered (safe per §6) |
| A downstream service is unreachable during read | Row renders with live value `unknown`, not `0`, and is excluded from drift detection |
| Live ≠ computed | Drift flag only. Never auto-corrected. |
| Registry row whose source no longer exists | Flagged as orphaned; excluded from apply |

---

## 12. Testing

- `scaleValue` unit tests at the edges that bite: `0.00`, results landing on `.5`, baseline `1` at
  low modifiers, and the idempotency property (`apply(0.5)` twice == once).
- Fan-out partial-failure test proving retry converges to the correct state.
- **Completeness test:** assert every credit-bearing value in all three databases has a registry row.
  This is what stops a future award being added without appearing on this page, which is the failure
  that made the first pass of the economic evaluation incomplete.
- Server-enforced rejection test on KKGame's `POST /admin/actions` credit fields.
- Browser E2E: change modifier → preview updates → save → live values match → drift column clears.

---

## 13. Out of scope

- The **-50 escrow hole** and the missing supply-vs-balances reconciliation. Related, separately
  tracked, deliberately not bundled.
- Spend-side values (deal prices, the merchant price floor and guidance).
- Per-value editing, per-group modifiers, or scheduled/automatic modifier changes.
- Any change to how awards are computed at runtime beyond reading the migrated hunt config.
- Retiring the dead `trade_complete_credits` key in the Exchange tenant config.

---

## 14. Open item for the plan

**Sequencing of the hunt migration (D7) relative to the rest.** It is the only part of this work that
changes a live read path — `loadConfig` in `kkgame/src/routers/hunt.ts` stops reading KV and starts
reading Passport — so it is the only part carrying real deploy risk, and the treasure hunt is the
single largest source of credits in the economy. It may deserve to be its own increment behind its
own gate rather than shipping with the admin route.

Resolved during spec review, recorded here so the plan does not re-open them:

- **Internal endpoint auth:** `X-Internal-Secret`, matching Passport's existing internal-route
  convention (`/internal/notifications`, `/internal/splash/sweep`). Not a per-app key; that pattern
  belongs to KKCredits, where per-caller attribution of mint authority is the point.
- **Guards diff format:** copy-pasteable text in the page. A downloadable patch implies the file
  state is known, which it is not from another service.
