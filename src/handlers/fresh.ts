/**
 * Fresh Today — resident-owned farm-stand board
 *
 * Stands are persistent producer profiles (any signed-in local can register
 * one - NO merchant verification, unlike Happenings). Posts are short,
 * self-expiring daily notes ("eggs and asparagus today") that clear at the
 * end of the calendar day, same lazy-expiry-via-read-filter pattern as
 * Happenings (no cron). A harvest calendar (fresh_seasons) is static
 * reference data, seeded once by the migration.
 *
 * Zero economy surface: no credits, no KKGame calls, no notifications, no
 * streaks. Admin hides carry a stored, owner-visible reason and are not
 * owner-reversible - only admin reverses (ARCHITECTURE.md Section 13, item 10,
 * the content-lifecycle CRUD gate).
 *
 * This file deliberately does not import from happenings.ts - the two boards
 * are independent features that happen to share a shape (cooldown/cap,
 * end-of-day expiry, lazy expiry, friendly guard copy). Duplicating the
 * small helpers keeps that shape copy, not coupling.
 */

import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { Env } from '../types';
import { nanoid } from 'nanoid';

type AppContext = Context<{ Bindings: Env }>;

// The board's wall-clock timezone for end-of-day expiry and the harvest
// calendar's month/day comparison.
const BOARD_TZ = 'America/New_York';

// Allowed categories. The backend is the source of truth so a crafted request
// can't invent a category the filter bar doesn't know about.
// UI labels (exact): Produce, Eggs, Meat, Dairy, Baked Goods,
// Honey & Syrup, Plants & Flowers, U-Pick, CSA, Prepared Food
export const FRESH_CATEGORIES = [
  'produce', 'eggs', 'meat', 'dairy', 'baked_goods',
  'honey_syrup', 'plants_flowers', 'upick', 'csa', 'prepared',
] as const;

// Bounding box: the Tri-State Lakes Region with padding.
// Union City MI (N), North Manchester IN (S), South Bend IN (W), Bryan OH (E).
export const REGION_BOUNDS = { minLat: 40.75, maxLat: 42.30, minLon: -86.65, maxLon: -84.25 };
export const REGION_CENTER = { lat: 41.55, lon: -85.45 }; // default map center, zoom 9

// Anti-spam (calm-board guardrail, same shape as Happenings' cooldown+cap).
const POST_COOLDOWN_MINUTES = 30; // same as happenings
const LIVE_POST_CAP = 3;          // per stand
const STAND_CAP_PER_USER = 3;

const BODY_MAX = 280;
const NAME_MIN = 3;
const NAME_MAX = 60;
const ADDRESS_HINT_MAX = 120;
const PHONE_MAX = 25;
const DESCRIPTION_MAX = 280;

function requireAdmin(c: AppContext) {
  const user = c.get('user');
  if (!user?.is_admin) throw new HTTPException(403, { message: 'Admin access required.' });
}

function cleanText(value: unknown, maxLen: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLen);
}

function asBool(value: unknown, fallback: boolean): boolean {
  if (value === undefined || value === null) return fallback;
  return !!value;
}

/**
 * Unix seconds for the next local midnight in BOARD_TZ. Copied verbatim
 * (in behavior) from happenings.ts endOfBoardDay() - computes seconds
 * elapsed since local midnight from the wall clock and adds the remainder.
 */
function endOfBoardDay(): number {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: BOARD_TZ, hour12: false,
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(now);
  const get = (t: string) => Number(parts.find(p => p.type === t)?.value ?? 0);
  let h = get('hour');
  if (h === 24) h = 0; // some runtimes emit 24 for midnight
  const elapsed = h * 3600 + get('minute') * 60 + get('second');
  const nowSec = Math.floor(now.getTime() / 1000);
  return nowSec + (86400 - elapsed);
}

/** Today's { month, day } in BOARD_TZ, for the harvest calendar comparison. */
function currentMonthDay(): { month: number; day: number } {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: BOARD_TZ, month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const get = (t: string) => Number(parts.find(p => p.type === t)?.value ?? 0);
  return { month: get('month'), day: get('day') };
}

/**
 * Whether today's (month, day) falls within [start, end] inclusive. Written
 * as an MMDD integer comparison so a range that crosses year-end (start > end,
 * e.g. a future Nov-to-Feb entry) is handled the same way as a same-year
 * range - only the comparison operator flips.
 */
function isInSeason(startMonth: number, startDay: number, endMonth: number, endDay: number, month: number, day: number): boolean {
  const cur = month * 100 + day;
  const start = startMonth * 100 + startDay;
  const end = endMonth * 100 + endDay;
  if (start <= end) return cur >= start && cur <= end;
  return cur >= start || cur <= end; // crosses year-end
}

function parseStandInput(body: any, existing?: any) {
  const name = cleanText(body.name, NAME_MAX) ?? existing?.name ?? null;
  if (!name || name.length < NAME_MIN) {
    throw new HTTPException(400, { message: 'Give your stand a name (3-60 characters).' });
  }

  const lat = body.lat !== undefined ? Number(body.lat) : Number(existing?.lat);
  const lon = body.lon !== undefined ? Number(body.lon) : Number(existing?.lon);
  if (
    !Number.isFinite(lat) || !Number.isFinite(lon) ||
    lat < REGION_BOUNDS.minLat || lat > REGION_BOUNDS.maxLat ||
    lon < REGION_BOUNDS.minLon || lon > REGION_BOUNDS.maxLon
  ) {
    throw new HTTPException(400, { message: "Place the pin inside the Lakes Region - drag it to your stand's spot." });
  }

  let categories: string[];
  if (body.categories !== undefined) {
    if (!Array.isArray(body.categories)) {
      throw new HTTPException(400, { message: 'Pick 1-4 categories for your stand.' });
    }
    categories = body.categories.filter((cat: any) => (FRESH_CATEGORIES as readonly string[]).includes(cat));
    if (categories.length < 1 || categories.length > 4) {
      throw new HTTPException(400, { message: 'Pick 1-4 categories for your stand.' });
    }
  } else if (existing) {
    categories = JSON.parse(existing.categories || '[]');
  } else {
    throw new HTTPException(400, { message: 'Pick 1-4 categories for your stand.' });
  }

  const addressHint = body.address_hint === undefined ? (existing?.address_hint ?? null) : cleanText(body.address_hint, ADDRESS_HINT_MAX);
  const phone = body.phone === undefined ? (existing?.phone ?? null) : cleanText(body.phone, PHONE_MAX);
  const description = body.description === undefined ? (existing?.description ?? null) : cleanText(body.description, DESCRIPTION_MAX);
  const photoUrl = body.photo_url === undefined ? (existing?.photo_url ?? null) : cleanText(body.photo_url, 500);

  return { name, lat, lon, categories, addressHint, phone, description, photoUrl };
}

function serializeStand(row: any) {
  return { ...row, categories: JSON.parse(row.categories || '[]') };
}

/** Cooldown + live-post cap, shared by createFreshPost and relistFreshPost. */
async function guardCooldownAndCap(c: AppContext, standId: string) {
  const last = await c.env.DB.prepare(
    'SELECT created_at FROM fresh_posts WHERE stand_id = ? ORDER BY created_at DESC LIMIT 1'
  ).bind(standId).first<{ created_at: number }>();
  if (last) {
    const since = Math.floor(Date.now() / 1000) - last.created_at;
    if (since < POST_COOLDOWN_MINUTES * 60) {
      const mins = Math.ceil((POST_COOLDOWN_MINUTES * 60 - since) / 60);
      throw new HTTPException(429, {
        message: `Give it a few minutes between posts - you can share another in about ${mins} min.`,
      });
    }
  }

  const live = await c.env.DB.prepare(
    'SELECT COUNT(*) AS n FROM fresh_posts WHERE stand_id = ? AND is_active = 1 AND admin_hidden = 0 AND expires_at > unixepoch()'
  ).bind(standId).first<{ n: number }>();
  if ((live?.n ?? 0) >= LIVE_POST_CAP) {
    throw new HTTPException(409, {
      message: `You have ${LIVE_POST_CAP} posts up - they clear at the end of the day, or remove one to post another.`,
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Owner-visible state helpers (used by listMyFresh + fetchFreshSummary)
// ─────────────────────────────────────────────────────────────────────────────

type StandState = 'visible' | 'paused' | 'hidden_by_admin' | 'removed';
type PostState = 'live' | 'sold_out' | 'expired' | 'removed' | 'hidden_by_admin';

function standState(row: any): StandState {
  if (row.deleted_at) return 'removed';
  if (row.admin_hidden) return 'hidden_by_admin';
  if (row.is_hidden) return 'paused';
  return 'visible';
}

function standStateNote(state: StandState, row: any): string {
  switch (state) {
    case 'visible': return 'Live - neighbors can see your stand.';
    case 'paused': return "Paused - only you can see it. Tap Show when you're back.";
    case 'hidden_by_admin':
      return `Hidden by an admin: "${row.admin_hidden_reason}" - reply from your profile's Talk to Us if you have questions.`;
    case 'removed': return 'Removed.';
  }
}

function postState(row: any, now: number): PostState {
  if (!row.is_active) return 'removed';
  if (row.admin_hidden) return 'hidden_by_admin';
  if (row.expires_at <= now) return 'expired';
  if (row.sold_out) return 'sold_out';
  return 'live';
}

function postStateNote(state: PostState, row: any): string {
  switch (state) {
    case 'live': return 'Live until end of day.';
    case 'sold_out': return 'Sold out - still listed so folks know you had it.';
    case 'expired': {
      const date = new Date(row.expires_at * 1000).toLocaleDateString('en-US', {
        timeZone: BOARD_TZ, month: 'short', day: 'numeric',
      });
      return `Ended ${date}.`;
    }
    case 'removed': return 'Removed.';
    case 'hidden_by_admin':
      return `Hidden by an admin: "${row.admin_hidden_reason}" - reply from your profile's Talk to Us if you have questions.`;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Public board
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/t/:tenant/fresh — the public feed. Joins posts -> stands. Optional
 * ?category= filters on the stand's category list.
 */
export async function listFresh(c: AppContext) {
  const tenant = c.get('tenant');
  const category = c.req.query('category');

  const filters = [
    'p.tenant_id = ?', 'p.is_active = 1', 'p.admin_hidden = 0', 'p.expires_at > unixepoch()',
    's.deleted_at IS NULL', 's.is_hidden = 0', 's.admin_hidden = 0',
  ];
  const binds: any[] = [tenant.id];
  if (category && (FRESH_CATEGORIES as readonly string[]).includes(category)) {
    filters.push('instr(s.categories, ?)');
    binds.push(`"${category}"`);
  }

  const { results } = await c.env.DB.prepare(`
    SELECT p.id, p.body, p.photo_url, p.sold_out, p.created_at, p.expires_at,
           s.id AS stand_id, s.name AS stand_name, s.lat AS stand_lat, s.lon AS stand_lon,
           s.address_hint AS stand_address_hint, s.phone AS stand_phone, s.categories AS stand_categories
    FROM fresh_posts p
    JOIN fresh_stands s ON s.id = p.stand_id
    WHERE ${filters.join(' AND ')}
    ORDER BY p.created_at DESC
    LIMIT 200
  `).bind(...binds).all<any>();

  const data = (results || []).map((r: any) => ({
    id: r.id,
    body: r.body,
    photo_url: r.photo_url,
    sold_out: !!r.sold_out,
    created_at: r.created_at,
    expires_at: r.expires_at,
    stand: {
      id: r.stand_id,
      name: r.stand_name,
      lat: r.stand_lat,
      lon: r.stand_lon,
      address_hint: r.stand_address_hint,
      phone: r.stand_phone,
      categories: JSON.parse(r.stand_categories || '[]'),
    },
  }));

  return c.json({ data });
}

/**
 * GET /api/t/:tenant/fresh/stands — map pins. Every publicly visible stand,
 * even one without a live post today (a stand is a place; the pin popup then
 * shows "Nothing posted today").
 */
export async function listFreshStands(c: AppContext) {
  const tenant = c.get('tenant');

  const { results } = await c.env.DB.prepare(`
    SELECT s.id, s.name, s.lat, s.lon, s.address_hint, s.phone, s.categories,
      EXISTS (
        SELECT 1 FROM fresh_posts p
        WHERE p.stand_id = s.id AND p.is_active = 1 AND p.admin_hidden = 0 AND p.expires_at > unixepoch()
      ) AS has_live_post,
      (
        SELECT p.body FROM fresh_posts p
        WHERE p.stand_id = s.id AND p.is_active = 1 AND p.admin_hidden = 0 AND p.expires_at > unixepoch()
        ORDER BY p.created_at DESC LIMIT 1
      ) AS latest_body
    FROM fresh_stands s
    WHERE s.tenant_id = ? AND s.deleted_at IS NULL AND s.is_hidden = 0 AND s.admin_hidden = 0
    ORDER BY s.created_at DESC
    LIMIT 300
  `).bind(tenant.id).all<any>();

  const data = (results || []).map((r: any) => ({
    id: r.id, name: r.name, lat: r.lat, lon: r.lon,
    address_hint: r.address_hint, phone: r.phone,
    categories: JSON.parse(r.categories || '[]'),
    has_live_post: r.has_live_post ? 1 : 0,
    latest_body: r.latest_body ?? null,
  }));

  return c.json({ data });
}

/**
 * GET /api/t/:tenant/fresh/stands/:id — stand detail + its live posts. 404 if
 * not publicly visible (owner uses /fresh/mine instead).
 */
export async function getFreshStand(c: AppContext) {
  const tenant = c.get('tenant');
  const id = c.req.param('id') ?? '';

  const stand = await c.env.DB.prepare(`
    SELECT id, name, description, lat, lon, address_hint, phone, categories, photo_url, created_at
    FROM fresh_stands
    WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL AND is_hidden = 0 AND admin_hidden = 0
  `).bind(id, tenant.id).first<any>();
  if (!stand) throw new HTTPException(404, { message: 'Stand not found.' });

  const { results: posts } = await c.env.DB.prepare(`
    SELECT id, body, photo_url, sold_out, sold_out_at, created_at, expires_at
    FROM fresh_posts
    WHERE stand_id = ? AND is_active = 1 AND admin_hidden = 0 AND expires_at > unixepoch()
    ORDER BY created_at DESC
  `).bind(id).all<any>();

  return c.json({ data: { ...serializeStand(stand), posts: posts || [] } });
}

/**
 * GET /api/t/:tenant/fresh/seasons — the harvest calendar. Every row plus a
 * computed in_season_now flag (compared against today's date in BOARD_TZ).
 */
export async function listFreshSeasons(c: AppContext) {
  const tenant = c.get('tenant');

  const { results } = await c.env.DB.prepare(`
    SELECT id, item_name, start_month, start_day, end_month, end_day, sort_order
    FROM fresh_seasons
    WHERE tenant_id = ?
    ORDER BY sort_order ASC
  `).bind(tenant.id).all<any>();

  const { month, day } = currentMonthDay();
  const data = (results || []).map((r: any) => ({
    ...r,
    in_season_now: isInSeason(r.start_month, r.start_day, r.end_month, r.end_day, month, day),
  }));

  return c.json({ data });
}

// ─────────────────────────────────────────────────────────────────────────────
// Authenticated — owner CRUD (any signed-in user, no merchant verification)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /fresh/mine — every stand the caller owns, in every state, each with
 * its latest 10 posts (also every state). Powers /fresh/mine ("My Stand").
 */
export async function listMyFresh(c: AppContext) {
  const user = c.get('user');
  const tenant = c.get('tenant');
  const kkauthUid = Number(user.sub);
  const now = Math.floor(Date.now() / 1000);

  const { results: standRows } = await c.env.DB.prepare(
    'SELECT * FROM fresh_stands WHERE tenant_id = ? AND kkauth_uid = ? ORDER BY created_at DESC'
  ).bind(tenant.id, kkauthUid).all<any>();

  const stands = [];
  for (const s of (standRows || [])) {
    const state = standState(s);

    const { results: postRows } = await c.env.DB.prepare(
      'SELECT * FROM fresh_posts WHERE stand_id = ? ORDER BY created_at DESC LIMIT 10'
    ).bind(s.id).all<any>();

    let relistAssigned = false;
    const posts = (postRows || []).map((p: any) => {
      const pState = postState(p, now);
      let canRelist = false;
      if (state === 'visible' && pState === 'expired' && !relistAssigned) {
        canRelist = true;
        relistAssigned = true;
      }
      return {
        id: p.id,
        body: p.body,
        photo_url: p.photo_url,
        sold_out: !!p.sold_out,
        created_at: p.created_at,
        expires_at: p.expires_at,
        state: pState,
        state_note: postStateNote(pState, p),
        can_relist: canRelist,
      };
    });

    stands.push({
      id: s.id,
      name: s.name,
      description: s.description,
      lat: s.lat,
      lon: s.lon,
      address_hint: s.address_hint,
      phone: s.phone,
      categories: JSON.parse(s.categories || '[]'),
      photo_url: s.photo_url,
      is_hidden: !!s.is_hidden,
      admin_hidden_reason: s.admin_hidden ? s.admin_hidden_reason : null,
      created_at: s.created_at,
      state,
      state_note: standStateNote(state, s),
      posts,
    });
  }

  return c.json({ data: { stands } });
}

/** POST /fresh/stands — create a producer stand. Max 3 per kkauth_uid. */
export async function createFreshStand(c: AppContext) {
  const user = c.get('user');
  const tenant = c.get('tenant');
  const kkauthUid = Number(user.sub);
  const body = await c.req.json<any>().catch(() => ({}));

  const countRow = await c.env.DB.prepare(
    'SELECT COUNT(*) AS n FROM fresh_stands WHERE tenant_id = ? AND kkauth_uid = ? AND deleted_at IS NULL'
  ).bind(tenant.id, kkauthUid).first<{ n: number }>();
  if ((countRow?.n ?? 0) >= STAND_CAP_PER_USER) {
    throw new HTTPException(409, { message: 'You can run up to three stands. Remove one to add another.' });
  }

  const input = parseStandInput(body);
  const id = nanoid(10);

  await c.env.DB.prepare(`
    INSERT INTO fresh_stands
      (id, tenant_id, kkauth_uid, name, description, lat, lon, address_hint, phone, categories, photo_url)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    id, tenant.id, kkauthUid, input.name, input.description, input.lat, input.lon,
    input.addressHint, input.phone, JSON.stringify(input.categories), input.photoUrl
  ).run();

  const stand = await c.env.DB.prepare('SELECT * FROM fresh_stands WHERE id = ?').bind(id).first<any>();
  return c.json({ data: serializeStand(stand) }, 201);
}

/** PUT /fresh/stands/:id — owner edits. Blocked (403) while admin-hidden. */
export async function updateFreshStand(c: AppContext) {
  const user = c.get('user');
  const tenant = c.get('tenant');
  const kkauthUid = Number(user.sub);
  const id = c.req.param('id') ?? '';
  const body = await c.req.json<any>().catch(() => ({}));

  const existing = await c.env.DB.prepare(
    'SELECT * FROM fresh_stands WHERE id = ? AND tenant_id = ?'
  ).bind(id, tenant.id).first<any>();
  if (!existing) throw new HTTPException(404, { message: 'Stand not found.' });
  if (existing.kkauth_uid !== kkauthUid) throw new HTTPException(403, { message: 'This is not your stand.' });
  if (existing.admin_hidden) {
    throw new HTTPException(403, { message: 'An admin has hidden this stand. The reason is on your My Stand page.' });
  }

  const input = parseStandInput(body, existing);

  await c.env.DB.prepare(`
    UPDATE fresh_stands
    SET name = ?, description = ?, lat = ?, lon = ?, address_hint = ?, phone = ?, categories = ?, photo_url = ?,
        updated_at = unixepoch()
    WHERE id = ? AND tenant_id = ? AND kkauth_uid = ?
  `).bind(
    input.name, input.description, input.lat, input.lon, input.addressHint, input.phone,
    JSON.stringify(input.categories), input.photoUrl, id, tenant.id, kkauthUid
  ).run();

  const stand = await c.env.DB.prepare('SELECT * FROM fresh_stands WHERE id = ?').bind(id).first<any>();
  return c.json({ data: serializeStand(stand) });
}

/**
 * POST /fresh/stands/:id/visibility — owner pause/show. Flips is_hidden only;
 * never touches admin_hidden. If the stand is admin-hidden, this always 403s
 * (regardless of the requested value) - only admin reverses that state.
 */
export async function setFreshStandVisibility(c: AppContext) {
  const user = c.get('user');
  const tenant = c.get('tenant');
  const kkauthUid = Number(user.sub);
  const id = c.req.param('id') ?? '';
  const body = await c.req.json<any>().catch(() => ({}));

  const existing = await c.env.DB.prepare(
    'SELECT * FROM fresh_stands WHERE id = ? AND tenant_id = ?'
  ).bind(id, tenant.id).first<any>();
  if (!existing) throw new HTTPException(404, { message: 'Stand not found.' });
  if (existing.kkauth_uid !== kkauthUid) throw new HTTPException(403, { message: 'This is not your stand.' });
  if (existing.admin_hidden) {
    throw new HTTPException(403, { message: 'An admin has hidden this stand. The reason is on your My Stand page.' });
  }

  const hidden = asBool(body.hidden, !!existing.is_hidden) ? 1 : 0;
  await c.env.DB.prepare(
    'UPDATE fresh_stands SET is_hidden = ?, updated_at = unixepoch() WHERE id = ? AND tenant_id = ? AND kkauth_uid = ?'
  ).bind(hidden, id, tenant.id, kkauthUid).run();

  const stand = await c.env.DB.prepare('SELECT * FROM fresh_stands WHERE id = ?').bind(id).first<any>();
  return c.json({ data: serializeStand(stand) });
}

/** DELETE /fresh/stands/:id — owner soft-delete (sets deleted_at). */
export async function deleteFreshStand(c: AppContext) {
  const user = c.get('user');
  const tenant = c.get('tenant');
  const kkauthUid = Number(user.sub);
  const id = c.req.param('id') ?? '';

  const res = await c.env.DB.prepare(
    'UPDATE fresh_stands SET deleted_at = unixepoch(), updated_at = unixepoch() WHERE id = ? AND tenant_id = ? AND kkauth_uid = ? AND deleted_at IS NULL'
  ).bind(id, tenant.id, kkauthUid).run();
  if (res.meta.changes !== 1) throw new HTTPException(404, { message: 'Stand not found.' });

  return c.json({ data: { removed: true } });
}

/**
 * POST /fresh/stands/:id/posts — owner posts today's update. The stand must
 * be visible (409 with reason copy if paused or admin-hidden); cooldown + cap
 * guard as usual.
 */
export async function createFreshPost(c: AppContext) {
  const user = c.get('user');
  const tenant = c.get('tenant');
  const kkauthUid = Number(user.sub);
  const standId = c.req.param('id') ?? '';
  const body = await c.req.json<any>().catch(() => ({}));

  const stand = await c.env.DB.prepare(
    'SELECT * FROM fresh_stands WHERE id = ? AND tenant_id = ? AND kkauth_uid = ?'
  ).bind(standId, tenant.id, kkauthUid).first<any>();
  if (!stand || stand.deleted_at) throw new HTTPException(404, { message: 'Stand not found.' });
  if (stand.admin_hidden) {
    throw new HTTPException(403, { message: 'An admin has hidden this stand. The reason is on your My Stand page.' });
  }
  if (stand.is_hidden) {
    throw new HTTPException(409, { message: 'Your stand is paused - tap Show on My Stand and then post.' });
  }

  const bodyText = cleanText(body.body, BODY_MAX);
  if (!bodyText) throw new HTTPException(400, { message: 'Write what you have today.' });

  await guardCooldownAndCap(c, standId);

  const id = nanoid(10);
  const expiresAt = endOfBoardDay();
  const photoUrl = cleanText(body.photo_url, 500);

  await c.env.DB.prepare(`
    INSERT INTO fresh_posts (id, tenant_id, stand_id, kkauth_uid, body, photo_url, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(id, tenant.id, standId, kkauthUid, bodyText, photoUrl, expiresAt).run();

  const post = await c.env.DB.prepare('SELECT * FROM fresh_posts WHERE id = ?').bind(id).first<any>();
  return c.json({ data: post }, 201);
}

/** PUT /fresh/posts/:id — owner edits body/photo while live or sold-out. */
export async function updateFreshPost(c: AppContext) {
  const user = c.get('user');
  const tenant = c.get('tenant');
  const kkauthUid = Number(user.sub);
  const id = c.req.param('id') ?? '';
  const body = await c.req.json<any>().catch(() => ({}));

  const existing = await c.env.DB.prepare(
    'SELECT * FROM fresh_posts WHERE id = ? AND tenant_id = ? AND kkauth_uid = ?'
  ).bind(id, tenant.id, kkauthUid).first<any>();
  if (!existing) throw new HTTPException(404, { message: 'Post not found.' });

  const now = Math.floor(Date.now() / 1000);
  if (!existing.is_active || existing.expires_at <= now) {
    throw new HTTPException(409, { message: 'This post has ended - post again to share an update.' });
  }

  const bodyText = body.body === undefined ? existing.body : cleanText(body.body, BODY_MAX);
  if (!bodyText) throw new HTTPException(400, { message: 'Write what you have today.' });
  const photoUrl = body.photo_url === undefined ? existing.photo_url : cleanText(body.photo_url, 500);

  await c.env.DB.prepare(
    'UPDATE fresh_posts SET body = ?, photo_url = ? WHERE id = ? AND tenant_id = ? AND kkauth_uid = ?'
  ).bind(bodyText, photoUrl, id, tenant.id, kkauthUid).run();

  const post = await c.env.DB.prepare('SELECT * FROM fresh_posts WHERE id = ?').bind(id).first<any>();
  return c.json({ data: post });
}

/** POST /fresh/posts/:id/sold-out — owner marks today's post sold out (idempotent). */
export async function setFreshPostSoldOut(c: AppContext) {
  const user = c.get('user');
  const tenant = c.get('tenant');
  const kkauthUid = Number(user.sub);
  const id = c.req.param('id') ?? '';

  const existing = await c.env.DB.prepare(
    'SELECT * FROM fresh_posts WHERE id = ? AND tenant_id = ? AND kkauth_uid = ?'
  ).bind(id, tenant.id, kkauthUid).first<any>();
  if (!existing) throw new HTTPException(404, { message: 'Post not found.' });

  if (!existing.sold_out) {
    await c.env.DB.prepare(
      'UPDATE fresh_posts SET sold_out = 1, sold_out_at = unixepoch() WHERE id = ? AND tenant_id = ? AND kkauth_uid = ?'
    ).bind(id, tenant.id, kkauthUid).run();
  }

  const post = await c.env.DB.prepare('SELECT * FROM fresh_posts WHERE id = ?').bind(id).first<any>();
  return c.json({ data: post });
}

/**
 * POST /fresh/posts/:id/relist — "Out again today". Source post must be the
 * newest expired, non-admin-hidden post for its stand (i.e. can_relist), and
 * the stand must still be visible. Creates a NEW row via the same guarded
 * path as createFreshPost - cooldown and cap apply normally.
 */
export async function relistFreshPost(c: AppContext) {
  const user = c.get('user');
  const tenant = c.get('tenant');
  const kkauthUid = Number(user.sub);
  const id = c.req.param('id') ?? '';
  const now = Math.floor(Date.now() / 1000);

  const existing = await c.env.DB.prepare(
    'SELECT * FROM fresh_posts WHERE id = ? AND tenant_id = ? AND kkauth_uid = ?'
  ).bind(id, tenant.id, kkauthUid).first<any>();
  if (!existing) throw new HTTPException(404, { message: 'Post not found.' });
  if (!existing.is_active || existing.admin_hidden || existing.expires_at > now) {
    throw new HTTPException(409, { message: 'Only an ended post can be relisted.' });
  }

  const stand = await c.env.DB.prepare(
    'SELECT * FROM fresh_stands WHERE id = ? AND tenant_id = ? AND kkauth_uid = ?'
  ).bind(existing.stand_id, tenant.id, kkauthUid).first<any>();
  if (!stand || stand.deleted_at) throw new HTTPException(404, { message: 'Stand not found.' });
  if (stand.admin_hidden) {
    throw new HTTPException(403, { message: 'An admin has hidden this stand. The reason is on your My Stand page.' });
  }
  if (stand.is_hidden) {
    throw new HTTPException(409, { message: 'Your stand is paused - tap Show on My Stand and then post.' });
  }

  // Must be the newest expired, non-admin-hidden post for this stand - the
  // same post the owner sees can_relist: true on in /fresh/mine.
  const latestExpired = await c.env.DB.prepare(`
    SELECT id FROM fresh_posts
    WHERE stand_id = ? AND is_active = 1 AND admin_hidden = 0 AND expires_at <= ?
    ORDER BY created_at DESC LIMIT 1
  `).bind(stand.id, now).first<{ id: string }>();
  if (!latestExpired || latestExpired.id !== existing.id) {
    throw new HTTPException(409, { message: 'Only your most recently ended post can be relisted.' });
  }

  await guardCooldownAndCap(c, stand.id);

  const newId = nanoid(10);
  const expiresAt = endOfBoardDay();

  await c.env.DB.prepare(`
    INSERT INTO fresh_posts (id, tenant_id, stand_id, kkauth_uid, body, photo_url, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(newId, tenant.id, stand.id, kkauthUid, existing.body, existing.photo_url, expiresAt).run();

  const post = await c.env.DB.prepare('SELECT * FROM fresh_posts WHERE id = ?').bind(newId).first<any>();
  return c.json({ data: post }, 201);
}

/** DELETE /fresh/posts/:id — owner early removal (soft: is_active = 0). */
export async function deleteFreshPost(c: AppContext) {
  const user = c.get('user');
  const tenant = c.get('tenant');
  const kkauthUid = Number(user.sub);
  const id = c.req.param('id') ?? '';

  const res = await c.env.DB.prepare(
    'UPDATE fresh_posts SET is_active = 0 WHERE id = ? AND tenant_id = ? AND kkauth_uid = ? AND is_active = 1'
  ).bind(id, tenant.id, kkauthUid).run();
  if (res.meta.changes !== 1) throw new HTTPException(404, { message: 'Post not found.' });

  return c.json({ data: { removed: true } });
}

// ─────────────────────────────────────────────────────────────────────────────
// Admin — hide with a required, owner-visible reason; only admin reverses
// ─────────────────────────────────────────────────────────────────────────────

/** GET /admin/fresh/stands — every stand, every state, newest first. */
export async function adminListFreshStands(c: AppContext) {
  requireAdmin(c);
  const tenant = c.get('tenant');

  const { results } = await c.env.DB.prepare(`
    SELECT s.*, u.email AS owner_email
    FROM fresh_stands s
    LEFT JOIN users u ON u.kkauth_uid = s.kkauth_uid AND u.tenant_id = s.tenant_id
    WHERE s.tenant_id = ?
    ORDER BY s.created_at DESC
    LIMIT 200
  `).bind(tenant.id).all<any>();

  const data = (results || []).map((r: any) => serializeStand(r));
  return c.json({ data });
}

/** GET /admin/fresh/posts — every post, every state, newest first. */
export async function adminListFreshPosts(c: AppContext) {
  requireAdmin(c);
  const tenant = c.get('tenant');

  const { results } = await c.env.DB.prepare(`
    SELECT p.*, s.name AS stand_name
    FROM fresh_posts p
    JOIN fresh_stands s ON s.id = p.stand_id
    WHERE p.tenant_id = ?
    ORDER BY p.created_at DESC
    LIMIT 200
  `).bind(tenant.id).all<any>();

  return c.json({ data: results || [] });
}

/**
 * POST /admin/fresh/stands/:id/hide — { hidden, reason? }. reason is REQUIRED
 * when hiding; owner cannot reverse (setFreshStandVisibility always 403s
 * while admin_hidden is set) - only this endpoint (hidden: false) clears it.
 */
export async function adminHideFreshStand(c: AppContext) {
  requireAdmin(c);
  const user = c.get('user');
  const tenant = c.get('tenant');
  const id = c.req.param('id') ?? '';
  const body = await c.req.json<any>().catch(() => ({}));

  const existing = await c.env.DB.prepare(
    'SELECT * FROM fresh_stands WHERE id = ? AND tenant_id = ?'
  ).bind(id, tenant.id).first<any>();
  if (!existing) throw new HTTPException(404, { message: 'Stand not found.' });

  if (body.hidden) {
    const reason = cleanText(body.reason, 500);
    if (!reason) throw new HTTPException(400, { message: "A reason is required when hiding a member's stand." });
    await c.env.DB.prepare(
      'UPDATE fresh_stands SET admin_hidden = 1, admin_hidden_reason = ?, admin_hidden_by = ?, updated_at = unixepoch() WHERE id = ? AND tenant_id = ?'
    ).bind(reason, Number(user.sub), id, tenant.id).run();
  } else {
    await c.env.DB.prepare(
      'UPDATE fresh_stands SET admin_hidden = 0, admin_hidden_reason = NULL, admin_hidden_by = NULL, updated_at = unixepoch() WHERE id = ? AND tenant_id = ?'
    ).bind(id, tenant.id).run();
  }

  const stand = await c.env.DB.prepare('SELECT * FROM fresh_stands WHERE id = ?').bind(id).first<any>();
  return c.json({ data: serializeStand(stand) });
}

/** POST /admin/fresh/posts/:id/hide — same contract as adminHideFreshStand. */
export async function adminHideFreshPost(c: AppContext) {
  requireAdmin(c);
  const user = c.get('user');
  const tenant = c.get('tenant');
  const id = c.req.param('id') ?? '';
  const body = await c.req.json<any>().catch(() => ({}));

  const existing = await c.env.DB.prepare(
    'SELECT * FROM fresh_posts WHERE id = ? AND tenant_id = ?'
  ).bind(id, tenant.id).first<any>();
  if (!existing) throw new HTTPException(404, { message: 'Post not found.' });

  if (body.hidden) {
    const reason = cleanText(body.reason, 500);
    if (!reason) throw new HTTPException(400, { message: "A reason is required when hiding a member's post." });
    await c.env.DB.prepare(
      'UPDATE fresh_posts SET admin_hidden = 1, admin_hidden_reason = ?, admin_hidden_by = ? WHERE id = ? AND tenant_id = ?'
    ).bind(reason, Number(user.sub), id, tenant.id).run();
  } else {
    await c.env.DB.prepare(
      'UPDATE fresh_posts SET admin_hidden = 0, admin_hidden_reason = NULL, admin_hidden_by = NULL WHERE id = ? AND tenant_id = ?'
    ).bind(id, tenant.id).run();
  }

  const post = await c.env.DB.prepare('SELECT * FROM fresh_posts WHERE id = ?').bind(id).first<any>();
  return c.json({ data: post });
}
