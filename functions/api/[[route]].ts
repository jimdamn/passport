import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { HTTPException } from 'hono/http-exception';
import type { Env } from '../../src/types';
/// <reference types="@cloudflare/workers-types" />
import { resolveTenant } from '../../src/middleware/tenant';
import { requireAuth } from '../../src/middleware/auth';
import { authRouter } from '../../src/routers/auth';
import { scanPlaque, registerClaim, getStamps } from '../../src/handlers/passport';

import { logger } from '../../src/lib/logger';

const app = new Hono<{ Bindings: Env }>();

app.use('*', cors({
  origin: (origin) => origin || '*',
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

  const { results: nicheRows } = await c.env.DB.prepare(`
    SELECT n.*,
      json_group_array(json_object(
        'id', cat.id, 'slug', cat.slug, 'name', cat.name,
        'icon', cat.icon, 'sort_order', cat.sort_order
      )) as categories_json
    FROM niches n
    LEFT JOIN categories cat ON cat.niche_id = n.id
    WHERE n.tenant_id = ? AND n.is_active = 1
    GROUP BY n.id
    ORDER BY n.sort_order ASC
  `).bind(tenantId).all<any>();

  const niches = (nicheRows || []).map(row => ({
    ...row,
    config: JSON.parse(row.config || '{}'),
    categories: JSON.parse(row.categories_json || '[]')
      .filter((cat: any) => cat.id !== null)
      .sort((a: any, b: any) => a.sort_order - b.sort_order),
    categories_json: undefined,
  }));

  return c.json({ data: { tenant, niches } });
});


// Tenant-scoped API
const tenantApp = new Hono<{ Bindings: Env }>();
tenantApp.use('*', resolveTenant);
tenantApp.use('*', requireAuth);

tenantApp.get('/passport/stamps', getStamps);

// Public Passport Scan & Claims APIs (Tenant-scoped, Guest-friendly)
app.post('/api/t/:tenant/passport/scan', resolveTenant, scanPlaque);
app.post('/api/t/:tenant/passport/claims/register', resolveTenant, registerClaim);
app.get('/api/t/:tenant/passport/members', resolveTenant, async (c) => {
  const tenant = c.get('tenant');
  const members = await c.env.DB.prepare(`
    SELECT id, display_name, location, bio, avatar_url, bd_member_since, created_at
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
