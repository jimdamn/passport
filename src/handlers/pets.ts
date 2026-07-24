/**
 * Home Safe — lost-and-found pet posts
 *
 * A donor-diff of Fresh Today / Sale Day: ONE table (a pet post is a
 * standalone object; nobody needs a profile to report a lost dog), a
 * RESOLUTION-based clock instead of end-of-day or scheduled-days expiry (30
 * days visible per create/renewal, renew-IN-PLACE so a share URL circulating
 * in a Facebook group never dies), a last-seen/found-at pin that is
 * deliberately a best guess, and a Home safe terminal state with a 3-day
 * public glow so the neighborhood sees endings.
 *
 * Contact (phone and/or email, at least one required) is MASKED by default -
 * a lost-pet poster is a private person, not an operator whose business is
 * being called. The values never leave the server in any public payload;
 * a signed-in neighbor requests them via a logged reveal, and the poster
 * sees who asked. Posters may opt in to the old inline behavior via
 * contact_public.
 *
 * PERMANENT rule (not a v1 scope choice): zero credits, KKGame calls,
 * notifications, or streaks on this board, ever. A lost pet is a family in
 * a bad week; the board's whole value is trust, and any profit motive
 * poisons it. Same admin hide-with-reason, soft delete, and lazy retirement
 * as every sibling board (ARCHITECTURE.md §13.10, the content-lifecycle
 * CRUD gate).
 *
 * This file does not import from fresh.ts/sales.ts except
 * REGION_BOUNDS/REGION_CENTER (the plan's explicit "import, never redefine"
 * rule) - every other helper (board-TZ date math, input cleaning, nearest-
 * town snapshot, guard shape) is copied rather than shared, same reasoning
 * those files document for not importing from each other.
 */

import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { Env } from '../types';
import { nanoid } from 'nanoid';
import { REGION_BOUNDS, REGION_CENTER } from './fresh';

type AppContext = Context<{ Bindings: Env }>;

// The board's wall-clock timezone - same as fresh.ts/sales.ts's BOARD_TZ.
const BOARD_TZ = 'America/New_York';

export const PET_TYPES = ['lost', 'found'] as const;
// UI labels (exact): Lost, Found

export const PET_SPECIES = [
  'dog', 'cat', 'bird', 'small_pet', 'horse_livestock', 'other',
] as const;
// UI labels (exact): Dog, Cat, Bird, Small Pet, Horse & Livestock, Other
// ('other' is deliberate on this board - donors don't have one, but a lost
// tortoise deserves a post; do not remove it)

const UNRESOLVED_CAP_PER_USER = 5;
const CREATE_COOLDOWN_MINUTES = 10;
const NAME_MAX = 40;
const BODY_MAX = 500;
const HINT_MAX = 120;
const ACTIVE_WINDOW_DAYS = 30;        // visible window per create/renewal
const RESOLVED_GLOW_DAYS = 3;         // Home-safe posts stay public this long
const SEEN_DATE_MAX_PAST_DAYS = 60;
const PHONE_MIN = 7;
const PHONE_MAX = 25;
const EMAIL_MAX = 120;
const REVEAL_DAILY_LIMIT = 20;

const ACTIVE_WINDOW_SECONDS = ACTIVE_WINDOW_DAYS * 86400;
const GLOW_WINDOW_SECONDS = RESOLVED_GLOW_DAYS * 86400;

export type PetStatus = 'looking' | 'archived' | 'home_safe';
type OwnerPetState = PetStatus | 'hidden_by_admin' | 'removed';

/**
 * petStatus(activeUntil, resolvedAt, now) - the one pure status helper,
 * mirrored in the UI. resolved_at set is permanent (home_safe) regardless of
 * whether the 3-day public glow window has passed - the glow is the READ
 * FILTER's job, not this function's.
 */
export function petStatus(activeUntil: number, resolvedAt: number | null, now: number): PetStatus {
  if (resolvedAt) return 'home_safe';
  if (now >= activeUntil) return 'archived';
  return 'looking';
}

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

// ─────────────────────────────────────────────────────────────────────────────
// Board-TZ date helpers - copied from sales.ts's boardDateStr/addDaysToDateStr
// (this file's own per-source independence, same reasoning fresh.ts/sales.ts
// document for not importing these from each other).
// ─────────────────────────────────────────────────────────────────────────────

function boardDateStr(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: BOARD_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? '00';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function addDaysToDateStr(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

const NEAREST_PLACE_TIMEOUT_MS = 3000;

/** Best-effort nearest-town snapshot - copied verbatim from fresh.ts's fetchNearestPlace. */
async function fetchNearestPlace(c: AppContext, lat: number, lon: number): Promise<{ city: string | null; state: string | null }> {
  try {
    const res = await c.env.KKAUTH.fetch(
      new Request(`https://kkauth/internal/nearest-place?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`, {
        headers: { 'X-Internal-Secret': c.env.INTERNAL_SECRET || '' },
        signal: AbortSignal.timeout(NEAREST_PLACE_TIMEOUT_MS),
      })
    );
    if (!res.ok) {
      console.error('[pets] nearest-place lookup returned non-OK status:', res.status);
      return { city: null, state: null };
    }
    const body = await res.json<any>();
    return {
      city: body?.data?.city ?? null,
      state: body?.data?.state ?? null,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[pets] nearest-place lookup failed:', msg);
    return { city: null, state: null };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Input validation
// ─────────────────────────────────────────────────────────────────────────────

function parseSeenDate(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  const invalid = () => new HTTPException(400, {
    message: "Check the date - it can't be in the future, and posts work best when it's recent.",
  });
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw invalid();

  const today = boardDateStr();
  const minDate = addDaysToDateStr(today, -SEEN_DATE_MAX_PAST_DAYS);
  if (value > today || value < minDate) throw invalid();
  return value;
}

/** Phone and/or email, at least one required - the poster's contact info. */
function parseContact(body: any, existing?: any): { phone: string | null; email: string | null } {
  const phone = body.phone === undefined ? (existing?.phone ?? null) : cleanText(body.phone, PHONE_MAX);
  if (phone !== null && phone.length < PHONE_MIN) {
    throw new HTTPException(400, { message: 'Add a phone number (7-25 characters) or an email.' });
  }

  const email = body.email === undefined ? (existing?.email ?? null) : cleanText(body.email, EMAIL_MAX);
  if (email !== null && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new HTTPException(400, { message: "Check the email address - it doesn't look right." });
  }

  if (!phone && !email) {
    throw new HTTPException(400, {
      message: "Add a phone number or an email - it's how a neighbor reaches you when they spot them.",
    });
  }

  return { phone, email };
}

interface PetInput {
  type: string; species: string; petName: string | null; bodyText: string;
  lat: number; lon: number; locationHint: string | null; seenDate: string | null;
  phone: string | null; email: string | null; contactPublic: boolean; photoUrl: string | null;
}

/**
 * Validates create/update input. `type` is immutable on edit - a body.type
 * that differs from the existing row's type 400s with the §7.2 copy rather
 * than being silently ignored.
 */
function parsePetInput(body: any, existing?: any): PetInput {
  let type: string;
  if (existing) {
    if (body.type !== undefined && body.type !== existing.type) {
      throw new HTTPException(400, { message: "A lost post can't become a found post - remove it and start the right one." });
    }
    type = existing.type;
  } else {
    type = body.type;
    if (!type || !(PET_TYPES as readonly string[]).includes(type)) {
      throw new HTTPException(400, { message: 'Pick lost or found.' });
    }
  }

  const species = body.species === undefined ? (existing?.species ?? null) : body.species;
  if (!species || !(PET_SPECIES as readonly string[]).includes(species)) {
    throw new HTTPException(400, { message: 'Pick a species for your post.' });
  }

  const petName = body.pet_name === undefined ? (existing?.pet_name ?? null) : cleanText(body.pet_name, NAME_MAX);

  const bodyText = body.body === undefined ? (existing?.body ?? null) : cleanText(body.body, BODY_MAX);
  if (!bodyText) {
    throw new HTTPException(400, { message: 'Describe them so a neighbor would recognize them (1-500 characters).' });
  }

  const lat = body.lat !== undefined ? Number(body.lat) : Number(existing?.lat);
  const lon = body.lon !== undefined ? Number(body.lon) : Number(existing?.lon);
  if (
    !Number.isFinite(lat) || !Number.isFinite(lon) ||
    lat < REGION_BOUNDS.minLat || lat > REGION_BOUNDS.maxLat ||
    lon < REGION_BOUNDS.minLon || lon > REGION_BOUNDS.maxLon
  ) {
    throw new HTTPException(400, { message: 'Place the pin inside the Lakes Region - closest corner to where they were seen.' });
  }

  const locationHint = body.location_hint === undefined ? (existing?.location_hint ?? null) : cleanText(body.location_hint, HINT_MAX);
  const seenDate = body.seen_date === undefined ? (existing?.seen_date ?? null) : parseSeenDate(body.seen_date);

  const { phone, email } = parseContact(body, existing);
  const contactPublic = body.contact_public === undefined ? (existing ? !!existing.contact_public : false) : asBool(body.contact_public, false);
  const photoUrl = body.photo_url === undefined ? (existing?.photo_url ?? null) : cleanText(body.photo_url, 500);

  return { type, species, petName, bodyText, lat, lon, locationHint, seenDate, phone, email, contactPublic, photoUrl };
}

/** Cooldown + unresolved-post cap, shared by createPetPost. */
async function guardCooldownAndCap(c: AppContext, tenantId: string, kkauthUid: number) {
  const last = await c.env.DB.prepare(
    'SELECT created_at FROM pet_posts WHERE tenant_id = ? AND kkauth_uid = ? ORDER BY created_at DESC LIMIT 1'
  ).bind(tenantId, kkauthUid).first<{ created_at: number }>();
  if (last) {
    const since = Math.floor(Date.now() / 1000) - last.created_at;
    if (since < CREATE_COOLDOWN_MINUTES * 60) {
      throw new HTTPException(429, { message: 'Give it a few minutes between posts - you can add another shortly.' });
    }
  }

  const unresolved = await c.env.DB.prepare(
    'SELECT COUNT(*) AS n FROM pet_posts WHERE tenant_id = ? AND kkauth_uid = ? AND deleted_at IS NULL AND resolved_at IS NULL'
  ).bind(tenantId, kkauthUid).first<{ n: number }>();
  if ((unresolved?.n ?? 0) >= UNRESOLVED_CAP_PER_USER) {
    throw new HTTPException(409, {
      message: `You have ${UNRESOLVED_CAP_PER_USER} posts up. Mark one Home safe or remove one to add another.`,
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Public/owner shaping
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The public shape for feed/pins/detail. Contact VALUES never cross the wire
 * unless contact_public = 1 - enforced here by explicit field selection, not
 * by trimming client-side. Masked rows carry has_phone/has_email booleans
 * instead so the UI can still render a "Get in touch" affordance.
 */
function publicPetShape(row: any, status: PetStatus) {
  const base = {
    id: row.id,
    type: row.type,
    species: row.species,
    pet_name: row.pet_name,
    body: row.body,
    lat: row.lat,
    lon: row.lon,
    location_hint: row.location_hint,
    seen_date: row.seen_date,
    photo_url: row.photo_url,
    nearest_city: row.nearest_city ?? null,
    nearest_state: row.nearest_state ?? null,
    contact_public: !!row.contact_public,
    created_at: row.created_at,
    active_until: row.active_until,
    resolved_at: row.resolved_at,
    status,
  };
  if (row.contact_public) {
    return { ...base, phone: row.phone, email: row.email };
  }
  return { ...base, has_phone: !!row.phone, has_email: !!row.email };
}

function pinKind(type: string, status: PetStatus): 'amber' | 'green' {
  if (status === 'home_safe') return 'green';
  return type === 'lost' ? 'amber' : 'green';
}

function ownerPetState(row: any, now: number): OwnerPetState {
  if (row.admin_hidden) return 'hidden_by_admin';
  return petStatus(row.active_until, row.resolved_at, now);
}

function ownerPetStateNote(state: OwnerPetState, row: any): string {
  switch (state) {
    case 'looking': {
      const date = new Date(row.active_until * 1000).toLocaleDateString('en-US', { timeZone: BOARD_TZ, month: 'short', day: 'numeric' });
      return `On the board - neighbors can see it and your number. Runs until ${date}, and you can extend it anytime.`;
    }
    case 'archived':
      return "It's been 30 days, so the board stopped showing it. Still looking? One tap puts it back out there.";
    case 'home_safe': {
      const date = new Date(row.resolved_at * 1000).toLocaleDateString('en-US', { timeZone: BOARD_TZ, month: 'short', day: 'numeric' });
      return `Home safe ${date}. The board showed the good news for a few days after.`;
    }
    case 'hidden_by_admin':
      return `Hidden by an admin: "${row.admin_hidden_reason}" - reply from your profile's Talk to Us if you have questions.`;
    case 'removed':
      return 'Removed.';
  }
}

/** Full owner-facing shape (unmasked contact) - used by mine/create/update/etc. */
function ownerPetShape(row: any, now: number) {
  const state = ownerPetState(row, now);
  return {
    id: row.id,
    type: row.type,
    species: row.species,
    pet_name: row.pet_name,
    body: row.body,
    lat: row.lat,
    lon: row.lon,
    location_hint: row.location_hint,
    seen_date: row.seen_date,
    phone: row.phone,
    email: row.email,
    contact_public: !!row.contact_public,
    photo_url: row.photo_url,
    nearest_city: row.nearest_city ?? null,
    nearest_state: row.nearest_state ?? null,
    active_until: row.active_until,
    renewed_at: row.renewed_at,
    resolved_at: row.resolved_at,
    admin_hidden_reason: row.admin_hidden ? row.admin_hidden_reason : null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    state,
    state_note: ownerPetStateNote(state, row),
  };
}

// The public read filter (§2, §8 - the complete, binding WHERE list). Bound
// with GLOW_WINDOW_SECONDS as a parameter rather than inlined, so the value
// only ever lives in one place.
const PUBLIC_FILTER =
  '(resolved_at IS NULL AND active_until > unixepoch()) OR resolved_at > (unixepoch() - ?)';

// ─────────────────────────────────────────────────────────────────────────────
// Public board (root app, resolveTenant, guest-friendly)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/t/:tenant/pets — the public feed. Optional ?type=/?species=
 * filters. Unresolved posts first (newest first), then resolved glow rows
 * (newest first) - the split is computed in JS after one fetch.
 */
export async function listPetPosts(c: AppContext) {
  const tenant = c.get('tenant');
  const type = c.req.query('type');
  const species = c.req.query('species');
  const now = Math.floor(Date.now() / 1000);

  const filters = ['tenant_id = ?', 'deleted_at IS NULL', 'admin_hidden = 0', `(${PUBLIC_FILTER})`];
  const binds: any[] = [tenant.id, GLOW_WINDOW_SECONDS];
  if (type && (PET_TYPES as readonly string[]).includes(type)) {
    filters.push('type = ?');
    binds.push(type);
  }
  if (species && (PET_SPECIES as readonly string[]).includes(species)) {
    filters.push('species = ?');
    binds.push(species);
  }

  const { results } = await c.env.DB.prepare(`
    SELECT * FROM pet_posts WHERE ${filters.join(' AND ')} ORDER BY created_at DESC LIMIT 200
  `).bind(...binds).all<any>();

  const unresolved: any[] = [];
  const resolved: any[] = [];
  for (const r of (results || [])) {
    const status = petStatus(r.active_until, r.resolved_at, now);
    const shaped = publicPetShape(r, status);
    (status === 'home_safe' ? resolved : unresolved).push(shaped);
  }

  return c.json({ data: [...unresolved, ...resolved] });
}

/** GET /api/t/:tenant/pets/pins — map pins, same filter as listPetPosts. */
export async function listPetPins(c: AppContext) {
  const tenant = c.get('tenant');
  const now = Math.floor(Date.now() / 1000);

  const { results } = await c.env.DB.prepare(`
    SELECT id, lat, lon, type, species, pet_name, location_hint, nearest_city, active_until, resolved_at
    FROM pet_posts
    WHERE tenant_id = ? AND deleted_at IS NULL AND admin_hidden = 0 AND (${PUBLIC_FILTER})
    ORDER BY created_at DESC LIMIT 300
  `).bind(tenant.id, GLOW_WINDOW_SECONDS).all<any>();

  const data = (results || []).map((r: any) => {
    const status = petStatus(r.active_until, r.resolved_at, now);
    return {
      id: r.id,
      lat: r.lat,
      lon: r.lon,
      type: r.type,
      species: r.species,
      pet_name: r.pet_name,
      location_hint: r.location_hint,
      nearest_city: r.nearest_city ?? null,
      status,
      kind: pinKind(r.type, status),
    };
  });

  return c.json({ data });
}

/**
 * GET /api/t/:tenant/pets/:id — public detail (the shareable object). Same
 * contact masking as the feed. 404 if not publicly visible (owner uses
 * /pets/mine). MUST be registered after /pets/pins (Hono order, sibling
 * lesson).
 */
export async function getPetPost(c: AppContext) {
  const tenant = c.get('tenant');
  const id = c.req.param('id') ?? '';
  const now = Math.floor(Date.now() / 1000);

  const row = await c.env.DB.prepare(`
    SELECT * FROM pet_posts
    WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL AND admin_hidden = 0 AND (${PUBLIC_FILTER})
  `).bind(id, tenant.id, GLOW_WINDOW_SECONDS).first<any>();
  if (!row) throw new HTTPException(404, { message: 'Post not found.' });

  const status = petStatus(row.active_until, row.resolved_at, now);
  return c.json({ data: publicPetShape(row, status) });
}

// ─────────────────────────────────────────────────────────────────────────────
// Authenticated — owner CRUD (any signed-in user, no merchant verification)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /pets/mine — every post the caller owns EXCEPT deleted ones (removed
 * posts drop from the list after the confirm - deliberate, §7.3), newest
 * first, latest 20. Each carries the reveal log (requester display name +
 * when, latest 10, plus a total count).
 */
export async function listMyPetPosts(c: AppContext) {
  const user = c.get('user');
  const tenant = c.get('tenant');
  const kkauthUid = Number(user.sub);
  const now = Math.floor(Date.now() / 1000);

  const { results } = await c.env.DB.prepare(
    'SELECT * FROM pet_posts WHERE tenant_id = ? AND kkauth_uid = ? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 20'
  ).bind(tenant.id, kkauthUid).all<any>();

  const posts = [];
  for (const r of (results || [])) {
    const { results: revealRows } = await c.env.DB.prepare(`
      SELECT pr.kkauth_uid, pr.created_at, u.display_name
      FROM pet_contact_reveals pr
      LEFT JOIN users u ON u.kkauth_uid = pr.kkauth_uid AND u.tenant_id = pr.tenant_id
      WHERE pr.post_id = ?
      ORDER BY pr.created_at DESC LIMIT 10
    `).bind(r.id).all<any>();
    const totalRow = await c.env.DB.prepare(
      'SELECT COUNT(*) AS n FROM pet_contact_reveals WHERE post_id = ?'
    ).bind(r.id).first<{ n: number }>();

    posts.push({
      ...ownerPetShape(r, now),
      reveal_count: totalRow?.n ?? 0,
      reveals: (revealRows || []).map((x: any) => ({ display_name: x.display_name ?? 'A neighbor', created_at: x.created_at })),
    });
  }

  return c.json({ data: { posts } });
}

/** POST /pets/upload — owner uploads a photo. Clone of uploadFreshPhoto. */
export async function uploadPetPhoto(c: AppContext) {
  const user = c.get('user');
  const kkauthUid = Number(user.sub);

  const form = await c.req.formData().catch(() => null);
  const file = form?.get('file');
  if (!file || typeof file === 'string') {
    throw new HTTPException(400, { message: 'Choose a photo to upload.' });
  }

  const uploadForm = new FormData();
  uploadForm.append('file', file as File);
  uploadForm.append('user_id', String(kkauthUid));
  uploadForm.append('variant', 'mobile');

  const res = await c.env.KKAUTH.fetch(
    new Request('https://kkauth/internal/uploads', {
      method: 'POST',
      headers: { 'X-Internal-Secret': c.env.INTERNAL_SECRET || '' },
      body: uploadForm,
    })
  );

  const kkBody = await res.json<any>().catch(() => ({}));
  if (!res.ok) {
    return c.json(kkBody, res.status as any);
  }

  return c.json({ data: { url: kkBody?.data?.url ?? null } });
}

/** POST /pets — create a lost or found post. Cooldown 429; unresolved-cap 409. */
export async function createPetPost(c: AppContext) {
  const user = c.get('user');
  const tenant = c.get('tenant');
  const kkauthUid = Number(user.sub);
  const body = await c.req.json<any>().catch(() => ({}));

  const input = parsePetInput(body);
  await guardCooldownAndCap(c, tenant.id, kkauthUid);

  const id = nanoid(10);
  const now = Math.floor(Date.now() / 1000);
  const activeUntil = now + ACTIVE_WINDOW_SECONDS;
  const nearest = await fetchNearestPlace(c, input.lat, input.lon);

  await c.env.DB.prepare(`
    INSERT INTO pet_posts
      (id, tenant_id, kkauth_uid, type, species, pet_name, body, lat, lon, location_hint, seen_date,
       phone, email, contact_public, photo_url, nearest_city, nearest_state, active_until)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    id, tenant.id, kkauthUid, input.type, input.species, input.petName, input.bodyText, input.lat, input.lon,
    input.locationHint, input.seenDate, input.phone, input.email, input.contactPublic ? 1 : 0, input.photoUrl,
    nearest.city, nearest.state, activeUntil
  ).run();

  const row = await c.env.DB.prepare('SELECT * FROM pet_posts WHERE id = ?').bind(id).first<any>();
  return c.json({ data: ownerPetShape(row, now) }, 201);
}

/**
 * PUT /pets/posts/:id — owner edits everything except `type` while
 * unresolved (looking or archived) and not admin-hidden. Editing does NOT
 * extend active_until - renewal is its own deliberate act.
 */
export async function updatePetPost(c: AppContext) {
  const user = c.get('user');
  const tenant = c.get('tenant');
  const kkauthUid = Number(user.sub);
  const id = c.req.param('id') ?? '';
  const body = await c.req.json<any>().catch(() => ({}));

  const existing = await c.env.DB.prepare(
    'SELECT * FROM pet_posts WHERE id = ? AND tenant_id = ? AND kkauth_uid = ? AND deleted_at IS NULL'
  ).bind(id, tenant.id, kkauthUid).first<any>();
  if (!existing) throw new HTTPException(404, { message: 'Post not found.' });
  if (existing.admin_hidden) {
    throw new HTTPException(403, { message: 'An admin has hidden this post. The reason is on your Home Safe page.' });
  }
  if (existing.resolved_at) {
    throw new HTTPException(409, { message: "This one's home safe - nothing left to edit. Post again if a new situation comes up." });
  }

  const input = parsePetInput(body, existing);

  const pinMoved = input.lat !== existing.lat || input.lon !== existing.lon;
  let nearestCity = existing.nearest_city ?? null;
  let nearestState = existing.nearest_state ?? null;
  if (pinMoved || nearestCity === null) {
    const nearest = await fetchNearestPlace(c, input.lat, input.lon);
    nearestCity = nearest.city;
    nearestState = nearest.state;
  }

  await c.env.DB.prepare(`
    UPDATE pet_posts
    SET species = ?, pet_name = ?, body = ?, lat = ?, lon = ?, location_hint = ?, seen_date = ?,
        phone = ?, email = ?, contact_public = ?, photo_url = ?, nearest_city = ?, nearest_state = ?,
        updated_at = unixepoch()
    WHERE id = ? AND tenant_id = ? AND kkauth_uid = ?
  `).bind(
    input.species, input.petName, input.bodyText, input.lat, input.lon, input.locationHint, input.seenDate,
    input.phone, input.email, input.contactPublic ? 1 : 0, input.photoUrl, nearestCity, nearestState,
    id, tenant.id, kkauthUid
  ).run();

  const row = await c.env.DB.prepare('SELECT * FROM pet_posts WHERE id = ?').bind(id).first<any>();
  return c.json({ data: ownerPetShape(row, Math.floor(Date.now() / 1000)) });
}

/**
 * POST /pets/posts/:id/home-safe — owner marks reunited. Idempotent; works
 * on looking AND archived posts (late good news is still good news).
 */
export async function resolvePetPost(c: AppContext) {
  const user = c.get('user');
  const tenant = c.get('tenant');
  const kkauthUid = Number(user.sub);
  const id = c.req.param('id') ?? '';

  const existing = await c.env.DB.prepare(
    'SELECT * FROM pet_posts WHERE id = ? AND tenant_id = ? AND kkauth_uid = ? AND deleted_at IS NULL'
  ).bind(id, tenant.id, kkauthUid).first<any>();
  if (!existing) throw new HTTPException(404, { message: 'Post not found.' });
  if (existing.admin_hidden) {
    throw new HTTPException(403, { message: 'An admin has hidden this post. The reason is on your Home Safe page.' });
  }

  if (!existing.resolved_at) {
    await c.env.DB.prepare(
      'UPDATE pet_posts SET resolved_at = unixepoch(), updated_at = unixepoch() WHERE id = ? AND tenant_id = ? AND kkauth_uid = ?'
    ).bind(id, tenant.id, kkauthUid).run();
  }

  const row = await c.env.DB.prepare('SELECT * FROM pet_posts WHERE id = ?').bind(id).first<any>();
  return c.json({ data: ownerPetShape(row, Math.floor(Date.now() / 1000)) });
}

/**
 * POST /pets/posts/:id/renew — "Still looking". Unresolved only (409
 * otherwise); sets renewed_at = now, active_until = now + 30d, on the SAME
 * row - a lost-pet share URL circulating in Facebook groups must never die.
 */
export async function renewPetPost(c: AppContext) {
  const user = c.get('user');
  const tenant = c.get('tenant');
  const kkauthUid = Number(user.sub);
  const id = c.req.param('id') ?? '';

  const existing = await c.env.DB.prepare(
    'SELECT * FROM pet_posts WHERE id = ? AND tenant_id = ? AND kkauth_uid = ? AND deleted_at IS NULL'
  ).bind(id, tenant.id, kkauthUid).first<any>();
  if (!existing) throw new HTTPException(404, { message: 'Post not found.' });
  if (existing.admin_hidden) {
    throw new HTTPException(403, { message: 'An admin has hidden this post. The reason is on your Home Safe page.' });
  }
  if (existing.resolved_at) {
    throw new HTTPException(409, { message: "This one's home safe - no need to keep it out there." });
  }

  const now = Math.floor(Date.now() / 1000);
  const activeUntil = now + ACTIVE_WINDOW_SECONDS;
  await c.env.DB.prepare(
    'UPDATE pet_posts SET renewed_at = ?, active_until = ?, updated_at = unixepoch() WHERE id = ? AND tenant_id = ? AND kkauth_uid = ?'
  ).bind(now, activeUntil, id, tenant.id, kkauthUid).run();

  const row = await c.env.DB.prepare('SELECT * FROM pet_posts WHERE id = ?').bind(id).first<any>();
  return c.json({ data: ownerPetShape(row, now) });
}

/** DELETE /pets/posts/:id — owner soft-delete. No children touched (photo stays an R2 object). */
export async function deletePetPost(c: AppContext) {
  const user = c.get('user');
  const tenant = c.get('tenant');
  const kkauthUid = Number(user.sub);
  const id = c.req.param('id') ?? '';

  const res = await c.env.DB.prepare(
    'UPDATE pet_posts SET deleted_at = unixepoch(), updated_at = unixepoch() WHERE id = ? AND tenant_id = ? AND kkauth_uid = ? AND deleted_at IS NULL'
  ).bind(id, tenant.id, kkauthUid).run();
  if (res.meta.changes !== 1) throw new HTTPException(404, { message: 'Post not found.' });

  return c.json({ data: { removed: true } });
}

/**
 * POST /pets/posts/:id/contact — a logged, signed-in reveal. The post must be
 * publicly visible (404 otherwise - covers removed/admin-hidden too). Upserts
 * the reveal row (idempotent per user+post via the unique index - a repeat
 * request never re-consumes the daily quota). Rate limit: 20 NEW reveals per
 * user per day across the whole board.
 */
export async function revealPetContact(c: AppContext) {
  const user = c.get('user');
  const tenant = c.get('tenant');
  const kkauthUid = Number(user.sub);
  const id = c.req.param('id') ?? '';
  const now = Math.floor(Date.now() / 1000);

  const row = await c.env.DB.prepare(`
    SELECT * FROM pet_posts
    WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL AND admin_hidden = 0 AND (${PUBLIC_FILTER})
  `).bind(id, tenant.id, GLOW_WINDOW_SECONDS).first<any>();
  if (!row) throw new HTTPException(404, { message: 'Post not found.' });

  const alreadyRevealed = await c.env.DB.prepare(
    'SELECT 1 FROM pet_contact_reveals WHERE post_id = ? AND kkauth_uid = ?'
  ).bind(id, kkauthUid).first();

  if (!alreadyRevealed) {
    const dayAgo = now - 86400;
    const countRow = await c.env.DB.prepare(
      'SELECT COUNT(*) AS n FROM pet_contact_reveals WHERE tenant_id = ? AND kkauth_uid = ? AND created_at > ?'
    ).bind(tenant.id, kkauthUid, dayAgo).first<{ n: number }>();
    if ((countRow?.n ?? 0) >= REVEAL_DAILY_LIMIT) {
      throw new HTTPException(429, { message: "That's a lot of requests for one day - try again tomorrow." });
    }
  }

  await c.env.DB.prepare(
    'INSERT OR IGNORE INTO pet_contact_reveals (tenant_id, post_id, kkauth_uid) VALUES (?, ?, ?)'
  ).bind(tenant.id, id, kkauthUid).run();

  return c.json({
    data: {
      phone: row.phone,
      email: row.email,
      poster_note: "They'll see your name asked. Give them a call or a text - short and kind.",
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Admin — hide with a required, owner-visible reason; only admin reverses
// ─────────────────────────────────────────────────────────────────────────────

/** GET /admin/pets — every post, every state incl. deleted, newest first. */
export async function adminListPetPosts(c: AppContext) {
  requireAdmin(c);
  const tenant = c.get('tenant');

  const { results } = await c.env.DB.prepare(`
    SELECT p.*, u.email AS owner_email
    FROM pet_posts p
    LEFT JOIN users u ON u.kkauth_uid = p.kkauth_uid AND u.tenant_id = p.tenant_id
    WHERE p.tenant_id = ?
    ORDER BY p.created_at DESC
    LIMIT 200
  `).bind(tenant.id).all<any>();

  return c.json({ data: results || [] });
}

/**
 * POST /admin/pets/:id/hide — { hidden, reason? }. Donor contract exactly:
 * reason required when hiding, stored + admin_hidden_by, owner cannot
 * self-restore.
 */
export async function adminHidePetPost(c: AppContext) {
  requireAdmin(c);
  const user = c.get('user');
  const tenant = c.get('tenant');
  const id = c.req.param('id') ?? '';
  const body = await c.req.json<any>().catch(() => ({}));

  const existing = await c.env.DB.prepare(
    'SELECT * FROM pet_posts WHERE id = ? AND tenant_id = ?'
  ).bind(id, tenant.id).first<any>();
  if (!existing) throw new HTTPException(404, { message: 'Post not found.' });

  if (body.hidden) {
    const reason = cleanText(body.reason, 500);
    if (!reason) throw new HTTPException(400, { message: "A reason is required when hiding a member's post." });
    await c.env.DB.prepare(
      'UPDATE pet_posts SET admin_hidden = 1, admin_hidden_reason = ?, admin_hidden_by = ?, updated_at = unixepoch() WHERE id = ? AND tenant_id = ?'
    ).bind(reason, Number(user.sub), id, tenant.id).run();
  } else {
    await c.env.DB.prepare(
      'UPDATE pet_posts SET admin_hidden = 0, admin_hidden_reason = NULL, admin_hidden_by = NULL, updated_at = unixepoch() WHERE id = ? AND tenant_id = ?'
    ).bind(id, tenant.id).run();
  }

  const row = await c.env.DB.prepare('SELECT * FROM pet_posts WHERE id = ?').bind(id).first<any>();
  return c.json({ data: row });
}
