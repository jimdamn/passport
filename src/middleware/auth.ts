/**
 * Auth middleware — token verification via KKAuth Service Binding
 *
 * Calls KKAuth /internal/verify-token which returns both the JWT payload
 * and the user's shared profile fields (avatar_url, home_zip_location,
 * home_zip_lat, home_zip_lon, home_distance_preference). These are set in
 * context so handlers can access them without extra round-trips.
 */

import { createMiddleware } from 'hono/factory';
import { HTTPException } from 'hono/http-exception';
import type { Env, KKAuthPayload, KKAuthProfile } from '../types';

export const requireAuth = createMiddleware<{ Bindings: Env }>(async (c, next) => {
  const authHeader = c.req.header('Authorization');
  const token = authHeader?.replace('Bearer ', '').trim() || c.req.query('token');
  if (!token) throw new HTTPException(401, { message: 'Authorization required' });

  // Verify token via KKAuth Service Binding — response includes profile fields
  let payload: KKAuthPayload;
  let profile: KKAuthProfile = {
    avatar_url: null,
    home_zip_location: null,
    home_zip_lat: null,
    home_zip_lon: null,
    home_distance_preference: null,
  };

  try {
    const res = await c.env.KKAUTH.fetch(
      new Request('https://kkauth/internal/verify-token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-Secret': c.env.INTERNAL_SECRET,
        },
        body: JSON.stringify({ token }),
      })
    );
    if (!res.ok) {
      const body = await res.json<{ error?: string }>().catch(() => ({} as { error?: string }));
      throw new HTTPException(401, { message: body.error ?? 'Invalid or expired token' });
    }
    const json = await res.json<{ data: { payload: KKAuthPayload; profile: KKAuthProfile } }>();
    payload = json.data.payload;
    if (json.data.profile) profile = json.data.profile;
  } catch (e) {
    if (e instanceof HTTPException) throw e;
    throw new HTTPException(401, { message: 'Token verification failed' });
  }

  const tenant = c.get('tenant');
  const kkAuthUserId = payload.sub;

  // Find or create Exchange user record for this (kkauth_user_id, tenant_id) pair
  let user = await c.env.DB.prepare(
    'SELECT * FROM users WHERE id = ? AND tenant_id = ?'
  ).bind(kkAuthUserId, tenant.id).first<any>();

  if (!user) {
    const displayName = payload.name ?? payload.email.split('@')[0];
    await c.env.DB.prepare(`
      INSERT INTO users
        (id, tenant_id, bd_uid, email, display_name, is_active, created_at, updated_at)
      VALUES (?, ?, NULL, ?, ?, 1, unixepoch(), unixepoch())
    `).bind(kkAuthUserId, tenant.id, payload.email, displayName).run();

    user = await c.env.DB.prepare(
      'SELECT * FROM users WHERE id = ? AND tenant_id = ?'
    ).bind(kkAuthUserId, tenant.id).first<any>();
  }

  if (!user || !user.is_active) {
    throw new HTTPException(403, { message: 'Account is not active' });
  }

  const adminEmails = c.env.ADMIN_EMAILS ?? 'gottabuylocal@gmail.com';
  const isAdmin = adminEmails.split(',').map(e => e.trim().toLowerCase()).includes(payload.email.toLowerCase());

  c.set('user', {
    sub: kkAuthUserId,
    email: payload.email,
    name: payload.name,
    bd_member: payload.bd_member,
    tenant_id: tenant.id,
    avatar_url: profile.avatar_url,
    home_zip_location: profile.home_zip_location,
    home_zip_lat: profile.home_zip_lat,
    home_zip_lon: profile.home_zip_lon,
    home_distance_preference: profile.home_distance_preference,
    business_id: profile.business_id ?? null,
    business_status: profile.business_status ?? null,
    business_name: profile.business_name ?? null,
    is_admin: isAdmin,
  });

  await next();
});
