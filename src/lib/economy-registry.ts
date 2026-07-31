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
 * A target that throws yields `null` for its rows, never 0 - an unreachable
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
  // row's source no longer exists" (spec S11). Both produce a null value, but
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
