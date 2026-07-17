/**
 * KrowdKwest - cron-called lifecycle sweep + reveal-coordinate retention
 * truncation. Gated by X-Internal-Secret, mirroring
 * handlers/deals.ts's internalSweep / sweepExpiredDealClaims shape.
 * Per KROWDKWEST-DEVELOPMENT-PLAN.md Section 9.
 */

import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { Env } from '../types';
import { matchesInternalSecret } from '../lib/hmac';
import { logger } from '../lib/logger';

type AppContext = Context<{ Bindings: Env }>;

const RETENTION_SECONDS = 30 * 86400;
const SWEEP_BATCH = 20;

function requireInternalSecret(c: AppContext) {
  if (!matchesInternalSecret(c.req.header('X-Internal-Secret'), c.env)) {
    throw new HTTPException(401, { message: 'Unauthorized' });
  }
}

/**
 * scheduled -> live at starts_at (bulk - no side effects, just a status flip).
 * live -> ended at COALESCE(official_end_at, ends_at): in the same
 * transition, retro_published=1 and display_locked=1 on all of that hunt's
 * finishes. display_name_snapshot is already kept current on every
 * display-choice edit (see setKwestDisplayChoice), so locking is the only
 * write needed to freeze the winners list.
 */
export async function kwestLifecycleSweep(env: Env): Promise<number> {
  let processed = 0;

  const toLive = await env.DB.prepare(`
    UPDATE kwest_hunts SET status = 'live', updated_at = unixepoch()
    WHERE status = 'scheduled' AND starts_at <= unixepoch()
  `).run();
  processed += toLive.meta.changes ?? 0;

  const { results } = await env.DB.prepare(`
    SELECT id FROM kwest_hunts
    WHERE status = 'live' AND unixepoch() >= COALESCE(official_end_at, ends_at)
    LIMIT ?
  `).bind(SWEEP_BATCH).all<{ id: number }>();

  for (const hunt of results ?? []) {
    try {
      const flip = await env.DB.prepare(`
        UPDATE kwest_hunts SET status = 'ended', retro_published = 1, updated_at = unixepoch()
        WHERE id = ? AND status = 'live'
      `).bind(hunt.id).run();
      if (flip.meta.changes === 1) {
        await env.DB.prepare(
          'UPDATE kwest_finishes SET display_locked = 1 WHERE hunt_id = ?'
        ).bind(hunt.id).run();
        processed++;
      }
    } catch (err) {
      logger.error(`Kwest lifecycle sweep failed for hunt ${hunt.id}: ${(err as Error).message}`);
    }
  }

  return processed;
}

/**
 * NULLs raw device coordinates on reveals whose hunt officially ended more
 * than 30 days ago. distance_m/result (the aggregates admins actually need
 * for historical dashboards) are untouched - only the precise lat/lng go.
 */
export async function kwestRetentionSweep(env: Env): Promise<number> {
  const { results } = await env.DB.prepare(`
    SELECT r.id FROM kwest_reveals r
    JOIN kwest_hunts h ON h.id = r.hunt_id
    WHERE h.official_end_at IS NOT NULL
      AND unixepoch() >= h.official_end_at + ?
      AND r.device_lat IS NOT NULL
    LIMIT ?
  `).bind(RETENTION_SECONDS, SWEEP_BATCH).all<{ id: number }>();

  let processed = 0;
  for (const row of results ?? []) {
    const flip = await env.DB.prepare(`
      UPDATE kwest_reveals SET device_lat = NULL, device_lng = NULL, edge_lat = NULL, edge_lng = NULL
      WHERE id = ? AND device_lat IS NOT NULL
    `).bind(row.id).run();
    if (flip.meta.changes === 1) processed++;
  }

  return processed;
}

/** POST /api/internal/kwest/lifecycle */
export async function internalKwestLifecycle(c: AppContext) {
  requireInternalSecret(c);
  const processed = await kwestLifecycleSweep(c.env);
  return c.json({ data: { processed } });
}

/** POST /api/internal/kwest/retention */
export async function internalKwestRetention(c: AppContext) {
  requireInternalSecret(c);
  const processed = await kwestRetentionSweep(c.env);
  return c.json({ data: { processed } });
}
