/**
 * KrowdKwest finish celebration - direct POST to KKAuth's /internal/notifications
 * (the game-toast channel), per KROWDKWEST-INTEGRATION-CONTRACTS.md Section 3.
 * Fullscreen chest reveal only; step/mini-game celebrations render instantly
 * in-app and never go through here.
 */

import type { Env } from '../types';
import { logger } from './logger';

const CHEST_ICON_URL = 'https://passport.lakeandlocals.com/site-assets/kwest/chest.png';

export async function notifyKwestFinish(
  env: Env,
  userId: string,
  title: string,
  message: string,
): Promise<void> {
  try {
    const res = await env.KKAUTH.fetch(
      new Request('https://kkauth/internal/notifications', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-Secret': env.INTERNAL_SECRET,
        },
        body: JSON.stringify({
          user_id: Number(userId),
          title,
          message,
          badge: '🏆',
          layout: 'fullscreen',
          icon_url: CHEST_ICON_URL,
        }),
      })
    );
    if (!res.ok) {
      logger.error('KKAuth notification failed', { error_code: res.status });
    }
  } catch (err) {
    // Celebration is best-effort - a KKAuth hiccup must never fail the finish itself.
    logger.error(`KKAuth notification error: ${err instanceof Error ? err.message : String(err)}`);
  }
}
