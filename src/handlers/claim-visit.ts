/**
 * P-1 (kk-business EXPANSION-SPEC §8.3): claim KrowdKredits for a real,
 * paid local purchase. The Business Hub mints a signed 24h visit token on
 * every paid receipt; the customer lands here from the "Earn KrowdKredits
 * in Passport" button.
 *
 * Flow: verify the shared-secret token → first-claimant gate (visit_claims,
 * one claim per ticket EVER across all users) → award via the existing
 * KKGame plumbing (action 'local_purchase', ref pos_ticket). The award size
 * lives in KKGame config, never in the token.
 *
 * Friendly states, never errors-as-walls: claimed / already-yours /
 * already-claimed / expired-or-invalid.
 */

import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { Env } from '../types';
import { recordGameAction } from '../lib/game';

type AppContext = Context<{ Bindings: Env }>;

interface VisitTokenPayload {
  purpose: 'visit';
  ticket_id: string;
  tenant_id: string;
  owner_uid: number;
  business_name: string;
  total_cents: number;
  iat: number;
  exp: number;
}

// Minimal HS256 JWT verify - mirrors kk-business/src/lib/tokens.ts (the
// minting side). Shared CLAIM_TOKEN_SECRET is the trust anchor (J-5).
function b64urlDecode(str: string): Uint8Array {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/');
  const padLen = (4 - (padded.length % 4)) % 4;
  const binary = atob(padded + '='.repeat(padLen));
  return Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
}

async function verifyVisitToken(token: string, secret: string): Promise<VisitTokenPayload | null> {
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
    const payload = JSON.parse(new TextDecoder().decode(b64urlDecode(payloadB64))) as VisitTokenPayload;
    if (payload.purpose !== 'visit') return null;
    if (typeof payload.exp !== 'number' || payload.exp < Math.floor(Date.now() / 1000)) return null;
    if (typeof payload.ticket_id !== 'string' || !payload.ticket_id) return null;
    return payload;
  } catch {
    return null;
  }
}

export async function claimVisit(c: AppContext) {
  const user = c.get('user');
  const userId = Number(user.sub);
  const tenant = c.get('tenant') as { id: string };

  const body = await c.req.json<{ token?: string }>().catch(() => ({} as { token?: string }));
  if (typeof body.token !== 'string' || !body.token) {
    throw new HTTPException(400, { message: 'A visit token is required.' });
  }

  const secret = c.env.CLAIM_TOKEN_SECRET;
  if (!secret) throw new HTTPException(503, { message: 'Visit claims are not configured yet.' });

  const visit = await verifyVisitToken(body.token, secret);
  if (!visit) {
    // Expired or tampered - same calm answer for both (no oracle).
    return c.json({ data: { status: 'expired' } });
  }

  // First-claimant gate: the PRIMARY KEY decides, atomically.
  const ins = await c.env.DB.prepare(
    'INSERT OR IGNORE INTO visit_claims (ticket_id, tenant_id, user_id) VALUES (?, ?, ?)'
  ).bind(visit.ticket_id, visit.tenant_id, userId).run();

  if ((ins.meta?.changes ?? 0) === 0) {
    const existing = await c.env.DB.prepare(
      'SELECT user_id FROM visit_claims WHERE ticket_id = ?'
    ).bind(visit.ticket_id).first<{ user_id: number }>();
    return c.json({
      data: {
        status: existing?.user_id === userId ? 'already_yours' : 'already_claimed',
        business_name: visit.business_name,
      },
    });
  }

  // Award through the same plumbing every Passport action uses. Award size
  // is KKGame config ('local_purchase' action, J-6), never client input.
  const game = await recordGameAction(c.env, {
    user_id: userId,
    action_id: 'local_purchase',
    source_app: 'passport',
    network_id: 'lake-and-locals',
    tenant_id: visit.tenant_id,
    ref_type: 'pos_ticket',
    ref_id: visit.ticket_id,
  });

  if (!game) {
    // KKGame unreachable: release the gate so the customer can retry - a
    // claim that awarded nothing must not burn the ticket.
    await c.env.DB.prepare('DELETE FROM visit_claims WHERE ticket_id = ? AND user_id = ?')
      .bind(visit.ticket_id, userId).run();
    throw new HTTPException(502, { message: 'Could not record your visit right now. Please try again in a moment.' });
  }

  return c.json({
    data: {
      status: 'claimed',
      business_name: visit.business_name,
      credits_awarded: game.credits_awarded,
      credits_balance: game.credits_balance,
      new_badges: game.new_badges,
    },
  });
}
