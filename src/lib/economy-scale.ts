/**
 * The ONLY place credit-scaling arithmetic exists. The preview endpoint and
 * the apply endpoint both call this; the browser never recomputes it. Two
 * implementations that agree today is the exact shape of the bug this whole
 * feature exists to prevent (see the 2026-07-30 evaluation).
 *
 * modifier === 0 is an explicit kill switch. At any nonzero modifier a value
 * floors at 1, so an award can never silently stop paying because the
 * arithmetic happened to land under a half.
 */
export function scaleValue(baseline: number, modifier: number): number {
  if (modifier === 0) return 0;
  if (baseline === 0) return 0;
  return Math.max(1, Math.ceil(baseline * modifier));
}
