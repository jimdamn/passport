import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { Env } from '../types';

type AppContext = Context<{ Bindings: Env }>;

async function sha256(message: string): Promise<string> {
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// Admins can redeem any claim; verified merchants only claims for their own
// prizes (prize.merchant_id). Anyone else is rejected.
function requireRedeemer(c: AppContext): { isAdmin: boolean; merchantId: string | null } {
  const user = c.get('user');
  if (user?.is_admin) return { isAdmin: true, merchantId: null };
  if (user?.business_id && user.business_status === 'verified') {
    return { isAdmin: false, merchantId: String(user.business_id) };
  }
  throw new HTTPException(403, { message: 'Only admins and verified merchants can redeem claims.' });
}

async function findClaim(c: AppContext, claimCode: unknown) {
  if (typeof claimCode !== 'string' || !claimCode.trim()) {
    throw new HTTPException(400, { message: 'claim_code is required.' });
  }
  const tenant = c.get('tenant');
  const tokenHash = await sha256(claimCode.trim().toUpperCase());

  const claim = await c.env.DB.prepare(`
    SELECT cl.token_hash, cl.contact_info, cl.status, cl.expires_at, cl.created_at,
           pr.id AS prize_id, pr.name AS prize_name, pr.prize_type, pr.value, pr.details, pr.merchant_id,
           pl.name AS plaque_name, pl.location_name
    FROM passport_claims cl
    JOIN passport_prizes pr ON pr.id = cl.prize_id
    JOIN passport_plaques pl ON pl.id = cl.plaque_id
    WHERE cl.token_hash = ? AND cl.tenant_id = ?
  `).bind(tokenHash, tenant.id).first<any>();

  if (!claim) {
    throw new HTTPException(404, { message: 'No claim found for that code. Double-check it was typed exactly as shown (e.g. LL-AB12CD34).' });
  }
  return claim;
}

function claimPayload(claim: any) {
  const now = Math.floor(Date.now() / 1000);
  const expired = claim.status === 'expired' || (claim.status === 'pending' && claim.expires_at <= now);
  return {
    status: expired && claim.status === 'pending' ? 'expired' : claim.status,
    redeemable: claim.status === 'pending' && !expired,
    prize: {
      name: claim.prize_name,
      prize_type: claim.prize_type,
      value: claim.value,
      details: claim.details,
    },
    plaque_name: claim.plaque_name,
    location_name: claim.location_name,
    contact_info: claim.contact_info,
    created_at: claim.created_at,
    expires_at: claim.expires_at,
  };
}

/**
 * POST /api/t/:tenant/redeem/lookup
 * Look up a claim by its code and show prize + status before confirming.
 */
export async function lookupClaim(c: AppContext) {
  const redeemer = requireRedeemer(c);
  const body = await c.req.json<any>().catch(() => ({}));
  const claim = await findClaim(c, body.claim_code);

  if (!redeemer.isAdmin && claim.merchant_id !== redeemer.merchantId) {
    throw new HTTPException(403, { message: 'This claim is for another merchant’s prize, so it can’t be redeemed here.' });
  }

  return c.json({ data: claimPayload(claim) });
}

/**
 * POST /api/t/:tenant/redeem/confirm
 * Mark a pending, unexpired claim as redeemed. Atomic — a code can only be
 * redeemed once even if two people confirm simultaneously.
 */
export async function confirmClaim(c: AppContext) {
  const redeemer = requireRedeemer(c);
  const tenant = c.get('tenant');
  const body = await c.req.json<any>().catch(() => ({}));
  const claim = await findClaim(c, body.claim_code);

  if (!redeemer.isAdmin && claim.merchant_id !== redeemer.merchantId) {
    throw new HTTPException(403, { message: 'This claim is for another merchant’s prize, so it can’t be redeemed here.' });
  }

  const result = await c.env.DB.prepare(`
    UPDATE passport_claims
    SET status = 'claimed'
    WHERE token_hash = ? AND tenant_id = ? AND status = 'pending' AND expires_at > unixepoch()
  `).bind(claim.token_hash, tenant.id).run();

  if (result.meta.changes !== 1) {
    const payload = claimPayload(claim);
    throw new HTTPException(409, {
      message: payload.status === 'claimed'
        ? 'This claim was already redeemed.'
        : 'This claim has expired and can no longer be redeemed.',
    });
  }

  return c.json({ data: { ...claimPayload(claim), status: 'claimed', redeemable: false } });
}
