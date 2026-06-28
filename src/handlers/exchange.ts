import type { Context } from 'hono';
import type { Env } from '../types';
import { fetchExchangeOffers } from '../lib/exchange';

type AppContext = Context<{ Bindings: Env }>;

// GET /api/t/:tenant/exchange/offers — recent active offers from the Exchange app,
// surfaced as a strip on the Passport Marketplace. Returns [] for guests (no token
// to forward) so the strip simply hides itself.
export async function listExchangeOffers(c: AppContext) {
  const tenant = c.get('tenant');
  const limit  = Math.min(parseInt(c.req.query('limit') ?? '6', 10) || 6, 20);
  const offers = await fetchExchangeOffers(
    c.env,
    tenant.id,
    c.req.header('Authorization') ?? null,
    limit,
  );
  return c.json({ data: offers });
}
