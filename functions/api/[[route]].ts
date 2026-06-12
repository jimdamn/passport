import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { HTTPException } from 'hono/http-exception';
import type { Env } from '../../src/types';
/// <reference types="@cloudflare/workers-types" />
import { resolveTenant } from '../../src/middleware/tenant';
import { requireAuth } from '../../src/middleware/auth';
import { authRouter } from '../../src/routers/auth';
import { scanPlaque, registerClaim, getStamps } from '../../src/handlers/passport';
import { getBalance, getBalanceOnly } from '../../src/handlers/credits';
import { getMember } from '../../src/handlers/members';
import {
  createTestPlaque, removeTestPlaque,
  listPlaques, createPlaque, updatePlaque, deletePlaque,
  listPrizes, createPrize, updatePrize, deletePrize,
} from '../../src/handlers/admin';

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

// Public Passport Scan & Claims APIs (Tenant-scoped, Guest-friendly)
app.post('/api/t/:tenant/passport/scan', resolveTenant, scanPlaque);
app.post('/api/t/:tenant/passport/claims/register', resolveTenant, registerClaim);
app.get('/api/t/:tenant/members/:id', resolveTenant, getMember);
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

export const onRequest: PagesFunction<Env> = (context) => app.fetch(context.request, context.env);
