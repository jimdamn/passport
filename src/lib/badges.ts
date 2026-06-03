/**
 * Badge system — definitions and award logic.
 *
 * Badges are computed from existing user stats (no separate DB table needed).
 * Images are served from the site-image-assets R2 bucket at:
 *   /assets/badges/<id>.png
 *
 * To add a new badge:
 *   1. Define it in BADGE_DEFS below.
 *   2. Add its award condition to computeBadges().
 *   3. Upload the image to R2 at badges/<id>.png.
 */

export interface BadgeDef {
  id:          string;
  label:       string;
  description: string;
}

export const BADGE_DEFS: BadgeDef[] = [
  {
    id:          'bd-member',
    label:       'L&L Member',
    description: 'Verified Lake & Locals member',
  },
  {
    id:          'top-trader',
    label:       'Top Trader',
    description: 'Completed 10 or more trades',
  },
  {
    id:          'five-star',
    label:       'Five Star',
    description: 'Maintained a near-perfect rating across 3+ reviews',
  },
  {
    id:          'rising-star',
    label:       'Rising Star',
    description: 'Completed first trade within 90 days of joining',
  },
];

// Index for fast lookups
export const BADGE_MAP: Record<string, BadgeDef> = Object.fromEntries(
  BADGE_DEFS.map(b => [b.id, b])
);

/**
 * Compute which badge IDs a user has earned based on their stored stats.
 * Runs on the backend so the client never has to implement this logic.
 */
export function computeBadges(user: {
  bd_member_since: number | null;
  trade_count:     number;
  rating_avg:      number;
  rating_count:    number;
  created_at:      number;
}): string[] {
  const badges: string[] = [];

  if (user.bd_member_since) {
    badges.push('bd-member');
  }

  if (user.trade_count >= 10) {
    badges.push('top-trader');
  }

  if (user.rating_count >= 3 && user.rating_avg >= 4.8) {
    badges.push('five-star');
  }

  const daysOld = (Math.floor(Date.now() / 1000) - user.created_at) / 86400;
  if (user.trade_count >= 1 && daysOld <= 90) {
    badges.push('rising-star');
  }

  return badges;
}
