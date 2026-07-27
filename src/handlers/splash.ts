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
import type { Env, Tenant } from '../types';
import { hmacHex, timingSafeEqual } from '../lib/hmac';
import { transferCredits, escrowUid } from '../lib/credits';
import { sendSplashCertificateEmail } from '../lib/email';
import { notifySplash } from '../lib/splash-notify';
import { createDirectUpload, getVideoDetails, mintSignedPlaybackToken, signedIframeUrl } from '../lib/stream';
import { getSplashConfig, setSplashConfig, type SplashConfig } from '../lib/splash-config';
import { getCount, increment } from '../lib/throttle';

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
const SUBMIT_RATE_LIMIT_PER_DAY = 20; // defense-in-depth above the per-business daily UNIQUE
const SUBMIT_RATE_LIMIT_TTL_SECONDS = 24 * 60 * 60;

function cleanText(value: unknown, maxLen: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLen);
}

function requireAdmin(c: AppContext) {
  const user = c.get('user');
  if (!user?.is_admin) throw new HTTPException(403, { message: 'Admin access required.' });
}

/** Defense-in-depth above the per-(tenant,user,business,day) UNIQUE - caps total submit attempts per user per day across every business, so the UNIQUE isn't the only thing standing between a bad actor and a flood of upload/eligibility calls. */
async function checkSubmitRateLimit(c: AppContext, kkauthUid: number): Promise<void> {
  const key = `splash:submit:${kkauthUid}`;
  const count = await getCount(c.env.PASSPORT_CONFIG, key);
  if (count >= SUBMIT_RATE_LIMIT_PER_DAY) {
    throw new HTTPException(429, { message: "You've shared quite a bit today - try again tomorrow." });
  }
  await increment(c.env.PASSPORT_CONFIG, key, SUBMIT_RATE_LIMIT_TTL_SECONDS);
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
 * Shared visibility-driving validation for both submit paths (photo and
 * video): opt-in, the qualifying scan, and the daily cap. Never trust any of
 * this from the eligible-list the client fetched moments earlier - re-derive
 * it here every time.
 */
async function checkSplashEligibility(
  c: AppContext, tenant: Tenant, kkauthUid: number, businessId: string
): Promise<{ scanId: string; businessName: string; createdDay: string }> {
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

  return { scanId: scan.scan_id, businessName: scan.business_name, createdDay };
}

/**
 * POST /splash/submit — multipart { business_id, file, caption? } for a
 * photo, or JSON { business_id, stream_uid, caption? } for a video already
 * uploaded to Stream. Branches on Content-Type.
 */
export async function submitSplash(c: AppContext) {
  const contentType = c.req.header('Content-Type') ?? '';
  if (contentType.includes('application/json')) {
    return submitSplashVideo(c);
  }
  return submitSplashPhoto(c);
}

async function submitSplashPhoto(c: AppContext) {
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

  await checkSubmitRateLimit(c, kkauthUid);
  const { scanId, businessName, createdDay } = await checkSplashEligibility(c, tenant, kkauthUid, businessId);

  // Forward to KKAuth's generic upload proxy (private + retained original -
  // Social Splash Increment 1), same call shape as Fresh Today's photo
  // upload (uploadFreshPhoto in fresh.ts), plus the two new fields.
  // watermark_text added for the pre-license-preview watermark
  // (SOCIAL-SPLASH-WATERMARK-DESIGN.md) - the tenant's own brand name, so a
  // merchant in one region never sees another region's mark.
  const uploadForm = new FormData();
  uploadForm.append('file', file as File);
  uploadForm.append('user_id', String(kkauthUid));
  uploadForm.append('variant', 'mobile');
  uploadForm.append('private', 'true');
  uploadForm.append('retain_original', 'true');
  uploadForm.append('watermark_text', tenant.config.brand_name);

  const uploadRes = await c.env.KKAUTH.fetch(new Request('https://kkauth/internal/uploads', {
    method: 'POST',
    headers: { 'X-Internal-Secret': c.env.INTERNAL_SECRET },
    body: uploadForm,
  }));
  const uploadBody = await uploadRes.json<{ data?: { key?: string; original_key?: string; watermarked_key?: string }; error?: string }>()
    .catch(() => ({} as { data?: { key?: string; original_key?: string; watermarked_key?: string }; error?: string }));
  if (!uploadRes.ok) {
    throw new HTTPException(uploadRes.status as 400 | 413 | 415 | 502, { message: uploadBody?.error ?? 'Photo upload failed.' });
  }
  const imageKey = uploadBody?.data?.key;
  const originalKey = uploadBody?.data?.original_key ?? null;
  const watermarkedKey = uploadBody?.data?.watermarked_key ?? null;
  if (!imageKey) throw new HTTPException(502, { message: 'Photo upload failed.' });

  try {
    const inserted = await c.env.DB.prepare(`
      INSERT INTO splash_submissions
        (tenant_id, kkauth_uid, business_id, business_name, media_type, image_key, image_original_key, image_watermarked_key, caption, scan_ref, created_day)
      VALUES (?, ?, ?, ?, 'image', ?, ?, ?, ?, ?, ?)
      RETURNING id, business_id, business_name, media_type, caption, status, created_at
    `).bind(
      tenant.id, kkauthUid, businessId, businessName, imageKey, originalKey, watermarkedKey, caption, scanId, createdDay
    ).first<any>();
    return c.json({ data: inserted }, 201);
  } catch (e: any) {
    // Race with a concurrent submit for the same (tenant, user, business, day) -
    // the UNIQUE constraint is the hard backstop behind the pre-check above.
    if (String(e?.message ?? '').includes('UNIQUE')) {
      throw new HTTPException(400, { message: `You've already shared with ${businessName} today - come back tomorrow.` });
    }
    throw e;
  }
}

/**
 * POST /splash/video/direct-upload — mints a Stream direct-upload session
 * bound to the caller. The client uploads raw bytes straight to the returned
 * uploadURL (never through this Worker); submit-video below re-checks
 * ownership of the resulting stream_uid before trusting it.
 */
export async function requestSplashVideoUpload(c: AppContext) {
  const tenant = c.get('tenant');
  const user = c.get('user');
  const kkauthUid = Number(user.sub);

  const config = await getSplashConfig(c.env, tenant.id);
  const { uid, uploadURL } = await createDirectUpload(c.env, config.max_video_seconds);
  await c.env.DB.prepare(
    'INSERT INTO splash_video_uploads (stream_uid, tenant_id, kkauth_uid) VALUES (?, ?, ?)'
  ).bind(uid, tenant.id, kkauthUid).run();

  return c.json({ data: { uid, upload_url: uploadURL } });
}

async function submitSplashVideo(c: AppContext) {
  const tenant = c.get('tenant');
  const user = c.get('user');
  const kkauthUid = Number(user.sub);

  const body = await c.req.json<{ business_id?: string; stream_uid?: string; caption?: string }>()
    .catch(() => ({} as { business_id?: string; stream_uid?: string; caption?: string }));
  const businessId = String(body.business_id ?? '').trim();
  const streamUid = String(body.stream_uid ?? '').trim();
  if (!businessId) throw new HTTPException(400, { message: 'Choose a business to share this with.' });
  if (!streamUid) throw new HTTPException(400, { message: 'No video upload found - try recording again.' });
  const caption = cleanText(body.caption, CAPTION_MAX);

  await checkSubmitRateLimit(c, kkauthUid);
  const config = await getSplashConfig(c.env, tenant.id);
  const { scanId, businessName, createdDay } = await checkSplashEligibility(c, tenant, kkauthUid, businessId);

  // The pending row proves THIS caller minted THIS stream_uid through us -
  // never trust a client-supplied uid without it (it could be any existing
  // video, including someone else's).
  const pending = await c.env.DB.prepare(
    'SELECT stream_uid FROM splash_video_uploads WHERE stream_uid = ? AND tenant_id = ? AND kkauth_uid = ?'
  ).bind(streamUid, tenant.id, kkauthUid).first<{ stream_uid: string }>();
  if (!pending) {
    throw new HTTPException(403, { message: 'This video upload does not belong to you.' });
  }

  const details = await getVideoDetails(c.env, streamUid).catch(() => null);
  if (!details || !details.readyToStream) {
    throw new HTTPException(400, { message: "That video isn't ready yet - wait a moment and try again." });
  }
  if (details.duration > config.max_video_seconds) {
    throw new HTTPException(400, { message: `Videos can be up to ${config.max_video_seconds} seconds - this one is longer.` });
  }

  try {
    const inserted = await c.env.DB.prepare(`
      INSERT INTO splash_submissions
        (tenant_id, kkauth_uid, business_id, business_name, media_type, stream_uid, duration_seconds, caption, scan_ref, created_day)
      VALUES (?, ?, ?, ?, 'video', ?, ?, ?, ?, ?)
      RETURNING id, business_id, business_name, media_type, caption, status, created_at
    `).bind(
      tenant.id, kkauthUid, businessId, businessName, streamUid, Math.round(details.duration), caption, scanId, createdDay
    ).first<any>();
    await c.env.DB.prepare('DELETE FROM splash_video_uploads WHERE stream_uid = ?').bind(streamUid).run();
    return c.json({ data: inserted }, 201);
  } catch (e: any) {
    if (String(e?.message ?? '').includes('UNIQUE')) {
      throw new HTTPException(400, { message: `You've already shared with ${businessName} today - come back tomorrow.` });
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
    SELECT id, business_id, business_name, media_type, duration_seconds, caption, status,
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

  const config = await getSplashConfig(c.env, tenant.id);
  const destroyAfter = Math.floor(Date.now() / 1000) + config.destroy_delay_days * 86400;
  const res = await c.env.DB.prepare(
    "UPDATE splash_submissions SET status = 'removed', destroy_after = ?, declined_at = unixepoch() WHERE id = ? AND tenant_id = ? AND kkauth_uid = ? AND status = 'submitted'"
  ).bind(destroyAfter, id, tenant.id, Number(user.sub)).run();

  if (res.meta.changes !== 1) {
    throw new HTTPException(404, { message: 'This can only be withdrawn before the business responds to it.' });
  }
  return c.json({ data: { id, status: 'removed', destroy_after: destroyAfter } });
}

/**
 * GET /splash/media/:id/view — owner or admin only. For a photo, mints a
 * 5-minute HMAC-signed URL for the raw-serving route below (raw R2 keys
 * never reach the client). For a video, mints a short-lived Stream signed
 * playback token and returns Stream's own iframe URL directly - Stream
 * serves the bytes itself, so there is no equivalent raw-serving route.
 */
export async function getSplashMediaView(c: AppContext) {
  const tenant = c.get('tenant');
  const user = c.get('user');
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id)) throw new HTTPException(400, { message: 'Invalid submission id' });

  const row = await c.env.DB.prepare(
    'SELECT kkauth_uid, media_type, image_key, image_watermarked_key, status, stream_uid FROM splash_submissions WHERE id = ? AND tenant_id = ?'
  ).bind(id, tenant.id).first<{ kkauth_uid: number; media_type: string; image_key: string | null; image_watermarked_key: string | null; status: string; stream_uid: string | null }>();
  if (!row) throw new HTTPException(404, { message: 'Submission not found' });
  const isOwner = Number(user.sub) === row.kkauth_uid;
  if (!isOwner && !user.is_admin) {
    throw new HTTPException(403, { message: 'Not your submission.' });
  }

  if (row.media_type === 'video') {
    if (!row.stream_uid) throw new HTTPException(404, { message: 'No video on this submission yet.' });
    const token = await mintSignedPlaybackToken(c.env, row.stream_uid, MEDIA_VIEW_TTL_SECONDS);
    return c.json({ data: { url: signedIframeUrl(c.env, token), type: 'video' } });
  }

  if (!row.image_key) throw new HTTPException(404, { message: 'No photo on this submission yet.' });
  // Owner sees their own submission clean, always, regardless of status.
  // Admin sees watermarked by default (same as the merchant currently
  // sees), with ?original=true as the explicit "view original" escape
  // hatch for real moderation work (Jim's call,
  // SOCIAL-SPLASH-WATERMARK-DESIGN.md).
  const wantsOriginal = c.req.query('original') === 'true';
  const variant: 'clean' | 'watermarked' =
    isOwner || wantsOriginal || !row.image_watermarked_key ? 'clean' : 'watermarked';
  const expiresAt = Math.floor(Date.now() / 1000) + MEDIA_VIEW_TTL_SECONDS;
  const sig = await hmacHex(c.env.SPLASH_MEDIA_SECRET, `${id}|${variant}|${expiresAt}`);
  const url = `/api/t/${tenant.id}/splash/media/${id}/raw?exp=${expiresAt}&variant=${variant}&sig=${sig}`;
  return c.json({ data: { url, type: 'image' } });
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
  const variant = c.req.query('variant') === 'watermarked' ? 'watermarked' : 'clean';
  const sig = c.req.query('sig') ?? '';
  if (!Number.isInteger(id) || !Number.isFinite(exp) || !sig) {
    throw new HTTPException(400, { message: 'Invalid media link' });
  }
  if (Math.floor(Date.now() / 1000) > exp) {
    throw new HTTPException(403, { message: 'This link has expired.' });
  }
  // The variant is part of what's signed, not a separate unchecked flag - a
  // caller can't request "clean" bytes by editing the query string, since
  // that would no longer match the signature minted for this link
  // (SOCIAL-SPLASH-WATERMARK-DESIGN.md).
  const expected = await hmacHex(c.env.SPLASH_MEDIA_SECRET, `${id}|${variant}|${exp}`);
  if (!timingSafeEqual(expected, sig)) {
    throw new HTTPException(403, { message: 'Invalid media link' });
  }

  const row = await c.env.DB.prepare(
    'SELECT image_key, image_watermarked_key FROM splash_submissions WHERE id = ? AND tenant_id = ?'
  ).bind(id, tenant.id).first<{ image_key: string | null; image_watermarked_key: string | null }>();
  if (!row?.image_key) throw new HTTPException(404, { message: 'Photo not found' });

  // Legacy fallback: a pre-watermark-feature row (or a row whose watermark
  // generation degraded gracefully) has no image_watermarked_key - serve
  // clean rather than 404, exactly today's behavior for those rows.
  const key = (variant === 'watermarked' && row.image_watermarked_key) ? row.image_watermarked_key : row.image_key;

  const upstream = await c.env.KKAUTH.fetch(new Request(`https://kkauth/internal/images/${key}`, {
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

// ─────────────────────────────────────────────────────────────────────────────
// Admin — remove with a required, owner-visible reason; mirrors fresh.ts's
// adminHideFreshStand contract. Removal is one-directional (no "unremove") -
// a removed submission proceeds through the same destroy_after/tombstone
// path as any decline or withdrawal; there is nothing to reverse once the
// legal-delay countdown has started. Admin can already view a submission's
// media via GET /splash/media/:id/view above (it allows an is_admin bypass
// of the owner check), so no separate admin media route is needed.
// ─────────────────────────────────────────────────────────────────────────────

/** GET /admin/splash — every submission, every state, newest first. */
export async function adminListSplash(c: AppContext) {
  requireAdmin(c);
  const tenant = c.get('tenant');

  const { results } = await c.env.DB.prepare(`
    SELECT s.*, u.email AS owner_email
    FROM splash_submissions s
    LEFT JOIN users u ON u.kkauth_uid = s.kkauth_uid AND u.tenant_id = s.tenant_id
    WHERE s.tenant_id = ?
    ORDER BY s.created_at DESC
    LIMIT 200
  `).bind(tenant.id).all<any>();

  return c.json({ data: results ?? [] });
}

/**
 * POST /admin/splash/:id/remove — { reason }. Reason is REQUIRED (400
 * without). Licensed content is retained forever (A.7/economics invariant)
 * so it cannot be removed this way - decline it through the normal merchant
 * flow instead if that ever needs revisiting, which this endpoint deliberately
 * does not touch.
 */
export async function adminRemoveSplash(c: AppContext) {
  requireAdmin(c);
  const user = c.get('user');
  const tenant = c.get('tenant');
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id)) throw new HTTPException(400, { message: 'Invalid submission id' });
  const body = await c.req.json<any>().catch(() => ({}));

  const existing = await c.env.DB.prepare(
    'SELECT id, status FROM splash_submissions WHERE id = ? AND tenant_id = ?'
  ).bind(id, tenant.id).first<{ id: number; status: string }>();
  if (!existing) throw new HTTPException(404, { message: 'Submission not found.' });
  if (existing.status === 'licensed') {
    throw new HTTPException(400, { message: 'Licensed content is retained and cannot be removed.' });
  }

  const reason = cleanText(body.reason, 500);
  if (!reason) throw new HTTPException(400, { message: 'A reason is required when removing a submission.' });

  const config = await getSplashConfig(c.env, tenant.id);
  const destroyAfter = Math.floor(Date.now() / 1000) + config.destroy_delay_days * 86400;
  await c.env.DB.prepare(`
    UPDATE splash_submissions
    SET status = 'removed', admin_removed_reason = ?, admin_removed_by = ?, destroy_after = ?, declined_at = unixepoch()
    WHERE id = ? AND tenant_id = ?
  `).bind(reason, Number(user.sub), destroyAfter, id, tenant.id).run();

  const row = await c.env.DB.prepare('SELECT * FROM splash_submissions WHERE id = ?').bind(id).first<any>();
  return c.json({ data: row });
}

/**
 * GET /admin/splash/config — the tunable defaults from Part B.1 (Increment 6
 * step 3a). Read-modify-write against tenants.config, same shape as
 * adminGetSponsorFeature/adminSetSponsorFeature.
 */
export async function adminGetSplashConfig(c: AppContext) {
  requireAdmin(c);
  const tenant = c.get('tenant');
  const config = await getSplashConfig(c.env, tenant.id);
  return c.json({ data: config });
}

const CONFIG_BOUNDS: Record<keyof SplashConfig, [number, number]> = {
  accept_award_k: [1, 1000],
  hold_days: [1, 90],
  offer_days: [1, 60],
  destroy_delay_days: [1, 30],
  max_video_seconds: [10, 300],
  fee_original_cents: [0, 5000],
};

/**
 * POST /admin/splash/config — any subset of SplashConfig's keys. Sane
 * min/max validated server-side (not just client-side), matching every
 * other admin write-path in this codebase. Fields not sent are left
 * unchanged. No values are shipped changed by this increment - this makes
 * them tunable without a redeploy, per the plan's step 3a note.
 */
export async function adminSetSplashConfig(c: AppContext) {
  requireAdmin(c);
  const tenant = c.get('tenant');
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));

  const patch: Partial<SplashConfig> = {};
  for (const key of Object.keys(CONFIG_BOUNDS) as Array<keyof SplashConfig>) {
    if (body[key] === undefined || body[key] === null) continue;
    const [min, max] = CONFIG_BOUNDS[key];
    const n = Math.floor(Number(body[key]));
    if (!Number.isFinite(n) || n < min || n > max) {
      throw new HTTPException(400, { message: `${key} must be between ${min} and ${max}.` });
    }
    patch[key] = n;
  }

  const merged = await setSplashConfig(c.env, tenant.id, patch);
  return c.json({ data: merged });
}
