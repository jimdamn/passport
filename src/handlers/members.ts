import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { Env } from '../types';

type AppContext = Context<{ Bindings: Env }>;

// GET /api/t/:tenant/members/:id — public member profile
// :id is the kkauth_uid — the public user id shared across all KrowdKraft apps.
export async function getMember(c: AppContext) {
  const tenant    = c.get('tenant');
  const memberId  = parseInt(c.req.param('id') ?? '', 10);
  if (isNaN(memberId) || memberId < 1) throw new HTTPException(404, { message: 'Member not found' });

  const [user, badgesRes, ratingRes] = await Promise.all([
    c.env.DB.prepare(`
      SELECT kkauth_uid as id, display_name, location, bio, avatar_url,
             bd_member_since, created_at
      FROM users
      WHERE kkauth_uid = ? AND tenant_id = ? AND is_active = 1
    `).bind(memberId, tenant.id).first<any>(),

    c.env.KKCREDITS.fetch(`https://kkcredits/badges/${memberId}`).catch(() => null),

    c.env.KKAUTH.fetch(
      new Request(`https://kkauth/internal/users/${memberId}/ratings?limit=0`, {
        headers: { 'X-Internal-Secret': c.env.INTERNAL_SECRET },
      })
    ).catch(() => null),
  ]);

  if (!user) throw new HTTPException(404, { message: 'Member not found' });

  let badges: any[] = [];
  if (badgesRes?.ok) {
    try {
      const json = await badgesRes.json<{ data: any[] }>();
      badges = (json.data || []).map(b => ({ id: b.slug, label: b.name, description: b.description }));
    } catch {}
  }

  let rating_avg   = 0;
  let rating_count = 0;
  if (ratingRes?.ok) {
    try {
      const json = await ratingRes.json<{ data: { rating_avg: number; rating_count: number } }>();
      rating_avg   = json.data?.rating_avg   ?? 0;
      rating_count = json.data?.rating_count ?? 0;
    } catch {}
  }

  return c.json({
    data: {
      member: { ...user, rating_avg, rating_count },
      badges,
      active_offers: [],
    },
  });
}

// POST /api/t/:tenant/members/:id/rate — authenticated
export async function rateMember(c: AppContext) {
  const rateeId = parseInt(c.req.param('id') ?? '', 10);
  if (isNaN(rateeId) || rateeId < 1) throw new HTTPException(400, { message: 'Invalid member id' });

  const user    = c.get('user');
  const raterId = parseInt(user.sub, 10);

  if (raterId === rateeId) throw new HTTPException(400, { message: 'Cannot rate yourself' });

  const body = await c.req.json<{
    score?:        number;
    comment?:      string | null;
    context_type?: string | null;
    context_id?:   string | null;
  }>();

  const { score, comment, context_type, context_id } = body;

  if (!Number.isInteger(score) || (score as number) < 1 || (score as number) > 5) {
    throw new HTTPException(400, { message: 'score must be an integer between 1 and 5' });
  }

  const res = await c.env.KKAUTH.fetch(new Request('https://kkauth/internal/ratings', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'X-Internal-Secret': c.env.INTERNAL_SECRET },
    body:    JSON.stringify({ rater_id: raterId, ratee_id: rateeId, score, comment: comment ?? null, context_type: context_type ?? null, context_id: context_id ?? null }),
  }));

  if (!res.ok) {
    const err = await res.json<{ error?: string }>().catch(() => ({ error: undefined }));
    throw new HTTPException(res.status as 400 | 404 | 409 | 500, { message: err.error ?? 'Failed to submit rating' });
  }

  return new Response(res.body, { status: 201, headers: { 'Content-Type': 'application/json' } });
}

// GET /api/t/:tenant/members/:id/ratings — public
export async function getMemberRatings(c: AppContext) {
  const memberId = parseInt(c.req.param('id') ?? '', 10);
  if (isNaN(memberId) || memberId < 1) throw new HTTPException(400, { message: 'Invalid member id' });

  const limit  = Math.min(parseInt(c.req.query('limit')  ?? '20', 10), 50);
  const offset = parseInt(c.req.query('offset') ?? '0', 10);

  const res = await c.env.KKAUTH.fetch(
    new Request(`https://kkauth/internal/users/${memberId}/ratings?limit=${limit}&offset=${offset}`, {
      headers: { 'X-Internal-Secret': c.env.INTERNAL_SECRET },
    })
  );

  if (!res.ok) throw new HTTPException(502, { message: 'Failed to fetch ratings' });

  return new Response(res.body, { status: 200, headers: { 'Content-Type': 'application/json' } });
}
