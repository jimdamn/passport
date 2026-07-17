import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { Env } from '../types';
import { fetchMemberActiveOffers } from '../lib/exchange';
import { matchesInternalSecret } from '../lib/hmac';

type AppContext = Context<{ Bindings: Env }>;

// GET /api/t/:tenant/members/:id — public member profile
// :id is the kkauth_uid — the public user id shared across all KrowdKraft apps.
export async function getMember(c: AppContext) {
  const tenant    = c.get('tenant');
  const memberId  = parseInt(c.req.param('id') ?? '', 10);
  if (isNaN(memberId) || memberId < 1) throw new HTTPException(404, { message: 'Member not found' });

  const [user, badgesRes, activeOffers, hubLinksRes] = await Promise.all([
    c.env.DB.prepare(`
      SELECT kkauth_uid as id, display_name, location, bio, avatar_url,
             bd_member_since, created_at
      FROM users
      WHERE kkauth_uid = ? AND tenant_id = ? AND is_active = 1
    `).bind(memberId, tenant.id).first<any>(),

    c.env.KKCREDITS.fetch(`https://kkcredits/badges/${memberId}`).catch(() => null),

    fetchMemberActiveOffers(c.env, tenant.id, memberId, c.req.header('Authorization') ?? null),

    // Business Hub public links (booking + endorsements) - present only when
    // this member is a business with hub pages. Best-effort; never blocks.
    fetch(`${c.env.HUB_URL ?? 'https://business.lakeandlocals.com'}/api/public/links/${memberId}`, {
      signal: AbortSignal.timeout(3000),
    }).catch(() => null),
  ]);

  if (!user) throw new HTTPException(404, { message: 'Member not found' });

  let badges: any[] = [];
  if (badgesRes?.ok) {
    try {
      const json = await badgesRes.json<{ data: any[] }>();
      badges = (json.data || []).map(b => ({ id: b.slug, label: b.name, description: b.description }));
    } catch {}
  }

  let business_links: { business_name: string; booking_url: string | null; endorse_url: string | null; store_url?: string | null } | null = null;
  if (hubLinksRes?.ok) {
    try {
      const json = await hubLinksRes.json<{ data: typeof business_links }>();
      business_links = json.data ?? null;
    } catch {}
  }

  return c.json({
    data: {
      member: user,
      badges,
      active_offers: activeOffers,
      business_links,
    },
  });
}

// POST /api/internal/members/provision - called by the Business Hub the
// moment a business is verified, so every member business has a page on the
// network from day one (no waiting for their first Passport sign-in).
// Never overwrites an existing member's identity.
export async function provisionMember(c: AppContext) {
  if (!matchesInternalSecret(c.req.header('X-Internal-Secret'), c.env)) {
    throw new HTTPException(401, { message: 'Unauthorized' });
  }

  const body = await c.req.json<{
    tenant_id?: string;
    kkauth_uid?: number;
    email?: string;
    display_name?: string;
  }>();
  const tenantId = body.tenant_id ?? 'lake-locals';
  const kkauthUid = Number(body.kkauth_uid);
  const email = (body.email ?? '').trim().toLowerCase();
  const displayName = (body.display_name ?? '').trim() || 'Member';
  if (!Number.isInteger(kkauthUid) || kkauthUid < 1 || !email) {
    throw new HTTPException(400, { message: 'kkauth_uid and email are required' });
  }

  const res = await c.env.DB.prepare(`
    INSERT OR IGNORE INTO users (kkauth_uid, tenant_id, email, display_name)
    VALUES (?, ?, ?, ?)
  `).bind(kkauthUid, tenantId, email, displayName).run();

  return c.json({ data: { created: (res.meta?.changes ?? 0) > 0 } });
}

// GET /api/t/:tenant/network-members - the browse surface: every verified
// member business on the network, from KKAuth (the verification source of
// truth), KV-cached briefly. This is how "somebody who just showed up" learns
// who's on Lake & Locals. Real businesses only - no samples, no fabricated
// ratings, no paid placement; alphabetical from the source.
export async function getNetworkMembers(c: AppContext) {
  const tenant = c.get('tenant');
  const cacheKey = `network-members:${tenant.id}`;

  const cached = await c.env.PASSPORT_CONFIG.get(cacheKey, 'json').catch(() => null);
  if (cached) return c.json({ data: cached });

  const res = await c.env.KKAUTH.fetch(
    new Request('https://kkauth/internal/businesses/verified', {
      headers: { 'X-Internal-Secret': c.env.INTERNAL_SECRET },
    }),
  );
  if (!res.ok) throw new HTTPException(502, { message: 'Could not load network members' });

  const json = await res.json<{ data: any[] }>();
  const members = json.data ?? [];

  c.executionCtx.waitUntil(
    c.env.PASSPORT_CONFIG.put(cacheKey, JSON.stringify(members), { expirationTtl: 300 }).catch(() => {}),
  );

  return c.json({ data: members });
}

