/**
 * Social Splash — private guest-content pipeline.
 *
 * A member who scanned a participating business's plaque in the last 24h can
 * submit one photo (video: Increment 5) per business per day to that
 * business's private inbox. Content is NEVER displayed anywhere on the
 * platform - the business licenses it for their own marketing
 * (SOCIAL-SPLASH-BUILD-PLAN.md is the full spec; this file is Increment 2:
 * guest submit + My Splash, photos only).
 *
 * Business eligibility is derived from passport_scans/passport_plaques
 * (passport.ts's scanPlaque/getStamps tables) joined against splash_settings
 * - there is no separate "which businesses can I splash" table. A business_id
 * is a KKAuth business id (passport_plaques.merchant_id).
 */

import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { nanoid } from 'nanoid';
import type { Env } from '../types';
import { hmacHex, timingSafeEqual } from '../lib/hmac';
import { transferCredits, escrowUid } from '../lib/credits';
import { sendSplashCertificateEmail } from '../lib/email';
import { notifySplash } from '../lib/splash-notify';

type AppContext = Context<{ Bindings: Env }>;

async function sha256(message: string): Promise<string> {
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}

const BOARD_TZ = 'America/New_York';
const CAPTION_MAX = 280;
const SCAN_WINDOW_SECONDS = 24 * 60 * 60;
const MEDIA_VIEW_TTL_SECONDS = 5 * 60;

// Config defaults (SOCIAL-SPLASH-BUILD-PLAN.md Part B.1). Centralizing these
// in Passport's KV-config pattern is Increment 6's job (alongside the fee/
// sweep config it introduces); Increment 2 only needs destroy_delay_days, so
// it's a plain constant here rather than a half-built config reader.
const DESTROY_DELAY_DAYS = 7;

function cleanText(value: unknown, maxLen: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLen);
}

/** Today's date as YYYY-MM-DD in BOARD_TZ, for the daily submission cap. */
function todayET(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: BOARD_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

/**
 * GET /splash/eligible — businesses the caller may submit to right now:
 * opted in, scanned within the last 24h, and no submission yet today.
 */
export async function getSplashEligible(c: AppContext) {
  const tenant = c.get('tenant');
  const user = c.get('user');
  const kkauthUid = Number(user.sub);
  const today = todayET();
  const cutoff = Math.floor(Date.now() / 1000) - SCAN_WINDOW_SECONDS;

  const { results } = await c.env.DB.prepare(`
    SELECT DISTINCT pp.merchant_id AS business_id, pp.name AS business_name, ss.blurb AS blurb
    FROM passport_scans ps
    JOIN passport_plaques pp ON pp.id = ps.plaque_id
    JOIN splash_settings ss ON ss.tenant_id = pp.tenant_id AND ss.business_id = pp.merchant_id
    WHERE ps.user_id = ?1 AND pp.tenant_id = ?2 AND pp.merchant_id IS NOT NULL
      AND ss.opt_in = 1
      AND ps.created_at > ?3
      AND NOT EXISTS (
        SELECT 1 FROM splash_submissions sub
        WHERE sub.tenant_id = ?2 AND sub.kkauth_uid = ?1 AND sub.business_id = pp.merchant_id AND sub.created_day = ?4
      )
  `).bind(kkauthUid, tenant.id, cutoff, today).all<{ business_id: string; business_name: string; blurb: string | null }>();

  return c.json({ data: results ?? [] });
}

/**
 * POST /splash/submit — multipart { business_id, file, caption? }. Every
 * visibility-driving field (opt-in, the qualifying scan, the daily cap) is
 * re-derived server-side here, never trusted from the eligible-list the
 * client fetched moments earlier.
 */
export async function submitSplash(c: AppContext) {
  const tenant = c.get('tenant');
  const user = c.get('user');
  const kkauthUid = Number(user.sub);

  const form = await c.req.formData().catch(() => null);
  if (!form) throw new HTTPException(400, { message: 'Choose a photo to share.' });

  const businessId = String(form.get('business_id') ?? '').trim();
  if (!businessId) throw new HTTPException(400, { message: 'Choose a business to share this with.' });

  const file = form.get('file');
  if (!file || typeof file === 'string') throw new HTTPException(400, { message: 'Choose a photo to share.' });

  const caption = cleanText(form.get('caption'), CAPTION_MAX);

  const settings = await c.env.DB.prepare(
    'SELECT opt_in FROM splash_settings WHERE tenant_id = ? AND business_id = ?'
  ).bind(tenant.id, businessId).first<{ opt_in: number }>();
  if (!settings?.opt_in) {
    throw new HTTPException(400, { message: "This business isn't accepting Social Splash submissions right now." });
  }

  const cutoff = Math.floor(Date.now() / 1000) - SCAN_WINDOW_SECONDS;
  const scan = await c.env.DB.prepare(`
    SELECT ps.id AS scan_id, pp.name AS business_name
    FROM passport_scans ps
    JOIN passport_plaques pp ON pp.id = ps.plaque_id
    WHERE ps.user_id = ? AND pp.tenant_id = ? AND pp.merchant_id = ? AND ps.created_at > ?
    ORDER BY ps.created_at DESC LIMIT 1
  `).bind(kkauthUid, tenant.id, businessId, cutoff).first<{ scan_id: string; business_name: string }>();
  if (!scan) {
    throw new HTTPException(400, {
      message: "Scan this business's plaque before sharing - it looks like it's been more than a day since your last visit.",
    });
  }

  const createdDay = todayET();
  const already = await c.env.DB.prepare(
    'SELECT id FROM splash_submissions WHERE tenant_id = ? AND kkauth_uid = ? AND business_id = ? AND created_day = ?'
  ).bind(tenant.id, kkauthUid, businessId, createdDay).first<{ id: number }>();
  if (already) {
    throw new HTTPException(400, { message: `You've already shared with ${scan.business_name} today - come back tomorrow.` });
  }

  // Forward to KKAuth's generic upload proxy (private + retained original -
  // Social Splash Increment 1), same call shape as Fresh Today's photo
  // upload (uploadFreshPhoto in fresh.ts), plus the two new fields.
  const uploadForm = new FormData();
  uploadForm.append('file', file as File);
  uploadForm.append('user_id', String(kkauthUid));
  uploadForm.append('variant', 'mobile');
  uploadForm.append('private', 'true');
  uploadForm.append('retain_original', 'true');

  const uploadRes = await c.env.KKAUTH.fetch(new Request('https://kkauth/internal/uploads', {
    method: 'POST',
    headers: { 'X-Internal-Secret': c.env.INTERNAL_SECRET },
    body: uploadForm,
  }));
  const uploadBody = await uploadRes.json<{ data?: { key?: string; original_key?: string }; error?: string }>()
    .catch(() => ({} as { data?: { key?: string; original_key?: string }; error?: string }));
  if (!uploadRes.ok) {
    throw new HTTPException(uploadRes.status as 400 | 413 | 415 | 502, { message: uploadBody?.error ?? 'Photo upload failed.' });
  }
  const imageKey = uploadBody?.data?.key;
  const originalKey = uploadBody?.data?.original_key ?? null;
  if (!imageKey) throw new HTTPException(502, { message: 'Photo upload failed.' });

  try {
    const inserted = await c.env.DB.prepare(`
      INSERT INTO splash_submissions
        (tenant_id, kkauth_uid, business_id, business_name, media_type, image_key, image_original_key, caption, scan_ref, created_day)
      VALUES (?, ?, ?, ?, 'image', ?, ?, ?, ?, ?)
      RETURNING id, business_id, business_name, media_type, caption, status, created_at
    `).bind(
      tenant.id, kkauthUid, businessId, scan.business_name, imageKey, originalKey, caption, scan.scan_id, createdDay
    ).first<any>();
    return c.json({ data: inserted }, 201);
  } catch (e: any) {
    // Race with a concurrent submit for the same (tenant, user, business, day) -
    // the UNIQUE constraint is the hard backstop behind the pre-check above.
    if (String(e?.message ?? '').includes('UNIQUE')) {
      throw new HTTPException(400, { message: `You've already shared with ${scan.business_name} today - come back tomorrow.` });
    }
    throw e;
  }
}

/**
 * GET /splash/mine — every submission the caller owns, every status, newest
 * first, plus any open offers and recent tombstones. Offers/tombstones tables
 * exist from this increment's migration but stay empty until Increment 4
 * (offers) and Increment 6 (the sweep that writes tombstones) ship - the
 * response shape is complete now so those increments don't need to reshape it.
 */
export async function getMySplash(c: AppContext) {
  const tenant = c.get('tenant');
  const user = c.get('user');
  const kkauthUid = Number(user.sub);

  const { results: submissionRows } = await c.env.DB.prepare(`
    SELECT id, business_id, business_name, media_type, caption, status,
           held_at, hold_expires_at, licensed_at, declined_at, destroy_after,
           original_unlocked, admin_removed_reason, created_at
    FROM splash_submissions
    WHERE tenant_id = ? AND kkauth_uid = ?
    ORDER BY created_at DESC
  `).bind(tenant.id, kkauthUid).all<any>();

  const submissions = submissionRows ?? [];
  const ids = submissions.map((r: any) => r.id);

  let offersBySubmission: Record<number, any> = {};
  if (ids.length) {
    const placeholders = ids.map(() => '?').join(',');
    const { results: offerRows } = await c.env.DB.prepare(`
      SELECT id, submission_id, consideration_type, credits_amount, cert_value_cents,
             cert_description, status, expires_at, agreed_at, created_at
      FROM splash_offers
      WHERE tenant_id = ? AND status = 'open' AND submission_id IN (${placeholders})
    `).bind(tenant.id, ...ids).all<any>();
    for (const o of offerRows ?? []) offersBySubmission[o.submission_id] = o;
  }

  const { results: tombstoneRows } = await c.env.DB.prepare(
    'SELECT id, business_name, final_status, destroyed_at FROM splash_tombstones WHERE tenant_id = ? AND kkauth_uid = ? ORDER BY destroyed_at DESC LIMIT 20'
  ).bind(tenant.id, kkauthUid).all<any>();

  // Certificates never expire and are never deleted - shown regardless of
  // their owning submission's current state. token_hash is never returned;
  // the raw code was shown once (agree response) or via the regenerate route.
  const { results: certificateRows } = await c.env.DB.prepare(
    'SELECT id, business_name, value_cents, description, status, redeemed_at, created_at FROM splash_certificates WHERE tenant_id = ? AND kkauth_uid = ? ORDER BY created_at DESC'
  ).bind(tenant.id, kkauthUid).all<any>();

  const withOffers = submissions.map((r: any) => ({ ...r, open_offer: offersBySubmission[r.id] ?? null }));
  return c.json({
    data: { submissions: withOffers, tombstones: tombstoneRows ?? [], certificates: certificateRows ?? [] },
  });
}

/** PATCH /splash/:id/caption — owner, only while status = 'submitted'. */
export async function updateSplashCaption(c: AppContext) {
  const tenant = c.get('tenant');
  const user = c.get('user');
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id)) throw new HTTPException(400, { message: 'Invalid submission id' });

  const body = await c.req.json().catch(() => ({} as Record<string, unknown>));
  const caption = cleanText(body?.caption, CAPTION_MAX);

  const res = await c.env.DB.prepare(
    "UPDATE splash_submissions SET caption = ? WHERE id = ? AND tenant_id = ? AND kkauth_uid = ? AND status = 'submitted'"
  ).bind(caption, id, tenant.id, Number(user.sub)).run();

  if (res.meta.changes !== 1) {
    throw new HTTPException(404, { message: 'This can only be edited before the business responds to it.' });
  }
  return c.json({ data: { id, caption } });
}

/**
 * POST /splash/:id/withdraw — owner, only while status = 'submitted' (once a
 * hold begins the merchant has paid an accept award as an option premium, so
 * withdrawal is disabled - stated in the submit-consent copy). Sets status
 * 'removed' with destroy_after; leaves admin_removed_reason/by NULL, which is
 * exactly what distinguishes a self-withdraw from an admin removal at read
 * time and in the eventual tombstone's final_status.
 */
export async function withdrawSplash(c: AppContext) {
  const tenant = c.get('tenant');
  const user = c.get('user');
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id)) throw new HTTPException(400, { message: 'Invalid submission id' });

  const destroyAfter = Math.floor(Date.now() / 1000) + DESTROY_DELAY_DAYS * 86400;
  const res = await c.env.DB.prepare(
    "UPDATE splash_submissions SET status = 'removed', destroy_after = ?, declined_at = unixepoch() WHERE id = ? AND tenant_id = ? AND kkauth_uid = ? AND status = 'submitted'"
  ).bind(destroyAfter, id, tenant.id, Number(user.sub)).run();

  if (res.meta.changes !== 1) {
    throw new HTTPException(404, { message: 'This can only be withdrawn before the business responds to it.' });
  }
  return c.json({ data: { id, status: 'removed', destroy_after: destroyAfter } });
}

/**
 * GET /splash/media/:id/view — owner or admin only. Mints a 5-minute signed
 * URL for the raw-serving route below; raw R2 keys never reach the client.
 */
export async function getSplashMediaView(c: AppContext) {
  const tenant = c.get('tenant');
  const user = c.get('user');
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id)) throw new HTTPException(400, { message: 'Invalid submission id' });

  const row = await c.env.DB.prepare(
    'SELECT kkauth_uid, image_key FROM splash_submissions WHERE id = ? AND tenant_id = ?'
  ).bind(id, tenant.id).first<{ kkauth_uid: number; image_key: string | null }>();
  if (!row) throw new HTTPException(404, { message: 'Submission not found' });
  if (Number(user.sub) !== row.kkauth_uid && !user.is_admin) {
    throw new HTTPException(403, { message: 'Not your submission.' });
  }
  if (!row.image_key) throw new HTTPException(404, { message: 'No photo on this submission yet.' });

  const expiresAt = Math.floor(Date.now() / 1000) + MEDIA_VIEW_TTL_SECONDS;
  const sig = await hmacHex(c.env.SPLASH_MEDIA_SECRET, `${id}|${expiresAt}`);
  const url = `/api/t/${tenant.id}/splash/media/${id}/raw?exp=${expiresAt}&sig=${sig}`;
  return c.json({ data: { url } });
}

/**
 * GET /splash/media/:id/raw — public (no Bearer - it's loaded via <img src>),
 * gated entirely by the HMAC token minted above. Streams bytes via
 * KKAuth -> image-api internal read; raw image-api keys/creds never touch
 * Passport's own secrets beyond SPLASH_MEDIA_SECRET.
 */
export async function getSplashMediaRaw(c: AppContext) {
  const tenant = c.get('tenant');
  const id = Number(c.req.param('id'));
  const exp = Number(c.req.query('exp'));
  const sig = c.req.query('sig') ?? '';
  if (!Number.isInteger(id) || !Number.isFinite(exp) || !sig) {
    throw new HTTPException(400, { message: 'Invalid media link' });
  }
  if (Math.floor(Date.now() / 1000) > exp) {
    throw new HTTPException(403, { message: 'This link has expired.' });
  }
  const expected = await hmacHex(c.env.SPLASH_MEDIA_SECRET, `${id}|${exp}`);
  if (!timingSafeEqual(expected, sig)) {
    throw new HTTPException(403, { message: 'Invalid media link' });
  }

  const row = await c.env.DB.prepare(
    'SELECT image_key FROM splash_submissions WHERE id = ? AND tenant_id = ?'
  ).bind(id, tenant.id).first<{ image_key: string | null }>();
  if (!row?.image_key) throw new HTTPException(404, { message: 'Photo not found' });

  const upstream = await c.env.KKAUTH.fetch(new Request(`https://kkauth/internal/images/${row.image_key}`, {
    headers: { 'X-Internal-Secret': c.env.INTERNAL_SECRET },
  }));
  if (!upstream.ok) {
    throw new HTTPException(upstream.status === 404 ? 404 : 502, { message: 'Photo could not be loaded.' });
  }
  return new Response(upstream.body, {
    headers: {
      'Content-Type': upstream.headers.get('Content-Type') ?? 'application/octet-stream',
      'Cache-Control': 'private, max-age=300',
    },
  });
}

/**
 * POST /splash/offers/:offerId/respond — body { action: 'agree' | 'pass' }.
 * Owner of the submission only. Agree is the atomic settlement (Part D.4):
 * consideration settles FIRST (escrow-out transfer, or certificate mint),
 * and only on that success do offer -> 'agreed' and submission -> 'licensed'
 * happen together in one batch(). If the transfer/mint throws, nothing else
 * changes - a retry re-enters cleanly since the offer is still 'open'.
 */
export async function respondToSplashOffer(c: AppContext) {
  const tenant = c.get('tenant');
  const user = c.get('user');
  const offerId = Number(c.req.param('offerId'));
  if (!Number.isInteger(offerId)) throw new HTTPException(400, { message: 'Invalid offer id' });

  const body = await c.req.json<{ action?: string }>().catch(() => ({} as { action?: string }));
  const action = body.action;
  if (action !== 'agree' && action !== 'pass') {
    throw new HTTPException(400, { message: "action must be 'agree' or 'pass'" });
  }

  const offer = await c.env.DB.prepare(`
    SELECT o.id, o.submission_id, o.business_id, o.merchant_uid, o.consideration_type,
           o.credits_amount, o.cert_value_cents, o.cert_description, o.status,
           s.kkauth_uid, s.status AS submission_status, s.business_name
    FROM splash_offers o JOIN splash_submissions s ON s.id = o.submission_id
    WHERE o.id = ? AND o.tenant_id = ?
  `).bind(offerId, tenant.id).first<any>();
  if (!offer) throw new HTTPException(404, { message: 'Offer not found' });
  if (Number(user.sub) !== offer.kkauth_uid) throw new HTTPException(403, { message: 'This offer is not yours to respond to.' });
  if (offer.status !== 'open') throw new HTTPException(400, { message: 'This offer is no longer open.' });

  if (action === 'pass') {
    const res = await c.env.DB.prepare(
      "UPDATE splash_offers SET status = 'passed' WHERE id = ? AND tenant_id = ? AND status = 'open'"
    ).bind(offerId, tenant.id).run();
    if (res.meta.changes !== 1) throw new HTTPException(400, { message: 'This offer is no longer open.' });

    if (offer.consideration_type === 'credits') {
      await transferCredits(
        c.env, escrowUid(c.env), offer.merchant_uid, offer.credits_amount,
        'Social Splash offer passed - refunded', 'splash_offer_refund', String(offerId)
      ).catch(() => {}); // best-effort; the merchant-side withdraw route logs failures, this path mirrors it silently since the guest has no reason to see a refund-plumbing error
    }
    c.executionCtx.waitUntil(notifySplash(c.env, offer.merchant_uid, 'Offer passed', 'The guest passed on your offer for their photo.'));
    return c.json({ data: { id: offerId, status: 'passed' } });
  }

  // agree
  let certCode: string | null = null;
  if (offer.consideration_type === 'credits') {
    try {
      await transferCredits(
        c.env, escrowUid(c.env), offer.kkauth_uid, offer.credits_amount,
        'Social Splash license agreed', 'splash_license', String(offerId)
      );
    } catch {
      throw new HTTPException(502, { message: 'Could not complete this - try again.' });
    }
  } else {
    const rawCode = `LL-${nanoid(8).toUpperCase()}`;
    const tokenHash = await sha256(rawCode);
    try {
      await c.env.DB.prepare(`
        INSERT INTO splash_certificates (tenant_id, offer_id, business_id, business_name, kkauth_uid, value_cents, description, token_hash, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active')
      `).bind(tenant.id, offerId, offer.business_id, offer.business_name, offer.kkauth_uid, offer.cert_value_cents, offer.cert_description, tokenHash).run();
      certCode = rawCode;
    } catch (err) {
      // UNIQUE(offer_id) means a retry already minted this certificate - the
      // raw code was shown once and is gone; the guest uses the regenerate
      // route below if they need a fresh one. Any other error is real.
      if (!String((err as Error).message).includes('UNIQUE')) {
        throw new HTTPException(500, { message: 'Could not complete this - try again.' });
      }
    }
  }

  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE splash_offers SET status = 'agreed', agreed_at = unixepoch() WHERE id = ? AND tenant_id = ? AND status = 'open'")
      .bind(offerId, tenant.id),
    c.env.DB.prepare("UPDATE splash_submissions SET status = 'licensed', licensed_at = unixepoch() WHERE id = ? AND tenant_id = ?")
      .bind(offer.submission_id, tenant.id),
  ]);

  if (certCode) {
    const guest = await c.env.DB.prepare('SELECT email FROM users WHERE kkauth_uid = ? AND tenant_id = ?')
      .bind(offer.kkauth_uid, tenant.id).first<{ email: string | null }>();
    if (guest?.email) {
      c.executionCtx.waitUntil(sendSplashCertificateEmail(c.env, guest.email, offer.business_name, certCode, offer.cert_description));
    }
  }
  c.executionCtx.waitUntil(notifySplash(
    c.env, offer.merchant_uid, 'Offer accepted',
    "The guest agreed - your licensed content is ready in your Splash inbox."
  ));

  return c.json({ data: { id: offerId, status: 'agreed', certificate_code: certCode } });
}

/**
 * POST /splash/certificates/:id/code — regenerates a certificate's redeem
 * code (same pattern as deals.ts's regenerateDealClaimCode) for a guest who
 * lost the one-time code shown at agree time. Only the holder, only while
 * 'active'.
 */
export async function regenerateSplashCertificateCode(c: AppContext) {
  const tenant = c.get('tenant');
  const user = c.get('user');
  const certId = Number(c.req.param('id'));
  if (!Number.isInteger(certId)) throw new HTTPException(400, { message: 'Invalid certificate id' });

  const rawCode = `LL-${nanoid(8).toUpperCase()}`;
  const tokenHash = await sha256(rawCode);

  const result = await c.env.DB.prepare(`
    UPDATE splash_certificates
    SET token_hash = ?
    WHERE id = ? AND tenant_id = ? AND kkauth_uid = ? AND status = 'active'
  `).bind(tokenHash, certId, tenant.id, Number(user.sub)).run();

  if (result.meta.changes !== 1) {
    throw new HTTPException(409, { message: 'This certificate is no longer active, or already redeemed.' });
  }

  return c.json({ data: { claim_code: rawCode } });
}
