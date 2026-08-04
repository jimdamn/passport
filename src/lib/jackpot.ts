/**
 * Scan-jackpot payout helpers.
 *
 * A rolled jackpot is paid as its OWN KKCredits award, separate from the base
 * passport_scan game action. Keeping them separate is deliberate: the base
 * call carries credits, XP, badges and cooldown tracking, none of which may be
 * lost, and a distinct (ref_type, ref_id) fully under passport's control gives
 * clean exactly-once semantics independent of KKGame's internal action keying.
 * It also produces an honest, auditable "Passport jackpot +500" ledger line
 * rather than one opaque +505 recorded as a scan.
 */
import type { Env } from '../types';

/** KKCredits (ref_type, ref_id) namespace for a scan jackpot payout. */
export const JACKPOT_REF_TYPE = 'passport_jackpot';

/** Only kredits_jackpot rows carry a payable jackpot on top of the base award. */
export function isJackpot(prizeType: string): boolean {
  return prizeType === 'kredits_jackpot';
}

/** Union of two badge lists, order-stable, no duplicates. */
export function mergeBadges(a: string[], b: string[]): string[] {
  return [...new Set([...a, ...b])];
}

/**
 * Put one reserved unit back on a limited prize - the release half of the
 * atomic decrement taken at roll time. Mirrors KrowdKwest's awardWithBudget
 * release semantics. The `quantity_left >= 0` guard keeps the unlimited floor
 * prize (-1) untouched.
 */
export async function restoreQuantity(env: Env, prizeId: string): Promise<void> {
  await env.DB.prepare(
    'UPDATE passport_prizes SET quantity_left = quantity_left + 1 WHERE id = ? AND quantity_left >= 0',
  ).bind(prizeId).run();
}
