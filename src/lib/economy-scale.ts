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
