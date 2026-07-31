import type { Env } from '../types';

// Exchange is deployed as a Cloudflare Pages project, not a Worker, so it cannot
// be reached through a service binding — Passport calls it over public HTTPS.
// Override per-environment by setting EXCHANGE_BASE_URL; defaults to prod.
const DEFAULT_EXCHANGE_BASE_URL = 'https://exchange.lakeandlocals.com';

// Exchange currently runs a single niche (SkillSwap, slug "skills"). The offers
// list route is niche-scoped, so we target that slug.
const EXCHANGE_NICHE = 'skills';

export interface ExchangeOffer {
  id: string;
  title: string;
  offer_type: string;
  location: string | null;
  created_at: number;
  category_name: string | null;
  category_icon: string | null;
}

export interface ExchangeMarketOffer extends ExchangeOffer {
  creator_label: string | null;
  interest_count: number;
  user_id: number;
  persona_type: string;
}

export function exchangeBaseUrl(env: Env): string {
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

// Fetch the most recent active offers across the niche, to surface a strip on
// the Marketplace. Forwards the caller's bearer token (Exchange's offers list is
// behind requireAuth). Returns [] on any failure.
export async function fetchExchangeOffers(
  env: Env,
  tenantId: string,
  authHeader: string | null,
  limit = 6,
): Promise<ExchangeMarketOffer[]> {
  if (!authHeader) return [];
  try {
    const res = await fetch(
      `${exchangeBaseUrl(env)}/api/t/${encodeURIComponent(tenantId)}/${EXCHANGE_NICHE}/offers?limit=${limit}&sort=recent`,
      { headers: { Authorization: authHeader } },
    );
    if (!res.ok) return [];
    const json = await res.json<{ data?: any[] }>();
    return (json.data ?? []).map(o => ({
      id: o.id,
      title: o.title,
      offer_type: o.offer_type,
      location: o.location ?? null,
      created_at: o.created_at,
      category_name: o.category_name ?? null,
      category_icon: o.category_icon ?? null,
      creator_label: o.creator_label ?? null,
      interest_count: o.interest_count ?? 0,
      user_id: o.user_id,
      persona_type: o.persona_type ?? 'anonymous',
    }));
  } catch {
    return [];
  }
}
