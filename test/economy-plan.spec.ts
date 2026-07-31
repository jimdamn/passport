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
