import type { Env } from '../types';

export interface GameActionResult {
  credits_awarded: number;
  credits_balance: number;
  xp_awarded: Record<string, number>;
  is_first_time: boolean;
  bonuses_applied: string[];
  visitor_premium_applied: boolean;
  new_badges: string[];
  processing: 'queued';
}

/**
 * recordGameAction — records a game action in KKGame Worker via Service Binding.
 * Wrap in try/catch — failure is non-fatal; returns null on error.
 */
export async function recordGameAction(
  env: Env,
  params: {
    user_id: number;
    action_id: string;
    source_app: string;
    network_id?: string;
    tenant_id?: string | null;
    ref_type?: string | null;
    ref_id?: string | null;
    /** Exact credit amount computed server-side (e.g. spend-scaled visit
     * claims). Daily caps and cooldowns still enforce in KKGame. */
    credits_override?: number;
    skip_credit_multipliers?: boolean;
  }
): Promise<GameActionResult | null> {
  try {
    const res = await env.KKGAME.fetch(
      new Request('https://kkgame/action', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-App-Key': env.KKGAME_APP_KEY,
        },
        body: JSON.stringify(params),
      })
    );

    if (!res.ok) {
      const errorMsg = await res.text();
      console.error(`[Passport Game] KKGame action post failed (${res.status}):`, errorMsg);
      return null;
    }

    const payload = await res.json<{ data: GameActionResult }>();
    return payload.data;
  } catch (err) {
    console.error('[Passport Game] KKGame Service Binding call error:', err);
    return null;
  }
}
