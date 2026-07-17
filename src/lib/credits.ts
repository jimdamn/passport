/**
 * Credits integration — KKCredits API
 *
 * All credit operations go through the KKCredits Worker. KKCredits is the
 * source of truth for balances and supply tracking; Passport keeps no local
 * credits ledger or cache.
 */

import type { Env } from '../types';

const SOURCE_APP = 'passport';
const NETWORK_ID = 'lake-and-locals';

/**
 * Award credits to a user via KKCredits.
 * Applies the halving multiplier unless applyHalving is false.
 */
export async function awardCredits(
  env: Env,
  tenantId: string,
  userId: string,      // KKAuth user_id string — converted to integer for KKCredits
  amount: number,
  reason: string,
  refType: string,
  refId: string,
  tradeCount?: number
): Promise<{ issued_amount: number; balance: number; new_badges: string[] }> {
  const res = await env.KKCREDITS.fetch(
    new Request('https://kkcredits/award', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-App-Key': env.KKCREDITS_APP_KEY,
      },
      body: JSON.stringify({
        user_id: parseInt(userId, 10),
        amount,
        reason,
        source_app: SOURCE_APP,
        network_id: NETWORK_ID,
        ref_type: refType,
        ref_id: refId,
        trade_count: tradeCount,
        apply_halving: true,
      }),
    })
  );

  if (!res.ok) {
    const body = await res.json<{ error?: string }>().catch(() => ({} as { error?: string }));
    throw new Error(body.error ?? `KKCredits award failed: ${res.status}`);
  }

  const json = await res.json<{
    data: { issued_amount: number; balance: number; new_badges: string[] }
  }>();
  const { issued_amount, balance, new_badges } = json.data;

  return { issued_amount, balance, new_badges };
}

/**
 * Transfer credits between accounts via KKCredits. Supply-neutral: credits
 * move, they are never created or destroyed. The (ref_type, ref_id)
 * idempotency key makes retries safe.
 *
 * bearerToken is the SENDER's token. Omit it only when the sender is the
 * deals escrow account (env.DEALS_ESCROW_UID) — KKCredits authorizes
 * escrow-out transfers by app key alone.
 */
export async function transferCredits(
  env: Env,
  fromUserId: number,
  toUserId: number,
  amount: number,
  reason: string,
  refType: string,
  refId: string,
  bearerToken?: string
): Promise<{ balance_after_from: number; balance_after_to: number }> {
  const res = await env.KKCREDITS.fetch(
    new Request('https://kkcredits/transfer', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-App-Key': env.KKCREDITS_APP_KEY,
        ...(bearerToken ? { Authorization: `Bearer ${bearerToken}` } : {}),
      },
      body: JSON.stringify({
        from_user_id: fromUserId,
        to_user_id: toUserId,
        amount,
        reason,
        source_app: SOURCE_APP,
        network_id: NETWORK_ID,
        ref_type: refType,
        ref_id: refId,
      }),
    })
  );

  if (!res.ok) {
    const body = await res.json<{ error?: string; message?: string }>()
      .catch(() => ({} as { error?: string; message?: string }));
    throw new Error(body.error ?? body.message ?? `KKCredits transfer failed: ${res.status}`);
  }

  const json = await res.json<{ data: { debit: { balance_after: number }; credit: { balance_after: number } } }>();
  return {
    balance_after_from: json.data.debit.balance_after,
    balance_after_to: json.data.credit.balance_after,
  };
}

/** The deals escrow account uid (see DEALS_ESCROW_UID in wrangler.toml). */
export function escrowUid(env: Env): number {
  return parseInt(env.DEALS_ESCROW_UID, 10);
}

/*
 * Policy note (2026-07-17): credits MOVE, they are never destroyed or minted
 * as refunds. The former spendCredits (burn) and refundCredits (mint-refund)
 * helpers were removed — every deal flow now uses transferCredits through the
 * deals escrow account. If a true burn is ever needed, that is a deliberate
 * economic decision, not a convenience call.
 */

/**
 * Fetch current balance directly from KKCredits (bypasses local cache).
 * Returns null if KKCredits is unreachable or returns an error, so callers
 * can fall back to the cached D1 value rather than overwriting it with 0.
 */
export async function fetchBalance(env: Env, userId: string, bearerToken: string): Promise<number | null> {
  try {
    const res = await env.KKCREDITS.fetch(
      new Request(`https://kkcredits/balance/${parseInt(userId, 10)}`, {
        headers: { 'Authorization': `Bearer ${bearerToken}` },
      })
    );
    if (!res.ok) return null;
    const json = await res.json<{ data: { balance: number } }>();
    return json.data.balance;
  } catch {
    return null;
  }
}
