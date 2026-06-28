/**
 * Happenings — local bulletin board
 *
 * Short, informal updates a VERIFIED merchant posts about their own day
 * ("Sourdough's out at 3", "Live music tonight"). Unlike deals and prizes,
 * happenings publish LIVE with no admin review queue: a verified merchant's
 * word about their own business needs no gatekeeping. Admins keep full
 * review / modify / unpublish power.
 *
 * Calm-board guardrail (Mission Filter G1): this is a bulletin board, not a
 * FOMO feed. No countdowns, no ranking, no urgency. Posts self-expire at the
 * end of the calendar day so the board cleans itself nightly. Anti-spam is a
 * gentle cooldown + live-post cap, surfaced as a nudge, never an error.
 *
 * Contact fields are snapshotted from KKAuth at post time so the public board
 * reads with a single query; per-post show flags gate what the contact bubble
 * reveals. An optional attached deal reuses passport_deals.event_id.
 */

import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { Env } from '../types';
import { nanoid } from 'nanoid';

type AppContext = Context<{ Bindings: Env }>;

// The board's wall-clock timezone for end-of-day expiry. The Tri-State Lakes
// region is mostly Eastern; one fixed zone keeps "clears at end of day" honest
// for the whole tenant.
const BOARD_TZ = 'America/New_York';

// Allowed categories. The backend is the source of truth so a crafted request
// can't invent a category the filter bar doesn't know about.
export const HAPPENING_CATEGORIES = [
  'live_music', 'markets', 'food_drink', 'sales',
  'community', 'family', 'outdoors', 'arts',
] as const;

// Anti-spam (calm-board guardrail). Enforced here, not in schema.
const COOLDOWN_MINUTES = 30;
const LIVE_POST_CAP = 3;

const BODY_MAX = 280;

function requireVerifiedMerchant(c: AppContext): string {
  const user = c.get('user');
  if (!user?.business_id || user.business_status !== 'verified') {
    throw new HTTPException(403, { message: 'A verified merchant profile is required.' });
  }
  return String(user.business_id);
}

function requireAdmin(c: AppContext) {
  const user = c.get('user');
  if (!user?.is_admin) throw new HTTPException(403, { message: 'Admin access required.' });
}

function cleanText(value: unknown, maxLen: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLen);
}

function asBool(value: unknown, fallback: boolean): boolean {
  if (value === undefined || value === null) return fallback;
  return !!value;
}

/**
 * Parse the optional ?lat=&lon=&radius= "near me" params. Returns null unless a
 * valid coordinate is supplied. radius is in miles; 0 (or absent) means "compute
 * distance but don't filter by it" so the board can still label each post.
 */
function parseNearby(c: AppContext): { lat: number; lon: number; radius: number } | null {
  const lat = Number(c.req.query('lat'));
  const lon = Number(c.req.query('lon'));
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return null;
  }
  const radius = Math.max(0, Math.min(500, Number(c.req.query('radius')) || 0));
  return { lat, lon, radius };
}

// Great-circle distance (miles) as a SQL expression over a post's stored coords.
// Mirrors the Exchange's haversine; clamps the acos argument to avoid NaN at the
// antipodes. The precise coords are used only here, server-side — never returned.
const DISTANCE_SQL = `
  3958.8 * acos(MIN(1.0, MAX(-1.0,
    sin(radians(h.merchant_lat)) * sin(radians(?)) +
    cos(radians(h.merchant_lat)) * cos(radians(?)) * cos(radians(h.merchant_lon) - radians(?))
  )))
`;

/**
 * Unix seconds for the next local midnight in BOARD_TZ. Computes seconds
 * elapsed since local midnight from the wall clock and adds the remainder —
 * accurate to within the rare DST-shift hour, which is plenty for a board that
 * only needs to clear "tonight".
 */
function endOfBoardDay(): number {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: BOARD_TZ, hour12: false,
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(now);
  const get = (t: string) => Number(parts.find(p => p.type === t)?.value ?? 0);
  let h = get('hour');
  if (h === 24) h = 0; // some runtimes emit 24 for midnight
  const elapsed = h * 3600 + get('minute') * 60 + get('second');
  const nowSec = Math.floor(now.getTime() / 1000);
  return nowSec + (86400 - elapsed);
}

/**
 * Snapshot the merchant's contact details from KKAuth at post time. Passport
 * does not store business contact info — KKAuth is the source — so we copy it
 * onto the row once. Short-lived posts make staleness a non-issue.
 */
async function fetchMerchantSnapshot(c: AppContext) {
  const auth = c.req.header('Authorization')!;
  const res = await c.env.KKAUTH.fetch(
    new Request('https://kkauth/businesses/me', { headers: { 'Authorization': auth } })
  );
  if (!res.ok) {
    throw new HTTPException(502, { message: 'Could not read your business profile — try again.' });
  }
  const body = await res.json<any>();
  const b = body?.data ?? body ?? {};
  return {
    name: b.name ?? null,
    phone: b.phone ?? null,
    address: b.address ?? null,
    website: b.website ?? null,
    lat: typeof b.lat === 'number' ? b.lat : null,
    lon: typeof b.lon === 'number' ? b.lon : null,
  };
}

function parseHappeningInput(body: any, existing?: any) {
  const text = cleanText(body.body, BODY_MAX) ?? existing?.body ?? null;
  if (!text) throw new HTTPException(400, { message: 'Write a short update to post.' });

  const category = HAPPENING_CATEGORIES.includes(body.category)
    ? body.category
    : (existing?.category ?? null);
  if (!category) throw new HTTPException(400, { message: 'Pick a category for your happening.' });

  const photoUrl = body.photo_url === undefined
    ? (existing?.photo_url ?? null)
    : cleanText(body.photo_url, 500);

  let startsAt = existing?.starts_at ?? null;
  if (body.starts_at !== undefined) {
    startsAt = body.starts_at === null ? null : Math.floor(Number(body.starts_at));
    if (startsAt !== null && !Number.isFinite(startsAt)) {
      throw new HTTPException(400, { message: 'Invalid start time.' });
    }
  }

  const showName = asBool(body.show_name, existing ? !!existing.show_name : true) ? 1 : 0;
  const showAddress = asBool(body.show_address, existing ? !!existing.show_address : true) ? 1 : 0;
  const showPhone = asBool(body.show_phone, existing ? !!existing.show_phone : true) ? 1 : 0;

  return { text, category, photoUrl, startsAt, showName, showAddress, showPhone };
}

/**
 * Re-point an attached deal at this happening via the dormant event_id hook.
 * Clears any deal previously tied to this happening, then (if a deal is chosen
 * and belongs to the merchant) links the new one. Verified-merchant scoped.
 */
async function reconcileAttachedDeal(
  c: AppContext, tenantId: string, merchantId: string, happeningId: string, dealId: unknown
) {
  await c.env.DB.prepare(
    'UPDATE passport_deals SET event_id = NULL WHERE event_id = ? AND tenant_id = ? AND merchant_id = ?'
  ).bind(happeningId, tenantId, merchantId).run();

  const cleanId = cleanText(dealId, 32);
  if (!cleanId) return;

  await c.env.DB.prepare(
    'UPDATE passport_deals SET event_id = ? WHERE id = ? AND tenant_id = ? AND merchant_id = ?'
  ).bind(happeningId, cleanId, tenantId, merchantId).run();
}

// ─────────────────────────────────────────────────────────────────────────────
// Public board
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/t/:tenant/happenings — public, guest-browseable board.
 * Optional ?category= filter. Contact fields are nulled server-side per the
 * post's show flags so hidden details never reach the client.
 */
export async function listHappenings(c: AppContext) {
  const tenant = c.get('tenant');
  const category = c.req.query('category');
  const near = parseNearby(c);

  const filters: string[] = [
    'h.tenant_id = ?', 'h.is_active = 1',
    'h.expires_at > unixepoch()',
    '(h.starts_at IS NULL OR h.starts_at <= unixepoch())',
  ];
  const binds: any[] = [tenant.id];
  if (category && HAPPENING_CATEGORIES.includes(category as any)) {
    filters.push('h.category = ?');
    binds.push(category);
  }

  // "Near me": compute distance server-side on precise coords and, when a radius
  // is set, filter to within it *before* the 200-cap — so the closest posts can
  // never be dropped by the limit. The precise coords are not returned.
  let distanceSelect = 'NULL AS distance_mi';
  if (near) {
    distanceSelect = `(${DISTANCE_SQL}) AS distance_mi`;
    binds.unshift(near.lat, near.lat, near.lon); // bound to the leading SELECT expr
    if (near.radius > 0) {
      filters.push('h.merchant_lat IS NOT NULL', 'h.merchant_lon IS NOT NULL');
      filters.push(`(${DISTANCE_SQL}) <= ?`);
      binds.push(near.lat, near.lat, near.lon, near.radius);
    }
  }

  const { results } = await c.env.DB.prepare(`
    SELECT h.id, h.merchant_id, h.category, h.body, h.photo_url, h.starts_at, h.expires_at, h.created_at,
           h.merchant_name, h.merchant_phone, h.merchant_address, h.merchant_website, h.merchant_lat, h.merchant_lon,
           h.show_name, h.show_address, h.show_phone,
           ${distanceSelect},
           d.id AS deal_id, d.title AS deal_title
    FROM passport_happenings h
    LEFT JOIN passport_deals d
      ON d.event_id = h.id AND d.is_active = 1 AND d.quantity_left != 0
         AND (d.starts_at IS NULL OR d.starts_at <= unixepoch())
         AND (d.ends_at IS NULL OR d.ends_at > unixepoch())
    WHERE ${filters.join(' AND ')}
    ORDER BY h.created_at DESC
    LIMIT 200
  `).bind(...binds).all<any>();

  const data = (results || []).map((h: any) => ({
    id: h.id,
    category: h.category,
    body: h.body,
    photo_url: h.photo_url,
    starts_at: h.starts_at,
    expires_at: h.expires_at,
    created_at: h.created_at,
    // Distance from the visitor when "near me" is active — a number only; the
    // underlying coords stay server-side.
    distance_mi: h.distance_mi == null ? null : Math.round(h.distance_mi * 10) / 10,
    // Contact bubble — only fields the merchant chose to show. Coordinates are
    // returned solely to power the map link, so they ride along only when the
    // address is shown; a hidden-address post reveals no coordinates at all.
    merchant_name: h.show_name ? h.merchant_name : null,
    merchant_address: h.show_address ? h.merchant_address : null,
    merchant_lat: h.show_address ? h.merchant_lat : null,
    merchant_lon: h.show_address ? h.merchant_lon : null,
    merchant_phone: h.show_phone ? h.merchant_phone : null,
    merchant_website: h.merchant_website,
    deal: h.deal_id ? { id: h.deal_id, title: h.deal_title } : null,
  }));

  return c.json({ data });
}

// ─────────────────────────────────────────────────────────────────────────────
// Merchant CRUD — verified merchants post live, no review queue
// ─────────────────────────────────────────────────────────────────────────────

const HAPPENING_SELECT = `
  SELECT h.*,
         (SELECT d.id FROM passport_deals d WHERE d.event_id = h.id LIMIT 1) AS deal_id,
         (SELECT d.title FROM passport_deals d WHERE d.event_id = h.id LIMIT 1) AS deal_title
  FROM passport_happenings h
`;

/**
 * GET /api/t/:tenant/merchant/happenings — the merchant's own posts, with the
 * live count so the UI can show "2 of 3 live" without a second call.
 */
export async function listMerchantHappenings(c: AppContext) {
  const merchantId = requireVerifiedMerchant(c);
  const tenant = c.get('tenant');

  const { results } = await c.env.DB.prepare(`
    ${HAPPENING_SELECT}
    WHERE h.tenant_id = ? AND h.merchant_id = ?
    ORDER BY h.is_active DESC, h.created_at DESC
    LIMIT 100
  `).bind(tenant.id, merchantId).all<any>();

  return c.json({ data: results || [] });
}

/**
 * POST /api/t/:tenant/merchant/happenings — publishes LIVE immediately.
 * Cooldown + live-cap are gentle nudges, not hard errors.
 */
export async function createHappening(c: AppContext) {
  const merchantId = requireVerifiedMerchant(c);
  const tenant = c.get('tenant');
  const body = await c.req.json<any>().catch(() => ({}));
  const input = parseHappeningInput(body);

  // Anti-spam: cooldown since the merchant's last post.
  const last = await c.env.DB.prepare(
    'SELECT created_at FROM passport_happenings WHERE tenant_id = ? AND merchant_id = ? ORDER BY created_at DESC LIMIT 1'
  ).bind(tenant.id, merchantId).first<{ created_at: number }>();
  if (last) {
    const since = Math.floor(Date.now() / 1000) - last.created_at;
    if (since < COOLDOWN_MINUTES * 60) {
      const mins = Math.ceil((COOLDOWN_MINUTES * 60 - since) / 60);
      throw new HTTPException(429, {
        message: `Give it a few minutes between posts — you can share another in about ${mins} min.`,
      });
    }
  }

  // Anti-spam: live-post cap.
  const live = await c.env.DB.prepare(
    'SELECT COUNT(*) AS n FROM passport_happenings WHERE tenant_id = ? AND merchant_id = ? AND is_active = 1 AND expires_at > unixepoch()'
  ).bind(tenant.id, merchantId).first<{ n: number }>();
  if ((live?.n ?? 0) >= LIVE_POST_CAP) {
    throw new HTTPException(409, {
      message: `You've got ${LIVE_POST_CAP} happenings live — they clear at end of day, or remove one to post another.`,
    });
  }

  const snapshot = await fetchMerchantSnapshot(c);
  const id = nanoid(10);
  const expiresAt = endOfBoardDay();

  await c.env.DB.prepare(`
    INSERT INTO passport_happenings
      (id, tenant_id, merchant_id, merchant_name, merchant_phone, merchant_address,
       merchant_website, merchant_lat, merchant_lon,
       show_name, show_address, show_phone, category, body, photo_url, starts_at, expires_at, is_active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
  `).bind(
    id, tenant.id, merchantId, snapshot.name, snapshot.phone, snapshot.address,
    snapshot.website, snapshot.lat, snapshot.lon,
    input.showName, input.showAddress, input.showPhone,
    input.category, input.text, input.photoUrl, input.startsAt, expiresAt
  ).run();

  await reconcileAttachedDeal(c, tenant.id, merchantId, id, body.deal_id);

  const happening = await c.env.DB.prepare(`${HAPPENING_SELECT} WHERE h.id = ?`).bind(id).first<any>();
  return c.json({ data: happening });
}

/**
 * PUT /api/t/:tenant/merchant/happenings/:id — edit own post. Stays live;
 * editing text/category/contact doesn't change its calendar-day expiry.
 */
export async function updateHappening(c: AppContext) {
  const merchantId = requireVerifiedMerchant(c);
  const tenant = c.get('tenant');
  const id = c.req.param('id') ?? '';
  const body = await c.req.json<any>().catch(() => ({}));

  const existing = await c.env.DB.prepare(
    'SELECT * FROM passport_happenings WHERE id = ? AND tenant_id = ? AND merchant_id = ?'
  ).bind(id, tenant.id, merchantId).first<any>();
  if (!existing) throw new HTTPException(404, { message: 'Happening not found.' });

  const input = parseHappeningInput(body, existing);
  const isActive = body.is_active === false ? 0 : existing.is_active;

  await c.env.DB.prepare(`
    UPDATE passport_happenings
    SET category = ?, body = ?, photo_url = ?, starts_at = ?,
        show_name = ?, show_address = ?, show_phone = ?, is_active = ?
    WHERE id = ? AND tenant_id = ? AND merchant_id = ?
  `).bind(
    input.category, input.text, input.photoUrl, input.startsAt,
    input.showName, input.showAddress, input.showPhone, isActive,
    id, tenant.id, merchantId
  ).run();

  if (body.deal_id !== undefined) {
    await reconcileAttachedDeal(c, tenant.id, merchantId, id, body.deal_id);
  }

  const happening = await c.env.DB.prepare(`${HAPPENING_SELECT} WHERE h.id = ?`).bind(id).first<any>();
  return c.json({ data: happening });
}

/**
 * DELETE /api/t/:tenant/merchant/happenings/:id — hard delete. Happenings carry
 * no claim history of their own, so removal is clean; detach any linked deal.
 */
export async function deleteHappening(c: AppContext) {
  const merchantId = requireVerifiedMerchant(c);
  const tenant = c.get('tenant');
  const id = c.req.param('id') ?? '';

  await c.env.DB.prepare(
    'UPDATE passport_deals SET event_id = NULL WHERE event_id = ? AND tenant_id = ? AND merchant_id = ?'
  ).bind(id, tenant.id, merchantId).run();

  const res = await c.env.DB.prepare(
    'DELETE FROM passport_happenings WHERE id = ? AND tenant_id = ? AND merchant_id = ?'
  ).bind(id, tenant.id, merchantId).run();
  if (res.meta.changes !== 1) throw new HTTPException(404, { message: 'Happening not found.' });

  return c.json({ data: { removed: true } });
}

// ─────────────────────────────────────────────────────────────────────────────
// Admin — full review / modify / unpublish
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/t/:tenant/admin/happenings — every post (incl. unpublished/expired),
 * newest first, so an admin can review and act on anything.
 */
export async function adminListHappenings(c: AppContext) {
  requireAdmin(c);
  const tenant = c.get('tenant');

  const { results } = await c.env.DB.prepare(`
    ${HAPPENING_SELECT}
    WHERE h.tenant_id = ?
    ORDER BY h.created_at DESC
    LIMIT 300
  `).bind(tenant.id).all<any>();

  return c.json({ data: results || [] });
}

/**
 * PUT /api/t/:tenant/admin/happenings/:id — admin can modify any field and
 * publish/unpublish (is_active).
 */
export async function adminUpdateHappening(c: AppContext) {
  requireAdmin(c);
  const tenant = c.get('tenant');
  const id = c.req.param('id') ?? '';
  const body = await c.req.json<any>().catch(() => ({}));

  const existing = await c.env.DB.prepare(
    'SELECT * FROM passport_happenings WHERE id = ? AND tenant_id = ?'
  ).bind(id, tenant.id).first<any>();
  if (!existing) throw new HTTPException(404, { message: 'Happening not found.' });

  const input = parseHappeningInput(body, existing);
  const isActive = body.is_active === undefined ? existing.is_active : (body.is_active ? 1 : 0);

  await c.env.DB.prepare(`
    UPDATE passport_happenings
    SET category = ?, body = ?, photo_url = ?, starts_at = ?,
        show_name = ?, show_address = ?, show_phone = ?, is_active = ?
    WHERE id = ? AND tenant_id = ?
  `).bind(
    input.category, input.text, input.photoUrl, input.startsAt,
    input.showName, input.showAddress, input.showPhone, isActive,
    id, tenant.id
  ).run();

  const happening = await c.env.DB.prepare(`${HAPPENING_SELECT} WHERE h.id = ?`).bind(id).first<any>();
  return c.json({ data: happening });
}

/**
 * DELETE /api/t/:tenant/admin/happenings/:id — hard delete; detach linked deal.
 */
export async function adminDeleteHappening(c: AppContext) {
  requireAdmin(c);
  const tenant = c.get('tenant');
  const id = c.req.param('id') ?? '';

  await c.env.DB.prepare(
    'UPDATE passport_deals SET event_id = NULL WHERE event_id = ? AND tenant_id = ?'
  ).bind(id, tenant.id).run();

  const res = await c.env.DB.prepare(
    'DELETE FROM passport_happenings WHERE id = ? AND tenant_id = ?'
  ).bind(id, tenant.id).run();
  if (res.meta.changes !== 1) throw new HTTPException(404, { message: 'Happening not found.' });

  return c.json({ data: { removed: true } });
}
