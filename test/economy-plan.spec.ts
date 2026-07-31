import { describe, it, expect } from 'vitest';
import { computePlan, type RegistryRow } from '../src/lib/economy-scale';
import { applyPlan, readLiveValues, type EconomyClients } from '../src/lib/economy-registry';
import { describeGuards } from '../src/lib/economy-guards';

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

  it('derives the computed value from baseline alone, ignoring decoy fields', () => {
    const decoyRow = {
      id: 'd', source_kind: 'kkgame_action', source_ref: 'decoy', tenant_id: null,
      baseline: 10, current: 999, live: 999,
    } as RegistryRow;
    const plan = computePlan([decoyRow], 0.5);
    expect(plan[0].computed).toBe(5);
  });

  it('does not mutate the input rows', () => {
    const clone = structuredClone(rows);
    computePlan(rows, 0.5);
    expect(rows).toEqual(clone);
  });
});

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
    const r = await applyPlan(plan, clients());
    expect(r.outcome).toBe('applied');
    expect(Object.keys(r.perTarget).sort()).toEqual(['exchange', 'kkgame', 'passport']);
  });

  it('reports partial and names the failing target', async () => {
    const r = await applyPlan(plan, clients('exchange'));
    expect(r.outcome).toBe('partial');
    expect(Object.keys(r.perTarget).sort()).toEqual(['exchange', 'kkgame', 'passport']);
    expect(r.perTarget.exchange).toBe('failed');
    expect(r.perTarget.kkgame).toBe('ok');
    expect(r.perTarget.passport).toBe('ok');
  });

  it('converges on retry once the target recovers', async () => {
    expect((await applyPlan(plan, clients('exchange'))).outcome).toBe('partial');
    expect((await applyPlan(plan, clients())).outcome).toBe('applied');
  });
});

describe('readLiveValues', () => {
  // Two rows that both end up with a null live value for opposite reasons:
  // one belongs to a service that is up but no longer has that ref (an
  // orphaned registry row); the other belongs to a service that is down
  // entirely (a transient failure). The caller must be able to tell these
  // apart, so `reachable` has to disagree even though `live` agrees.
  const orphanRow: RegistryRow = {
    id: 'orphan', source_kind: 'kkgame_action', source_ref: 'no_such_ref', tenant_id: null, baseline: 5,
  };
  const downRow: RegistryRow = {
    id: 'down', source_kind: 'exchange_tenant_config', source_ref: 'welcome_credits', tenant_id: 'lake-locals', baseline: 10,
  };

  function mixedClients(): EconomyClients {
    return {
      kkgame: { read: async () => [], apply: async () => {} },
      exchange: { read: async () => { throw new Error('exchange is down'); }, apply: async () => {} },
      passport: { read: async () => [], apply: async () => {} },
    };
  }

  it('yields null for both an orphaned row and an unreachable service, but reports reachability differently', async () => {
    const { live, reachable } = await readLiveValues([orphanRow, downRow], mixedClients());

    expect(live.get('orphan')).toBeNull();
    expect(live.get('down')).toBeNull();

    expect(reachable.kkgame).toBe(true);
    expect(reachable.exchange).toBe(false);
  });
});

describe('describeGuards', () => {
  it('does not flag when the ratio is unchanged', () => {
    expect(describeGuards(100, 100, 1000, 1000)[0].outOfBand).toBe(false);
  });
  it('flags when the largest award shrinks far below baseline', () => {
    expect(describeGuards(25, 100, 1000, 1000)[0].outOfBand).toBe(true);
  });

  it('does not flag the daily-ceiling rows when total daily mint is unchanged from baseline', () => {
    const rows = describeGuards(100, 100, 5000, 5000);
    const ceilingRows = rows.filter((r) => r.key !== 'KWEST_MAX_SINGLE_AWARD');
    expect(ceilingRows.length).toBeGreaterThan(0);
    expect(ceilingRows.every((r) => r.outOfBand === false)).toBe(true);
  });

  // Regression test for the 2026-07-30 incident: reward values fell roughly
  // 10x while every ceiling stayed at its old absolute number, so the
  // ceiling-to-mint ratio silently grew by roughly the same factor. With the
  // ceilings fixed and total daily mint collapsing well below half its
  // baseline, every daily-ceiling row (including the fallback) must flag.
  it('flags the daily-ceiling rows when ceilings are fixed and total mint collapses', () => {
    const rows = describeGuards(100, 100, 10000, 1000);
    const ceilingRows = rows.filter((r) => r.key !== 'KWEST_MAX_SINGLE_AWARD');
    expect(ceilingRows.length).toBeGreaterThan(0);
    expect(ceilingRows.every((r) => r.outOfBand === true)).toBe(true);

    const fallback = rows.find((r) => r.key === 'FALLBACK_CEILING');
    expect(fallback?.outOfBand).toBe(true);
  });

  it('yields null ratios and no flag when total computed mint is zero, with no NaN leaking out', () => {
    const rows = describeGuards(100, 100, 1000, 0);
    const ceilingRows = rows.filter((r) => r.key !== 'KWEST_MAX_SINGLE_AWARD');
    expect(ceilingRows.length).toBeGreaterThan(0);
    for (const row of ceilingRows) {
      expect(row.ratioNow).toBeNull();
      expect(row.outOfBand).toBe(false);
      expect(row.value).not.toContain('NaN');
    }
    expect(rows.some((r) => JSON.stringify(r).includes('NaN'))).toBe(false);
  });
});
