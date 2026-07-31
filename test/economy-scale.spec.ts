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

  it('does not inflate by one credit on IEEE-754-lossy modifiers', () => {
    // 100 * 1.1 === 110.00000000000001 and 100 * 0.07 === 7.000000000000001
    // in raw floating point - a naive Math.ceil(baseline * modifier) rounds
    // those up to 111 and 8. Both must land on the exact intended value.
    expect(scaleValue(100, 1.1)).toBe(110);
    expect(scaleValue(100, 0.07)).toBe(7);
  });
});
