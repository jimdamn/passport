import { createMiddleware } from 'hono/factory';
import { HTTPException } from 'hono/http-exception';
import type { Env, Niche } from '../types';

export const resolveNiche = createMiddleware<{ Bindings: Env }>(async (c, next) => {
  const slug = c.req.param('niche') as string;
  const tenantId = c.get('tenant').id;
  const cacheKey = `niche:${tenantId}:${slug}`;

  const cached = await c.env.PASSPORT_CONFIG.get(cacheKey, 'json') as Niche | null;
  if (cached) {
    c.set('niche', cached);
    return next();
  }

  const row = await c.env.DB.prepare(`
    SELECT n.*,
      json_group_array(json_object(
        'id', cat.id, 'slug', cat.slug, 'name', cat.name,
        'icon', cat.icon, 'sort_order', cat.sort_order
      )) as categories_json
    FROM niches n
    LEFT JOIN categories cat ON cat.niche_id = n.id
    WHERE n.tenant_id = ? AND n.slug = ? AND n.is_active = 1
    GROUP BY n.id
  `).bind(tenantId, slug).first<any>();

  if (!row) throw new HTTPException(404, { message: `Niche "${slug}" not found` });

  const niche: Niche = {
    ...row,
    config: JSON.parse(row.config || '{}'),
    categories: JSON.parse(row.categories_json || '[]').filter((c: any) => c.id !== null),
  };
  delete (niche as any).categories_json;

  await c.env.PASSPORT_CONFIG.put(cacheKey, JSON.stringify(niche), { expirationTtl: 300 });
  c.set('niche', niche);
  await next();
});
