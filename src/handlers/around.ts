/**
 * Around Town — per-member interest picks
 *
 * A private preference, not content: which lenses (Events / Fresh / Deals /
 * Volunteer / Places) a member keeps an eye on, in pick order. This orders
 * the lens row on the board and sets the default lens. Explicit choice only -
 * never inferred from behavior (mission: no algorithmic personalization).
 *
 * No public read, no admin surface - there is nothing here to moderate.
 * `chosen_at === null` (no row yet) is the "show the picker" signal; once a
 * member picks (even "everything", i.e. an empty array), chosen_at is set
 * and never cleared, so the picker never re-nags (ARCHITECTURE.md Section 13,
 * item 10, the content-lifecycle CRUD gate - see AROUND-TOWN-BUILD-PLAN.md
 * Section 1 for the full matrix this table was built against).
 */

import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { Env } from '../types';

type AppContext = Context<{ Bindings: Env }>;

// Server-side mirror of passport/ui/src/api/around.ts's LENSES/LENS_SLUGS -
// kept in sync by hand (this Worker's handlers do not import from the UI
// bundle). The backend is the source of truth for what a client can submit,
// same reasoning as fresh.ts's FRESH_CATEGORIES.
export const LENSES = [
  { slug: 'everything', label: 'Everything' },
  { slug: 'events', label: 'Events' },       // happenings
  { slug: 'fresh', label: 'Fresh' },         // fresh today
  { slug: 'deals', label: 'Deals' },
  { slug: 'hands', label: 'Volunteer' },     // lend a hand
  { slug: 'places', label: 'Places' },       // the member directory
] as const;
export const LENS_SLUGS = LENSES.map((l) => l.slug);

// 'everything' is never a pickable interest - it is the absence of picks, so
// submitted interests are validated against every slug except it.
const PICKABLE_SLUGS = LENS_SLUGS.filter((slug) => slug !== 'everything');

const MAX_INTERESTS = 6;

/**
 * Validates and normalizes a submitted interests array: must be an array,
 * at most MAX_INTERESTS entries, every entry a pickable lens slug, deduped
 * while preserving first-seen (pick) order. Throws the shared 400 copy on
 * any violation - the client never needs to distinguish which rule failed.
 */
function parseInterestsInput(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > MAX_INTERESTS) {
    throw new HTTPException(400, { message: 'Pick from the interests on the list.' });
  }

  const deduped: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string' || !(PICKABLE_SLUGS as readonly string[]).includes(entry)) {
      throw new HTTPException(400, { message: 'Pick from the interests on the list.' });
    }
    if (!deduped.includes(entry)) deduped.push(entry);
  }
  return deduped;
}

/**
 * GET /around/interests — the caller's own picks. No row yet → the picker
 * signal: { interests: [], chosen_at: null }.
 */
export async function getAroundInterests(c: AppContext) {
  const user = c.get('user');
  const tenant = c.get('tenant');
  const kkauthUid = Number(user.sub);

  const row = await c.env.DB.prepare(
    'SELECT interests, chosen_at FROM around_interests WHERE kkauth_uid = ? AND tenant_id = ?'
  ).bind(kkauthUid, tenant.id).first<{ interests: string; chosen_at: number }>();

  if (!row) {
    return c.json({ data: { interests: [], chosen_at: null } });
  }

  return c.json({ data: { interests: JSON.parse(row.interests || '[]'), chosen_at: row.chosen_at } });
}

/**
 * PUT /around/interests — body { interests: string[] }. Upserts the caller's
 * row. chosen_at is set once (COALESCE against any existing value) and never
 * moves again, including on a "show me everything" submit of [] - that is a
 * deliberate pick, not a reset, and it must stop the picker from re-showing.
 */
export async function putAroundInterests(c: AppContext) {
  const user = c.get('user');
  const tenant = c.get('tenant');
  const kkauthUid = Number(user.sub);
  const body = await c.req.json<any>().catch(() => ({}));

  const interests = parseInterestsInput(body.interests);

  await c.env.DB.prepare(`
    INSERT INTO around_interests (kkauth_uid, tenant_id, interests, chosen_at, updated_at)
    VALUES (?, ?, ?, unixepoch(), unixepoch())
    ON CONFLICT (kkauth_uid, tenant_id) DO UPDATE SET
      interests = excluded.interests,
      chosen_at = COALESCE(around_interests.chosen_at, unixepoch()),
      updated_at = unixepoch()
  `).bind(kkauthUid, tenant.id, JSON.stringify(interests)).run();

  const row = await c.env.DB.prepare(
    'SELECT interests, chosen_at FROM around_interests WHERE kkauth_uid = ? AND tenant_id = ?'
  ).bind(kkauthUid, tenant.id).first<{ interests: string; chosen_at: number }>();

  return c.json({ data: { interests: JSON.parse(row!.interests || '[]'), chosen_at: row!.chosen_at } });
}
