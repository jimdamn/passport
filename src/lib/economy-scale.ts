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
  // Round the modifier to whole cents before multiplying, then divide back
  // down, rather than multiplying the raw float. `baseline * modifier`
  // alone is subject to IEEE-754 error on ordinary two-decimal modifiers
  // (100 * 1.1 === 110.00000000000001, 100 * 0.07 === 7.000000000000001),
  // which the outer Math.ceil then rounds up to a wrong-by-one integer
  // (111, 8). Modifiers are always validated to at most two decimal places
  // (parseModifier), so rounding modifier * 100 to the nearest integer
  // recovers the intended cents exactly before the division reintroduces
  // any (now harmless, sub-integer) floating point noise ahead of ceil.
  return Math.max(1, Math.ceil((baseline * Math.round(modifier * 100)) / 100));
}

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

export type EconomyTarget = 'kkgame' | 'exchange' | 'passport';

/**
 * The ONE place the source-kind-to-target mapping exists. readLiveValues and
 * applyPlan (economy-registry.ts) and the economy handlers (economy.ts) all
 * import this rather than each hand-rolling their own copy of the same
 * if/else - that duplication is exactly how applyPlan and readLiveValues
 * drifted apart before this function existed: applyPlan silently dropped
 * hunt_tiers rows from every write while readLiveValues read them as if they
 * were an ordinary passport value.
 */
export function targetForSourceKind(kind: SourceKind): EconomyTarget {
  if (kind === 'kkgame_action' || kind === 'kkgame_quest') return 'kkgame';
  if (kind === 'exchange_tenant_config') return 'exchange';
  return 'passport'; // passport_tenant_config, kwest_defaults, hunt_tiers (increment 2)
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
