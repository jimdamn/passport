import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { Env } from '../types';

type AppContext = Context<{ Bindings: Env }>;

// GET /api/t/:tenant/members/:id — public member profile
// :id is the kkauth_uid — the public user id shared across all KrowdKraft apps.
export async function getMember(c: AppContext) {
  const tenant = c.get('tenant');
  const memberId = c.req.param('id') ?? '';

  const user = await c.env.DB.prepare(`
    SELECT kkauth_uid as id, display_name, location, bio, avatar_url,
           bd_member_since, created_at
    FROM users
    WHERE kkauth_uid = ? AND tenant_id = ? AND is_active = 1
  `).bind(parseInt(memberId, 10) || -1, tenant.id).first<any>();

  if (!user) throw new HTTPException(404, { message: 'Member not found' });

  // Fetch badges from KKCredits Service Binding
  let badges: any[] = [];
  try {
    const res = await c.env.KKCREDITS.fetch(`https://kkcredits/badges/${parseInt(memberId, 10)}`);
    if (res.ok) {
      const json = await res.json<{ data: any[] }>();
      badges = (json.data || []).map(b => ({
        id: b.slug,
        label: b.name,
        description: b.description,
      }));
    }
  } catch (err) {
    console.error('[passport] Failed to fetch badges from KKCredits:', err);
  }

  // Passport has no offers — keep the shared PublicProfile response shape.
  return c.json({
    data: {
      member: user,
      badges,
      active_offers: [],
    },
  });
}
