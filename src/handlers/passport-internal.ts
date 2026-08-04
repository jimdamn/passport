/**
 * Passport - cron-called sweep that returns prize units reserved by guest
 * claims which were never deposited. Gated by X-Internal-Secret, mirroring
 * handlers/kwest-internal.ts.
 *
 * A guest scan decrements quantity_left at roll time and issues a 7-day claim
 * token. If the guest never registers, the claim lapses and that unit is
 * burned permanently - fatal for a one-unit tier, where a single no-show would
 * retire the top prize forever. This releases it.
 *
 * attachClaim already refuses an expired claim, so a lapsed prize can never be
 * deposited even before this runs. The sweep's only job is returning stock.
 */
import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { Env } from '../types';
import { matchesInternalSecret } from '../lib/hmac';
import { logger } from '../lib/logger';

type AppContext = Context<{ Bindings: Env }>;

const SWEEP_BATCH = 20;

function requireInternalSecret(c: AppContext) {
  if (!matchesInternalSecret(c.req.header('X-Internal-Secret'), c.env)) {
    throw new HTTPException(401, { message: 'Unauthorized' });
  }
}

/**
 * Flip lapsed pending claims to expired and hand their reserved unit back.
 *
 * The atomic status transition GATES the restore: only the caller that
 * actually won the pending -> expired flip restores a unit, so running this
 * twice never hands back the same unit twice. A restore adds exactly the one
 * unit that claim reserved at roll time, so stock can never exceed what was
 * originally rolled out and no separate ceiling is needed.
 *
 * `quantity_left >= 0` limits this to LIMITED prizes - the floor prize carries
 * -1 (unlimited) and must never be touched. It covers every limited prize, not
 * only jackpots, which is the correct general behaviour: a lapsed physical
 * prize claim should return its unit too.
 */
export async function expireJackpotClaimsSweep(env: Env): Promise<number> {
  const { results } = await env.DB.prepare(`
    SELECT cl.token_hash, cl.prize_id
      FROM passport_claims cl
      JOIN passport_prizes p ON p.id = cl.prize_id
     WHERE cl.status = 'pending'
       AND cl.expires_at < unixepoch()
       AND p.quantity_left >= 0
     LIMIT ?
  `).bind(SWEEP_BATCH).all<{ token_hash: string; prize_id: string }>();

  let processed = 0;
  for (const row of results ?? []) {
    try {
      const flip = await env.DB.prepare(
        "UPDATE passport_claims SET status = 'expired' WHERE token_hash = ? AND status = 'pending'",
      ).bind(row.token_hash).run();
      if (flip.meta.changes !== 1) continue; // another sweep already took it

      await env.DB.prepare(
        'UPDATE passport_prizes SET quantity_left = quantity_left + 1 WHERE id = ? AND quantity_left >= 0',
      ).bind(row.prize_id).run();
      processed++;
    } catch (err) {
      logger.error(`Jackpot claim expiry failed for ${row.token_hash}: ${(err as Error).message}`);
    }
  }

  return processed;
}

/** POST /api/internal/passport/expire-jackpot-claims */
export async function internalExpireJackpotClaims(c: AppContext) {
  requireInternalSecret(c);
  const processed = await expireJackpotClaimsSweep(c.env);
  return c.json({ data: { processed } });
}
