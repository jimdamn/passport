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

type DrawnPrize = {
  id: string;
  name: string;
  prize_type: string;
  value: number;
  details: string;
  probability: number;
  quantity_left: number;
};

// Floor prize display value mirrors KKGame's passport_scan base_credits. The real
// KrowdKredits award is issued by KKGame; prize.value is shown to the user only.
const FLOOR_PRIZE_VALUE = 25;

// Every winning scan must award something. The probability matrix falls through to
// the kredits_base "floor" prize, so a tenant with no active floor prize would 500
// the scanner. Guarantee the invariant: return the active floor prize, lazily
// creating a deterministic one if it is missing. Creating a real row (rather than
// synthesizing an in-memory prize) keeps the passport_claims.prize_id foreign key
// valid — guest scans always insert a claim referencing this id.
async function ensureFloorPrize(env: Env, tenantId: string): Promise<DrawnPrize> {
  const existing = await env.DB.prepare(
    "SELECT id, name, prize_type, value, details, probability, quantity_left FROM passport_prizes WHERE tenant_id = ? AND prize_type = 'kredits_base' AND is_active = 1 LIMIT 1"
  ).bind(tenantId).first<DrawnPrize>();
  if (existing) return existing;

  const id = `kredits-base-${tenantId}`;
  await env.DB.prepare(
    `INSERT OR IGNORE INTO passport_prizes
       (id, tenant_id, name, prize_type, value, details, probability, quantity_left, is_active, is_paced)
     VALUES (?, ?, 'KrowdKredits', 'kredits_base', ?, NULL, 0, -1, 1, 0)`
  ).bind(id, tenantId, FLOOR_PRIZE_VALUE).run();

  return { id, name: 'KrowdKredits', prize_type: 'kredits_base', value: FLOOR_PRIZE_VALUE, details: '', probability: 0, quantity_left: -1 };
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
  // Event plaques (e.g. a QR on a t-shirt at a street event) are roving — they
  // skip the geofence entirely and instead honor an optional time window. The
  // QR signature and per-person cooldown still protect them.
  if (plaque.is_event) {
    const now = Math.floor(Date.now() / 1000);
    if (plaque.event_start && now < plaque.event_start) {
      throw new HTTPException(403, { message: `${plaque.name} hasn't started yet — come back soon!` });
    }
    if (plaque.event_end && now > plaque.event_end) {
      throw new HTTPException(403, { message: `${plaque.name} has ended. Thanks for playing — keep an eye out for the next one!` });
    }
  } else {
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

    // Home-based merchants use an 8 km radius; fixed-location plaques use 500 m.
    const geofenceRadius = plaque.skip_geofence ? 8000 : 500;
    const distanceMeters = getDistance(lat, lon, plaque.lat, plaque.lon) * 1000;
    if (distanceMeters > geofenceRadius) {
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

  const scanId = nanoid();

  // 5a. Paced prize drops take priority (event pacing): each unit of a paced
  // prize has a hidden random release time; the first eligible scan at/after
  // it wins. The conditional UPDATE makes the claim atomic under concurrency.
  let rolledPrize: DrawnPrize | undefined;

  const maturedDrop = await c.env.DB.prepare(`
    SELECT d.id AS drop_id, p.id, p.name, p.prize_type, p.value, p.details, p.probability, p.quantity_left
    FROM passport_prize_drops d
    JOIN passport_prizes p ON p.id = d.prize_id
    WHERE p.tenant_id = ? AND p.is_active = 1 AND p.is_paced = 1
      AND (p.plaque_id IS NULL OR p.plaque_id = ?)
      AND d.drop_at <= unixepoch() AND d.won_scan_id IS NULL
    ORDER BY d.drop_at ASC
    LIMIT 1
  `).bind(tenant.id, plaque_id).first<any>();

  if (maturedDrop) {
    const claimed = await c.env.DB.prepare(
      'UPDATE passport_prize_drops SET won_scan_id = ? WHERE id = ? AND won_scan_id IS NULL'
    ).bind(scanId, maturedDrop.drop_id).run();
    if (claimed.meta.changes === 1) {
      await c.env.DB.prepare(
        'UPDATE passport_prizes SET quantity_left = quantity_left - 1 WHERE id = ? AND quantity_left > 0'
      ).bind(maturedDrop.id).run();
      const { drop_id: _dropId, ...prize } = maturedDrop;
      rolledPrize = prize;
    }
  }

  // 5b. Otherwise, draw a probability-weighted prize from the matrix.
  // Prizes scoped to a plaque (plaque_id set) only appear at that plaque.
  const prizes = await c.env.DB.prepare(
    'SELECT * FROM passport_prizes WHERE tenant_id = ? AND is_active = 1 AND is_paced = 0 AND (plaque_id IS NULL OR plaque_id = ?)'
  ).bind(tenant.id, plaque_id).all<{
    id: string;
    name: string;
    prize_type: string;
    value: number;
    details: string;
    probability: number;
    quantity_left: number;
  }>();

  if (!rolledPrize) {
    const roll = Math.random();
    let cumulativeProb = 0;

    // Out-of-stock prizes (quantity_left === 0) are excluded; the kredits_base
    // floor is handled separately below, never in the weighted roll.
    const availablePrizes = prizes.results.filter(p => p.quantity_left !== 0);

    let upgraded: DrawnPrize | undefined;
    for (const prize of availablePrizes) {
      if (prize.prize_type === 'kredits_base') continue; // floor is the default fallback
      cumulativeProb += prize.probability;
      if (roll < cumulativeProb) {
        upgraded = prize;
        break;
      }
    }

    // Decrement stock atomically for a limited upgraded prize (quantity_left = -1
    // means unlimited). The conditional WHERE closes the race where two concurrent
    // scans both claim the last unit; the loser drops to the floor prize.
    if (upgraded && upgraded.quantity_left > 0) {
      const decr = await c.env.DB.prepare(
        'UPDATE passport_prizes SET quantity_left = quantity_left - 1 WHERE id = ? AND quantity_left > 0'
      ).bind(upgraded.id).run();
      if (decr.meta.changes === 0) upgraded = undefined;
    }

    // Guaranteed floor: every winning scan awards something, so a missing or
    // depleted upgraded prize never 500s the scanner.
    rolledPrize = upgraded ?? await ensureFloorPrize(c.env, tenant.id);
  }

  // 6. Handle payouts instantly if logged in, or generate deferred claim token for guests
  if (userId) {
    // Append scan record immediately
    await c.env.DB.prepare(`
      INSERT INTO passport_scans (id, plaque_id, user_id, guest_ip, credits_won, created_at)
      VALUES (?, ?, ?, ?, ?, unixepoch())
    `).bind(scanId, plaque_id, userId, clientIp, rolledPrize.value).run();

    // Physical prizes (cash, coupons, gifts) need a claim code even for
    // logged-in users — it's what they show at redemption time.
    let memberClaimCode: string | null = null;
    if (!rolledPrize.prize_type.startsWith('kredits')) {
      memberClaimCode = `LL-${nanoid(8).toUpperCase()}`;
      const memberTokenHash = await sha256(memberClaimCode);
      await c.env.DB.prepare(`
        INSERT INTO passport_claims (token_hash, tenant_id, plaque_id, prize_id, scan_id, contact_info, status, expires_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, 'pending', unixepoch() + ?, unixepoch())
      `).bind(memberTokenHash, tenant.id, plaque_id, rolledPrize.id, scanId, userEmail, 7 * 86400).run();
    }

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
          claim_token: memberClaimCode,
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
      INSERT INTO passport_claims (token_hash, tenant_id, plaque_id, prize_id, scan_id, status, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?, 'pending', unixepoch() + ?, unixepoch())
    `).bind(tokenHash, tenant.id, plaque_id, rolledPrize.id, scanId, CLAIM_TTL_SECONDS).run();

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

  const tokenHash = await sha256(claim_code.trim().toUpperCase());

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

  const emailed = contact_info.includes('@');
  return c.json({
    data: {
      registered: true,
      emailed,
      message: emailed
        ? `Done! We emailed your claim code to ${contact_info}.`
        : `Done! Your win is saved under ${contact_info}.`,
    },
  });
}

/**
 * POST /api/t/:tenant/passport/claims/attach  (requires auth)
 * Deposits a guest claim into the signed-in user's account:
 * - kredits prizes → credits/badges awarded, claim closed, stamp moved into their passport
 * - physical prizes → claim linked to their email; still redeemed in person via the code
 */
export async function attachClaim(c: AppContext) {
  const tenant = c.get('tenant');
  const user = c.get('user') as { sub: string; email: string };
  const body = await c.req.json<{ claim_code: string }>().catch(() => ({} as any));

  if (!body.claim_code) {
    throw new HTTPException(400, { message: 'claim_code is required.' });
  }

  const tokenHash = await sha256(body.claim_code.trim().toUpperCase());
  const claim = await c.env.DB.prepare(`
    SELECT cl.*, p.name AS prize_name, p.prize_type, p.value AS prize_value, p.details AS prize_details
    FROM passport_claims cl
    JOIN passport_prizes p ON p.id = cl.prize_id
    WHERE cl.token_hash = ? AND cl.tenant_id = ?
  `).bind(tokenHash, tenant.id).first<any>();

  if (!claim) {
    throw new HTTPException(404, { message: "That claim code doesn't match anything — double-check it and try again." });
  }
  if (claim.status === 'claimed') {
    throw new HTTPException(409, { message: 'This claim code has already been used.' });
  }
  if (claim.expires_at <= Math.floor(Date.now() / 1000)) {
    throw new HTTPException(409, { message: 'This claim code has expired.' });
  }

  const userId = Number(user.sub);
  const isKredits = claim.prize_type.startsWith('kredits');

  // Move the original guest scan into the user's passport so the stamp shows
  // up in their history and the per-plaque cooldown follows them.
  if (claim.scan_id) {
    await c.env.DB.prepare(
      'UPDATE passport_scans SET user_id = ? WHERE id = ? AND user_id IS NULL'
    ).bind(userId, claim.scan_id).run();
  }

  if (isKredits) {
    // Close the claim atomically so the same code can't be deposited twice.
    const closed = await c.env.DB.prepare(`
      UPDATE passport_claims SET status = 'claimed', contact_info = ?
      WHERE token_hash = ? AND status = 'pending' AND expires_at > unixepoch()
    `).bind(user.email, tokenHash).run();
    if (closed.meta.changes === 0) {
      throw new HTTPException(409, { message: 'This claim code has already been used or expired.' });
    }

    const gameResult = await recordGameAction(c.env, {
      user_id: userId,
      action_id: 'passport_scan',
      source_app: 'passport',
      network_id: 'lake-and-locals',
      tenant_id: tenant.id,
      ref_type: 'plaque',
      ref_id: claim.plaque_id,
    });

    return c.json({
      data: {
        deposited: true,
        prize: { name: claim.prize_name, prize_type: claim.prize_type, value: claim.prize_value },
        user: {
          balance: gameResult?.credits_balance ?? 0,
          new_badges: gameResult?.new_badges ?? [],
        },
        message: `Deposited! ${claim.prize_name} is now in your account, and the stamp is in your passport.`,
      },
    });
  }

  // Physical prize: link it to this account (email becomes the contact on the
  // claim) but keep it pending — it's redeemed in person with the code.
  await c.env.DB.prepare(`
    UPDATE passport_claims SET contact_info = ?
    WHERE token_hash = ? AND status = 'pending'
  `).bind(user.email, tokenHash).run();

  return c.json({
    data: {
      deposited: false,
      linked: true,
      prize: { name: claim.prize_name, prize_type: claim.prize_type, value: claim.prize_value },
      message: `${claim.prize_name} is now linked to your account. Show your claim code in person to collect it.`,
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

