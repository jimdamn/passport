import type { Context } from 'hono';
import type { Env } from '../types';
import { fetchExchangeSummary, fetchFieldNotesSummary } from '../lib/contentSummary';

type AppContext = Context<{ Bindings: Env }>;

// GET /api/t/:tenant/me/content-summary — read-only fan-out to Exchange and
// Field Notes for the Passport profile's "My Posts" cards. Each leg is
// best-effort; a down or slow source degrades to an empty summary rather
// than failing the whole request.
export async function getContentSummary(c: AppContext) {
  const tenant = c.get('tenant');
  const authHeader = c.req.header('Authorization') ?? null;

  const [exchange, field_notes] = await Promise.all([
    fetchExchangeSummary(c.env, tenant.id, authHeader),
    fetchFieldNotesSummary(c.env, tenant.id, authHeader),
  ]);

  return c.json({ data: { exchange, field_notes } });
}
