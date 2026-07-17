/**
 * Kredit-Spend Deals Marketplace
 *
 * Merchants post deals purchasable with KrowdKredits; members spend their
 * balance to claim them. A "hot deal" is just a deal with a short claim
 * window — claimed-but-unredeemed deals auto-expire, refund the buyer's
 * kredits exactly (no halving), and return the slot to the pool.
 *
 * Expiry is processed lazily: every marketplace read sweeps a small batch of
 * expired pending claims in the same request (no polling, no per-minute cron).
 * A once-daily cron backstop hits /api/internal/deals/sweep so refunds never
 * sit unprocessed during quiet traffic.
 */

import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { Env } from '../types';
import { nanoid } from 'nanoid';
import { transferCredits, escrowUid } from '../lib/credits';
import { matchesInternalSecret } from '../lib/hmac';
import { logger } from '../lib/logger';

type AppContext = Context<{ Bindings: Env }>;

// Claim-window presets (minutes). The backend is the source of truth so a
// crafted request can't create a 1-minute or 10-year window.
export const CLAIM_WINDOW_PRESETS = [30, 60, 120, 240, 1440, 10080, 20160];

const MAX_PER_USER_LIMIT = 10;

async function sha256(message: string): Promise<string> {
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}

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

// ─────────────────────────────────────────────────────────────────────────────
// Expiry sweep — refund kredits, return slots to the pool
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Process a batch of expired pending claims. Refund-first ordering: the
 * KKCredits transfer is idempotent per claim id, so if the status flip fails
 * after a successful refund, the next sweep retries safely.
 * Refunds move the held credits back out of escrow — nothing is minted.
 */
export async function sweepExpiredDealClaims(env: Env): Promise<number> {
  const { results } = await env.DB.prepare(`
    SELECT id, deal_id, user_id, kredits_paid
    FROM passport_deal_claims
    WHERE status = 'pending' AND expires_at <= unixepoch()
    LIMIT 20
  `).all<{ id: string; deal_id: string; user_id: number; kredits_paid: number }>();

  let processed = 0;
  for (const claim of results ?? []) {
    try {
      await transferCredits(
        env, escrowUid(env), claim.user_id, claim.kredits_paid,
        'Deal claim expired — kredits returned', 'deal_refund', claim.id
      );
      const flip = await env.DB.prepare(`
        UPDATE passport_deal_claims
        SET status = 'refunded', refunded_at = unixepoch()
        WHERE id = ? AND status = 'pending'
      `).bind(claim.id).run();
      if (flip.meta.changes === 1) {
        // Return the slot to the pool (no-op for unlimited deals at -1).
        await env.DB.prepare(
          'UPDATE passport_deals SET quantity_left = quantity_left + 1 WHERE id = ? AND quantity_left >= 0'
        ).bind(claim.deal_id).run();
        processed++;
      }
    } catch (err) {
      logger.error(`Deal claim sweep failed for ${claim.id}: ${(err as Error).message}`);
    }
  }
  return processed;
}

/**
 * POST /api/internal/deals/sweep — cron backstop entry point.
 * Caller must present the shared internal secret.
 */
export async function internalSweep(c: AppContext) {
  if (!matchesInternalSecret(c.req.header('X-Internal-Secret'), c.env)) {
    throw new HTTPException(401, { message: 'Unauthorized' });
  }
  const processed = await sweepExpiredDealClaims(c.env);
  return c.json({ data: { processed } });
}

// ─────────────────────────────────────────────────────────────────────────────
// Member-facing marketplace
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/t/:tenant/deals — public marketplace listing.
 * Guests can browse (conversion funnel); purchasing requires login.
 */
export async function listDeals(c: AppContext) {
  const tenant = c.get('tenant');
  await sweepExpiredDealClaims(c.env);

  const { results } = await c.env.DB.prepare(`
    SELECT id, merchant_id, merchant_name, title, details, kredit_price,
           quantity_left, per_user_limit, claim_window_minutes, is_hot_deal,
           starts_at, ends_at
    FROM passport_deals
    WHERE tenant_id = ? AND is_active = 1
      AND quantity_left != 0
      AND (starts_at IS NULL OR starts_at <= unixepoch())
      AND (ends_at IS NULL OR ends_at > unixepoch())
    ORDER BY is_hot_deal DESC, created_at DESC
  `).bind(tenant.id).all<any>();

  return c.json({ data: results || [] });
}

/**
 * POST /api/t/:tenant/deals/:id/claim — purchase a deal with kredits.
 *
 * Order of operations (each step compensates the previous on failure):
 *   1. reserve a stock slot (atomic conditional decrement)
 *   2. debit kredits via KKCredits (user's own Bearer token required)
 *   3. insert the hash-only claim row
 */
export async function purchaseDeal(c: AppContext) {
  const tenant = c.get('tenant');
  const user = c.get('user');
  const dealId = c.req.param('id') ?? '';
  const bearerToken = (c.req.header('Authorization') ?? '').replace('Bearer ', '').trim();
  const userId = parseInt(user.sub, 10);

  await sweepExpiredDealClaims(c.env);

  const deal = await c.env.DB.prepare(`
    SELECT * FROM passport_deals
    WHERE id = ? AND tenant_id = ? AND is_active = 1
      AND (starts_at IS NULL OR starts_at <= unixepoch())
      AND (ends_at IS NULL OR ends_at > unixepoch())
  `).bind(dealId, tenant.id).first<any>();
  if (!deal) throw new HTTPException(404, { message: 'This deal is no longer available.' });

  const held = await c.env.DB.prepare(`
    SELECT COUNT(*) AS n FROM passport_deal_claims
    WHERE user_id = ? AND deal_id = ? AND status IN ('pending', 'claimed')
  `).bind(userId, dealId).first<{ n: number }>();
  if ((held?.n ?? 0) >= deal.per_user_limit) {
    throw new HTTPException(409, {
      message: deal.per_user_limit === 1
        ? 'You already have this deal.'
        : `Limit of ${deal.per_user_limit} per person reached for this deal.`,
    });
  }

  // 1. Reserve a slot. Conditional decrement is the concurrency guard — two
  //    buyers racing for the last slot can't both win it.
  const limitedStock = deal.quantity_left !== -1;
  if (limitedStock) {
    const reserve = await c.env.DB.prepare(
      'UPDATE passport_deals SET quantity_left = quantity_left - 1 WHERE id = ? AND quantity_left > 0'
    ).bind(dealId).run();
    if (reserve.meta.changes !== 1) {
      throw new HTTPException(409, { message: 'This deal just sold out.' });
    }
  }

  const claimId = nanoid(10);
  const releaseSlot = async () => {
    if (limitedStock) {
      await c.env.DB.prepare(
        'UPDATE passport_deals SET quantity_left = quantity_left + 1 WHERE id = ?'
      ).bind(dealId).run();
    }
  };

  // 2. Move kredits into escrow — only a paid claim ever exists in the table.
  // Credits are never burned: they sit in the deals escrow account until the
  // merchant redeems the claim (escrow -> merchant) or the claim expires
  // (escrow -> member). The member's own token authorizes this transfer.
  try {
    await transferCredits(
      c.env, parseInt(user.sub, 10), escrowUid(c.env), deal.kredit_price,
      `Deal: ${deal.title}`, 'deal_purchase', claimId, bearerToken
    );
  } catch (err) {
    await releaseSlot();
    const msg = (err as Error).message;
    if (msg.includes('Insufficient')) {
      throw new HTTPException(402, { message: 'Not enough kredits for this deal.' });
    }
    throw new HTTPException(502, { message: 'Kredit payment failed — you were not charged.' });
  }

  // 3. Create the claim. On failure, refund (idempotent) + release the slot.
  const rawCode = `LL-${nanoid(8).toUpperCase()}`;
  const tokenHash = await sha256(rawCode);
  const expiresAt = Math.floor(Date.now() / 1000) + deal.claim_window_minutes * 60;
  try {
    await c.env.DB.prepare(`
      INSERT INTO passport_deal_claims (id, token_hash, tenant_id, deal_id, user_id, kredits_paid, status, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, unixepoch())
    `).bind(claimId, tokenHash, tenant.id, dealId, userId, deal.kredit_price, expiresAt).run();
  } catch (err) {
    // Return the held credits from escrow — a move, not a mint.
    await transferCredits(
      c.env, escrowUid(c.env), userId, deal.kredit_price,
      'Deal purchase failed — kredits returned', 'deal_refund', claimId
    ).catch(e => logger.error(`Deal purchase refund failed for ${claimId}: ${(e as Error).message}`));
    await releaseSlot();
    throw new HTTPException(500, { message: 'Could not complete the purchase — your kredits were refunded.' });
  }

  return c.json({
    data: {
      claim_id: claimId,
      claim_code: rawCode,
      deal_title: deal.title,
      merchant_name: deal.merchant_name,
      kredits_paid: deal.kredit_price,
      expires_at: expiresAt,
    },
  });
}

/**
 * GET /api/t/:tenant/deals/mine — the member's purchased deals, newest first.
 */
export async function listMyDealClaims(c: AppContext) {
  const tenant = c.get('tenant');
  const user = c.get('user');
  await sweepExpiredDealClaims(c.env);

  const { results } = await c.env.DB.prepare(`
    SELECT cl.id, cl.status, cl.kredits_paid, cl.expires_at, cl.created_at, cl.claimed_at, cl.refunded_at,
           d.title AS deal_title, d.details AS deal_details, d.merchant_name, d.is_hot_deal
    FROM passport_deal_claims cl
    JOIN passport_deals d ON d.id = cl.deal_id
    WHERE cl.tenant_id = ? AND cl.user_id = ?
    ORDER BY cl.created_at DESC
    LIMIT 100
  `).bind(tenant.id, parseInt(user.sub, 10)).all<any>();

  return c.json({ data: results || [] });
}

/**
 * POST /api/t/:tenant/deals/claims/:id/code — rotate and reveal a fresh code.
 * Codes are hash-only, so they can't be re-shown — instead the owner gets a
 * new one each time (the old code stops working, which is also a safety net
 * if a code was exposed).
 */
export async function regenerateDealClaimCode(c: AppContext) {
  const tenant = c.get('tenant');
  const user = c.get('user');
  const claimId = c.req.param('id') ?? '';

  const rawCode = `LL-${nanoid(8).toUpperCase()}`;
  const tokenHash = await sha256(rawCode);

  const result = await c.env.DB.prepare(`
    UPDATE passport_deal_claims
    SET token_hash = ?
    WHERE id = ? AND tenant_id = ? AND user_id = ? AND status = 'pending' AND expires_at > unixepoch()
  `).bind(tokenHash, claimId, tenant.id, parseInt(user.sub, 10)).run();

  if (result.meta.changes !== 1) {
    throw new HTTPException(409, { message: 'This deal claim is no longer active.' });
  }

  const claim = await c.env.DB.prepare(
    'SELECT expires_at FROM passport_deal_claims WHERE id = ?'
  ).bind(claimId).first<{ expires_at: number }>();

  return c.json({ data: { claim_code: rawCode, expires_at: claim?.expires_at ?? 0 } });
}

// ─────────────────────────────────────────────────────────────────────────────
// Merchant CRUD — same trust model as merchant prizes
// ─────────────────────────────────────────────────────────────────────────────

function parseDealInput(body: any, existing?: any) {
  const title = cleanText(body.title, 120) ?? existing?.title ?? null;
  if (!title) throw new HTTPException(400, { message: 'A deal title is required.' });

  const details = body.details === undefined ? (existing?.details ?? null) : cleanText(body.details, 400);

  let kreditPrice = existing?.kredit_price ?? null;
  if (body.kredit_price !== undefined) {
    kreditPrice = Math.floor(Number(body.kredit_price));
    if (!Number.isFinite(kreditPrice) || kreditPrice < 1) {
      throw new HTTPException(400, { message: 'Kredit price must be at least 1.' });
    }
  }
  if (kreditPrice === null) throw new HTTPException(400, { message: 'A kredit price is required.' });

  let quantity = existing?.quantity_left ?? -1;
  if (body.quantity !== undefined) {
    quantity = Math.floor(Number(body.quantity));
    if (!Number.isFinite(quantity) || quantity < -1 || quantity === 0) {
      throw new HTTPException(400, { message: 'Stock must be a positive number, or -1 for unlimited.' });
    }
  }

  let perUserLimit = existing?.per_user_limit ?? 1;
  if (body.per_user_limit !== undefined) {
    perUserLimit = Math.floor(Number(body.per_user_limit));
    if (!Number.isFinite(perUserLimit) || perUserLimit < 1 || perUserLimit > MAX_PER_USER_LIMIT) {
      throw new HTTPException(400, { message: `Per-person limit must be between 1 and ${MAX_PER_USER_LIMIT}.` });
    }
  }

  let claimWindow = existing?.claim_window_minutes ?? 20160;
  if (body.claim_window_minutes !== undefined) {
    claimWindow = Math.floor(Number(body.claim_window_minutes));
    if (!CLAIM_WINDOW_PRESETS.includes(claimWindow)) {
      throw new HTTPException(400, { message: 'Claim window must be one of the preset durations.' });
    }
  }

  const isHotDeal = body.is_hot_deal === undefined
    ? (existing?.is_hot_deal ?? 0)
    : (body.is_hot_deal ? 1 : 0);

  let endsAt = existing?.ends_at ?? null;
  if (body.ends_at !== undefined) {
    endsAt = body.ends_at === null ? null : Math.floor(Number(body.ends_at));
    if (endsAt !== null && (!Number.isFinite(endsAt) || endsAt <= Math.floor(Date.now() / 1000))) {
      throw new HTTPException(400, { message: 'The deal end time must be in the future.' });
    }
  }

  return { title, details, kreditPrice, quantity, perUserLimit, claimWindow, isHotDeal, endsAt };
}

const DEAL_STATS_SELECT = `
  SELECT d.*,
         (SELECT COUNT(*) FROM passport_deal_claims cl WHERE cl.deal_id = d.id) AS times_purchased,
         (SELECT COUNT(*) FROM passport_deal_claims cl WHERE cl.deal_id = d.id AND cl.status = 'claimed') AS times_redeemed,
         (SELECT COUNT(*) FROM passport_deal_claims cl WHERE cl.deal_id = d.id AND cl.status = 'refunded') AS times_refunded
  FROM passport_deals d
`;

/**
 * GET /api/t/:tenant/merchant/deals
 */
export async function listMerchantDeals(c: AppContext) {
  const merchantId = requireVerifiedMerchant(c);
  const tenant = c.get('tenant');
  await sweepExpiredDealClaims(c.env);

  const { results } = await c.env.DB.prepare(`
    ${DEAL_STATS_SELECT}
    WHERE d.tenant_id = ? AND d.merchant_id = ?
    ORDER BY d.is_active DESC, d.created_at DESC
  `).bind(tenant.id, merchantId).all<any>();

  return c.json({ data: results || [] });
}

/**
 * POST /api/t/:tenant/merchant/deals — new deals start inactive pending
 * admin review, exactly like merchant prizes.
 */
export async function createMerchantDeal(c: AppContext) {
  const merchantId = requireVerifiedMerchant(c);
  const tenant = c.get('tenant');
  const user = c.get('user');
  const body = await c.req.json<any>().catch(() => ({}));
  const input = parseDealInput(body);

  const id = nanoid(10);
  await c.env.DB.prepare(`
    INSERT INTO passport_deals
      (id, tenant_id, merchant_id, merchant_name, title, details, kredit_price,
       quantity_left, per_user_limit, claim_window_minutes, is_hot_deal, is_active, ends_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
  `).bind(
    id, tenant.id, merchantId, user.business_name ?? null,
    input.title, input.details, input.kreditPrice,
    input.quantity, input.perUserLimit, input.claimWindow, input.isHotDeal, input.endsAt
  ).run();

  const deal = await c.env.DB.prepare(`${DEAL_STATS_SELECT} WHERE d.id = ?`).bind(id).first<any>();
  return c.json({ data: deal });
}

/**
 * PUT /api/t/:tenant/merchant/deals/:id
 * Price or stock changes send the deal back to admin review. Merchants may
 * pause a live deal but can never self-activate.
 */
export async function updateMerchantDeal(c: AppContext) {
  const merchantId = requireVerifiedMerchant(c);
  const tenant = c.get('tenant');
  const id = c.req.param('id') ?? '';
  const body = await c.req.json<any>().catch(() => ({}));

  const existing = await c.env.DB.prepare(
    'SELECT * FROM passport_deals WHERE id = ? AND tenant_id = ? AND merchant_id = ?'
  ).bind(id, tenant.id, merchantId).first<any>();
  if (!existing) throw new HTTPException(404, { message: 'Deal not found.' });

  const input = parseDealInput(body, existing);

  let isActive = existing.is_active;
  if (input.kreditPrice !== existing.kredit_price || input.quantity !== existing.quantity_left) {
    isActive = 0;
  }
  if (body.is_active === false) isActive = 0;

  await c.env.DB.prepare(`
    UPDATE passport_deals
    SET title = ?, details = ?, kredit_price = ?, quantity_left = ?, per_user_limit = ?,
        claim_window_minutes = ?, is_hot_deal = ?, ends_at = ?, is_active = ?
    WHERE id = ? AND tenant_id = ? AND merchant_id = ?
  `).bind(
    input.title, input.details, input.kreditPrice, input.quantity, input.perUserLimit,
    input.claimWindow, input.isHotDeal, input.endsAt, isActive,
    id, tenant.id, merchantId
  ).run();

  const deal = await c.env.DB.prepare(`${DEAL_STATS_SELECT} WHERE d.id = ?`).bind(id).first<any>();
  return c.json({ data: deal });
}

/**
 * DELETE /api/t/:tenant/merchant/deals/:id
 * Hard-deletes a deal nobody has purchased; deactivates one with history.
 * Pending purchased claims stay valid until they're redeemed or auto-refund.
 */
export async function deleteMerchantDeal(c: AppContext) {
  const merchantId = requireVerifiedMerchant(c);
  const tenant = c.get('tenant');
  const id = c.req.param('id') ?? '';

  const existing = await c.env.DB.prepare(
    'SELECT id FROM passport_deals WHERE id = ? AND tenant_id = ? AND merchant_id = ?'
  ).bind(id, tenant.id, merchantId).first<any>();
  if (!existing) throw new HTTPException(404, { message: 'Deal not found.' });

  const history = await c.env.DB.prepare(
    'SELECT COUNT(*) AS n FROM passport_deal_claims WHERE deal_id = ?'
  ).bind(id).first<{ n: number }>();

  if ((history?.n ?? 0) > 0) {
    await c.env.DB.prepare(
      'UPDATE passport_deals SET is_active = 0 WHERE id = ? AND tenant_id = ? AND merchant_id = ?'
    ).bind(id, tenant.id, merchantId).run();
    return c.json({ data: { removed: false, deactivated: true } });
  }

  await c.env.DB.prepare(
    'DELETE FROM passport_deals WHERE id = ? AND tenant_id = ? AND merchant_id = ?'
  ).bind(id, tenant.id, merchantId).run();
  return c.json({ data: { removed: true, deactivated: false } });
}

// ─────────────────────────────────────────────────────────────────────────────
// Admin review
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/t/:tenant/admin/deals — every deal, pending review first.
 */
export async function adminListDeals(c: AppContext) {
  requireAdmin(c);
  const tenant = c.get('tenant');
  await sweepExpiredDealClaims(c.env);

  const { results } = await c.env.DB.prepare(`
    ${DEAL_STATS_SELECT}
    WHERE d.tenant_id = ?
    ORDER BY d.is_active ASC, d.created_at DESC
  `).bind(tenant.id).all<any>();

  return c.json({ data: results || [] });
}

/**
 * PUT /api/t/:tenant/admin/deals/:id — admin can edit anything, including
 * activation (the review approval step).
 */
export async function adminUpdateDeal(c: AppContext) {
  requireAdmin(c);
  const tenant = c.get('tenant');
  const id = c.req.param('id') ?? '';
  const body = await c.req.json<any>().catch(() => ({}));

  const existing = await c.env.DB.prepare(
    'SELECT * FROM passport_deals WHERE id = ? AND tenant_id = ?'
  ).bind(id, tenant.id).first<any>();
  if (!existing) throw new HTTPException(404, { message: 'Deal not found.' });

  const input = parseDealInput(body, existing);
  const isActive = body.is_active === undefined ? existing.is_active : (body.is_active ? 1 : 0);

  await c.env.DB.prepare(`
    UPDATE passport_deals
    SET title = ?, details = ?, kredit_price = ?, quantity_left = ?, per_user_limit = ?,
        claim_window_minutes = ?, is_hot_deal = ?, ends_at = ?, is_active = ?
    WHERE id = ? AND tenant_id = ?
  `).bind(
    input.title, input.details, input.kreditPrice, input.quantity, input.perUserLimit,
    input.claimWindow, input.isHotDeal, input.endsAt, isActive,
    id, tenant.id
  ).run();

  const deal = await c.env.DB.prepare(`${DEAL_STATS_SELECT} WHERE d.id = ?`).bind(id).first<any>();
  return c.json({ data: deal });
}

/**
 * DELETE /api/t/:tenant/admin/deals/:id — same history-preserving rule.
 */
export async function adminDeleteDeal(c: AppContext) {
  requireAdmin(c);
  const tenant = c.get('tenant');
  const id = c.req.param('id') ?? '';

  const history = await c.env.DB.prepare(
    'SELECT COUNT(*) AS n FROM passport_deal_claims WHERE deal_id = ?'
  ).bind(id).first<{ n: number }>();

  if ((history?.n ?? 0) > 0) {
    const res = await c.env.DB.prepare(
      'UPDATE passport_deals SET is_active = 0 WHERE id = ? AND tenant_id = ?'
    ).bind(id, tenant.id).run();
    if (res.meta.changes !== 1) throw new HTTPException(404, { message: 'Deal not found.' });
    return c.json({ data: { removed: false, deactivated: true } });
  }

  const res = await c.env.DB.prepare(
    'DELETE FROM passport_deals WHERE id = ? AND tenant_id = ?'
  ).bind(id, tenant.id).run();
  if (res.meta.changes !== 1) throw new HTTPException(404, { message: 'Deal not found.' });
  return c.json({ data: { removed: true, deactivated: false } });
}
