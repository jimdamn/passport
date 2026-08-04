// The ladder is the supply lever: KrowdKredits never expire and are never
// clawed back, so `value * units` is permanent supply. These tests pin the
// invariants that keep a big sticker safe (tiny stock) and keep migration
// 0021 in step with the constant the rest of the codebase reasons about.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  JACKPOT_LADDER,
  FLOOR_VALUE,
  FLOOR_FROM_VALUE,
  maxLifetimeMint,
} from '../src/lib/prize-ladder';

const MIGRATION = readFileSync(
  fileURLToPath(new URL('../migrations/0021-prize-matrix-redenomination.sql', import.meta.url)),
  'utf8',
);

describe('jackpot ladder', () => {
  it('caps lifetime jackpot mint at 2725 credits', () => {
    expect(maxLifetimeMint()).toBe(2725);
  });

  it('never maps two source values onto the same row', () => {
    const from = JACKPOT_LADDER.map((t) => t.fromValue);
    expect(new Set(from).size).toBe(from.length);
  });

  it('makes bigger prizes rarer and scarcer', () => {
    for (let i = 1; i < JACKPOT_LADDER.length; i++) {
      expect(JACKPOT_LADDER[i].value).toBeGreaterThan(JACKPOT_LADDER[i - 1].value);
      expect(JACKPOT_LADDER[i].probability).toBeLessThan(JACKPOT_LADDER[i - 1].probability);
      expect(JACKPOT_LADDER[i].units).toBeLessThan(JACKPOT_LADDER[i - 1].units);
    }
  });

  it('keeps the floor below every jackpot tier', () => {
    expect(FLOOR_VALUE).toBeLessThan(Math.min(...JACKPOT_LADDER.map((t) => t.value)));
  });
});

describe('migration 0021', () => {
  it('registers itself in the schema_migrations ledger', () => {
    expect(MIGRATION).toContain(
      "INSERT OR IGNORE INTO schema_migrations (name) VALUES ('0021-prize-matrix-redenomination')",
    );
  });

  it('brings the floor onto the ladder value', () => {
    expect(MIGRATION).toMatch(
      new RegExp(`SET value = ${FLOOR_VALUE}[\\s\\S]*?prize_type = 'kredits_base' AND value = ${FLOOR_FROM_VALUE}`),
    );
  });

  it('remaps every tier keyed on its ORIGINAL value', () => {
    for (const t of JACKPOT_LADDER) {
      expect(MIGRATION).toMatch(new RegExp(`WHEN\\s+${t.fromValue}\\s+THEN\\s+${t.value}\\b`));
      expect(MIGRATION).toMatch(new RegExp(`WHEN\\s+${t.fromValue}\\s+THEN\\s+${t.units}\\b`));
      expect(MIGRATION).toMatch(new RegExp(`WHEN\\s+${t.fromValue}\\s+THEN\\s+'${t.name}'`));
    }
  });

  it('uses exactly two UPDATEs, so no tier can cascade into the next', () => {
    // Sequential per-tier UPDATEs are the trap the old 0020 warned about:
    // 1000 -> 500 followed by 500 -> 250 lands the top tier at 250. One
    // CASE statement per column reads every RHS from the pre-update row.
    expect((MIGRATION.match(/UPDATE passport_prizes/g) ?? []).length).toBe(2);
  });

  it('guards BOTH updates against a second run', () => {
    // This ladder's targets overlap its own sources: after one pass Legendary
    // sits at 500, which is the source value that maps to 250. Re-running
    // without a guard collapses Legendary into a duplicate Grand Jackpot and
    // deletes the top prize. Verified live against a local copy of the real
    // production rows on 2026-08-04. Do not remove the guard.
    const guards = MIGRATION.match(
      /NOT EXISTS \(SELECT 1 FROM schema_migrations WHERE name = '0021-prize-matrix-redenomination'\)/g,
    ) ?? [];
    expect(guards.length).toBe(2);
  });

  it('writes its ledger row only after the updates it guards', () => {
    // If the INSERT ran first, the guard would already be true and both
    // UPDATEs would be skipped on the very first run.
    const insertIdx = MIGRATION.indexOf('INSERT OR IGNORE INTO schema_migrations');
    const lastUpdateIdx = MIGRATION.lastIndexOf('UPDATE passport_prizes');
    expect(insertIdx).toBeGreaterThan(lastUpdateIdx);
  });
});
