/**
 * KrowdKwest economy - every award is guarded by an atomic per-hunt budget
 * debit BEFORE calling KKCredits (which has no cap concept of its own; see
 * KROWDKWEST-INTEGRATION-CONTRACTS.md). If the award never lands (KKCredits
 * error, or a race that resolves to KKCredits' own idempotency dedupe
 * returning issued_amount:0), the reserved budget is released so the cap
 * never drifts from what was actually issued.
 */

import type { Env } from '../types';
import { awardCredits } from './credits';

// Per-award hard ceiling regardless of hunt config - a defense-in-depth cap
// so a misconfigured hunt (or a bug) can never mint an outsized single award.
export const KWEST_MAX_SINGLE_AWARD = 500;

export interface AwardWithBudgetResult {
  awarded: number;        // actual issued_amount (0 if budget-capped or a deduped duplicate)
  capped: boolean;        // true when the hunt's budget guard blocked this award before KKCredits was ever called
  balance?: number;
}

/**
 * Atomically reserve `amount` (clamped to KWEST_MAX_SINGLE_AWARD) against
 * the hunt's kk_budget_cap, then issue it via the existing awardCredits
 * client. Reservation and issuance are two steps (D1 UPDATE, then a
 * cross-service fetch) because KKCredits cannot participate in a D1
 * transaction - the reservation is released if issuance fails or turns out
 * to have already happened (KKCredits idempotency on ref_type+ref_id).
 */
export async function awardWithBudget(
  env: Env,
  huntId: number,
  tenantId: string,
  userId: string,
  amount: number,
  reason: string,
  refType: string,
  refId: string,
): Promise<AwardWithBudgetResult> {
  const clamped = Math.max(0, Math.min(Math.floor(amount), KWEST_MAX_SINGLE_AWARD));
  if (clamped <= 0) return { awarded: 0, capped: false };

  const debit = await env.DB.prepare(
    `UPDATE kwest_hunts SET kk_spent = kk_spent + ?1, updated_at = unixepoch()
     WHERE id = ?2 AND kk_spent + ?1 <= kk_budget_cap`
  ).bind(clamped, huntId).run();

  if ((debit.meta?.changes ?? 0) !== 1) {
    // Budget exhausted - the game continues, but no more credits flow.
    return { awarded: 0, capped: true };
  }

  const release = () =>
    env.DB.prepare(
      `UPDATE kwest_hunts SET kk_spent = kk_spent - ?1, updated_at = unixepoch() WHERE id = ?2`
    ).bind(clamped, huntId).run();

  try {
    const result = await awardCredits(env, tenantId, userId, clamped, reason, refType, refId);
    if (result.issued_amount === 0) {
      // KKCredits' own (user_id, ref_type, ref_id) idempotency deduped this
      // as a repeat - nothing was actually issued, so release the reservation.
      await release();
      return { awarded: 0, capped: false, balance: result.balance };
    }
    return { awarded: result.issued_amount, capped: false, balance: result.balance };
  } catch (err) {
    await release();
    throw err;
  }
}

/** Effective reward for a step: its own override, or the hunt's default. */
export function stepRewardAmount(hunt: { step_reward_default: number }, step: { step_reward: number | null }): number {
  return step.step_reward ?? hunt.step_reward_default;
}
