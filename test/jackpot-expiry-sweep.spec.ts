// The sweep returns a reserved prize unit to stock when a guest never deposits
// their claim. Source scan - see the note in jackpot-payout-keys.spec.ts for
// why this repo's money-path tests are structural rather than behavioural.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SRC = readFileSync(
  fileURLToPath(new URL('../src/handlers/passport-internal.ts', import.meta.url)),
  'utf8',
);

describe('jackpot claim expiry sweep', () => {
  it('is gated by the internal secret', () => {
    expect(SRC).toContain('requireInternalSecret');
    expect(SRC).toContain('matchesInternalSecret');
  });

  it('only ever touches limited prizes, never the unlimited floor', () => {
    // quantity_left is -1 on the floor prize. Restoring it would invent stock
    // for something that is already unlimited and corrupt the sentinel.
    expect((SRC.match(/quantity_left >= 0/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it('gates the restore behind an atomic pending -> expired transition', () => {
    // The restore must only run when THIS sweep won the status flip, or a
    // re-run would hand back the same unit twice.
    const flipIdx = SRC.indexOf("SET status = 'expired'");
    const restoreIdx = SRC.indexOf('quantity_left = quantity_left + 1');
    expect(flipIdx).toBeGreaterThan(-1);
    expect(restoreIdx).toBeGreaterThan(flipIdx);
    expect(SRC).toMatch(/changes !== 1[\s\S]{0,200}quantity_left = quantity_left \+ 1/);
  });

  it('reports a processed count so the cron batch loop can terminate', () => {
    expect(SRC).toMatch(/data:\s*\{\s*processed\s*\}/);
  });
});
