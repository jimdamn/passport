import { describe, it, expect } from 'vitest';
import { HTTPException } from 'hono/http-exception';
import { parseModifier, classifyEconomyValue } from '../src/handlers/economy';
import { assertAllowedEconomyHost } from '../src/lib/economy-clients';
import type { PlanEntry } from '../src/lib/economy-scale';

function expectRejected(raw: unknown): void {
  let thrown: unknown;
  try {
    parseModifier(raw);
  } catch (err) {
    thrown = err;
  }
  expect(thrown).toBeInstanceOf(HTTPException);
  expect((thrown as HTTPException).status).toBe(400);
}

describe('parseModifier', () => {
  it('rejects anything that is not already a JS number, before any coercion would kick in', () => {
    // Number(null) === 0, Number('') === 0, Number([]) === 0, Number(false) === 0 -
    // every one of these would silently fire the kill switch if parseModifier
    // ever called Number(raw) instead of checking typeof first.
    [null, '', '  ', [], false, true].forEach(expectRejected);
  });

  it('rejects non-finite numbers', () => {
    [NaN, Infinity, -Infinity].forEach(expectRejected);
  });

  it('rejects numbers out of the 0..5 range', () => {
    [-1, 5.01, -0.01, 100].forEach(expectRejected);
  });

  it('rejects more than 2 decimal places', () => {
    [0.001, 1.234].forEach(expectRejected);
  });

  it('accepts every valid value, including the float-imprecision edge cases', () => {
    // 0.07, 1.15 and 2.01 all land a fraction of a cent off 100x in IEEE-754
    // float math (e.g. 1.15 * 100 === 114.99999999999999) - the epsilon
    // check must accept these, not just values that happen to be exact.
    for (const v of [0, 0.00, 0.07, 1.15, 2.01, 5]) {
      expect(parseModifier(v)).toBe(v);
    }
  });
});

describe('classifyEconomyValue', () => {
  const entry: PlanEntry = {
    id: 'kkgame.action.passport_scan',
    source_kind: 'kkgame_action',
    source_ref: 'passport_scan',
    tenant_id: null,
    baseline: 5,
    computed: 3,
  };

  it('marks an unreachable target unavailable, with live null and no drift', () => {
    // Unreachable regardless of what live value happened to be passed in -
    // an outage must never look like an award that pays nothing.
    const result = classifyEconomyValue(entry, null, false);
    expect(result.status).toBe('unavailable');
    expect(result.live).toBeNull();
    expect(result.drift).toBe(false);
  });

  it('marks a reachable target with no matching ref as orphaned', () => {
    const result = classifyEconomyValue(entry, null, true);
    expect(result.status).toBe('orphaned');
    expect(result.live).toBeNull();
    expect(result.drift).toBe(false);
  });

  it('marks a reachable target with a matching value ok, and computes drift as live !== computed', () => {
    const matching = classifyEconomyValue(entry, 3, true);
    expect(matching.status).toBe('ok');
    expect(matching.live).toBe(3);
    expect(matching.drift).toBe(false);

    const drifted = classifyEconomyValue(entry, 4, true);
    expect(drifted.status).toBe('ok');
    expect(drifted.live).toBe(4);
    expect(drifted.drift).toBe(true);
  });
});

describe('assertAllowedEconomyHost', () => {
  it('accepts a real lakeandlocals.com subdomain over https', () => {
    expect(() => assertAllowedEconomyHost('https://exchange.lakeandlocals.com')).not.toThrow();
  });

  it('rejects the right host over the wrong protocol', () => {
    expect(() => assertAllowedEconomyHost('http://exchange.lakeandlocals.com')).toThrow();
  });

  it('rejects an unrelated host entirely', () => {
    expect(() => assertAllowedEconomyHost('https://evil.example.com')).toThrow();
  });

  it('rejects suffix confusion - a hostname that merely contains the allowed domain as a substring', () => {
    // A naive `includes('lakeandlocals.com')` check would wrongly accept
    // this: the string is present, but the actual hostname is a subdomain of
    // evil.com, not of lakeandlocals.com.
    expect(() => assertAllowedEconomyHost('https://lakeandlocals.com.evil.com')).toThrow();
  });

  it('rejects a string that does not parse as a URL', () => {
    expect(() => assertAllowedEconomyHost('not a url')).toThrow();
  });
});
