/**
 * Auth router — KKAuth adapter
 *
 * The Exchange no longer owns auth. All identity operations (OTP, SSO, token
 * issuance, refresh) are delegated to KKAuth via Service Binding. This router
 * is a thin adapter that:
 *
 *   1. Forwards OTP and SSO requests to KKAuth
 *   2. On successful auth, finds or creates the Exchange user record (tenant-scoped)
 *   3. Awards welcome/upgrade credits via KKCredits for new users
 *   4. Returns the KKAuth access_token + Exchange user data to the browser
 *
 * Refresh token cookies are proxied transparently — KKAuth sets and rotates them;
 * the Exchange forwards the Set-Cookie header so the browser stays in sync.
 *
 * The /me and /me (PUT) endpoints stay in the Exchange because they return and
 * update Exchange-specific profile data (trade_count, rating_avg, location, etc.)
 */

import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { Env, KKAuthPayload, KKAuthProfile } from '../types';
import { awardCredits, fetchBalance } from '../lib/credits';
import { hmacHex } from '../lib/hmac';
import { generateQrSvg } from '../lib/qr';

export const authRouter = new Hono<{ Bindings: Env }>();

// ─────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────

/**
 * Rewrite the Set-Cookie header that comes back from KKAuth so it is correct
 * for the Exchange domain (exchange.lakeandlocals.com).
 *
 * KKAuth uses SameSite=None because it supports direct cross-origin calls.
 * When the cookie is forwarded through the Exchange (same-site from the
 * browser's perspective), SameSite=Lax is correct and more secure.
 * Path is normalised to / so logout can clear it reliably.
 */
function rewriteCookie(setCookie: string): string {
  return setCookie.replace(/;\s*Path=[^;]*/gi, '; Path=/');
}

/**
 * Forward the visitor's real IP to KKAuth. Service-binding requests carry no
 * CF-Connecting-IP, so without this header KKAuth's per-IP brute-force
 * throttle would put every visitor in one shared bucket. Omitted entirely
 * (never sent empty) when the edge IP is unavailable.
 */
function clientIpHeader(c: { req: { header: (name: string) => string | undefined } }): Record<string, string> {
  const ip = c.req.header('CF-Connecting-IP');
  return ip ? { 'X-Forwarded-For': ip } : {};
}

/** Verify a token via KKAuth Service Binding and return the payload. */
async function verifyToken(token: string, env: Env): Promise<KKAuthPayload> {
  // Service Binding call — stays within Cloudflare network; scheme is ignored by runtime.
  const res = await env.KKAUTH.fetch(
    new Request('https://kkauth/internal/verify-token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Secret': env.INTERNAL_SECRET,
      },
      body: JSON.stringify({ token }),
    })
  );
  if (!res.ok) {
    const body = await res.json<{ error?: string }>().catch(() => ({} as { error?: string }));
    throw new HTTPException(401, { message: body.error ?? 'Invalid or expired token' });
  }
  const json = await res.json<{ data: { payload: KKAuthPayload } }>();
  return json.data.payload;
}

/**
 * Same as verifyToken but also returns the KKAuth profile (avatar_url, home_zip_*).
 * Used in GET /me so location fields are included in the response without an extra round-trip.
 */
async function verifyTokenFull(
  token: string,
  env: Env
): Promise<{ payload: KKAuthPayload; profile: KKAuthProfile }> {
  const res = await env.KKAUTH.fetch(
    new Request('https://kkauth/internal/verify-token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Secret': env.INTERNAL_SECRET,
      },
      body: JSON.stringify({ token }),
    })
  );
  if (!res.ok) {
    const body = await res.json<{ error?: string }>().catch(() => ({} as { error?: string }));
    throw new HTTPException(401, { message: body.error ?? 'Invalid or expired token' });
  }
  const json = await res.json<{ data: { payload: KKAuthPayload; profile: KKAuthProfile } }>();
  const profile: KKAuthProfile = json.data.profile ?? {
    avatar_url: null,
    home_zip_location: null,
    home_zip_lat: null,
    home_zip_lon: null,
    home_distance_preference: null,
  };
  return { payload: json.data.payload, profile };
}

/**
 * Find or create a Passport user for a given (kkauth_user_id, tenant_id).
 * Awards welcome credits on first login if configured.
 * Returns the Passport user row.
 */
async function findOrCreateUser(
  kkAuthUserId: number,
  tenantId: string,
  email: string,
  displayName: string,
  bdUid: string | null,
  bdMemberSince: number | null,
  env: Env
): Promise<any> {
  let user = await env.DB.prepare(
    'SELECT * FROM users WHERE kkauth_uid = ? AND tenant_id = ?'
  ).bind(kkAuthUserId, tenantId).first<any>();

  if (!user) {
    // New user — create Passport record
    const name = displayName || email.split('@')[0];
    await env.DB.prepare(`
      INSERT INTO users
        (kkauth_uid, tenant_id, bd_uid, email, display_name, bd_member_since, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 1, unixepoch(), unixepoch())
    `).bind(kkAuthUserId, tenantId, bdUid, email, name, bdMemberSince).run();

    user = await env.DB.prepare(
      'SELECT * FROM users WHERE kkauth_uid = ? AND tenant_id = ?'
    ).bind(kkAuthUserId, tenantId).first<any>();
  }

  if (user) await awardWelcomeCredits(user, tenantId, env);

  return user;
}

/**
 * Award the welcome bonus if it has not landed yet. Retried on every login and
 * every /me call until delivered, so a KKCredits outage at signup can never
 * permanently cost a user their bonus. The ('welcome', kkauth_uid) ref is
 * shared with the Exchange, so KKCredits dedupes across apps: one welcome bonus
 * per identity, never two. Mutates user.welcome_credited on success.
 */
async function awardWelcomeCredits(user: any, tenantId: string, env: Env): Promise<void> {
  if (!user || user.welcome_credited) return;

  const kkAuthUserId = user.kkauth_uid;
  try {
    const tenantRow = await env.DB.prepare(
      'SELECT config FROM tenants WHERE id = ?'
    ).bind(tenantId).first<any>();
    const welcomeCredits = JSON.parse(tenantRow?.config || '{}').welcome_credits ?? 0;

    if (welcomeCredits > 0) {
      await awardCredits(
        env, tenantId, String(kkAuthUserId),
        welcomeCredits,
        'Welcome bonus',
        'welcome', String(kkAuthUserId)
      );
    }
    await env.DB.prepare(
      'UPDATE users SET welcome_credited = 1, updated_at = unixepoch() WHERE kkauth_uid = ? AND tenant_id = ?'
    ).bind(kkAuthUserId, tenantId).run();
    user.welcome_credited = 1;
  } catch (err) {
    // Credit award failure must not block login — flag stays 0 for retry.
    console.error('[awardWelcomeCredits] welcome credits failed:', err instanceof Error ? err.message : err);
  }
}

/** Shape the public user object returned to the browser. */
function publicUser(user: any, profile?: KKAuthProfile, adminEmails?: string) {
  // For shared identity fields (display_name, location, bio), KKAuth is the
  // source of truth across all apps. If KKAuth's profile includes them (returned
  // by verifyTokenFull), prefer those over Exchange D1 so changes made in
  // apps-hub or other KrowdKraft apps are reflected here immediately.
  const admins = adminEmails ?? 'gottabuylocal@gmail.com';
  const is_admin = admins.split(',').map(e => e.trim().toLowerCase()).includes(user.email.toLowerCase());
  return {
    id: user.kkauth_uid,
    email: user.email,
    display_name: profile?.display_name ?? user.display_name,
    avatar_url: profile?.avatar_url ?? user.avatar_url ?? null,
    bio: profile?.bio ?? user.bio ?? null,
    location: profile?.location ?? user.location ?? null,
    bd_member_since: user.bd_member_since ?? null,
    home_zip_location: profile?.home_zip_location ?? null,
    home_zip_lat: profile?.home_zip_lat ?? null,
    home_zip_lon: profile?.home_zip_lon ?? null,
    home_distance_preference: profile?.home_distance_preference ?? null,
    is_admin,
  };
}

// ─────────────────────────────────────────────────────────────
// POST /api/auth/otp/request — forward to KKAuth
// ─────────────────────────────────────────────────────────────
authRouter.post('/otp/request', async (c) => {
  const body = await c.req.json<{ email: string; tenant_id?: string; display_name?: string; location?: string }>();
  const { email } = body;

  if (!email) throw new HTTPException(400, { message: 'email is required' });

  // Forward just the email to KKAuth — KKAuth handles rate limiting and delivery
  let res: Response;
  try {
    res = await c.env.KKAUTH.fetch(
      new Request('https://kkauth/otp/request', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Service-binding requests carry no CF-Connecting-IP, so KKAuth's
          // per-IP throttle would lump all visitors into one bucket without this.
          ...clientIpHeader(c),
        },
        body: JSON.stringify({ email }),
      })
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[auth/otp/request] KKAUTH binding error:', msg);
    throw new HTTPException(503, { message: `Auth service unavailable: ${msg}` });
  }

  const kkBody = await res.json<any>();
  return c.json(kkBody, res.status as any);
});

// ─────────────────────────────────────────────────────────────
// POST /api/auth/otp/verify — forward to KKAuth, enrich with Exchange user
// ─────────────────────────────────────────────────────────────
authRouter.post('/otp/verify', async (c) => {
  const body = await c.req.json<{
    email: string;
    otp: string;
    tenant_id: string;
    display_name?: string;
    location?: string;
  }>();

  const { email, otp, tenant_id, display_name, location } = body;
  if (!email || !otp || !tenant_id) {
    throw new HTTPException(400, { message: 'email, otp, and tenant_id are required' });
  }

  // Verify tenant exists
  const tenantRow = await c.env.DB.prepare(
    'SELECT id FROM tenants WHERE id = ? AND is_active = 1'
  ).bind(tenant_id).first<any>();
  if (!tenantRow) throw new HTTPException(404, { message: 'Tenant not found' });

  // Forward OTP verify to KKAuth — Exchange adds the app_key the browser doesn't have
  let res: Response;
  try {
    res = await c.env.KKAUTH.fetch(
      new Request('https://kkauth/otp/verify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...clientIpHeader(c),
        },
        body: JSON.stringify({ email, otp, app_key: c.env.KKAUTH_APP_KEY }),
      })
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[auth/otp/verify] KKAUTH binding error:', msg);
    throw new HTTPException(503, { message: `Auth service unavailable: ${msg}` });
  }

  if (!res.ok) {
    const kkBody = await res.json<any>();
    return c.json(kkBody, res.status as any);
  }

  const kkJson = await res.json<{ data: { access_token: string; is_new: boolean; user: { id: number } } }>();
  const { access_token, is_new } = kkJson.data;

  // Decode payload to get KKAuth user_id and name
  const payload = await verifyToken(access_token, c.env);

  // Determine display name: body > KKAuth name > email prefix
  const resolvedName = display_name?.trim() || payload.name || email.split('@')[0];

  // Find or create Exchange user
  let user = await findOrCreateUser(
    Number(payload.sub), tenant_id, email, resolvedName, null, null, c.env
  );

  // Update location if provided and user is new or location not set
  if (location && (!user.location)) {
    await c.env.DB.prepare(
      'UPDATE users SET location = ?, updated_at = unixepoch() WHERE kkauth_uid = ? AND tenant_id = ?'
    ).bind(location, Number(payload.sub), tenant_id).run();
    user = await c.env.DB.prepare(
      'SELECT * FROM users WHERE kkauth_uid = ? AND tenant_id = ?'
    ).bind(Number(payload.sub), tenant_id).first<any>();
  }

  // Forward KKAuth's Set-Cookie (refresh token) to the browser, rewritten
  // for the Exchange domain (SameSite=Lax, Path=/).
  const setCookie = res.headers.get('Set-Cookie');
  if (setCookie) c.header('Set-Cookie', rewriteCookie(setCookie));

  return c.json({
    data: {
      access_token,
      is_new,
      user: publicUser(user, undefined, c.env.ADMIN_EMAILS),
    },
  });
});

// ─────────────────────────────────────────────────────────────
// POST /api/auth/sso — BD SSO via KKAuth
// ─────────────────────────────────────────────────────────────
authRouter.post('/sso', async (c) => {
  const body = await c.req.json<{
    uid: string;
    ts: string;
    email: string;
    sig: string;
    tenant_id: string;
    display_name?: string;
    avatar_url?: string;
    bd_member_since?: number;
  }>();

  const { uid, ts, email, sig, tenant_id, display_name, avatar_url, bd_member_since } = body;

  if (!uid || !ts || !email || !sig || !tenant_id) {
    throw new HTTPException(400, { message: 'Missing required SSO parameters' });
  }

  // Verify tenant exists
  const tenantRow = await c.env.DB.prepare(
    'SELECT id FROM tenants WHERE id = ? AND is_active = 1'
  ).bind(tenant_id).first<any>();
  if (!tenantRow) throw new HTTPException(404, { message: 'Tenant not found' });

  // Delegate SSO verification and token issuance to KKAuth
  const res = await c.env.KKAUTH.fetch(
    new Request('https://kkauth/sso/bd', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uid, ts, email, sig, display_name, avatar_url, bd_member_since }),
    })
  );

  if (!res.ok) {
    const kkBody = await res.json<any>();
    return c.json(kkBody, res.status as any);
  }

  const kkJson = await res.json<{ data: { access_token: string; is_new: boolean } }>();
  const { access_token } = kkJson.data;

  const payload = await verifyToken(access_token, c.env);
  const resolvedName = display_name || payload.name || email.split('@')[0];

  // Find or create Exchange user; link bd_uid and bd_member_since
  let user = await findOrCreateUser(
    Number(payload.sub), tenant_id, email, resolvedName, uid, bd_member_since ?? null, c.env
  );

  // Update BD fields if user already existed
  if (user.bd_uid !== uid) {
    await c.env.DB.prepare(
      'UPDATE users SET bd_uid = ?, bd_member_since = ?, avatar_url = COALESCE(?, avatar_url), updated_at = unixepoch() WHERE kkauth_uid = ? AND tenant_id = ?'
    ).bind(uid, bd_member_since ?? null, avatar_url ?? null, Number(payload.sub), tenant_id).run();
    user = await c.env.DB.prepare(
      'SELECT * FROM users WHERE kkauth_uid = ? AND tenant_id = ?'
    ).bind(Number(payload.sub), tenant_id).first<any>();
  }

  // Forward KKAuth's Set-Cookie to the browser, rewritten for the Exchange domain.
  const setCookie = res.headers.get('Set-Cookie');
  if (setCookie) c.header('Set-Cookie', rewriteCookie(setCookie));

  return c.json({
    data: {
      access_token,
      user: publicUser(user, undefined, c.env.ADMIN_EMAILS),
    },
  });
});

// ─────────────────────────────────────────────────────────────
// POST /api/auth/refresh — proxy to KKAuth, rotate cookie
// ─────────────────────────────────────────────────────────────
authRouter.post('/refresh', async (c) => {
  // Forward the refresh cookie to KKAuth so it can rotate the token
  const cookieHeader = c.req.header('Cookie') ?? '';

  // No refresh cookie at all: an anonymous visitor probing for a session.
  // Answer 200 with data:null instead of 401 so the browser console stays
  // clean on every anonymous page load (browsers print all 4xx responses).
  if (!/(?:^|;\s*)kkauth_refresh=/.test(cookieHeader)) {
    return c.json({ data: null });
  }

  const res = await c.env.KKAUTH.fetch(
    new Request('https://kkauth/otp/refresh', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': cookieHeader,
        ...clientIpHeader(c),
      },
      body: JSON.stringify({}),
    })
  );

  if (!res.ok) {
    // Dead or expired session reads as "no session", not an error - same
    // clean-console reasoning as the missing-cookie case above. Real
    // failures (KKAuth 5xx) still surface as errors.
    if (res.status === 401 || res.status === 403) {
      return c.json({ data: null });
    }
    const kkBody = await res.json<any>();
    return c.json(kkBody, res.status as any);
  }

  // KKAuth returns refresh_token in the body because service binding
  // Set-Cookie headers are not reliably forwarded. Set the cookie manually.
  const kkJson = await res.json<{ data: { access_token: string; refresh_token?: string; user: any } }>();
  const { access_token, refresh_token: newRefreshToken } = kkJson.data;

  const payload = await verifyToken(access_token, c.env);

  if (newRefreshToken) {
    const domainAttr = c.env.COOKIE_DOMAIN ? `; Domain=${c.env.COOKIE_DOMAIN}` : '';
    c.header(
      'Set-Cookie',
      'kkauth_refresh=' + newRefreshToken +
        `; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=2592000${domainAttr}`
    );
  }

  return c.json({
    data: {
      access_token,
      user: {
        id: payload.sub,
        email: payload.email,
        display_name: payload.name ?? payload.email?.split('@')[0] ?? '',
        bd_member: payload.bd_member,
      },
    },
  });
});

// ─────────────────────────────────────────────────────────────
// GET /api/auth/me — Exchange profile (tenant-scoped)
// Includes KKAuth profile fields (location, avatar) so the frontend always
// sees the latest shared data alongside the Exchange-specific fields.
// ─────────────────────────────────────────────────────────────
authRouter.get('/me', async (c) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader) throw new HTTPException(401, { message: 'Authorization required' });

  const tenantId = c.req.query('tenant_id');
  if (!tenantId) throw new HTTPException(400, { message: 'tenant_id query param is required' });

  // Call KKAuth GET /me directly — the same call kk-apps-hub makes.
  // Single round-trip that both verifies the token and returns the full
  // authoritative profile: display_name, location, bio, avatar, zip, distance.
  const kkRes = await c.env.KKAUTH.fetch(
    new Request('https://kkauth/me', {
      headers: { 'Authorization': authHeader },
    })
  );

  if (!kkRes.ok) throw new HTTPException(401, { message: 'Invalid or expired token' });

  const kkJson = await kkRes.json<{ data: any }>();
  const kk = kkJson.data;
  if (!kk?.id) throw new HTTPException(401, { message: 'Invalid auth response from KKAuth' });

  // Fetch Exchange-specific fields from D1 (credits, trades, ratings, bd_*)
  let user = await c.env.DB.prepare(
    'SELECT * FROM users WHERE kkauth_uid = ? AND tenant_id = ? AND is_active = 1'
  ).bind(Number(kk.id), tenantId).first<any>();

  if (!user) {
    user = await findOrCreateUser(
      Number(kk.id),
      tenantId,
      kk.email,
      kk.display_name || kk.email.split('@')[0],
      kk.bd_uid ?? null,
      kk.bd_member_since ?? null,
      c.env
    );
  } else {
    // Existing user whose welcome bonus never landed (e.g. KKCredits was down
    // at signup, or they signed in via kk-login which skips findOrCreateUser).
    await awardWelcomeCredits(user, tenantId, c.env);
  }

  // Keep D1 cache in sync so offer/trade join queries stay accurate.
  const syncFields: string[] = [];
  const syncBinds: any[]     = [];

  if (kk.display_name && kk.display_name !== user.display_name) {
    syncFields.push('display_name = ?'); syncBinds.push(kk.display_name);
  }
  if (kk.location !== undefined && kk.location !== user.location) {
    syncFields.push('location = ?'); syncBinds.push(kk.location || null);
  }
  if (kk.bio !== undefined && kk.bio !== user.bio) {
    syncFields.push('bio = ?'); syncBinds.push(kk.bio || null);
  }

  if (syncFields.length > 0) {
    syncFields.push('updated_at = unixepoch()');
    syncBinds.push(Number(kk.id), tenantId);
    await c.env.DB.prepare(
      `UPDATE users SET ${syncFields.join(', ')} WHERE kkauth_uid = ? AND tenant_id = ?`
    ).bind(...syncBinds).run();
  }

  // Fetch live balance from KKCredits — it is the authoritative ledger.
  const liveBalance = await fetchBalance(c.env, String(kk.id), authHeader.replace('Bearer ', '').trim());
  const credits_balance = liveBalance ?? 0;

  return c.json({
    data: {
      user: {
        id:                       user.id,
        email:                    kk.email            ?? user.email,
        display_name:             kk.display_name     ?? user.display_name,
        avatar_url:               kk.avatar_url       ?? user.avatar_url       ?? null,
        bio:                      kk.bio              ?? user.bio              ?? null,
        location:                 kk.location         ?? user.location         ?? null,
        home_zip_location:        kk.home_zip_location        ?? null,
        home_zip_lat:             kk.home_zip_lat             ?? null,
        home_zip_lon:             kk.home_zip_lon             ?? null,
        home_distance_preference: kk.home_distance_preference ?? null,
        credits_balance,
        bd_member_since:          user.bd_member_since ?? null,
        is_admin:                 (c.env.ADMIN_EMAILS ?? 'gottabuylocal@gmail.com').split(',').map(e => e.trim().toLowerCase()).includes((kk.email ?? user.email).toLowerCase()),
        active_persona:           kk.active_persona           ?? 'anonymous',
        business_id:              kk.business_id              ?? null,
        business_status:          kk.business_status          ?? null,
        business_name:            kk.business_name            ?? null,
      },
    },
  });
});

// ─────────────────────────────────────────────────────────────
// PUT /api/auth/me — update Exchange profile fields
// ─────────────────────────────────────────────────────────────
authRouter.put('/me', async (c) => {
  const authHeader = c.req.header('Authorization');
  const token = authHeader?.replace('Bearer ', '').trim();
  if (!token) throw new HTTPException(401, { message: 'Authorization required' });

  let payload: KKAuthPayload;
  try {
    payload = await verifyToken(token, c.env);
  } catch {
    throw new HTTPException(401, { message: 'Invalid or expired token' });
  }

  const tenantId = c.req.query('tenant_id');
  if (!tenantId) throw new HTTPException(400, { message: 'tenant_id query param is required' });

  const body = await c.req.json<{ display_name?: string; location?: string; bio?: string }>();

  if (body.display_name !== undefined) {
    const name = body.display_name.trim();
    if (name.length === 0) throw new HTTPException(400, { message: 'Display name cannot be empty' });
    if (name.length > 50) throw new HTTPException(400, { message: 'Display name must be 50 characters or fewer' });
    body.display_name = name;
  }
  if (body.bio !== undefined && body.bio.length > 300) {
    throw new HTTPException(400, { message: 'Bio must be 300 characters or fewer' });
  }
  if (body.location !== undefined && body.location.length > 100) {
    throw new HTTPException(400, { message: 'Location must be 100 characters or fewer' });
  }

  if (Object.keys(body).length === 0) throw new HTTPException(400, { message: 'No fields provided to update' });

  // KKAuth is the source of truth for all shared identity fields.
  // Write there first — if it fails, we don't touch Exchange D1.
  const kkRes = await c.env.KKAUTH.fetch(
    new Request('https://kkauth/me', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': authHeader ?? '',
      },
      body: JSON.stringify(body),
    })
  );

  if (!kkRes.ok) {
    const kkBody = await kkRes.json<any>();
    return c.json(kkBody, kkRes.status as any);
  }

  // Mirror to Exchange D1 so offer/trade queries can join display_name,
  // location, and bio without a round-trip to KKAuth on every request.
  const cacheFields: string[] = [];
  const cacheBinds: any[]     = [];

  if (body.display_name !== undefined) { cacheFields.push('display_name = ?'); cacheBinds.push(body.display_name); }
  if (body.location     !== undefined) { cacheFields.push('location = ?');     cacheBinds.push(body.location || null); }
  if (body.bio          !== undefined) { cacheFields.push('bio = ?');          cacheBinds.push(body.bio || null); }

  if (cacheFields.length > 0) {
    cacheFields.push('updated_at = unixepoch()');
    cacheBinds.push(Number(payload.sub), tenantId);
    await c.env.DB.prepare(
      `UPDATE users SET ${cacheFields.join(', ')} WHERE kkauth_uid = ? AND tenant_id = ?`
    ).bind(...cacheBinds).run();
  }

  const user = await c.env.DB.prepare(
    'SELECT * FROM users WHERE kkauth_uid = ? AND tenant_id = ?'
  ).bind(Number(payload.sub), tenantId).first<any>();

  return c.json({ data: { user: publicUser(user, undefined, c.env.ADMIN_EMAILS) } });
});

// ─────────────────────────────────────────────────────────────
// POST /api/auth/logout — revoke session via KKAuth
// ─────────────────────────────────────────────────────────────
authRouter.post('/logout', async (c) => {
  const cookieHeader = c.req.header('Cookie') ?? '';
  const authHeader = c.req.header('Authorization') ?? '';

  await c.env.KKAUTH.fetch(
    new Request('https://kkauth/me/logout', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': authHeader,
        'Cookie': cookieHeader,
      },
      body: JSON.stringify({}),
    })
  );

  // Clear the shared refresh cookie — Domain and Path must match what was set.
  const domainAttr = c.env.COOKIE_DOMAIN ? `; Domain=${c.env.COOKIE_DOMAIN}` : '';
  c.header('Set-Cookie', `kkauth_refresh=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0${domainAttr}`);
  return c.json({ data: { logged_out: true } });
});

// ─────────────────────────────────────────────────────────────
// PATCH /api/auth/profile/location — update shared location prefs via KKAuth
// Updates home_zip_location and/or home_distance_preference in KKAuth's DB.
// These are shared across all KrowdKraft apps — they live in KKAuth, not Exchange.
// ─────────────────────────────────────────────────────────────
authRouter.patch('/profile/location', async (c) => {
  const authHeader = c.req.header('Authorization');
  const token = authHeader?.replace('Bearer ', '').trim();
  if (!token) throw new HTTPException(401, { message: 'Authorization required' });

  let payload: KKAuthPayload;
  try {
    payload = await verifyToken(token, c.env);
  } catch {
    throw new HTTPException(401, { message: 'Invalid or expired token' });
  }

  const body = await c.req.json<{
    home_zip_location?: string | null;
    home_distance_preference?: number | null;
  }>();

  // Delegate to KKAuth internal endpoint — it handles geocoding and validation
  const res = await c.env.KKAUTH.fetch(
    new Request(`https://kkauth/internal/profile/${payload.sub}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Secret': c.env.INTERNAL_SECRET || '',
      },
      body: JSON.stringify(body),
    })
  );

  const kkBody = await res.json<any>();
  if (!res.ok) {
    return c.json(kkBody, res.status as any);
  }

  return c.json(kkBody);
});

// ─────────────────────────────────────────────────────────────
// POST /api/auth/profile/avatar — upload profile image via KKAuth
// Verifies JWT, forwards raw image blob to KKAuth Service Binding,
// and syncs the returned avatar_url to the Exchange user record.
// ─────────────────────────────────────────────────────────────
authRouter.post('/profile/avatar', async (c) => {
  const authHeader = c.req.header('Authorization');
  const token = authHeader?.replace('Bearer ', '').trim();
  if (!token) throw new HTTPException(401, { message: 'Authorization required' });

  let payload: KKAuthPayload;
  try {
    payload = await verifyToken(token, c.env);
  } catch {
    throw new HTTPException(401, { message: 'Invalid or expired token' });
  }

  const tenantId = c.req.query('tenant_id');
  if (!tenantId) throw new HTTPException(400, { message: 'tenant_id query param is required' });

  const contentType = c.req.header('content-type') ?? '';
  const imageBody = await c.req.arrayBuffer();

  // Forward raw image to KKAuth — it handles R2 storage and D1 avatar_url update
  const res = await c.env.KKAUTH.fetch(
    new Request(`https://kkauth/internal/profile/${payload.sub}/avatar`, {
      method: 'POST',
      headers: {
        'Content-Type': contentType,
        'X-Internal-Secret': c.env.INTERNAL_SECRET || '',
      },
      body: imageBody,
    })
  );

  const kkBody = await res.json<any>();
  if (!res.ok) {
    return c.json(kkBody, res.status as any);
  }

  const avatarUrl: string | null = kkBody?.data?.avatar_url ?? null;

  // Sync avatar_url to the Exchange user record for this tenant
  if (avatarUrl) {
    await c.env.DB.prepare(
      "UPDATE users SET avatar_url = ?, updated_at = unixepoch() WHERE kkauth_uid = ? AND tenant_id = ?"
    ).bind(avatarUrl, Number(payload.sub), tenantId).run();
  }

  return c.json({ data: { avatar_url: avatarUrl } });
});

// ─────────────────────────────────────────────────────────────
// POST /api/auth/profile/apply-merchant — proxy business application to KKAuth
// ─────────────────────────────────────────────────────────────
authRouter.post('/profile/apply-merchant', async (c) => {
  const authHeader = c.req.header('Authorization');
  const token = authHeader?.replace('Bearer ', '').trim();
  if (!token) throw new HTTPException(401, { message: 'Authorization required' });

  let payload: KKAuthPayload;
  try {
    payload = await verifyToken(token, c.env);
  } catch {
    throw new HTTPException(401, { message: 'Invalid or expired token' });
  }

  const body = await c.req.json();
  const res = await c.env.KKAUTH.fetch(
    new Request('https://kkauth/businesses/apply', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(body),
    })
  );

  const kkBody = await res.json<any>();
  if (!res.ok) {
    return c.json(kkBody, res.status as any);
  }

  return c.json(kkBody);
});

// ─────────────────────────────────────────────────────────────
// GET /api/auth/me/qr-code — proxy authenticated QR code to KKAuth
// ─────────────────────────────────────────────────────────────
authRouter.get('/me/qr-code', async (c) => {
  // Authorization header only — never accept tokens in the query string
  // (they leak into logs and browser history).
  const auth = c.req.header('Authorization');
  if (!auth) {
    throw new HTTPException(401, { message: 'Authorization required' });
  }

  // Fetch QR code from KKAuth directly
  const res = await c.env.KKAUTH.fetch(
    new Request('https://kkauth/me/qr-code', {
      headers: { 'Authorization': auth },
    })
  );

  if (!res.ok) {
    const text = await res.text();
    return new Response(text, { status: res.status, headers: { 'Content-Type': 'application/json' } });
  }

  const body = await res.arrayBuffer();
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'image/svg+xml',
      'Cache-Control': 'private, no-cache, no-store, must-revalidate',
    },
  });
});

// ─────────────────────────────────────────────────────────────
// GET /api/auth/merchant/qr-code — generate signed merchant check-in QR code
// ─────────────────────────────────────────────────────────────
authRouter.get('/merchant/qr-code', async (c) => {
  const auth = c.req.header('Authorization');
  if (!auth) {
    throw new HTTPException(401, { message: 'Authorization required' });
  }

  // Get business ID from KKAuth
  const res = await c.env.KKAUTH.fetch(
    new Request('https://kkauth/me/merchant-qr-code', {
      headers: { 'Authorization': auth },
    })
  );

  if (!res.ok) {
    const text = await res.text();
    return new Response(text, { status: res.status, headers: { 'Content-Type': 'application/json' } });
  }

  const { data: business } = await res.json<{ data: { id: number; name: string } }>();

  // KKAuth confirms the business is verified, but the scannable check-in
  // location (plaque) lives in Passport's D1 and is created at approval. Without
  // an active plaque row, /scan would 404 - so never hand out a signed QR that
  // cannot be scanned. The plaque id is the stringified business id.
  const plaque = await c.env.DB.prepare(
    'SELECT 1 FROM passport_plaques WHERE id = ? AND is_active = 1'
  ).bind(String(business.id)).first();
  if (!plaque) {
    throw new HTTPException(404, { message: 'No active check-in location exists for this business yet' });
  }

  // Sign the scan payload — QR_SIGNING_SECRET lives in Passport, not KKAuth
  const sig = await hmacHex(c.env.QR_SIGNING_SECRET, `/scan:${business.id}`);
  const domain = c.env.COOKIE_DOMAIN ? c.env.COOKIE_DOMAIN.replace(/^\./, '') : 'lakeandlocals.com';
  const scanUrl = `https://passport.${domain}/scan?id=${business.id}&sig=${sig}`;

  const svgString = generateQrSvg(scanUrl);
  return new Response(svgString, {
    status: 200,
    headers: {
      'Content-Type': 'image/svg+xml',
      'Cache-Control': 'private, no-cache, no-store, must-revalidate',
    },
  });
});

// ─────────────────────────────────────────────────────────────
// GET /api/auth/profile/admin/merchants — get all business applications for admin
authRouter.get('/profile/admin/merchants', async (c) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader) throw new HTTPException(401, { message: 'Authorization required' });

  const token = authHeader.replace('Bearer ', '').trim();
  let payload: KKAuthPayload;
  try {
    payload = await verifyToken(token, c.env);
  } catch {
    throw new HTTPException(401, { message: 'Invalid or expired token' });
  }

  const adminEmails = c.env.ADMIN_EMAILS ?? 'gottabuylocal@gmail.com';
  const requesterEmail = payload.email?.toLowerCase();
  const isAdmin = adminEmails.split(',').map(e => e.trim().toLowerCase()).includes(requesterEmail);
  if (!isAdmin) {
    throw new HTTPException(403, { message: 'Forbidden: Admin access required' });
  }

  const res = await c.env.KKAUTH.fetch(
    new Request('https://kkauth/businesses', {
      method: 'GET',
      headers: {
        'Authorization': authHeader
      }
    })
  );

  const kkBody = await res.json<any>();
  if (!res.ok) {
    return c.json(kkBody, res.status as any);
  }

  return c.json(kkBody);
});

// ─────────────────────────────────────────────────────────────
// POST /api/auth/profile/admin/merchants/:id/review — review merchant application
// ─────────────────────────────────────────────────────────────
authRouter.post('/profile/admin/merchants/:id/review', async (c) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader) throw new HTTPException(401, { message: 'Authorization required' });

  const token = authHeader.replace('Bearer ', '').trim();
  let payload: KKAuthPayload;
  try {
    payload = await verifyToken(token, c.env);
  } catch {
    throw new HTTPException(401, { message: 'Invalid or expired token' });
  }

  const adminEmails = c.env.ADMIN_EMAILS ?? 'gottabuylocal@gmail.com';
  const requesterEmail = payload.email?.toLowerCase();
  const isAdmin = adminEmails.split(',').map(e => e.trim().toLowerCase()).includes(requesterEmail);
  if (!isAdmin) {
    throw new HTTPException(403, { message: 'Forbidden: Admin access required' });
  }

  const id = c.req.param('id');
  const body = await c.req.json();

  const res = await c.env.KKAUTH.fetch(
    new Request(`https://kkauth/businesses/${id}/review`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': authHeader
      },
      body: JSON.stringify(body)
    })
  );

  const kkBody = await res.json<any>();
  if (!res.ok) {
    return c.json(kkBody, res.status as any);
  }

  // On approval, create/update the merchant's passport plaque so their QR code works
  if (body.status === 'verified' && kkBody.data) {
    const biz = kkBody.data;
    if (biz.lat != null && biz.lon != null) {
      const tenant = await c.env.DB.prepare(
        'SELECT id FROM tenants WHERE is_active = 1 LIMIT 1'
      ).first<{ id: string }>();

      if (tenant) {
        await c.env.DB.prepare(`
          INSERT OR REPLACE INTO passport_plaques (id, tenant_id, merchant_id, name, location_name, lat, lon, category, is_active, skip_geofence)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
        `).bind(
          String(biz.id),
          tenant.id,
          String(biz.id),
          biz.name,
          biz.address || biz.name,
          biz.lat,
          biz.lon,
          biz.category,
          biz.hide_address ? 1 : 0
        ).run();
      }
    }
  }

  return c.json(kkBody);
});

// GET /api/auth/persona
authRouter.get('/persona', async (c) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader) throw new HTTPException(401, { message: 'Authorization required' });

  const res = await c.env.KKAUTH.fetch('https://kkauth/me/persona', {
    headers: { 'Authorization': authHeader },
  });
  const json = await res.json<any>();
  return c.json(json, res.status as any);
});

// PUT /api/auth/persona
authRouter.put('/persona', async (c) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader) throw new HTTPException(401, { message: 'Authorization required' });

  const body = await c.req.json().catch(() => ({}));
  const res = await c.env.KKAUTH.fetch('https://kkauth/me/persona', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': authHeader,
    },
    body: JSON.stringify(body),
  });
  const json = await res.json<any>();
  return c.json(json, res.status as any);
});

// GET /api/auth/personal-persona
authRouter.get('/personal-persona', async (c) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader) throw new HTTPException(401, { message: 'Authorization required' });

  const res = await c.env.KKAUTH.fetch('https://kkauth/me/personal-persona', {
    headers: { 'Authorization': authHeader },
  });
  const json = await res.json<any>();
  return c.json(json, res.status as any);
});

// PUT /api/auth/personal-persona
authRouter.put('/personal-persona', async (c) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader) throw new HTTPException(401, { message: 'Authorization required' });

  const body = await c.req.json().catch(() => ({}));
  const res = await c.env.KKAUTH.fetch('https://kkauth/me/personal-persona', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': authHeader,
    },
    body: JSON.stringify(body),
  });
  const json = await res.json<any>();
  return c.json(json, res.status as any);
});

// GET /api/auth/anonymous-persona
authRouter.get('/anonymous-persona', async (c) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader) throw new HTTPException(401, { message: 'Authorization required' });

  const res = await c.env.KKAUTH.fetch('https://kkauth/me/anonymous-persona', {
    headers: { 'Authorization': authHeader },
  });
  const json = await res.json<any>();
  return c.json(json, res.status as any);
});

// PUT /api/auth/anonymous-persona
authRouter.put('/anonymous-persona', async (c) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader) throw new HTTPException(401, { message: 'Authorization required' });

  const body = await c.req.json().catch(() => ({}));
  const res = await c.env.KKAUTH.fetch('https://kkauth/me/anonymous-persona', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': authHeader,
    },
    body: JSON.stringify(body),
  });
  const json = await res.json<any>();
  return c.json(json, res.status as any);
});



