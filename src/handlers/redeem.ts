import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { transferCredits, escrowUid } from '../lib/credits';
import { logger } from '../lib/logger';
import type { Env } from '../types';

type AppContext = Context<{ Bindings: Env }>;

/** Resolve a business to its owner's KKAuth uid (for escrow settlement). */
async function businessOwnerUid(env: Env, businessId: string): Promise<number> {
  const res = await env.KKAUTH.fetch(
    new Request(`https://kkauth/internal/business-owner/${businessId}`, {
      headers: { 'X-Internal-Secret': env.INTERNAL_SECRET },
    })
  );
  if (!res.ok) throw new Error(`business-owner lookup failed: ${res.status}`);
  const json = await res.json<{ data: { owner_id: number } }>();
  return json.data.owner_id;
}

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

// A code can belong to a prize win (passport_claims), a purchased deal
// (passport_deal_claims), or a Social Splash gift certificate
// (splash_certificates) — all three are checked so the merchant /redeem
// screen works the same for any kind.
async function findClaim(c: AppContext, claimCode: unknown): Promise<{ kind: 'prize' | 'deal' | 'splash'; claim: any }> {
  if (typeof claimCode !== 'string' || !claimCode.trim()) {
    throw new HTTPException(400, { message: 'claim_code is required.' });
  }
  const tenant = c.get('tenant');
  const tokenHash = await sha256(claimCode.trim().toUpperCase());

  const prizeClaim = await c.env.DB.prepare(`
    SELECT cl.token_hash, cl.contact_info, cl.status, cl.expires_at, cl.created_at,
           pr.id AS prize_id, pr.name AS prize_name, pr.prize_type, pr.value, pr.details, pr.merchant_id,
           pl.name AS plaque_name, pl.location_name
    FROM passport_claims cl
    JOIN passport_prizes pr ON pr.id = cl.prize_id
    JOIN passport_plaques pl ON pl.id = cl.plaque_id
    WHERE cl.token_hash = ? AND cl.tenant_id = ?
  `).bind(tokenHash, tenant.id).first<any>();
  if (prizeClaim) return { kind: 'prize', claim: prizeClaim };

  const dealClaim = await c.env.DB.prepare(`
    SELECT cl.id AS claim_id, cl.user_id AS buyer_uid,
           cl.token_hash, cl.status, cl.expires_at, cl.created_at, cl.kredits_paid,
           d.title AS prize_name, d.details, d.merchant_id, d.merchant_name,
           u.display_name AS buyer_name, u.email AS buyer_email
    FROM passport_deal_claims cl
    JOIN passport_deals d ON d.id = cl.deal_id
    LEFT JOIN users u ON u.kkauth_uid = cl.user_id AND u.tenant_id = cl.tenant_id
    WHERE cl.token_hash = ? AND cl.tenant_id = ?
  `).bind(tokenHash, tenant.id).first<any>();
  if (dealClaim) return { kind: 'deal', claim: dealClaim };

  const splashClaim = await c.env.DB.prepare(`
    SELECT id AS cert_id, business_id AS merchant_id, business_name, kkauth_uid AS holder_uid,
           value_cents, description, status, token_hash, created_at
    FROM splash_certificates
    WHERE token_hash = ? AND tenant_id = ?
  `).bind(tokenHash, tenant.id).first<any>();
  if (splashClaim) return { kind: 'splash', claim: splashClaim };

  throw new HTTPException(404, { message: 'No claim found for that code. Double-check it was typed exactly as shown (e.g. LL-AB12CD34).' });
}

function claimPayload(kind: 'prize' | 'deal' | 'splash', claim: any) {
  if (kind === 'splash') {
    // Certificates never expire and use their own active/redeemed vocabulary -
    // mapped onto the same pending/claimed the redeem screen already renders,
    // rather than teaching that screen a third status set.
    return {
      kind,
      status: claim.status === 'redeemed' ? 'claimed' : 'pending',
      redeemable: claim.status === 'active',
      prize: {
        name: claim.description,
        prize_type: 'splash_certificate',
        value: Math.round(claim.value_cents / 100),
        details: `${claim.business_name} - Social Splash certificate`,
      },
      plaque_name: claim.business_name,
      location_name: 'Social Splash certificate',
      contact_info: null,
      created_at: claim.created_at,
      expires_at: null,
    };
  }
  const now = Math.floor(Date.now() / 1000);
  const expired = claim.status === 'expired' || claim.status === 'refunded'
    || (claim.status === 'pending' && claim.expires_at <= now);
  return {
    kind,
    status: expired && claim.status === 'pending' ? 'expired' : (claim.status === 'refunded' ? 'expired' : claim.status),
    redeemable: claim.status === 'pending' && !expired,
    prize: {
      name: claim.prize_name,
      prize_type: kind === 'deal' ? 'kredit_deal' : claim.prize_type,
      value: kind === 'deal' ? claim.kredits_paid : claim.value,
      details: claim.details,
    },
    plaque_name: kind === 'deal' ? (claim.merchant_name ?? 'Kredit Deal') : claim.plaque_name,
    location_name: kind === 'deal' ? 'Purchased with KrowdKredits' : claim.location_name,
    contact_info: kind === 'deal' ? (claim.buyer_name ?? claim.buyer_email ?? null) : claim.contact_info,
    created_at: claim.created_at,
    expires_at: claim.expires_at,
  };
}

function requireOwnClaim(redeemer: { isAdmin: boolean; merchantId: string | null }, claim: any, kind: 'prize' | 'deal' | 'splash') {
  if (!redeemer.isAdmin && claim.merchant_id !== redeemer.merchantId) {
    throw new HTTPException(403, {
      message: kind === 'deal'
        ? 'This deal belongs to another merchant, so it can’t be redeemed here.'
        : kind === 'splash'
        ? 'This certificate belongs to another business, so it can’t be redeemed here.'
        : 'This claim is for another merchant’s prize, so it can’t be redeemed here.',
    });
  }
}

/**
 * POST /api/t/:tenant/redeem/lookup
 * Look up a claim by its code and show prize + status before confirming.
 */
export async function lookupClaim(c: AppContext) {
  const redeemer = requireRedeemer(c);
  const body = await c.req.json<any>().catch(() => ({}));
  const { kind, claim } = await findClaim(c, body.claim_code);

  requireOwnClaim(redeemer, claim, kind);

  return c.json({ data: claimPayload(kind, claim) });
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
  const { kind, claim } = await findClaim(c, body.claim_code);

  requireOwnClaim(redeemer, claim, kind);

  const result = kind === 'deal'
    ? await c.env.DB.prepare(`
        UPDATE passport_deal_claims
        SET status = 'claimed', claimed_at = unixepoch()
        WHERE token_hash = ? AND tenant_id = ? AND status = 'pending' AND expires_at > unixepoch()
      `).bind(claim.token_hash, tenant.id).run()
    : kind === 'splash'
    ? await c.env.DB.prepare(`
        UPDATE splash_certificates
        SET status = 'redeemed', redeemed_at = unixepoch()
        WHERE token_hash = ? AND tenant_id = ? AND status = 'active'
      `).bind(claim.token_hash, tenant.id).run()
    : await c.env.DB.prepare(`
        UPDATE passport_claims
        SET status = 'claimed'
        WHERE token_hash = ? AND tenant_id = ? AND status = 'pending' AND expires_at > unixepoch()
      `).bind(claim.token_hash, tenant.id).run();

  if (result.meta.changes !== 1) {
    const payload = claimPayload(kind, claim);
    throw new HTTPException(409, {
      message: payload.status === 'claimed'
        ? 'This claim was already redeemed.'
        : 'This claim has expired and can no longer be redeemed.',
    });
  }

  // Deal redemption is now official: settle the held credits from escrow to
  // the DEAL's merchant (not the scanning user — admins can redeem on a
  // merchant's behalf). The transfer is idempotent on (deal_settle, claim id),
  // and a failure leaves the funds safe in escrow with a loud log; the money
  // is never lost, settlement can be retried with the same ref.
  if (kind === 'deal') {
    try {
      const ownerUid = await businessOwnerUid(c.env, String(claim.merchant_id));
      await transferCredits(
        c.env, escrowUid(c.env), ownerUid, claim.kredits_paid,
        `Deal payment: ${claim.prize_name}`, 'deal_settle', String(claim.claim_id)
      );
    } catch (err) {
      logger.error(JSON.stringify({
        event: 'deal_settle_failed',
        claim_id: claim.claim_id,
        merchant_id: claim.merchant_id,
        kredits: claim.kredits_paid,
        error: (err as Error).message,
      }));
    }
  }

  return c.json({ data: { ...claimPayload(kind, claim), status: 'claimed', redeemable: false } });
}
