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

const KWEST_MAX_SINGLE_AWARD = 500;

const AWARD_DAILY_CEILINGS: Record<string, number> = {
  passport: 2000,
  exchange: 2000,
  kkgame: 5000,
  'kk-apps-hub': 2000,
  legacy: 5000,
};

const FALLBACK_CEILING = 1000;

function ratio(guard: number, denominator: number): number | null {
  return denominator > 0 ? guard / denominator : null;
}

// A guard is out of band when it is at least 2x weaker than at baseline.
// The 2026-07-30 incident was a 4x weakening: KWEST_MAX_SINGLE_AWARD sat at
// 5x the largest award at baseline and drifted to 20x it once rewards fell,
// without the guard itself ever changing. Flagging at 2x catches that case
// (and anything worse) with margin, while a small day-to-day fluctuation in
// reward sizing does not double the ratio and so does not trip a false
// alarm. The comparison is inclusive (>=) because an exact halving of every
// reward is an ordinary kind of mistake for this panel to miss, not an edge
// case to wave through.
function isOutOfBand(ratioNow: number | null, ratioBaseline: number | null): boolean {
  return ratioNow !== null && ratioBaseline !== null && ratioNow >= ratioBaseline * 2;
}

/**
 * @param largestNow - the largest currently configured single award, used to
 *   judge KWEST_MAX_SINGLE_AWARD against.
 * @param largestBaseline - the largest single award at the pre-2026-07-30
 *   baseline.
 * @param totalBaselineSum - sum of every registry row's baseline value, used
 *   to judge the daily mint ceilings against the volume they were sized for.
 * @param totalComputedSum - sum of every registry row's currently computed
 *   value, the daily mint ceilings' actual denominator today.
 */
export function describeGuards(
  largestNow: number,
  largestBaseline: number,
  totalBaselineSum: number,
  totalComputedSum: number,
): GuardRow[] {
  const fmtAward = (r: number | null) => (r === null ? null : `${Math.round(r)}x largest award`);
  const fmtMint = (r: number | null) => (r === null ? null : `${Math.round(r)}x total daily mint`);

  const maxSingleRatioNow = ratio(KWEST_MAX_SINGLE_AWARD, largestNow);
  const maxSingleRatioBaseline = ratio(KWEST_MAX_SINGLE_AWARD, largestBaseline);

  const rows: GuardRow[] = [
    {
      key: 'KWEST_MAX_SINGLE_AWARD',
      label: 'Max single KrowdKwest award',
      value: String(KWEST_MAX_SINGLE_AWARD),
      home: 'passport/src/lib/kwest-economy.ts',
      deployTarget: 'Passport',
      ratioNow: fmtAward(maxSingleRatioNow),
      ratioAtBaseline: fmtAward(maxSingleRatioBaseline),
      outOfBand: isOutOfBand(maxSingleRatioNow, maxSingleRatioBaseline),
    },
  ];

  for (const [app, ceiling] of Object.entries(AWARD_DAILY_CEILINGS)) {
    const ratioNow = ratio(ceiling, totalComputedSum);
    const ratioBaseline = ratio(ceiling, totalBaselineSum);
    rows.push({
      key: `AWARD_DAILY_CEILING_${app}`,
      label: `Daily mint ceiling - ${app}`,
      value: String(ceiling),
      home: 'KKCredits/wrangler.toml',
      deployTarget: 'KKCredits',
      ratioNow: fmtMint(ratioNow),
      ratioAtBaseline: fmtMint(ratioBaseline),
      outOfBand: isOutOfBand(ratioNow, ratioBaseline),
    });
  }

  const fallbackRatioNow = ratio(FALLBACK_CEILING, totalComputedSum);
  const fallbackRatioBaseline = ratio(FALLBACK_CEILING, totalBaselineSum);
  rows.push({
    key: 'FALLBACK_CEILING',
    label: 'Fallback daily ceiling',
    value: String(FALLBACK_CEILING),
    home: 'KKCredits/src/lib/ceiling.ts',
    deployTarget: 'KKCredits',
    ratioNow: fmtMint(fallbackRatioNow),
    ratioAtBaseline: fmtMint(fallbackRatioBaseline),
    outOfBand: isOutOfBand(fallbackRatioNow, fallbackRatioBaseline),
  });

  return rows;
}
