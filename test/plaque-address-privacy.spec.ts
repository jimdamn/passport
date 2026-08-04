// Regression guard for the 2026-08-04 home-address leak.
//
// WHAT WENT WRONG: ensureMerchantPlaque copied the business street address
// straight into passport_plaques.location_name with no hide_address check.
// location_name is public - it is returned in the scan response and rendered
// on the reward card - so a home-based business that had explicitly set
// hide_address = 1 still had its home address shown to every scanner. Because
// the function is INSERT OR REPLACE and runs lazily on EVERY merchant QR-code
// request, repairing the row by hand did not hold: the next QR fetch put the
// address straight back.
//
// Source scan, not an execution test - same limits as splash-escrow-keys.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SRC = readFileSync(
  fileURLToPath(new URL('../src/routers/auth.ts', import.meta.url)),
  'utf8',
);

/** The body of ensureMerchantPlaque, where the public row is written. */
function ensureMerchantPlaqueBody(src: string): string {
  const start = src.indexOf('export async function ensureMerchantPlaque');
  expect(start).toBeGreaterThan(-1);
  const end = src.indexOf('\n}', start);
  expect(end).toBeGreaterThan(start);
  return src.slice(start, end);
}

describe('merchant plaque address privacy', () => {
  it('never binds the raw business address into the public plaque row', () => {
    const body = ensureMerchantPlaqueBody(SRC);
    // The exact expression that leaked. Its return would reinstate the bug.
    expect(body).not.toMatch(/biz\.address\s*\|\|\s*biz\.name/);
  });

  it('gates the address on an explicit permission check', () => {
    const body = ensureMerchantPlaqueBody(SRC);
    expect(body).toContain('mayShowAddress');
    expect(body).toMatch(/biz\.hide_address === 0\s*\|\|\s*biz\.hide_address === false/);
  });

  it('fails closed - an unknown flag falls back to the business name', () => {
    const body = ensureMerchantPlaqueBody(SRC);
    // Truthiness on hide_address would publish the address whenever the flag
    // is simply absent from a caller's payload. The check must be for the
    // positive "allowed" values only.
    expect(body).not.toMatch(/!biz\.hide_address/);
    expect(body).toMatch(/mayShowAddress && biz\.address\)\s*\?\s*biz\.address\s*:\s*biz\.name/);
  });
});
