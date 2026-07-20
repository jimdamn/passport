import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { Env } from '../types';
import { nanoid } from 'nanoid';
import { ensureMerchantPlaque } from '../routers/auth';

type AppContext = Context<{ Bindings: Env }>;

const MERCHANT_PRIZE_TYPES = ['merchant_coupon', 'merchant_gift'];

function requireVerifiedMerchant(c: AppContext): string {
  const user = c.get('user');
  if (!user?.business_id || user.business_status !== 'verified') {
    throw new HTTPException(403, { message: 'A verified merchant profile is required.' });
  }
  return String(user.business_id);
}

function cleanText(value: unknown, maxLen: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLen);
}

/**
 * GET /api/t/:tenant/merchant/prizes
 * The merchant's own prize pool, with win counts.
 */
export async function listMyPrizes(c: AppContext) {
  const merchantId = requireVerifiedMerchant(c);
  const tenant = c.get('tenant');

  const { results } = await c.env.DB.prepare(`
    SELECT pr.*,
           (SELECT COUNT(*) FROM passport_claims cl WHERE cl.prize_id = pr.id) AS times_won,
           (SELECT COUNT(*) FROM passport_claims cl WHERE cl.prize_id = pr.id AND cl.status = 'claimed') AS times_redeemed
    FROM passport_prizes pr
    WHERE pr.tenant_id = ? AND pr.merchant_id = ?
    ORDER BY pr.is_active DESC, pr.rowid DESC
  `).bind(tenant.id, merchantId).all<any>();

  return c.json({ data: results || [] });
}

/**
 * POST /api/t/:tenant/merchant/prizes
 * Create a merchant prize (coupon or gift). New merchant prizes start inactive
 * and enter the draw once the network admin activates them.
 */
export async function createMyPrize(c: AppContext) {
  const merchantId = requireVerifiedMerchant(c);
  const tenant = c.get('tenant');
  const user = c.get('user');
  const body = await c.req.json<any>().catch(() => ({}));

  const name = cleanText(body.name, 120);
  const prizeType = MERCHANT_PRIZE_TYPES.includes(body.prize_type) ? body.prize_type : null;
  if (!name || !prizeType) {
    throw new HTTPException(400, { message: 'A prize name and type (coupon/discount or gift/certificate) are required.' });
  }

  const value = Number.isFinite(body.value) ? Math.max(0, Math.floor(body.value)) : 0;
  const baseDetails = cleanText(body.details, 400);
  // Winners need to know where to redeem — bake the business name in.
  const details = baseDetails
    ? `${baseDetails} (Redeem at ${user.business_name ?? 'the merchant'})`
    : `Redeem at ${user.business_name ?? 'the merchant'}`;

  const probability = Number(body.probability);
  if (!isFinite(probability) || probability <= 0 || probability > 1) {
    throw new HTTPException(400, { message: 'Win chance must be between 0 and 1 (e.g. 0.05 = 5% of scans).' });
  }

  let quantity = -1;
  if (Number.isFinite(body.quantity)) {
    quantity = Math.floor(body.quantity);
    if (quantity < -1 || quantity === 0) {
      throw new HTTPException(400, { message: 'Stock must be a positive number, or -1 for unlimited.' });
    }
  }

  const id = nanoid(10);
  await c.env.DB.prepare(`
    INSERT INTO passport_prizes (id, tenant_id, name, prize_type, value, details, probability, quantity_left, is_active, plaque_id, merchant_id, is_paced)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, 0)
  `).bind(id, tenant.id, name, prizeType, value, details, probability, quantity, merchantId).run();

  const prize = await c.env.DB.prepare('SELECT * FROM passport_prizes WHERE id = ?').bind(id).first<any>();
  return c.json({ data: { ...prize, times_won: 0, times_redeemed: 0 } });
}

/**
 * PUT /api/t/:tenant/merchant/prizes/:id
 * Edit own prize. Changing win chance or stock sends the prize back to admin
 * review (deactivates it); name/details/value edits keep its current status.
 */
export async function updateMyPrize(c: AppContext) {
  const merchantId = requireVerifiedMerchant(c);
  const tenant = c.get('tenant');
  const id = c.req.param('id') ?? '';
  const body = await c.req.json<any>().catch(() => ({}));

  const existing = await c.env.DB.prepare(
    'SELECT * FROM passport_prizes WHERE id = ? AND tenant_id = ? AND merchant_id = ?'
  ).bind(id, tenant.id, merchantId).first<any>();
  if (!existing) throw new HTTPException(404, { message: 'Prize not found.' });

  const name = cleanText(body.name, 120) ?? existing.name;
  const details = body.details === undefined ? existing.details : cleanText(body.details, 400);
  const value = Number.isFinite(body.value) ? Math.max(0, Math.floor(body.value)) : existing.value;

  let probability = existing.probability;
  let quantity = existing.quantity_left;
  let isActive = existing.is_active;

  if (body.probability !== undefined) {
    probability = Number(body.probability);
    if (!isFinite(probability) || probability <= 0 || probability > 1) {
      throw new HTTPException(400, { message: 'Win chance must be between 0 and 1.' });
    }
  }
  if (Number.isFinite(body.quantity)) {
    quantity = Math.floor(body.quantity);
    if (quantity < -1 || quantity === 0) {
      throw new HTTPException(400, { message: 'Stock must be a positive number, or -1 for unlimited.' });
    }
  }
  if (probability !== existing.probability || quantity !== existing.quantity_left) {
    isActive = 0;
  }

  // Merchants may pause their own live prize, but cannot self-activate —
  // activation is the admin review step.
  if (body.is_active === false) isActive = 0;

  await c.env.DB.prepare(`
    UPDATE passport_prizes
    SET name = ?, details = ?, value = ?, probability = ?, quantity_left = ?, is_active = ?
    WHERE id = ? AND tenant_id = ? AND merchant_id = ?
  `).bind(name, details, value, probability, quantity, isActive, id, tenant.id, merchantId).run();

  const prize = await c.env.DB.prepare(`
    SELECT pr.*,
           (SELECT COUNT(*) FROM passport_claims cl WHERE cl.prize_id = pr.id) AS times_won,
           (SELECT COUNT(*) FROM passport_claims cl WHERE cl.prize_id = pr.id AND cl.status = 'claimed') AS times_redeemed
    FROM passport_prizes pr WHERE pr.id = ?
  `).bind(id).first<any>();
  return c.json({ data: prize });
}

/**
 * DELETE /api/t/:tenant/merchant/prizes/:id
 * Hard-deletes an unwon prize; deactivates one that has win history.
 */
export async function deleteMyPrize(c: AppContext) {
  const merchantId = requireVerifiedMerchant(c);
  const tenant = c.get('tenant');
  const id = c.req.param('id') ?? '';

  const existing = await c.env.DB.prepare(
    'SELECT id FROM passport_prizes WHERE id = ? AND tenant_id = ? AND merchant_id = ?'
  ).bind(id, tenant.id, merchantId).first<any>();
  if (!existing) throw new HTTPException(404, { message: 'Prize not found.' });

  const history = await c.env.DB.prepare(
    'SELECT COUNT(*) AS n FROM passport_claims WHERE prize_id = ?'
  ).bind(id).first<{ n: number }>();

  if ((history?.n ?? 0) > 0) {
    await c.env.DB.prepare(
      'UPDATE passport_prizes SET is_active = 0 WHERE id = ? AND tenant_id = ? AND merchant_id = ?'
    ).bind(id, tenant.id, merchantId).run();
    return c.json({ data: { removed: false, deactivated: true } });
  }

  await c.env.DB.prepare(
    'DELETE FROM passport_prizes WHERE id = ? AND tenant_id = ? AND merchant_id = ?'
  ).bind(id, tenant.id, merchantId).run();
  return c.json({ data: { removed: true, deactivated: false } });
}

/**
 * GET /api/t/:tenant/merchant/claims
 * Recent wins of this merchant's prizes, newest first.
 */
export async function listMyClaims(c: AppContext) {
  const merchantId = requireVerifiedMerchant(c);
  const tenant = c.get('tenant');

  const { results } = await c.env.DB.prepare(`
    SELECT cl.status, cl.contact_info, cl.created_at, cl.expires_at,
           pr.name AS prize_name, pr.prize_type,
           pl.name AS plaque_name
    FROM passport_claims cl
    JOIN passport_prizes pr ON pr.id = cl.prize_id
    JOIN passport_plaques pl ON pl.id = cl.plaque_id
    WHERE cl.tenant_id = ? AND pr.merchant_id = ?
    ORDER BY cl.created_at DESC
    LIMIT 100
  `).bind(tenant.id, merchantId).all<any>();

  return c.json({ data: results || [] });
}

/**
 * GET /api/t/:tenant/merchant/business
 * Returns the full business record from KKAuth for display on the merchant dashboard.
 */
export async function getMyBusiness(c: AppContext) {
  requireVerifiedMerchant(c);
  const auth = c.req.header('Authorization')!;

  const res = await c.env.KKAUTH.fetch(
    new Request('https://kkauth/businesses/me', {
      headers: { 'Authorization': auth },
    })
  );

  const body = await res.json<any>();
  if (!res.ok) return c.json(body, res.status as any);
  return c.json(body);
}

/**
 * PATCH /api/t/:tenant/merchant/business
 * Allows a verified merchant to update their category, phone, and location
 * (address/zip/lat/lon/hide_address). Keeps the passport_plaques row in sync:
 * category changes propagate directly, and any location update runs the same
 * idempotent ensureMerchantPlaque() used at approval time - so a merchant who
 * was verified without a location gets a working QR code the moment they add
 * one here, without needing an admin to re-approve them.
 */
export async function updateMyBusiness(c: AppContext) {
  const merchantId = requireVerifiedMerchant(c);
  const auth = c.req.header('Authorization')!;
  const body = await c.req.json<{
    category?: string; phone?: string;
    address?: string; zip?: string; lat?: number; lon?: number; hide_address?: boolean;
  }>();

  const res = await c.env.KKAUTH.fetch(
    new Request('https://kkauth/businesses/me', {
      method: 'PATCH',
      headers: { 'Authorization': auth, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  );

  const kkBody = await res.json<any>();
  if (!res.ok) return c.json(kkBody, res.status as any);

  // Keep plaque category in sync if it changed
  if (body.category && kkBody.data) {
    await c.env.DB.prepare(
      'UPDATE passport_plaques SET category = ? WHERE merchant_id = ?'
    ).bind(body.category, merchantId).run();
  }

  // Location changed (or was set for the first time) - (re)create the plaque now
  if ((body.lat !== undefined || body.zip !== undefined) && kkBody.data) {
    await ensureMerchantPlaque(c.env, kkBody.data);
  }

  return c.json(kkBody);
}
