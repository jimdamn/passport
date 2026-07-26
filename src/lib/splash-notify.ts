/**
 * Social Splash toasts - direct POST to KKAuth's /internal/notifications (the
 * game-toast channel), same shape as kwest-notify.ts's fullscreen celebration
 * but with layout 'toast' for these calmer, non-fullscreen moments (accept/
 * decline). Best-effort: a KKAuth hiccup must never fail the accept/decline
 * request itself.
 */

import type { Env } from '../types';
import { logger } from './logger';

export async function notifySplash(env: Env, kkauthUid: number, title: string, message: string): Promise<void> {
  try {
    const res = await env.KKAUTH.fetch(
      new Request('https://kkauth/internal/notifications', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-Secret': env.INTERNAL_SECRET,
        },
        body: JSON.stringify({
          user_id: kkauthUid,
          title,
          message,
          badge: '📸',
          layout: 'toast',
        }),
      })
    );
    if (!res.ok) {
      logger.error('KKAuth notification failed', { error_code: res.status });
    }
  } catch (err) {
    logger.error(`KKAuth notification error: ${err instanceof Error ? err.message : String(err)}`);
  }
}
