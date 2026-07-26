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
import { transferCredits } from '../lib/credits';
import { notifySplash } from '../lib/splash-notify';

type AppContext = Context<{ Bindings: Env }>;

const ACCEPT_AWARD_K = 25;       // splash.accept_award_k default (Part B.1)
const HOLD_DAYS = 30;            // splash.hold_days default
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
  const settings = await c.env.DB.prepare(
    'SELECT business_id, opt_in, blurb, updated_at FROM splash_settings WHERE tenant_id = ? AND business_id = ?'
  ).bind(tenantId, businessId).first<any>();

  return c.json({
    data: {
      submissions: results ?? [],
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
