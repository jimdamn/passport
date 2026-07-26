/**
 * Social Splash — Bridge C internal routes (kk-business -> Passport).
 *
 * Mounted on the root app at /api/internal/splash/* (X-Internal-Secret
 * protected, same as support.ts's internalSubmitSupport), NOT under
 * /api/t/:tenant - so every handler here takes tenant_id explicitly from the
 * body/query rather than from resolveTenant middleware, exactly like
 * internalSubmitSupport does.
 *
 * Auth model per call: X-Internal-Secret proves the caller is a registered
 * app (kk-business); the forwarded merchant Bearer is re-verified against
 * KKAuth's own /internal/verify-token (never trusted from a header the
 * caller could have forwarded from anywhere) and its profile.business_id/
 * business_status checked against the business_id being acted on. Nothing
 * here trusts kk-business's own claim of who owns which business.
 */

import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { Env, KKAuthPayload, KKAuthProfile } from '../types';
import { matchesInternalSecret, hmacHex } from '../lib/hmac';
import { transferCredits, escrowUid } from '../lib/credits';
import { notifySplash } from '../lib/splash-notify';
import { sendSplashOfferEmail } from '../lib/email';
import { logger } from '../lib/logger';

type AppContext = Context<{ Bindings: Env }>;

const ACCEPT_AWARD_K = 25;       // splash.accept_award_k default (Part B.1)
const HOLD_DAYS = 30;            // splash.hold_days default
const OFFER_DAYS = 14;           // splash.offer_days default
const DESTROY_DELAY_DAYS = 7;    // splash.destroy_delay_days default - matches splash.ts's own constant (copy, never share)
const MEDIA_VIEW_TTL_SECONDS = 5 * 60;

function cleanText(value: unknown, maxLen: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLen);
}

/**
 * The shared auth+ownership gate for every route in this file. Re-verifies
 * the forwarded Bearer via the KKAuth Service Binding (never trusts a
 * forwarded X-Verified-* header) and checks the resulting profile actually
 * owns businessId as a verified business - the same check kk-business's own
 * requireVerifiedBusiness performs client-side, re-derived here rather than
 * trusted from the caller.
 */
async function requireMerchantBridge(c: AppContext, businessId: string): Promise<{ merchantUid: number; bearerToken: string }> {
  if (!matchesInternalSecret(c.req.header('X-Internal-Secret'), c.env)) {
    throw new HTTPException(401, { message: 'Unauthorized internal call' });
  }
  const authHeader = c.req.header('Authorization');
  const token = authHeader?.replace('Bearer ', '').trim();
  if (!token) throw new HTTPException(401, { message: 'Authorization required' });

  const verifyRes = await c.env.KKAUTH.fetch(
    new Request('https://kkauth/internal/verify-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Internal-Secret': c.env.INTERNAL_SECRET },
      body: JSON.stringify({ token }),
    })
  );
  if (!verifyRes.ok) throw new HTTPException(401, { message: 'Invalid or expired token' });
  const verifyJson = await verifyRes.json<{ data: { payload: KKAuthPayload; profile: KKAuthProfile } }>();
  const profile = verifyJson.data.profile;

  if (String(profile.business_id ?? '') !== String(businessId) || profile.business_status !== 'verified') {
    throw new HTTPException(403, { message: 'You are not the verified owner of this business.' });
  }
  return { merchantUid: Number(verifyJson.data.payload.sub), bearerToken: token };
}

/** Tenant hostname for building an absolute media URL - the merchant's browser is on kk-business's own domain, so a relative path would resolve against the wrong origin. */
async function tenantHostname(c: AppContext, tenantId: string): Promise<string> {
  const row = await c.env.DB.prepare('SELECT hostname FROM tenants WHERE id = ?').bind(tenantId).first<{ hostname: string }>();
  return row?.hostname ?? 'passport.lakeandlocals.com';
}

/** GET /internal/splash/inbox?tenant_id=&business_id=&status= */
export async function getSplashInbox(c: AppContext) {
  const tenantId = c.req.query('tenant_id') ?? '';
  const businessId = c.req.query('business_id') ?? '';
  if (!tenantId || !businessId) throw new HTTPException(400, { message: 'tenant_id and business_id are required' });
  await requireMerchantBridge(c, businessId);

  const statusFilter = c.req.query('status');
  let sql = 'SELECT id, business_id, business_name, media_type, caption, status, held_at, hold_expires_at, licensed_at, declined_at, destroy_after, original_unlocked, created_at FROM splash_submissions WHERE tenant_id = ? AND business_id = ?';
  const params: unknown[] = [tenantId, businessId];
  if (statusFilter) {
    sql += ' AND status = ?';
    params.push(statusFilter);
  }
  sql += ' ORDER BY created_at DESC';

  const { results } = await c.env.DB.prepare(sql).bind(...params).all<any>();
  const submissions = results ?? [];

  const ids = submissions.map((r: any) => r.id);
  let offersBySubmission: Record<number, any> = {};
  if (ids.length) {
    const placeholders = ids.map(() => '?').join(',');
    const { results: offerRows } = await c.env.DB.prepare(`
      SELECT id, submission_id, consideration_type, credits_amount, cert_value_cents,
             cert_description, status, expires_at, agreed_at, created_at
      FROM splash_offers
      WHERE tenant_id = ? AND status = 'open' AND submission_id IN (${placeholders})
    `).bind(tenantId, ...ids).all<any>();
    for (const o of offerRows ?? []) offersBySubmission[o.submission_id] = o;
  }
  const submissionsWithOffers = submissions.map((r: any) => ({ ...r, open_offer: offersBySubmission[r.id] ?? null }));

  const settings = await c.env.DB.prepare(
    'SELECT business_id, opt_in, blurb, updated_at FROM splash_settings WHERE tenant_id = ? AND business_id = ?'
  ).bind(tenantId, businessId).first<any>();

  return c.json({
    data: {
      submissions: submissionsWithOffers,
      settings: settings ?? { business_id: businessId, opt_in: 0, blurb: null, updated_at: null },
    },
  });
}

/** PUT /internal/splash/settings — body { tenant_id, business_id, opt_in, blurb } */
export async function putSplashSettings(c: AppContext) {
  const body = await c.req.json<{ tenant_id?: string; business_id?: string; opt_in?: boolean; blurb?: string | null }>().catch(() => ({} as { tenant_id?: string; business_id?: string; opt_in?: boolean; blurb?: string | null }));
  const tenantId = body.tenant_id ?? '';
  const businessId = body.business_id ?? '';
  if (!tenantId || !businessId) throw new HTTPException(400, { message: 'tenant_id and business_id are required' });
  await requireMerchantBridge(c, businessId);

  const optIn = body.opt_in ? 1 : 0;
  const blurb = cleanText(body.blurb, 200);

  await c.env.DB.prepare(`
    INSERT INTO splash_settings (tenant_id, business_id, opt_in, blurb, updated_at)
    VALUES (?, ?, ?, ?, unixepoch())
    ON CONFLICT (tenant_id, business_id) DO UPDATE SET opt_in = excluded.opt_in, blurb = excluded.blurb, updated_at = unixepoch()
  `).bind(tenantId, businessId, optIn, blurb).run();

  return c.json({ data: { business_id: businessId, opt_in: optIn, blurb } });
}

/**
 * POST /internal/splash/:id/accept — body { tenant_id, business_id }. Guard
 * status='submitted'; a second accept on an already-held submission is a
 * no-op (returns the current held state, no second transfer - KKCredits'
 * own (ref_type, ref_id) idempotency is the hard backstop under a real race).
 */
export async function acceptSplash(c: AppContext) {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id)) throw new HTTPException(400, { message: 'Invalid submission id' });
  const body = await c.req.json<{ tenant_id?: string; business_id?: string }>().catch(() => ({} as { tenant_id?: string; business_id?: string }));
  const tenantId = body.tenant_id ?? '';
  const businessId = body.business_id ?? '';
  if (!tenantId || !businessId) throw new HTTPException(400, { message: 'tenant_id and business_id are required' });
  const { merchantUid, bearerToken } = await requireMerchantBridge(c, businessId);

  const row = await c.env.DB.prepare(
    'SELECT id, kkauth_uid, business_id, business_name, status, hold_expires_at FROM splash_submissions WHERE id = ? AND tenant_id = ?'
  ).bind(id, tenantId).first<{ id: number; kkauth_uid: number; business_id: string; business_name: string; status: string; hold_expires_at: number | null }>();
  if (!row) throw new HTTPException(404, { message: 'Submission not found' });
  if (row.business_id !== businessId) throw new HTTPException(403, { message: 'This submission does not belong to your business.' });

  if (row.status === 'held') {
    return c.json({ data: { id, status: 'held', hold_expires_at: row.hold_expires_at } });
  }
  if (row.status !== 'submitted') {
    throw new HTTPException(400, { message: 'This submission can no longer be accepted.' });
  }

  try {
    await transferCredits(
      c.env, merchantUid, row.kkauth_uid, ACCEPT_AWARD_K,
      `Accepted a Social Splash photo`, 'splash_accept', String(id), bearerToken
    );
  } catch (err) {
    const msg = (err as Error).message;
    if (msg.includes('Insufficient')) {
      throw new HTTPException(402, { message: `You need at least ${ACCEPT_AWARD_K} KrowdKredits to accept a submission.` });
    }
    throw new HTTPException(502, { message: 'Payment failed - you were not charged, and the photo was not accepted. Try again.' });
  }

  const holdExpiresAt = Math.floor(Date.now() / 1000) + HOLD_DAYS * 86400;
  await c.env.DB.prepare(
    "UPDATE splash_submissions SET status = 'held', held_at = unixepoch(), hold_expires_at = ? WHERE id = ? AND tenant_id = ? AND status = 'submitted'"
  ).bind(holdExpiresAt, id, tenantId).run();

  c.executionCtx.waitUntil(notifySplash(
    c.env, row.kkauth_uid, 'Photo accepted',
    `${row.business_name} accepted your photo - ${ACCEPT_AWARD_K} KrowdKredits are yours.`
  ));

  return c.json({ data: { id, status: 'held', hold_expires_at: holdExpiresAt } });
}

/**
 * POST /internal/splash/:id/decline — body { tenant_id, business_id }. From
 * 'submitted' or 'held' (a merchant can release a hold they no longer want).
 */
export async function declineSplash(c: AppContext) {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id)) throw new HTTPException(400, { message: 'Invalid submission id' });
  const body = await c.req.json<{ tenant_id?: string; business_id?: string }>().catch(() => ({} as { tenant_id?: string; business_id?: string }));
  const tenantId = body.tenant_id ?? '';
  const businessId = body.business_id ?? '';
  if (!tenantId || !businessId) throw new HTTPException(400, { message: 'tenant_id and business_id are required' });
  await requireMerchantBridge(c, businessId);

  const row = await c.env.DB.prepare(
    'SELECT id, kkauth_uid, business_id, business_name, status FROM splash_submissions WHERE id = ? AND tenant_id = ?'
  ).bind(id, tenantId).first<{ id: number; kkauth_uid: number; business_id: string; business_name: string; status: string }>();
  if (!row) throw new HTTPException(404, { message: 'Submission not found' });
  if (row.business_id !== businessId) throw new HTTPException(403, { message: 'This submission does not belong to your business.' });
  if (row.status !== 'submitted' && row.status !== 'held') {
    throw new HTTPException(400, { message: 'This submission can no longer be declined.' });
  }

  const destroyAfter = Math.floor(Date.now() / 1000) + DESTROY_DELAY_DAYS * 86400;
  await c.env.DB.prepare(
    "UPDATE splash_submissions SET status = 'declined', declined_at = unixepoch(), destroy_after = ? WHERE id = ? AND tenant_id = ?"
  ).bind(destroyAfter, id, tenantId).run();

  c.executionCtx.waitUntil(notifySplash(
    c.env, row.kkauth_uid, 'Photo declined',
    `${row.business_name} wasn't able to use your photo this time. Thanks for sharing it with them.`
  ));

  return c.json({ data: { id, status: 'declined', destroy_after: destroyAfter } });
}

/**
 * GET /internal/splash/:id/media/view?tenant_id=&business_id= — mints the
 * same 5-min HMAC token as the guest-facing mint in splash.ts (identical
 * token shape, so the one public raw-serving route in splash.ts serves both
 * without any changes there), but returns an ABSOLUTE url - the merchant's
 * browser is on kk-business's own domain, not Passport's.
 */
export async function getSplashInboxMediaView(c: AppContext) {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id)) throw new HTTPException(400, { message: 'Invalid submission id' });
  const tenantId = c.req.query('tenant_id') ?? '';
  const businessId = c.req.query('business_id') ?? '';
  if (!tenantId || !businessId) throw new HTTPException(400, { message: 'tenant_id and business_id are required' });
  await requireMerchantBridge(c, businessId);

  const row = await c.env.DB.prepare(
    'SELECT business_id, image_key FROM splash_submissions WHERE id = ? AND tenant_id = ?'
  ).bind(id, tenantId).first<{ business_id: string; image_key: string | null }>();
  if (!row) throw new HTTPException(404, { message: 'Submission not found' });
  if (row.business_id !== businessId) throw new HTTPException(403, { message: 'This submission does not belong to your business.' });
  if (!row.image_key) throw new HTTPException(404, { message: 'No photo on this submission yet.' });

  const expiresAt = Math.floor(Date.now() / 1000) + MEDIA_VIEW_TTL_SECONDS;
  const sig = await hmacHex(c.env.SPLASH_MEDIA_SECRET, `${id}|${expiresAt}`);
  const hostname = await tenantHostname(c, tenantId);
  const url = `https://${hostname}/api/t/${tenantId}/splash/media/${id}/raw?exp=${expiresAt}&sig=${sig}`;
  return c.json({ data: { url } });
}

/**
 * POST /internal/splash/:id/offer — body { tenant_id, business_id,
 * consideration_type, credits_amount?, cert_value_cents?, cert_description? }.
 * Guard status='held', no existing open offer. Credits type escrows in
 * (merchant -> escrow) BEFORE the offer row exists, so an insert failure can
 * refund cleanly (mirrors deals.ts's purchaseDeal escrow-then-insert shape).
 */
export async function createSplashOffer(c: AppContext) {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id)) throw new HTTPException(400, { message: 'Invalid submission id' });
  const body = await c.req.json<{
    tenant_id?: string; business_id?: string; consideration_type?: string;
    credits_amount?: number; cert_value_cents?: number; cert_description?: string;
  }>().catch(() => ({} as {
    tenant_id?: string; business_id?: string; consideration_type?: string;
    credits_amount?: number; cert_value_cents?: number; cert_description?: string;
  }));
  const tenantId = body.tenant_id ?? '';
  const businessId = body.business_id ?? '';
  if (!tenantId || !businessId) throw new HTTPException(400, { message: 'tenant_id and business_id are required' });
  const { merchantUid, bearerToken } = await requireMerchantBridge(c, businessId);

  const considerationType = body.consideration_type;
  if (considerationType !== 'credits' && considerationType !== 'gift_certificate') {
    throw new HTTPException(400, { message: "consideration_type must be 'credits' or 'gift_certificate'" });
  }

  const row = await c.env.DB.prepare(
    'SELECT id, kkauth_uid, business_id, business_name, status FROM splash_submissions WHERE id = ? AND tenant_id = ?'
  ).bind(id, tenantId).first<{ id: number; kkauth_uid: number; business_id: string; business_name: string; status: string }>();
  if (!row) throw new HTTPException(404, { message: 'Submission not found' });
  if (row.business_id !== businessId) throw new HTTPException(403, { message: 'This submission does not belong to your business.' });
  if (row.status !== 'held') throw new HTTPException(400, { message: 'Only a held submission can receive an offer.' });

  const existingOpen = await c.env.DB.prepare(
    "SELECT id FROM splash_offers WHERE submission_id = ? AND status = 'open'"
  ).bind(id).first<{ id: number }>();
  if (existingOpen) throw new HTTPException(400, { message: 'There is already an open offer on this submission.' });

  let creditsAmount: number | null = null;
  let certValueCents: number | null = null;
  let certDescription: string | null = null;

  if (considerationType === 'credits') {
    creditsAmount = Math.floor(Number(body.credits_amount));
    if (!Number.isFinite(creditsAmount) || creditsAmount <= 0) {
      throw new HTTPException(400, { message: 'credits_amount must be a positive number' });
    }
  } else {
    certValueCents = Math.floor(Number(body.cert_value_cents));
    if (!Number.isFinite(certValueCents) || certValueCents <= 0) {
      throw new HTTPException(400, { message: 'cert_value_cents must be a positive number' });
    }
    certDescription = cleanText(body.cert_description, 200);
    if (!certDescription) throw new HTTPException(400, { message: 'A description is required for a gift certificate.' });
  }

  if (considerationType === 'credits') {
    try {
      await transferCredits(
        c.env, merchantUid, escrowUid(c.env), creditsAmount!,
        'Social Splash offer escrow', 'splash_offer_escrow', String(id), bearerToken
      );
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.includes('Insufficient')) {
        throw new HTTPException(402, { message: `You need at least ${creditsAmount} KrowdKredits to make this offer.` });
      }
      throw new HTTPException(502, { message: 'Offer could not be created - you were not charged. Try again.' });
    }
  }

  const expiresAt = Math.floor(Date.now() / 1000) + OFFER_DAYS * 86400;
  let offerId: number;
  try {
    const inserted = await c.env.DB.prepare(`
      INSERT INTO splash_offers
        (tenant_id, submission_id, business_id, merchant_uid, consideration_type, credits_amount, cert_value_cents, cert_description, status, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?)
      RETURNING id
    `).bind(tenantId, id, businessId, merchantUid, considerationType, creditsAmount, certValueCents, certDescription, expiresAt).first<{ id: number }>();
    offerId = inserted!.id;
  } catch (err) {
    if (considerationType === 'credits') {
      await transferCredits(
        c.env, escrowUid(c.env), merchantUid, creditsAmount!,
        'Social Splash offer failed - refunded', 'splash_offer_refund', String(id)
      ).catch(e => logger.error(`Splash offer refund failed for submission ${id}: ${(e as Error).message}`));
    }
    if (String((err as Error).message).includes('UNIQUE')) {
      throw new HTTPException(400, { message: 'There is already an open offer on this submission.' });
    }
    throw err;
  }

  const guest = await c.env.DB.prepare(
    'SELECT email FROM users WHERE kkauth_uid = ? AND tenant_id = ?'
  ).bind(row.kkauth_uid, tenantId).first<{ email: string | null }>();
  if (guest?.email) {
    const hostname = await tenantHostname(c, tenantId);
    c.executionCtx.waitUntil(sendSplashOfferEmail(c.env, guest.email, row.business_name, `https://${hostname}/splash`));
  }
  c.executionCtx.waitUntil(notifySplash(c.env, row.kkauth_uid, 'New offer', `${row.business_name} would like to license your photo.`));

  return c.json({
    data: {
      id: offerId, status: 'open', consideration_type: considerationType,
      credits_amount: creditsAmount, cert_value_cents: certValueCents, cert_description: certDescription,
      expires_at: expiresAt,
    },
  }, 201);
}

/** POST /internal/splash/offers/:offerId/withdraw — body { tenant_id, business_id }. Guard status='open'; refunds escrow (credits type only). */
export async function withdrawSplashOffer(c: AppContext) {
  const offerId = Number(c.req.param('offerId'));
  if (!Number.isInteger(offerId)) throw new HTTPException(400, { message: 'Invalid offer id' });
  const body = await c.req.json<{ tenant_id?: string; business_id?: string }>().catch(() => ({} as { tenant_id?: string; business_id?: string }));
  const tenantId = body.tenant_id ?? '';
  const businessId = body.business_id ?? '';
  if (!tenantId || !businessId) throw new HTTPException(400, { message: 'tenant_id and business_id are required' });
  await requireMerchantBridge(c, businessId);

  const offer = await c.env.DB.prepare(
    'SELECT id, business_id, merchant_uid, consideration_type, credits_amount, status FROM splash_offers WHERE id = ? AND tenant_id = ?'
  ).bind(offerId, tenantId).first<{ id: number; business_id: string; merchant_uid: number; consideration_type: string; credits_amount: number | null; status: string }>();
  if (!offer) throw new HTTPException(404, { message: 'Offer not found' });
  if (offer.business_id !== businessId) throw new HTTPException(403, { message: 'This offer does not belong to your business.' });

  const updateRes = await c.env.DB.prepare(
    "UPDATE splash_offers SET status = 'withdrawn' WHERE id = ? AND tenant_id = ? AND status = 'open'"
  ).bind(offerId, tenantId).run();
  if (updateRes.meta.changes !== 1) throw new HTTPException(400, { message: 'This offer is no longer open.' });

  if (offer.consideration_type === 'credits' && offer.credits_amount) {
    await transferCredits(
      c.env, escrowUid(c.env), offer.merchant_uid, offer.credits_amount,
      'Social Splash offer withdrawn - refunded', 'splash_offer_refund', String(offerId)
    ).catch(e => logger.error(`Splash offer refund failed for offer ${offerId}: ${(e as Error).message}`));
  }

  return c.json({ data: { id: offerId, status: 'withdrawn' } });
}

/**
 * GET /internal/splash/:id/media/download?tenant_id=&business_id=&original= —
 * guard status='licensed'. Optimized file always available; original only
 * if original_unlocked=1, else the machine-readable {error:'original-locked'}
 * the plan specifies (kk-business's UI checks this to show the $1.99 unlock,
 * Increment 6).
 */
export async function getSplashMediaDownload(c: AppContext) {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id)) throw new HTTPException(400, { message: 'Invalid submission id' });
  const tenantId = c.req.query('tenant_id') ?? '';
  const businessId = c.req.query('business_id') ?? '';
  if (!tenantId || !businessId) throw new HTTPException(400, { message: 'tenant_id and business_id are required' });
  await requireMerchantBridge(c, businessId);

  const row = await c.env.DB.prepare(
    'SELECT business_id, status, image_key, image_original_key, original_unlocked FROM splash_submissions WHERE id = ? AND tenant_id = ?'
  ).bind(id, tenantId).first<{ business_id: string; status: string; image_key: string | null; image_original_key: string | null; original_unlocked: number }>();
  if (!row) throw new HTTPException(404, { message: 'Submission not found' });
  if (row.business_id !== businessId) throw new HTTPException(403, { message: 'This submission does not belong to your business.' });
  if (row.status !== 'licensed') throw new HTTPException(403, { message: 'This photo is not licensed yet.' });

  const wantsOriginal = c.req.query('original') === 'true';
  if (wantsOriginal && !row.original_unlocked) {
    throw new HTTPException(403, { message: 'original-locked' });
  }
  const key = wantsOriginal ? row.image_original_key : row.image_key;
  if (!key) throw new HTTPException(404, { message: 'Photo not found' });

  const upstream = await c.env.KKAUTH.fetch(new Request(`https://kkauth/internal/images/${key}`, {
    headers: { 'X-Internal-Secret': c.env.INTERNAL_SECRET },
  }));
  if (!upstream.ok) {
    throw new HTTPException(upstream.status === 404 ? 404 : 502, { message: 'Photo could not be loaded.' });
  }
  return new Response(upstream.body, {
    headers: {
      'Content-Type': upstream.headers.get('Content-Type') ?? 'application/octet-stream',
      'Content-Disposition': 'attachment',
    },
  });
}
