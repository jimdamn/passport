import { getToken } from './client';

/**
 * Business Hub overview - served by kk-business, not a Passport endpoint
 * (kk-business owns the module tables). Browser-side fetch with the
 * resident's KKAuth bearer, same pattern as lendahand.ts. Best-effort: the
 * card degrades to deep-links-only if this fails.
 */

const BUSINESS_API = 'https://business.lakeandlocals.com/api';

export interface BusinessOverview {
  endorsements: { pending: number };
  pos: {
    week_ticket_count: number;
    week_total_cents: number;
    open_storefront_orders: number;
    new_quote_requests: number;
  };
  bookings: { upcoming_confirmed: number };
  volunteer: { active_listings: number; spots_filled: number; spots_total: number };
}

export async function getBusinessOverview(): Promise<BusinessOverview | null> {
  const token = getToken();
  if (!token) return null;
  try {
    const res = await fetch(`${BUSINESS_API}/overview`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return null;
    const body = await res.json() as { data: BusinessOverview };
    return body.data;
  } catch {
    return null;
  }
}
