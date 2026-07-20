import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { Env } from '../types';

type AppContext = Context<{ Bindings: Env }>;

// Both Exchange and Field Notes are Pages projects, not service bindings -
// same public-HTTPS-with-forwarded-bearer pattern as contentSummary.ts.
const DEFAULT_EXCHANGE_BASE_URL = 'https://exchange.lakeandlocals.com';
const DEFAULT_FIELD_NOTES_BASE_URL = 'https://fieldnotes.lakeandlocals.com';

function assertAdmin(c: AppContext): void {
  if (!c.get('user').is_admin) {
    throw new HTTPException(403, { message: 'Forbidden: Admin access required' });
  }
}

// GET /api/t/:tenant/admin/content/exchange — proxies to Exchange's admin
// offers list, forwarding every query param as-is (q/from/to/status/
// include_hidden/cursor/limit).
export async function adminListExchangeOffers(c: AppContext) {
  assertAdmin(c);
  const tenant = c.get('tenant');
  const baseUrl = c.env.EXCHANGE_BASE_URL || DEFAULT_EXCHANGE_BASE_URL;
  const qs = new URL(c.req.url).search;

  const res = await fetch(`${baseUrl}/api/t/${encodeURIComponent(tenant.id)}/admin/offers${qs}`, {
    headers: { Authorization: c.req.header('Authorization') ?? '' },
  });
  const body = await res.json();
  return c.json(body as any, res.status as any);
}

// GET /api/t/:tenant/admin/content/field-notes — proxies to Field Notes'
// admin stories list.
export async function adminListFieldNotesStories(c: AppContext) {
  assertAdmin(c);
  const tenant = c.get('tenant');
  const baseUrl = c.env.FIELD_NOTES_BASE_URL || DEFAULT_FIELD_NOTES_BASE_URL;
  const qs = new URL(c.req.url).search;

  const res = await fetch(`${baseUrl}/api/t/${encodeURIComponent(tenant.id)}/admin/stories${qs}`, {
    headers: { Authorization: c.req.header('Authorization') ?? '' },
  });
  const body = await res.json();
  return c.json(body as any, res.status as any);
}

// POST /api/t/:tenant/admin/content/exchange/:id/visibility — proxies to
// Exchange's existing owner-or-admin /publish endpoint (Increment 2). The
// niche slug travels in the body since Exchange's route is niche-scoped and
// the admin content list is cross-niche.
export async function adminSetExchangeVisibility(c: AppContext) {
  assertAdmin(c);
  const tenant = c.get('tenant');
  const id = c.req.param('id');
  const body = await c.req.json<{ published: boolean; reason?: string; niche?: string }>();
  if (!body.niche) throw new HTTPException(400, { message: 'niche is required' });

  const baseUrl = c.env.EXCHANGE_BASE_URL || DEFAULT_EXCHANGE_BASE_URL;
  const res = await fetch(
    `${baseUrl}/api/t/${encodeURIComponent(tenant.id)}/${encodeURIComponent(body.niche)}/offers/${id}/publish`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: c.req.header('Authorization') ?? '' },
      body: JSON.stringify({ published: body.published, reason: body.reason }),
    }
  );
  const responseBody = await res.json();
  return c.json(responseBody as any, res.status as any);
}

// POST /api/t/:tenant/admin/content/field-notes/:id/visibility — proxies to
// Field Notes' existing author-or-admin /visibility endpoint (Increment 3).
export async function adminSetFieldNotesVisibility(c: AppContext) {
  assertAdmin(c);
  const tenant = c.get('tenant');
  const id = c.req.param('id');
  const body = await c.req.json<{ hidden: boolean; reason?: string }>();

  const baseUrl = c.env.FIELD_NOTES_BASE_URL || DEFAULT_FIELD_NOTES_BASE_URL;
  const res = await fetch(
    `${baseUrl}/api/t/${encodeURIComponent(tenant.id)}/stories/${id}/visibility`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: c.req.header('Authorization') ?? '' },
      body: JSON.stringify({ hidden: body.hidden, reason: body.reason }),
    }
  );
  const responseBody = await res.json();
  return c.json(responseBody as any, res.status as any);
}
