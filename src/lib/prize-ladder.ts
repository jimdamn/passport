/**
 * The passport scan prize ladder - the single source of truth for the values
 * that migration 0021 and seed.sql land in the database.
 *
 * The supply lever is `value * units`, NOT probability. KrowdKredits never
 * expire and are never clawed back, so every jackpot credit ever won is
 * permanent supply. A big sticker is only safe when the stock is small;
 * probability only sets how fast a tier depletes, never how much it can mint.
 *
 * Nothing in src/handlers/ reads this - the database is what the scan roll
 * queries. It exists so the migration, the seed and the tests cannot drift
 * apart silently, which is exactly how the prize matrix got left behind by the
 * 2026-07-30 re-denomination in the first place.
 */

export interface JackpotTier {
  /** The value the row holds in production BEFORE 0021. The migration keys on this. */
  fromValue: number;
  /** The value a winner is actually paid after 0021. */
  value: number;
  /** Degree name. ScanPortal renders this directly above the value. */
  name: string;
  /** quantity_left - a hard lifetime count, not a per-period allowance. */
  units: number;
  /** Per-scan draw probability. Never shown to a member. */
  probability: number;
}

/** Floor prize value. Must equal what kkgame's passport_scan action pays. */
export const FLOOR_VALUE = 5;

/** The floor's pre-0021 production value, which the migration matches on. */
export const FLOOR_FROM_VALUE = 25;

export const JACKPOT_LADDER: JackpotTier[] = [
  { fromValue: 25, value: 25, name: 'Free Deal', units: 15, probability: 0.03 },
  { fromValue: 50, value: 50, name: 'Big Win', units: 10, probability: 0.02 },
  { fromValue: 100, value: 100, name: 'Jackpot', units: 6, probability: 0.012 },
  { fromValue: 500, value: 250, name: 'Grand Jackpot', units: 3, probability: 0.005 },
  { fromValue: 1000, value: 500, name: 'Legendary', units: 1, probability: 0.002 },
];

/** Credits this ladder can ever mint if every single unit is won. */
export function maxLifetimeMint(ladder: JackpotTier[] = JACKPOT_LADDER): number {
  return ladder.reduce((sum, t) => sum + t.value * t.units, 0);
}
