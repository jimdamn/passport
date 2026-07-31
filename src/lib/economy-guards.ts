/**
 * Guards are deploy-gated on purpose: a backstop must not share a failure
 * domain with the thing it backstops. This module never writes them. It
 * exists so guard drift is visible, which is the failure that went unnoticed
 * on 2026-07-30 when rewards fell ~10x and every ceiling stayed put.
 */
export interface GuardRow {
  key: string;
  label: string;
  value: string;
  home: string;
  deployTarget: string;
  ratioNow: string | null;
  ratioAtBaseline: string | null;
  outOfBand: boolean;
}

export function describeGuards(largestNow: number, largestBaseline: number): GuardRow[] {
  const ratio = (guard: number, largest: number) => (largest > 0 ? guard / largest : null);
  const fmt = (r: number | null) => (r === null ? null : `${Math.round(r)}x largest award`);

  const maxSingle = 500;
  const rNow = ratio(maxSingle, largestNow);
  const rBase = ratio(maxSingle, largestBaseline);

  return [
    {
      key: 'KWEST_MAX_SINGLE_AWARD',
      label: 'Max single KrowdKwest award',
      value: String(maxSingle),
      home: 'passport/src/lib/kwest-economy.ts',
      deployTarget: 'Passport',
      ratioNow: fmt(rNow),
      ratioAtBaseline: fmt(rBase),
      outOfBand: rNow !== null && rBase !== null && rNow > rBase * 2,
    },
    {
      key: 'AWARD_DAILY_CEILINGS',
      label: 'Daily mint ceiling per app',
      value: 'passport 2000, exchange 2000, kkgame 5000, kk-apps-hub 2000, legacy 5000',
      home: 'KKCredits/wrangler.toml',
      deployTarget: 'KKCredits',
      ratioNow: null, ratioAtBaseline: null,
      outOfBand: false,
    },
    {
      key: 'FALLBACK_CEILING',
      label: 'Fallback daily ceiling',
      value: '1000',
      home: 'KKCredits/src/lib/ceiling.ts',
      deployTarget: 'KKCredits',
      ratioNow: null, ratioAtBaseline: null,
      outOfBand: false,
    },
  ];
}
