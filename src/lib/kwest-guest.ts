/**
 * KrowdKwest guest identity - a durable signed guest key so a player can
 * start a hunt without an account, then attach their progress on OTP
 * sign-in. Mirrors the HS256 visit-token pattern in handlers/claim-visit.ts
 * (header.payload.sig, base64url), but this token has no expiry: guest
 * progress must survive as long as the hunt does, until attach invalidates
 * the underlying kwest_guest_keys row.
 *
 * Storage: localStorage key `kk_kwest_guest` on the client (per plan
 * Section 1 namespace map). Server trust anchor: env.KWEST_GUEST_SECRET.
 */

import type { Context } from 'hono';
import { nanoid } from 'nanoid';
import type { Env, KKAuthPayload, KKAuthProfile } from '../types';

type AppContext = Context<{ Bindings: Env }>;

const PURPOSE = 'kwest_guest';

interface GuestTokenPayload {
  purpose: typeof PURPOSE;
  gid: string;
  tenant_id: string;
  iat: number;
}

export interface ResolvedPlayer {
  playerKey: string;           // 'u:<uid>' or 'g:<gid>'
  userId: string | null;       // KKAuth uid as string, or null for guests
  isAdmin: boolean;
  guestId: string | null;
  hasRealPersona: boolean;     // active_persona 'personal' with a filled-in personal_persona - the finish display-choice default
  personaNames: { real: string; anonymous: string } | null; // null for guests (they can't finish)
}

function b64urlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(str: string): Uint8Array {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/');
  const padLen = (4 - (padded.length % 4)) % 4;
  const binary = atob(padded + '='.repeat(padLen));
  return Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
}

async function hmacSign(secret: string, message: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return new Uint8Array(sig);
}

async function signGuestToken(payload: GuestTokenPayload, secret: string): Promise<string> {
  const headerB64 = b64urlEncode(new TextEncoder().encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const payloadB64 = b64urlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const sig = await hmacSign(secret, `${headerB64}.${payloadB64}`);
  return `${headerB64}.${payloadB64}.${b64urlEncode(sig)}`;
}

async function verifyGuestToken(token: string, secret: string): Promise<GuestTokenPayload | null> {
  try {
    const [headerB64, payloadB64, sigB64] = token.split('.');
    if (!headerB64 || !payloadB64 || !sigB64) return null;
    const key = await crypto.subtle.importKey(
      'raw', new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['verify'],
    );
    const valid = await crypto.subtle.verify(
      'HMAC', key, b64urlDecode(sigB64),
      new TextEncoder().encode(`${headerB64}.${payloadB64}`),
    );
    if (!valid) return null;
    const payload = JSON.parse(new TextDecoder().decode(b64urlDecode(payloadB64))) as GuestTokenPayload;
    if (payload.purpose !== PURPOSE) return null;
    if (typeof payload.gid !== 'string' || !payload.gid) return null;
    return payload;
  } catch {
    return null;
  }
}

/**
 * Mint a brand-new guest key: a DB row (the row of record for attach/
 * invalidation) plus the signed token the client stores.
 */
export async function mintGuestKey(env: Env, tenantId: string): Promise<{ guestToken: string; guestId: string }> {
  const secret = env.KWEST_GUEST_SECRET;
  if (!secret) throw new Error('KWEST_GUEST_SECRET is not configured');

  const gid = nanoid(16);
  await env.DB.prepare(
    'INSERT INTO kwest_guest_keys (id, tenant_id) VALUES (?, ?)'
  ).bind(gid, tenantId).run();

  const guestToken = await signGuestToken(
    { purpose: PURPOSE, gid, tenant_id: tenantId, iat: Math.floor(Date.now() / 1000) },
    secret,
  );
  return { guestToken, guestId: gid };
}

/**
 * Verify a guest token AND confirm its key is still live (not yet attached
 * to an account). Returns the guest id, or null if the token is invalid,
 * tampered, or already attached.
 */
export async function resolveGuestId(env: Env, tenantId: string, guestToken: string): Promise<string | null> {
  const secret = env.KWEST_GUEST_SECRET;
  if (!secret) return null;
  const payload = await verifyGuestToken(guestToken, secret);
  if (!payload || payload.tenant_id !== tenantId) return null;

  const row = await env.DB.prepare(
    'SELECT attached_user_id FROM kwest_guest_keys WHERE id = ? AND tenant_id = ?'
  ).bind(payload.gid, tenantId).first<{ attached_user_id: string | null }>();
  if (!row || row.attached_user_id) return null;

  return payload.gid;
}

export interface PersonaInfo {
  userId: string;
  isAdmin: boolean;
  hasRealPersona: boolean;
  personaNames: { real: string; anonymous: string };
}

/**
 * Verify a raw Bearer token against KKAuth and compute the persona/admin
 * info KrowdKwest needs. Shared by tryVerifyBearer (guest-friendly routes)
 * and the authenticated display-choice handler (which needs
 * anonymous_display_name - a field requireAuth's own context doesn't carry).
 */
export async function fetchPersonaInfo(env: Env, token: string): Promise<PersonaInfo | null> {
  try {
    const res = await env.KKAUTH.fetch(
      new Request('https://kkauth/internal/verify-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Internal-Secret': env.INTERNAL_SECRET },
        body: JSON.stringify({ token }),
      })
    );
    if (!res.ok) return null;
    const json = await res.json<{ data: { payload: KKAuthPayload; profile: KKAuthProfile } }>();
    const uid = String(Number(json.data.payload.sub));
    const adminEmails = env.ADMIN_EMAILS ?? 'gottabuylocal@gmail.com';
    const isAdmin = adminEmails.split(',').map(e => e.trim().toLowerCase()).includes(json.data.payload.email.toLowerCase());

    // "Has a real persona been set?" (dev plan Section 6): active_persona is
    // 'personal' AND the personal_persona row actually has something filled in -
    // not just the row existing with every field null.
    const pp = json.data.profile?.personal_persona;
    const hasRealPersona =
      json.data.profile?.active_persona === 'personal' &&
      !!pp && !!(pp.facebook_url || pp.x_handle || pp.linkedin_url || pp.website_url);

    const personaNames = {
      real: json.data.payload.name || json.data.payload.email.split('@')[0],
      anonymous: json.data.profile?.anonymous_display_name ?? 'A L&L Member',
    };

    return { userId: uid, isAdmin, hasRealPersona, personaNames };
  } catch {
    return null;
  }
}

/**
 * Best-effort Bearer verification for guest-friendly public routes (which
 * do not run the requireAuth middleware, since anonymous callers must be
 * allowed through). An invalid/expired/absent token is NOT an error here -
 * it just means "anonymous caller", so guest resolution proceeds.
 */
async function tryVerifyBearer(c: AppContext): Promise<PersonaInfo | null> {
  const authHeader = c.req.header('Authorization');
  const token = authHeader?.replace('Bearer ', '').trim();
  if (!token) return null;
  return fetchPersonaInfo(c.env, token);
}

/**
 * Resolve the calling player's identity on a guest-friendly route: signed-in
 * user if a valid Bearer token is present, else a guest via the provided
 * guest token, else null (caller must mint a new guest key - only /start
 * does this).
 */
export async function resolvePlayerKey(c: AppContext, guestToken?: string | null): Promise<ResolvedPlayer | null> {
  const tenant = c.get('tenant');

  const user = await tryVerifyBearer(c);
  if (user) {
    return {
      playerKey: `u:${user.userId}`, userId: user.userId, isAdmin: user.isAdmin,
      guestId: null, hasRealPersona: user.hasRealPersona, personaNames: user.personaNames,
    };
  }

  if (guestToken) {
    const gid = await resolveGuestId(c.env, tenant.id, guestToken);
    if (gid) {
      return { playerKey: `g:${gid}`, userId: null, isAdmin: false, guestId: gid, hasRealPersona: false, personaNames: null };
    }
  }

  return null;
}
