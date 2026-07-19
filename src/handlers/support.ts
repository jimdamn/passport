/**
 * Support messages ("Talk to us") - one-way member-to-admin channel ported
 * from Las Vegas Edge (C:\LVE\src\routers\support.ts + admin.ts:316-347).
 * ONE unified inbox at passport /profile/admin/support for the whole
 * platform; kk-business forwards into POST /api/internal/support.
 * kkauth_uid stores the KKAuth uid (user.sub), never a local users row id.
 */

import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { Env, SupportMessageRow } from '../types';
import { matchesInternalSecret } from '../lib/hmac';
import { getCount, increment } from '../lib/throttle';
import { sendSupportAlertEmail } from '../lib/email';

type AppContext = Context<{ Bindings: Env }>;

const CATEGORIES = ['problem', 'question', 'idea', 'business'] as const;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RATE_LIMIT_PER_DAY = 5;
const RATE_LIMIT_TTL_SECONDS = 24 * 60 * 60;
const RETENTION_SECONDS = 365 * 24 * 60 * 60;

function requireAdmin(c: AppContext) {
  const user = c.get('user');
  if (!user?.is_admin) {
    throw new HTTPException(403, { message: 'Admin access required' });
  }
}

function requireInternalSecret(c: AppContext) {
  if (!matchesInternalSecret(c.req.header('X-Internal-Secret'), c.env)) {
    throw new HTTPException(401, { message: 'Unauthorized' });
  }
}

// Passport has no optional-auth middleware: verifies the same way
// requireAuth does (src/middleware/auth.ts:32-48) via the KKAuth Service
// Binding, but never throws and never touches the local users table - a
// logged-out submitter is a perfectly valid caller here.
async function tryGetKkauthUid(c: AppContext): Promise<number | undefined> {
  const authHeader = c.req.header('Authorization');
  const token = authHeader?.replace('Bearer ', '').trim();
  if (!token) return undefined;

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
    if (!res.ok) return undefined;
    const json = await res.json<{ data: { payload: { sub: string } } }>();
    const uid = Number(json.data.payload.sub);
    return Number.isFinite(uid) ? uid : undefined;
  } catch {
    return undefined;
  }
}

interface SupportInput {
  category?: string;
  body?: string;
  route?: string;
  email?: string;
}

function validateSupportInput(input: SupportInput): { category: string; body: string; email: string } {
  const category = input.category ?? '';
  if (!(CATEGORIES as readonly string[]).includes(category)) {
    throw new HTTPException(400, { message: 'invalid_category' });
  }

  const body = (input.body ?? '').trim();
  if (!body) throw new HTTPException(400, { message: 'body_required' });
  if (body.length > 2000) throw new HTTPException(400, { message: 'body_too_long' });

  const email = (input.email ?? '').trim().toLowerCase();
  return { category, body, email };
}

async function checkRateLimit(env: Env, key: string): Promise<void> {
  const count = await getCount(env.PASSPORT_CONFIG, key);
  if (count >= RATE_LIMIT_PER_DAY) {
    throw new HTTPException(429, { message: 'rate_limited' });
  }
  await increment(env.PASSPORT_CONFIG, key, RATE_LIMIT_TTL_SECONDS);
}

/** POST /api/t/:tenant/support - public, optional auth. */
export async function submitSupport(c: AppContext) {
  const tenant = c.get('tenant');
  const uid = await tryGetKkauthUid(c);
  const input = await c.req.json<SupportInput>();
  const { category, body, email } = validateSupportInput(input);

  if (!uid && !EMAIL_RE.test(email)) {
    throw new HTTPException(400, { message: 'email_required' });
  }

  const rateKey = `support_rate:${uid ?? c.req.header('CF-Connecting-IP') ?? 'unknown'}`;
  await checkRateLimit(c.env, rateKey);

  const row = await c.env.DB.prepare(
    `INSERT INTO support_messages (tenant_id, kkauth_uid, email, source_app, category, body, route, user_agent, status)
     VALUES (?, ?, ?, 'passport', ?, ?, ?, ?, 'new')
     RETURNING *`
  )
    .bind(
      tenant.id,
      uid ?? null,
      uid ? null : email,
      category,
      body,
      input.route ?? null,
      c.req.header('User-Agent') ?? null
    )
    .first<SupportMessageRow>();
  if (!row) throw new Error('Failed to record support message');

  c.executionCtx.waitUntil(sendSupportAlertEmail(c.env, row));

  return c.json({ data: row }, 201);
}

/** GET /api/t/:tenant/support/mine - tenantApp (requires auth). */
export async function getMySupport(c: AppContext) {
  const user = c.get('user');
  const { results } = await c.env.DB.prepare(
    'SELECT * FROM support_messages WHERE kkauth_uid = ? ORDER BY created_at DESC LIMIT 50'
  )
    .bind(Number(user.sub))
    .all<SupportMessageRow>();
  return c.json({ data: results ?? [] });
}

/** GET /api/t/:tenant/admin/support?status= - admin-gated. */
export async function adminListSupport(c: AppContext) {
  requireAdmin(c);
  const tenant = c.get('tenant');
  const status = c.req.query('status') ?? 'new';

  const query =
    status === 'all'
      ? 'SELECT * FROM support_messages WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 200'
      : 'SELECT * FROM support_messages WHERE tenant_id = ? AND status = ? ORDER BY created_at DESC LIMIT 200';

  const { results } =
    status === 'all'
      ? await c.env.DB.prepare(query).bind(tenant.id).all<SupportMessageRow>()
      : await c.env.DB.prepare(query).bind(tenant.id, status).all<SupportMessageRow>();

  return c.json({ data: results ?? [] });
}

/** GET /api/t/:tenant/admin/support/count - admin-gated. */
export async function adminSupportCount(c: AppContext) {
  requireAdmin(c);
  const tenant = c.get('tenant');
  const row = await c.env.DB.prepare(
    "SELECT COUNT(*) AS n FROM support_messages WHERE tenant_id = ? AND status = 'new'"
  )
    .bind(tenant.id)
    .first<{ n: number }>();
  return c.json({ data: { new_count: row?.n ?? 0 } });
}

/** PATCH /api/t/:tenant/admin/support/:id - admin-gated. */
export async function adminUpdateSupport(c: AppContext) {
  requireAdmin(c);
  const tenant = c.get('tenant');
  const id = Number(c.req.param('id'));
  const body = await c.req.json<{ status?: string; admin_note?: string }>();

  const existing = await c.env.DB.prepare(
    'SELECT * FROM support_messages WHERE id = ? AND tenant_id = ?'
  )
    .bind(id, tenant.id)
    .first<SupportMessageRow>();
  if (!existing) throw new HTTPException(404, { message: 'not_found' });

  const status =
    body.status && ['new', 'seen', 'resolved'].includes(body.status) ? body.status : existing.status;
  const adminNote = body.admin_note !== undefined ? body.admin_note : existing.admin_note;

  const row = await c.env.DB.prepare(
    'UPDATE support_messages SET status = ?, admin_note = ? WHERE id = ? AND tenant_id = ? RETURNING *'
  )
    .bind(status, adminNote, id, tenant.id)
    .first<SupportMessageRow>();

  return c.json({ data: row });
}

interface InternalSupportInput extends SupportInput {
  tenant_id?: string;
  kkauth_uid?: number;
  source_app?: string;
  user_agent?: string;
}

const INTERNAL_ALLOWED_SOURCE_APPS = ['kk-business'];

/** POST /api/internal/support - X-Internal-Secret gated (e.g. kk-business forwarding). */
export async function internalSubmitSupport(c: AppContext) {
  requireInternalSecret(c);

  const input = await c.req.json<InternalSupportInput>();
  const { category, body, email } = validateSupportInput(input);

  const tenantId = input.tenant_id ?? '';
  if (!tenantId) throw new HTTPException(400, { message: 'tenant_id_required' });

  const sourceApp = input.source_app ?? '';
  if (!INTERNAL_ALLOWED_SOURCE_APPS.includes(sourceApp)) {
    throw new HTTPException(400, { message: 'invalid_source_app' });
  }

  const uid = input.kkauth_uid;
  if (!uid && !EMAIL_RE.test(email)) {
    throw new HTTPException(400, { message: 'email_required' });
  }

  const rateKey = `support_rate:${uid ?? email ?? 'unknown'}`;
  await checkRateLimit(c.env, rateKey);

  const row = await c.env.DB.prepare(
    `INSERT INTO support_messages (tenant_id, kkauth_uid, email, source_app, category, body, route, user_agent, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'new')
     RETURNING *`
  )
    .bind(
      tenantId,
      uid ?? null,
      uid ? null : email,
      sourceApp,
      category,
      body,
      input.route ?? null,
      input.user_agent ?? null
    )
    .first<SupportMessageRow>();
  if (!row) throw new Error('Failed to record support message');

  c.executionCtx.waitUntil(sendSupportAlertEmail(c.env, row));

  return c.json({ data: row }, 201);
}

/** POST /api/internal/support/retention - X-Internal-Secret gated. Prunes resolved rows older than 365 days. */
export async function internalSupportRetention(c: AppContext) {
  requireInternalSecret(c);
  const result = await c.env.DB.prepare(
    'DELETE FROM support_messages WHERE status = ? AND created_at < unixepoch() - ?'
  )
    .bind('resolved', RETENTION_SECONDS)
    .run();
  return c.json({ data: { pruned: result.meta.changes ?? 0 } });
}
