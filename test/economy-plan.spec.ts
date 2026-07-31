import { describe, it, expect } from 'vitest';
import { computePlan, type RegistryRow } from '../src/lib/economy-scale';
import { applyPlan, readLiveValues, type EconomyClients } from '../src/lib/economy-registry';

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
