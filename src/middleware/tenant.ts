import { createMiddleware } from 'hono/factory';
import { HTTPException } from 'hono/http-exception';
import type { Env, Tenant } from '../types';

export const resolveTenant = createMiddleware<{ Bindings: Env }>(async (c, next) => {
  const tenantParam = c.req.param('tenant') as string | undefined;
  const hostname = new URL(c.req.url).hostname;
  const lookupKey = tenantParam || hostname;
  const cacheKey = tenantParam ? `tenant:slug:${lookupKey}` : `tenant:host:${lookupKey}`;

  const cached = await c.env.PASSPORT_CONFIG.get(cacheKey, 'json') as Tenant | null;
  if (cached) {
    c.set('tenant', cached);
    return next();
  }

  const query = tenantParam
    ? 'SELECT * FROM tenants WHERE id = ? AND is_active = 1'
    : 'SELECT * FROM tenants WHERE hostname = ? AND is_active = 1';

  const row = await c.env.DB.prepare(query).bind(lookupKey).first<any>();
  if (!row) throw new HTTPException(404, { message: 'Tenant not found' });

  const tenant: Tenant = { ...row, config: JSON.parse(row.config || '{}') };
  await c.env.PASSPORT_CONFIG.put(cacheKey, JSON.stringify(tenant), { expirationTtl: 300 });
  c.set('tenant', tenant);
  await next();
});
