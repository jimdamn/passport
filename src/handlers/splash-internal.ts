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
import { mintSignedPlaybackToken, signedIframeUrl, signedDownloadUrl, enableMp4Download, deleteStreamVideo } from '../lib/stream';
import { getSplashConfig } from '../lib/splash-config';

type AppContext = Context<{ Bindings: Env }>;

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

  // fee_original_cents rides along on settings rather than a dedicated
  // endpoint - kk-business's checkout route needs this one number and
  // already fetches this payload for the settings card, so this avoids a
  // second bridge call just to learn a config value (Increment 6 step 3a).
  const config = await getSplashConfig(c.env, tenantId);

  return c.json({
    data: {
      submissions: submissionsWithOffers,
      settings: {
        ...(settings ?? { business_id: businessId, opt_in: 0, blurb: null, updated_at: null }),
        fee_original_cents: config.fee_original_cents,
      },
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

  const config = await getSplashConfig(c.env, tenantId);

  try {
    await transferCredits(
      c.env, merchantUid, row.kkauth_uid, config.accept_award_k,
      `Accepted a Social Splash photo`, 'splash_accept', String(id), bearerToken
    );
  } catch (err) {
    const msg = (err as Error).message;
    if (msg.includes('Insufficient')) {
      throw new HTTPException(402, { message: `You need at least ${config.accept_award_k} KrowdKredits to accept a submission.` });
    }
    throw new HTTPException(502, { message: 'Payment failed - you were not charged, and the photo was not accepted. Try again.' });
  }

  const holdExpiresAt = Math.floor(Date.now() / 1000) + config.hold_days * 86400;
  await c.env.DB.prepare(
    "UPDATE splash_submissions SET status = 'held', held_at = unixepoch(), hold_expires_at = ? WHERE id = ? AND tenant_id = ? AND status = 'submitted'"
  ).bind(holdExpiresAt, id, tenantId).run();

  c.executionCtx.waitUntil(notifySplash(
    c.env, row.kkauth_uid, 'Photo accepted',
    `${row.business_name} accepted your photo - ${config.accept_award_k} KrowdKredits are yours.`
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

  const config = await getSplashConfig(c.env, tenantId);
  const destroyAfter = Math.floor(Date.now() / 1000) + config.destroy_delay_days * 86400;
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
 * GET /internal/splash/:id/media/view?tenant_id=&business_id= — for a photo,
 * mints the same 5-min HMAC token as the guest-facing mint in splash.ts
 * (identical shape, so the one public raw-serving route serves both) but
 * returns an ABSOLUTE url since the merchant's browser is on kk-business's
 * own domain. For a video, mints a Stream signed playback token and returns
 * Stream's own iframe URL directly - no absolute-vs-relative distinction
 * applies there since Stream's domain is never Passport's own to begin with.
 */
export async function getSplashInboxMediaView(c: AppContext) {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id)) throw new HTTPException(400, { message: 'Invalid submission id' });
  const tenantId = c.req.query('tenant_id') ?? '';
  const businessId = c.req.query('business_id') ?? '';
  if (!tenantId || !businessId) throw new HTTPException(400, { message: 'tenant_id and business_id are required' });
  await requireMerchantBridge(c, businessId);

  const row = await c.env.DB.prepare(
    'SELECT business_id, media_type, image_key, image_watermarked_key, status, stream_uid FROM splash_submissions WHERE id = ? AND tenant_id = ?'
  ).bind(id, tenantId).first<{ business_id: string; media_type: string; image_key: string | null; image_watermarked_key: string | null; status: string; stream_uid: string | null }>();
  if (!row) throw new HTTPException(404, { message: 'Submission not found' });
  if (row.business_id !== businessId) throw new HTTPException(403, { message: 'This submission does not belong to your business.' });

  if (row.media_type === 'video') {
    if (!row.stream_uid) throw new HTTPException(404, { message: 'No video on this submission yet.' });
    const token = await mintSignedPlaybackToken(c.env, row.stream_uid, MEDIA_VIEW_TTL_SECONDS);
    return c.json({ data: { url: signedIframeUrl(c.env, token), type: 'video' } });
  }

  if (!row.image_key) throw new HTTPException(404, { message: 'No photo on this submission yet.' });
  // Merchant sees watermarked until the submission is actually licensed -
  // that's the whole point of this feature (SOCIAL-SPLASH-WATERMARK-
  // DESIGN.md). Legacy fallback: no image_watermarked_key means clean,
  // same as before this feature existed.
  const variant: 'clean' | 'watermarked' =
    row.status === 'licensed' || !row.image_watermarked_key ? 'clean' : 'watermarked';
  const expiresAt = Math.floor(Date.now() / 1000) + MEDIA_VIEW_TTL_SECONDS;
  const sig = await hmacHex(c.env.SPLASH_MEDIA_SECRET, `${id}|${variant}|${expiresAt}`);
  const hostname = await tenantHostname(c, tenantId);
  const url = `https://${hostname}/api/t/${tenantId}/splash/media/${id}/raw?exp=${expiresAt}&variant=${variant}&sig=${sig}`;
  return c.json({ data: { url, type: 'image' } });
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

  const config = await getSplashConfig(c.env, tenantId);
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

  const expiresAt = Math.floor(Date.now() / 1000) + config.offer_days * 86400;
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
    'SELECT business_id, status, media_type, stream_uid, image_key, image_original_key, original_unlocked FROM splash_submissions WHERE id = ? AND tenant_id = ?'
  ).bind(id, tenantId).first<{ business_id: string; status: string; media_type: string; stream_uid: string | null; image_key: string | null; image_original_key: string | null; original_unlocked: number }>();
  if (!row) throw new HTTPException(404, { message: 'Submission not found' });
  if (row.business_id !== businessId) throw new HTTPException(403, { message: 'This submission does not belong to your business.' });
  if (row.status !== 'licensed') throw new HTTPException(403, { message: 'This photo is not licensed yet.' });

  if (row.media_type === 'video') {
    // Video has no free-preview download tier - the MP4 is the original, so it
    // is gated entirely behind original_unlocked (unlike photos, which have a
    // watermark-free displayed image available even before unlock).
    if (!row.original_unlocked) throw new HTTPException(403, { message: 'original-locked' });
    if (!row.stream_uid) throw new HTTPException(404, { message: 'Video not found' });
    const download = await enableMp4Download(c.env, row.stream_uid);
    if (download.status !== 'ready') {
      return c.json({ data: { type: 'video', status: download.status, percent_complete: download.percentComplete } }, 202);
    }
    const token = await mintSignedPlaybackToken(c.env, row.stream_uid, MEDIA_VIEW_TTL_SECONDS, true);
    return c.json({ data: { type: 'video', status: 'ready', url: signedDownloadUrl(c.env, token) } });
  }

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

/**
 * POST /internal/splash/:id/original-unlocked — body { tenant_id }. Called
 * ONLY by kk-business's Stripe webhook handler, server-to-server, after a
 * real $1.99 payment succeeded - there is no merchant Bearer to forward at
 * that point (a webhook has no logged-in browser session), so this route is
 * gated by X-Internal-Secret alone, same auth shape as internalSweep below.
 * The ownership check already happened once, earlier, at checkout-creation
 * time (an authenticated kk-business request) - this step only ever fires
 * for a submission_id kk-business already verified belongs to its own
 * business_id. Idempotent: a replayed webhook just re-sets the same 1.
 */
export async function markSplashOriginalUnlocked(c: AppContext) {
  if (!matchesInternalSecret(c.req.header('X-Internal-Secret'), c.env)) {
    throw new HTTPException(401, { message: 'Unauthorized internal call' });
  }
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id)) throw new HTTPException(400, { message: 'Invalid submission id' });
  const body = await c.req.json<{ tenant_id?: string }>().catch(() => ({} as { tenant_id?: string }));
  const tenantId = body.tenant_id ?? '';
  if (!tenantId) throw new HTTPException(400, { message: 'tenant_id is required' });

  const res = await c.env.DB.prepare(
    'UPDATE splash_submissions SET original_unlocked = 1 WHERE id = ? AND tenant_id = ?'
  ).bind(id, tenantId).run();
  if (res.meta.changes !== 1) {
    // Already 1, or the row doesn't exist. A replay of an already-applied
    // webhook is not an error - report it as done either way, so kk-business
    // never retries a webhook that has nothing left to do.
    const existing = await c.env.DB.prepare(
      'SELECT id FROM splash_submissions WHERE id = ? AND tenant_id = ? AND original_unlocked = 1'
    ).bind(id, tenantId).first<{ id: number }>();
    if (!existing) throw new HTTPException(404, { message: 'Submission not found' });
  }

  return c.json({ data: { id, original_unlocked: true } });
}

// ─────────────────────────────────────────────────────────────────────────────
// Sweep — cron backstop (Increment 6). Order matters: offers expire first (an
// offer can only be open on a HELD submission, but its own offer_days window
// can outlast the submission's hold_days window, so a lingering open offer
// must always be closed - and its escrow refunded - before the submission
// underneath it is allowed to move to 'declined'), then holds expire, then
// destruction runs last and only for rows with no open offer left (the
// Lifecycle matrix's child-order rule: offers must be terminal before a
// submission is destroyed). Each phase is its own bounded batch (LIMIT 20,
// matching sweepExpiredDealClaims's shape) so one sweep call never runs
// unboundedly long; kk-business-cron's job calls this repeatedly until a
// batch comes back empty (passport-cron's runBatchedSweep pattern).
// ─────────────────────────────────────────────────────────────────────────────

async function refundOpenOffer(env: Env, offer: { id: number; merchant_uid: number; consideration_type: string; credits_amount: number | null }, note: string): Promise<void> {
  if (offer.consideration_type === 'credits' && offer.credits_amount) {
    await transferCredits(
      env, escrowUid(env), offer.merchant_uid, offer.credits_amount, note, 'splash_offer_refund', String(offer.id)
    ).catch(e => logger.error(`Splash offer refund failed for offer ${offer.id}: ${(e as Error).message}`));
  }
}

async function sweepExpiredSplashOffers(env: Env): Promise<number> {
  const { results } = await env.DB.prepare(`
    SELECT id, merchant_uid, consideration_type, credits_amount
    FROM splash_offers
    WHERE status = 'open' AND expires_at <= unixepoch()
    LIMIT 20
  `).all<{ id: number; merchant_uid: number; consideration_type: string; credits_amount: number | null }>();

  let processed = 0;
  for (const offer of results ?? []) {
    try {
      const flip = await env.DB.prepare(
        "UPDATE splash_offers SET status = 'expired' WHERE id = ? AND status = 'open'"
      ).bind(offer.id).run();
      if (flip.meta.changes !== 1) continue;
      await refundOpenOffer(env, offer, 'Social Splash offer expired - refunded');
      processed++;
    } catch (err) {
      logger.error(`Splash offer expiry sweep failed for offer ${offer.id}: ${(err as Error).message}`);
    }
  }
  return processed;
}

async function sweepExpiredSplashHolds(env: Env): Promise<number> {
  const { results } = await env.DB.prepare(`
    SELECT id, tenant_id, kkauth_uid, business_name
    FROM splash_submissions
    WHERE status = 'held' AND hold_expires_at <= unixepoch()
    LIMIT 20
  `).all<{ id: number; tenant_id: string; kkauth_uid: number; business_name: string }>();

  let processed = 0;
  for (const sub of results ?? []) {
    try {
      // A lingering open offer on this submission (offer_days outlasting
      // hold_days) must be closed and refunded before the hold can lapse -
      // this is the one case sweepExpiredSplashOffers above can't catch on
      // its own, since the offer's own expires_at may still be in the future.
      const openOffer = await env.DB.prepare(
        "SELECT id, merchant_uid, consideration_type, credits_amount FROM splash_offers WHERE submission_id = ? AND status = 'open'"
      ).bind(sub.id).first<{ id: number; merchant_uid: number; consideration_type: string; credits_amount: number | null }>();
      if (openOffer) {
        const flip = await env.DB.prepare(
          "UPDATE splash_offers SET status = 'expired' WHERE id = ? AND status = 'open'"
        ).bind(openOffer.id).run();
        if (flip.meta.changes === 1) {
          await refundOpenOffer(env, openOffer, 'Social Splash offer expired - refunded');
        }
      }

      const config = await getSplashConfig(env, sub.tenant_id);
      const destroyAfter = Math.floor(Date.now() / 1000) + config.destroy_delay_days * 86400;
      const flip = await env.DB.prepare(
        "UPDATE splash_submissions SET status = 'declined', declined_at = unixepoch(), destroy_after = ? WHERE id = ? AND status = 'held'"
      ).bind(destroyAfter, sub.id).run();
      if (flip.meta.changes === 1) {
        await notifySplash(env, sub.kkauth_uid, 'Hold expired', `${sub.business_name} didn't respond in time - your photo was not licensed.`).catch(() => {});
        processed++;
      }
    } catch (err) {
      logger.error(`Splash hold expiry sweep failed for submission ${sub.id}: ${(err as Error).message}`);
    }
  }
  return processed;
}

function tombstoneFinalStatus(row: { status: string; admin_removed_by: string | null }): string {
  if (row.status === 'removed') return row.admin_removed_by ? 'removed' : 'withdrawn';
  return 'declined';
}

async function sweepSplashDestruction(env: Env): Promise<number> {
  const { results } = await env.DB.prepare(`
    SELECT id, tenant_id, kkauth_uid, business_name, media_type, image_key, image_original_key, image_watermarked_key, stream_uid, status, admin_removed_by
    FROM splash_submissions
    WHERE status IN ('declined', 'removed') AND destroy_after <= unixepoch()
      AND NOT EXISTS (SELECT 1 FROM splash_offers WHERE submission_id = splash_submissions.id AND status = 'open')
    LIMIT 20
  `).all<{
    id: number; tenant_id: string; kkauth_uid: number; business_name: string; media_type: string;
    image_key: string | null; image_original_key: string | null; image_watermarked_key: string | null; stream_uid: string | null;
    status: string; admin_removed_by: string | null;
  }>();

  let processed = 0;
  for (const row of results ?? []) {
    try {
      // Real deletion, not a soft flag - if any object delete fails, skip
      // this row entirely (retry next sweep) rather than orphan the object
      // by deleting the DB row anyway.
      if (row.media_type === 'video') {
        if (row.stream_uid) await deleteStreamVideo(env, row.stream_uid);
      } else {
        for (const key of [row.image_key, row.image_original_key, row.image_watermarked_key]) {
          if (!key) continue;
          const res = await env.KKAUTH.fetch(new Request(`https://kkauth/internal/images/${key}`, {
            method: 'DELETE',
            headers: { 'X-Internal-Secret': env.INTERNAL_SECRET },
          }));
          if (!res.ok && res.status !== 404) throw new Error(`image delete failed for ${key}: ${res.status}`);
        }
      }

      await env.DB.batch([
        env.DB.prepare(
          'INSERT INTO splash_tombstones (tenant_id, kkauth_uid, business_name, final_status, destroyed_at) VALUES (?, ?, ?, ?, unixepoch())'
        ).bind(row.tenant_id, row.kkauth_uid, row.business_name, tombstoneFinalStatus(row)),
        env.DB.prepare('DELETE FROM splash_submissions WHERE id = ?').bind(row.id),
      ]);
      processed++;
    } catch (err) {
      logger.error(`Splash destruction sweep failed for submission ${row.id}: ${(err as Error).message}`);
    }
  }
  return processed;
}

/** POST /api/internal/splash/sweep — cron backstop entry point (X-Internal-Secret only, same shape as internalSweep in deals.ts). */
export async function internalSplashSweep(c: AppContext) {
  if (!matchesInternalSecret(c.req.header('X-Internal-Secret'), c.env)) {
    throw new HTTPException(401, { message: 'Unauthorized' });
  }
  const offersExpired = await sweepExpiredSplashOffers(c.env);
  const holdsExpired = await sweepExpiredSplashHolds(c.env);
  const destroyed = await sweepSplashDestruction(c.env);
  return c.json({
    data: { processed: offersExpired + holdsExpired + destroyed, offers_expired: offersExpired, holds_expired: holdsExpired, destroyed },
  });
}
