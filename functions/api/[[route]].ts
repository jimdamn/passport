import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { HTTPException } from 'hono/http-exception';
import type { Env } from '../../src/types';
/// <reference types="@cloudflare/workers-types" />
import { resolveTenant } from '../../src/middleware/tenant';
import { requireAuth } from '../../src/middleware/auth';
import { authRouter } from '../../src/routers/auth';
import { scanPlaque, registerClaim, attachClaim, getStamps } from '../../src/handlers/passport';
import { getBalance, getBalanceOnly } from '../../src/handlers/credits';
import { getMember, provisionMember, getNetworkMembers } from '../../src/handlers/members';
import {
  createTestPlaque, removeTestPlaque,
  listPlaques, createPlaque, updatePlaque, deletePlaque,
  listPrizes, createPrize, updatePrize, deletePrize,
} from '../../src/handlers/admin';
import { lookupClaim, confirmClaim } from '../../src/handlers/redeem';
import { claimVisit } from '../../src/handlers/claim-visit';
import { listMyPrizes, createMyPrize, updateMyPrize, deleteMyPrize, listMyClaims, getMyBusiness, updateMyBusiness } from '../../src/handlers/merchant';
import {
  listDeals, purchaseDeal, listMyDealClaims, regenerateDealClaimCode,
  listMerchantDeals, createMerchantDeal, updateMerchantDeal, deleteMerchantDeal,
  adminListDeals, adminUpdateDeal, adminDeleteDeal, internalSweep,
} from '../../src/handlers/deals';
import {
  listHappenings, listMerchantHappenings, createHappening, updateHappening, deleteHappening,
  adminListHappenings, adminUpdateHappening, adminDeleteHappening,
} from '../../src/handlers/happenings';

import { listExchangeOffers } from '../../src/handlers/exchange';
import { rollHunt } from '../../src/lib/game';
import {
  listKwestHunts, getKwestHunt, getKwestRules, startKwest, ackKwest, getKwestState, revealKwest,
  getKwestRetro, attachKwestGuest, setKwestDisplayChoice, getMyKwestProgress,
} from '../../src/handlers/kwest';

import { logger } from '../../src/lib/logger';

const app = new Hono<{ Bindings: Env }>();

// Allowlist only — reflecting arbitrary origins with credentials:true would
// let any site make authenticated cookie-bearing requests to this API.
app.use('*', cors({
  origin: (origin) => {
    if (!origin) return origin;
    try {
      const { hostname } = new URL(origin);
      const allowed =
        hostname === 'localhost' ||
        hostname === '127.0.0.1' ||
        hostname.endsWith('.pages.dev') ||
        hostname === 'lakeandlocals.com' ||
        hostname.endsWith('.lakeandlocals.com');
      return allowed ? origin : '';
    } catch {
      return '';
    }
  },
  credentials: true,
  allowHeaders: ['Content-Type', 'Authorization', 'X-App-Key'],
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
}));

// Auth — handled by KKAuth adapter (no tenant middleware needed)
app.route('/api/auth', authRouter);

// Public tenant bootstrap — returns tenant config
// Called by TenantContext on every page load to configure branding.
app.get('/api/t/:tenant', async (c) => {
  const tenantId = c.req.param('tenant');

  const tenantRow = await c.env.DB.prepare(
    'SELECT * FROM tenants WHERE id = ? AND is_active = 1'
  ).bind(tenantId).first<any>();

  if (!tenantRow) return c.json({ error: 'Tenant not found' }, 404);

  const tenant = { ...tenantRow, config: JSON.parse(tenantRow.config || '{}') };

  // Passport has no niches/categories tables — return an empty list so the
  // shared TenantContext shape stays compatible with the other apps.
  return c.json({ data: { tenant, niches: [] } });
});


// Tenant-scoped API
const tenantApp = new Hono<{ Bindings: Env }>();
tenantApp.use('*', resolveTenant);
tenantApp.use('*', requireAuth);

tenantApp.get('/passport/stamps', getStamps);
tenantApp.post('/passport/claims/attach', attachClaim);
tenantApp.get('/credits/balance', getBalance);
tenantApp.get('/credits/balance-only', getBalanceOnly);
tenantApp.post('/admin/test-plaque', createTestPlaque);
tenantApp.delete('/admin/test-plaque', removeTestPlaque);
tenantApp.get('/admin/plaques', listPlaques);
tenantApp.post('/admin/plaques', createPlaque);
tenantApp.put('/admin/plaques/:id', updatePlaque);
tenantApp.delete('/admin/plaques/:id', deletePlaque);
tenantApp.get('/admin/prizes', listPrizes);
tenantApp.post('/admin/prizes', createPrize);
tenantApp.put('/admin/prizes/:id', updatePrize);
tenantApp.delete('/admin/prizes/:id', deletePrize);
tenantApp.post('/claim/visit', claimVisit);
tenantApp.post('/redeem/lookup', lookupClaim);
tenantApp.post('/redeem/confirm', confirmClaim);
tenantApp.get('/merchant/business', getMyBusiness);
tenantApp.patch('/merchant/business', updateMyBusiness);
tenantApp.get('/merchant/prizes', listMyPrizes);
tenantApp.post('/merchant/prizes', createMyPrize);
tenantApp.put('/merchant/prizes/:id', updateMyPrize);
tenantApp.delete('/merchant/prizes/:id', deleteMyPrize);
tenantApp.get('/merchant/claims', listMyClaims);
tenantApp.post('/deals/:id/claim', purchaseDeal);
tenantApp.get('/deals/mine', listMyDealClaims);
tenantApp.post('/deals/claims/:id/code', regenerateDealClaimCode);
tenantApp.get('/merchant/deals', listMerchantDeals);
tenantApp.post('/merchant/deals', createMerchantDeal);
tenantApp.put('/merchant/deals/:id', updateMerchantDeal);
tenantApp.delete('/merchant/deals/:id', deleteMerchantDeal);
tenantApp.get('/admin/deals', adminListDeals);
tenantApp.put('/admin/deals/:id', adminUpdateDeal);
tenantApp.delete('/admin/deals/:id', adminDeleteDeal);
tenantApp.get('/merchant/happenings', listMerchantHappenings);
tenantApp.post('/merchant/happenings', createHappening);
tenantApp.put('/merchant/happenings/:id', updateHappening);
tenantApp.delete('/merchant/happenings/:id', deleteHappening);
tenantApp.get('/admin/happenings', adminListHappenings);
tenantApp.put('/admin/happenings/:id', adminUpdateHappening);
tenantApp.delete('/admin/happenings/:id', adminDeleteHappening);

// KrowdKwest - guest progress migrates onto the account on sign-in.
tenantApp.post('/kwest/attach', attachKwestGuest);
tenantApp.post('/kwest/:slug/display-choice', setKwestDisplayChoice);
// NOTE: GET /kwest/mine is registered on the root app, BEFORE the
// guest-friendly GET /kwest/:slug pattern below - Hono resolves overlapping
// patterns by registration order (first match wins), not static-over-dynamic
// priority, so mounting it here (after tenantApp's routes are flattened in)
// would lose to :slug and 404 as "Hunt not found". See getMyKwestProgress.

// Digital Treasure Hunt — thin proxy to KKGame. Called on route changes for
// logged-in users; the win reveal arrives via the KKAuth game-toast channel,
// so a miss (the overwhelmingly common case) needs no client handling.
tenantApp.post('/hunt/roll', async (c) => {
  const user = c.get('user');
  const tenant = c.get('tenant');
  const body = await c.req.json<{ page_ref?: string }>().catch(() => ({} as { page_ref?: string }));

  const result = await rollHunt(c.env, {
    user_id: Number(user.sub),
    tenant_id: tenant.id,
    source_app: 'passport',
    page_ref: typeof body.page_ref === 'string' ? body.page_ref.slice(0, 200) : undefined,
  });

  return c.json({ data: result ?? { eligible: false, won: false } });
});

// Cron backstop for deal-claim expiry (X-Internal-Secret protected)
app.post('/api/internal/deals/sweep', internalSweep);
app.post('/api/internal/members/provision', provisionMember);

// Public Passport Scan & Claims APIs (Tenant-scoped, Guest-friendly)
app.post('/api/t/:tenant/passport/scan', resolveTenant, scanPlaque);
app.get('/api/t/:tenant/deals', resolveTenant, listDeals);
app.get('/api/t/:tenant/exchange/offers', resolveTenant, listExchangeOffers);
app.get('/api/t/:tenant/happenings', resolveTenant, listHappenings);
app.post('/api/t/:tenant/passport/claims/register', resolveTenant, registerClaim);
app.get('/api/t/:tenant/network-members', resolveTenant, getNetworkMembers);
app.get('/api/t/:tenant/members/:id', resolveTenant, getMember);
// KrowdKwest - real-world GPS clue hunt. Guest-friendly (no account
// required to play); a finish requires signing in (see attach, above).
app.get('/api/t/:tenant/kwest', resolveTenant, listKwestHunts);
// Registered BEFORE the guest-friendly GET /kwest/:slug pattern below -
// Hono resolves overlapping patterns by registration order, not
// static-over-dynamic priority, so "mine" would otherwise be swallowed as a
// slug and 404. requireAuth chained inline since this route isn't on tenantApp.
app.get('/api/t/:tenant/kwest/mine', resolveTenant, requireAuth, getMyKwestProgress);
app.get('/api/t/:tenant/kwest/:slug', resolveTenant, getKwestHunt);
app.get('/api/t/:tenant/kwest/:slug/rules', resolveTenant, getKwestRules);
app.post('/api/t/:tenant/kwest/:slug/start', resolveTenant, startKwest);
app.post('/api/t/:tenant/kwest/:slug/ack', resolveTenant, ackKwest);
app.get('/api/t/:tenant/kwest/:slug/state', resolveTenant, getKwestState);
app.post('/api/t/:tenant/kwest/:slug/reveal', resolveTenant, revealKwest);
app.get('/api/t/:tenant/kwest/:slug/retro', resolveTenant, getKwestRetro);

app.get('/api/t/:tenant/passport/members', resolveTenant, async (c) => {
  const tenant = c.get('tenant');
  // kkauth_uid is the public user id across all KrowdKraft apps — never expose
  // the local AUTOINCREMENT row id.
  const members = await c.env.DB.prepare(`
    SELECT kkauth_uid as id, display_name, location, bio, avatar_url, bd_member_since, created_at
    FROM users
    WHERE tenant_id = ? AND is_active = 1 AND bd_uid IS NOT NULL
    ORDER BY created_at DESC
  `).bind(tenant.id).all<any>();
  return c.json({ data: members.results || [] });
});

app.route('/api/t/:tenant', tenantApp);

app.onError((err, c) => {
  logger.error(err.message ?? 'Internal server error', {
    path: c.req.path,
    error_code: (err as { status?: number }).status ?? 500,
  });
  if (err instanceof HTTPException) {
    return c.json({ error: err.message, status: err.status }, err.status as any);
  }
  const message = err instanceof Error ? err.message : String(err);
  return c.json({ error: message, status: 500 }, 500);
});

// The Pages EventContext must ride along as Hono's ExecutionContext - without
// it, any handler touching c.executionCtx throws after its work committed.
export const onRequest: PagesFunction<Env> = (context) =>
  app.fetch(context.request, context.env, {
    waitUntil: (p) => context.waitUntil(p),
    passThroughOnException: () => context.passThroughOnException(),
  } as ExecutionContext);
