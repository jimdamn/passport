import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { Env, KKAuthPayload, KKAuthProfile } from '../types';
import { nanoid } from 'nanoid';
import { hmacHex, timingSafeEqual } from '../lib/hmac';
import { recordGameAction } from '../lib/game';
import { sendClaimEmail } from '../lib/email';

type AppContext = Context<{ Bindings: Env }>;

// Web Crypto SHA-256 helper
async function sha256(message: string): Promise<string> {
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// Distance helper (Haversine formula) in kilometers
function getDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // Earth's radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * POST /api/t/:tenant/passport/scan
 * Handles scans from both registered users and parade street guests.
 */
export async function scanPlaque(c: AppContext) {
  const tenant = c.get('tenant');
  const body = await c.req.json<{
    plaque_id: string;
    lat?: number;
    lon?: number;
    sig?: string;
  }>().catch(() => ({} as any));

  const { plaque_id, lat, lon } = body;
  if (!plaque_id) throw new HTTPException(400, { message: 'plaque_id is required' });

  const sig = body.sig || c.req.query('sig');
  if (!sig) throw new HTTPException(400, { message: 'sig is required' });

  const expectedSig = await hmacHex(c.env.QR_SIGNING_SECRET, `/scan:${plaque_id}`);
  if (!timingSafeEqual(sig, expectedSig)) {
    throw new HTTPException(400, { message: 'Invalid signature' });
  }


  // 1. Fetch the plaque details
  const plaque = await c.env.DB.prepare(
    'SELECT * FROM passport_plaques WHERE id = ? AND tenant_id = ? AND is_active = 1'
  ).bind(plaque_id, tenant.id).first<any>();

  if (!plaque) {
    throw new HTTPException(404, { message: 'This location could not be found or is not active.' });
  }

  // 2. Geofence & Location Validation (Pillar 1: Geofenced Shield)
  // Device coordinates are required — the ScanPortal UI always sends them, so a
  // request without coords is a hand-crafted call trying to skip the geofence.
  if (
    typeof lat !== 'number' || typeof lon !== 'number' ||
    !isFinite(lat) || !isFinite(lon) ||
    Math.abs(lat) > 90 || Math.abs(lon) > 180
  ) {
    throw new HTTPException(400, {
      message: 'Location verification is required to collect stamps. Please enable location access and re-scan.',
    });
  }

  let locationVerified = true;

  // Primary gate: device GPS must be within 500 meters of the plaque
  const distanceMeters = getDistance(lat, lon, plaque.lat, plaque.lon) * 1000;
  if (distanceMeters > 500) {
    locationVerified = false;
  }

  // Secondary cross-check: Cloudflare edge geolocation (cf.latitude/longitude
  // are strings). IP geolocation on mobile carriers can be off by 100+ km, so
  // this only catches clearly-remote spoofing — the 500m device gate above is
  // the real check.
  const cfLat = parseFloat(String(c.req.raw.cf?.latitude ?? ''));
  const cfLon = parseFloat(String(c.req.raw.cf?.longitude ?? ''));
  if (!isNaN(cfLat) && !isNaN(cfLon)) {
    const edgeDistKm = getDistance(cfLat, cfLon, plaque.lat, plaque.lon);
    if (edgeDistKm > 300) {
      locationVerified = false;
    }
  }

  if (!locationVerified) {
    throw new HTTPException(403, {
      message: `Geofence check failed. To collect this stamp, you must physically visit ${plaque.location_name || 'the merchant station'}.`,
    });
  }

  // 3. Optional User Authentication check
  const authHeader = c.req.header('Authorization');
  let userId: number | null = null;
  let userEmail: string | null = null;
  let userDisplayName: string | null = null;

  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.replace('Bearer ', '').trim();
    try {
      const authRes = await c.env.KKAUTH.fetch(
        new Request('https://kkauth/internal/verify-token', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Internal-Secret': c.env.INTERNAL_SECRET
          },
          body: JSON.stringify({ token }),
        })
      );
      if (authRes.ok) {
        const authJson = await authRes.json<{ data: { payload: KKAuthPayload; profile: KKAuthProfile } }>();
        userId = Number(authJson.data.payload.sub);
        userEmail = authJson.data.payload.email;
        userDisplayName = authJson.data.payload.name ?? userEmail.split('@')[0];

        // Ensure user exists locally in D1
        const localUser = await c.env.DB.prepare(
          'SELECT kkauth_uid FROM users WHERE kkauth_uid = ? AND tenant_id = ?'
        ).bind(userId, tenant.id).first<any>();

        if (!localUser) {
          await c.env.DB.prepare(`
            INSERT INTO users (kkauth_uid, tenant_id, email, display_name, created_at, updated_at)
            VALUES (?, ?, ?, ?, unixepoch(), unixepoch())
          `).bind(userId, tenant.id, userEmail, userDisplayName).run();
        }
      }
    } catch {
      // If auth token is invalid, treat as guest scan to avoid breaking the parade scanner flow
    }
  }

  // 4. Cooldown Enforcement (Anti-Gaming Shield)
  const clientIp = c.req.header('CF-Connecting-IP') || 'unknown';
  if (userId) {
    // Authenticated cooldown check (24h per user per plaque)
    const lastScan = await c.env.DB.prepare(`
      SELECT created_at FROM passport_scans 
      WHERE user_id = ? AND plaque_id = ? 
      AND created_at > (unixepoch() - 86400)
      ORDER BY created_at DESC LIMIT 1
    `).bind(userId, plaque_id).first<{ created_at: number }>();

    if (lastScan) {
      throw new HTTPException(429, {
        message: `You've already scanned this location today! Head out to explore other landmarks around the community.`,
      });
    }
  } else {
    // Guest cooldown check (24h per IP per plaque)
    const lastScan = await c.env.DB.prepare(`
      SELECT created_at FROM passport_scans 
      WHERE guest_ip = ? AND plaque_id = ? 
      AND created_at > (unixepoch() - 86400)
      ORDER BY created_at DESC LIMIT 1
    `).bind(clientIp, plaque_id).first<{ created_at: number }>();

    if (lastScan) {
      throw new HTTPException(429, {
        message: `This station has already been scanned from your device today! Create an account to lock in your stamps or try scanning a different code.`,
      });
    }
  }

  // 5. Draw Probability-Weighted Prize from matrix
  const prizes = await c.env.DB.prepare(
    'SELECT * FROM passport_prizes WHERE tenant_id = ? AND is_active = 1'
  ).bind(tenant.id).all<{
    id: string;
    name: string;
    prize_type: string;
    value: number;
    details: string;
    probability: number;
    quantity_left: number;
  }>();

  // Probability rolling loop
  let rolledPrize = prizes.results.find(p => p.prize_type === 'kredits_base');
  const roll = Math.random();
  let cumulativeProb = 0;

  // We filter out prizes that have run out of stock
  const availablePrizes = prizes.results.filter(p => p.quantity_left !== 0);

  for (const prize of availablePrizes) {
    if (prize.prize_type === 'kredits_base') continue; // baseline is default fallback
    cumulativeProb += prize.probability;
    if (roll < cumulativeProb) {
      rolledPrize = prize;
      break;
    }
  }

  if (!rolledPrize) {
    throw new HTTPException(500, { message: 'Failed to draw prize. Please try again.' });
  }

  // Decrement stock atomically for limited prizes (quantity_left = -1 means
  // unlimited). The conditional WHERE closes the race where two concurrent
  // scans both claim the last unit and push stock to -1 (= unlimited).
  if (rolledPrize.quantity_left > 0) {
    const decr = await c.env.DB.prepare(
      'UPDATE passport_prizes SET quantity_left = quantity_left - 1 WHERE id = ? AND quantity_left > 0'
    ).bind(rolledPrize.id).run();

    if (decr.meta.changes === 0) {
      // Lost the race — fall back to the baseline prize
      const baseline = prizes.results.find(p => p.prize_type === 'kredits_base');
      if (!baseline) {
        throw new HTTPException(500, { message: 'Failed to draw prize. Please try again.' });
      }
      rolledPrize = baseline;
    }
  }

  const scanId = nanoid();

  // 6. Handle payouts instantly if logged in, or generate deferred claim token for guests
  if (userId) {
    // Append scan record immediately
    await c.env.DB.prepare(`
      INSERT INTO passport_scans (id, plaque_id, user_id, guest_ip, credits_won, created_at)
      VALUES (?, ?, ?, ?, ?, unixepoch())
    `).bind(scanId, plaque_id, userId, clientIp, rolledPrize.value).run();

    // Record game action in KKGame via recordGameAction helper
    const gameResult = await recordGameAction(c.env, {
      user_id: userId,
      action_id: 'passport_scan',
      source_app: 'passport',
      network_id: 'lake-and-locals',
      tenant_id: tenant.id,
      ref_type: 'plaque',
      ref_id: plaque_id,
    });

    const freshBalance = gameResult?.credits_balance ?? 0;
    const newBadges = gameResult?.new_badges ?? [];
    const xpAwarded = gameResult?.xp_awarded ?? {};

    // Community-rooted personalized response (Pillar 4: Rooted in Place)
    return c.json({
      data: {
        unlocked: true,
        scan_id: scanId,
        plaque: {
          name: plaque.name,
          location_name: plaque.location_name,
          category: plaque.category,
        },
        prize: {
          name: rolledPrize.name,
          prize_type: rolledPrize.prize_type,
          value: rolledPrize.value,
          details: rolledPrize.details,
        },
        user: {
          balance: freshBalance,
          new_badges: newBadges,
          xp_awarded: xpAwarded,
          processing: 'queued',
        },
        message: `Welcome, Explorer! You've successfully stamped your Passport at ${plaque.name}. Thank you for supporting local independent spots!`,
      },
    });
  } else {
    // GUEST SCAN — Issue Deferred Claim Token (Pillar 2 & 3: Deferred Account Flow)
    const rawClaimCode = `LL-${nanoid(8).toUpperCase()}`;
    const tokenHash = await sha256(rawClaimCode);
    const CLAIM_TTL_SECONDS = 7 * 86400; // 7 days expiration

    // Only the hash is stored — keeping the raw code in the same row would
    // defeat the point of hashing it.
    await c.env.DB.prepare(`
      INSERT INTO passport_claims (token_hash, tenant_id, plaque_id, prize_id, status, expires_at, created_at)
      VALUES (?, ?, ?, ?, 'pending', unixepoch() + ?, unixepoch())
    `).bind(tokenHash, tenant.id, plaque_id, rolledPrize.id, CLAIM_TTL_SECONDS).run();

    // Log the guest scan log
    await c.env.DB.prepare(`
      INSERT INTO passport_scans (id, plaque_id, user_id, guest_ip, credits_won, created_at)
      VALUES (?, ?, NULL, ?, ?, unixepoch())
    `).bind(scanId, plaque_id, clientIp, rolledPrize.value).run();

    return c.json({
      data: {
        unlocked: false,
        claim_token: rawClaimCode,
        scan_id: scanId,
        plaque: {
          name: plaque.name,
          location_name: plaque.location_name,
          category: plaque.category,
        },
        prize: {
          name: rolledPrize.name,
          prize_type: rolledPrize.prize_type,
          value: rolledPrize.value,
          details: rolledPrize.details,
        },
        message: `Awesome! You rolled a winning stamp at ${plaque.name}! Take a screenshot of this page or enter your details below to secure your ${rolledPrize.name} claim.`,
      },
    });
  }
}

/**
 * POST /api/t/:tenant/passport/claims/register
 * Links a guest's claim code to their contact info so we can dispatch claims links.
 */
export async function registerClaim(c: AppContext) {
  const tenant = c.get('tenant');
  const body = await c.req.json<{
    claim_code: string;
    contact_info: string; // phone or email
  }>().catch(() => ({} as any));

  const { claim_code, contact_info } = body;
  if (!claim_code || !contact_info) {
    throw new HTTPException(400, { message: 'claim_code and contact_info are required.' });
  }

  const tokenHash = await sha256(claim_code.trim());

  // Find pending claim
  const claim = await c.env.DB.prepare(`
    SELECT * FROM passport_claims 
    WHERE token_hash = ? AND tenant_id = ? AND status = 'pending' AND expires_at > unixepoch()
  `).bind(tokenHash, tenant.id).first<any>();

  if (!claim) {
    throw new HTTPException(404, { message: 'Claim code is invalid, already claimed, or expired.' });
  }

  // Update claim with contact info (passport_claims has no updated_at column)
  await c.env.DB.prepare(`
    UPDATE passport_claims
    SET contact_info = ?
    WHERE token_hash = ?
  `).bind(contact_info.trim(), tokenHash).run();

  // Email the guest their claim code directly via Resend (non-fatal on failure —
  // the code was already shown on screen at scan time).
  try {
    if (contact_info.includes('@') && c.env.RESEND_API_KEY) {
      const prize = await c.env.DB.prepare(
        'SELECT name FROM passport_prizes WHERE id = ?'
      ).bind(claim.prize_id).first<{ name: string }>();

      await sendClaimEmail({
        to: contact_info.trim(),
        claimCode: claim_code.trim(),
        prizeName: prize?.name ?? 'Your Passport Reward',
        brandName: tenant.config.brand_name || 'Lake & Locals',
        loginUrl: `https://${tenant.hostname}/auth/login`,
        resendApiKey: c.env.RESEND_API_KEY,
      });
    }
  } catch (err) {
    console.error('[registerClaim] Claim email failed:', err);
  }

  return c.json({
    data: {
      registered: true,
      message: `Success! We've locked in your win. An OTP claim confirmation has been queued for ${contact_info}.`,
    },
  });
}

/**
 * GET /api/t/:tenant/passport/stamps
 * Pulls stamps scanned by the logged-in user, and fetches their earned badges from KKCredits.
 */
export async function getStamps(c: AppContext) {
  const tenant = c.get('tenant');
  const user = c.get('user');
  const token = c.req.header('Authorization')?.replace('Bearer ', '').trim() ?? '';

  // 1. Get D1 stamps scan history
  const { results: scans } = await c.env.DB.prepare(`
    SELECT s.id as scan_id, s.credits_won, s.created_at,
           p.id as plaque_id, p.name, p.location_name, p.category
    FROM passport_scans s
    JOIN passport_plaques p ON s.plaque_id = p.id
    WHERE s.user_id = ? AND p.tenant_id = ?
    ORDER BY s.created_at DESC
  `).bind(Number(user.sub), tenant.id).all<any>();

  // 2. Fetch earned badges from KKCredits
  let badges: any[] = [];
  try {
    const badgesRes = await c.env.KKCREDITS.fetch(
      new Request(`https://kkcredits/badges/${parseInt(user.sub, 10)}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      })
    );
    if (badgesRes.ok) {
      const badgesJson = await badgesRes.json<{ data: any[] }>();
      badges = badgesJson.data;
    }
  } catch (err) {
    console.error('[getStamps] Failed to fetch user badges from KKCredits:', err);
  }

  return c.json({
    data: {
      scans,
      badges,
    },
  });
}

