import type { Env } from '../types';

// Exchange is deployed as a Cloudflare Pages project, not a Worker, so it cannot
// be reached through a service binding — Passport calls it over public HTTPS.
// Override per-environment by setting EXCHANGE_BASE_URL; defaults to prod.
const DEFAULT_EXCHANGE_BASE_URL = 'https://exchange.lakeandlocals.com';

export interface ExchangeOffer {
  id: string;
  title: string;
  offer_type: string;
  location: string | null;
  created_at: number;
  category_name: string | null;
  category_icon: string | null;
}

function exchangeBaseUrl(env: Env): string {
  return env.EXCHANGE_BASE_URL || DEFAULT_EXCHANGE_BASE_URL;
}

// Fetch a member's active offers from Exchange. Exchange's members endpoint is
// behind requireAuth, so we forward the caller's bearer token. Returns [] on any
// failure (no token, network error, non-200) — the offers strip is non-critical
// chrome on the profile, so it should never break the page.
export async function fetchMemberActiveOffers(
  env: Env,
  tenantId: string,
  memberId: number,
  authHeader: string | null,
): Promise<ExchangeOffer[]> {
  if (!authHeader) return [];
  try {
    const res = await fetch(
      `${exchangeBaseUrl(env)}/api/t/${encodeURIComponent(tenantId)}/members/${memberId}`,
      { headers: { Authorization: authHeader } },
    );
    if (!res.ok) return [];
    const json = await res.json<{ data?: { active_offers?: ExchangeOffer[] } }>();
    return json.data?.active_offers ?? [];
  } catch {
    return [];
  }
}
