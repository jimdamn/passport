/**
 * Credits integration — KKCredits API
 *
 * All credit operations go through the KKCredits Worker. The Exchange no longer
 * maintains its own credits ledger. KKCredits is the source of truth for balances
 * and supply tracking. The Exchange users table caches credits_balance for display.
 *
 * award/spend both update the local cache after a successful KKCredits call.
 */

import type { Env } from '../types';

const SOURCE_APP = 'exchange';
const NETWORK_ID = 'lake-and-locals';

/**
 * Award credits to a user via KKCredits.
 * Applies the halving multiplier unless applyHalving is false.
 * Updates the Exchange user cache after a successful award.
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
        'X-App-Key': env.KKAUTH_APP_KEY,
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
 * Spend (debit) credits from a user via KKCredits.
 * Requires the user's Bearer token — KKCredits enforces that JWT sub matches user_id.
 * Updates the Exchange user cache after a successful spend.
 */
export async function spendCredits(
  env: Env,
  tenantId: string,
  userId: string,
  amount: number,
  reason: string,
  refType: string,
  refId: string,
  bearerToken: string
): Promise<{ balance: number }> {
  const res = await env.KKCREDITS.fetch(
    new Request('https://kkcredits/spend', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-App-Key': env.KKAUTH_APP_KEY,
        'Authorization': `Bearer ${bearerToken}`,
      },
      body: JSON.stringify({
        user_id: parseInt(userId, 10),
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
    const body = await res.json<{ error?: string }>().catch(() => ({} as { error?: string }));
    const msg = body.error ?? `KKCredits spend failed: ${res.status}`;
    if (res.status === 402) throw new Error(`Insufficient credits`);
    throw new Error(msg);
  }

  const json = await res.json<{ data: { balance: number } }>();
  const { balance } = json.data;

  return { balance };
}

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
