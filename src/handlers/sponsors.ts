/**
 * Sponsor Drawer — a calm, dismissible "Brought to you by X" bottom card
 * crediting a member business sponsoring a route (optionally scoped to a
 * sub-location). Admin-created only in v1 (SPONSOR-DRAWER-BUILD-PLAN.md).
 *
 * Zero economy surface: no credits, no KKGame calls, no notifications. No FK
 * from sponsorship into users/reputation/directory tables. No per-user
 * tracking: sponsor_impressions is daily aggregates only, keyed by
 * (placement_id, day) - frequency capping lives entirely client-side.
 *
 * This file deliberately does not import from fresh.ts/happenings.ts (same
 * "copy, never share code" reasoning as every other board module -
 * ARCHITECTURE.md's Board Module Pattern) even though the admin-auth check,
 * nearest-place lookup, and datetime helpers below are structurally
 * identical to fresh.ts's.
 */

import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { Env, TenantConfig } from '../types';

type AppContext = Context<{ Bindings: Env }>;

const BOARD_TZ = 'America/New_York';

// The backend is the source of truth so a crafted request can't invent an
// app or route the admin dropdown doesn't know about. Route sponsorship is a
// curated inventory, not an open field - verify each addition against the
// live App.tsx/router of the app in question before hardcoding.
//
// A bare route string collides across apps ('/' and '/help' exist in nearly
// every sibling), so every placement names both an app and a route within
// it (0017-sponsor-drawer-siblings.sql). Increment 1+2 shipped Passport-only;
// Increment 3 adds the three sibling mounts.
export const SPONSOR_APPS = [
  { value: 'passport', label: 'Passport' },
  { value: 'exchange', label: 'Exchange' },
  { value: 'field-notes', label: 'Field Notes' },
  { value: 'apps-hub', label: 'Apps Hub' },
] as const;
const KNOWN_APP_VALUES = SPONSOR_APPS.map(a => a.value) as readonly string[];

export const SPONSOR_ROUTES_BY_APP: Record<string, { value: string; label: string }[]> = {
  passport: [
    { value: '/explore', label: 'Around Town' },
    { value: '/happenings', label: 'Happenings' },
    { value: '/deals', label: 'Deals' },
    { value: '/fresh', label: 'Fresh Today' },
    { value: '/sales', label: 'Sale Day' },
    { value: '/pets', label: 'Home Safe' },
    { value: '/popups', label: 'Pop-Ups' },
    { value: '/meals', label: 'Community Table' },
    { value: '/kwest', label: 'KrowdKwest' },
  ],
  exchange: [
    { value: '/', label: 'Browse' },
    { value: '/trades', label: 'My Trades' },
    { value: '/me/posts', label: 'My Posts' },
  ],
  'field-notes': [
    { value: '/', label: 'Stories Feed' },
    { value: '/submit', label: 'Share a Story' },
    { value: '/my-stories', label: 'My Stories' },
  ],
  'apps-hub': [
    { value: '/', label: 'Hub Home' },
  ],
};
function knownRoutesFor(app: string): readonly string[] {
  return (SPONSOR_ROUTES_BY_APP[app] || []).map(r => r.value);
}

const SPONSOR_NAME_MIN = 2;
const SPONSOR_NAME_MAX = 60;
const MESSAGE_MIN = 5;
const MESSAGE_MAX = 120;

const COLLISION_MSG = 'That route and area already have a sponsor for that period.';

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

/** SQLite datetime('now') format: 'YYYY-MM-DD HH:MM:SS' UTC. */
function toSqlDatetime(ms: number): string {
  return new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
}

function nowSql(): string {
  return toSqlDatetime(Date.now());
}

/**
 * Same allowlist logic as the CORS check in functions/api/[[route]].ts -
 * duplicated rather than imported (board-module "copy, never share code"
 * convention) since link_url validation is a one-off string check, not a
 * shared module. A relative path is always allowed (same-origin by
 * construction); an absolute URL must resolve to a Hub origin.
 */
function isHubUrl(url: string): boolean {
  if (url.startsWith('/')) return true;
  try {
    const { hostname } = new URL(url);
    return (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname.endsWith('.pages.dev') ||
      hostname === 'lakeandlocals.com' ||
      hostname.endsWith('.lakeandlocals.com')
    );
  } catch {
    return false;
  }
}

const NEAREST_PLACE_TIMEOUT_MS = 3000;

/**
 * Best-effort lookup of the nearest known town/state for a lat/lon, via
 * KKAuth's GET /internal/nearest-place over the existing KKAUTH service
 * binding (copied from fresh.ts's fetchNearestPlace - same call shape).
 * Never throws - every failure path resolves to null so a lookup failure
 * degrades to "no city match" rather than a 500.
 */
async function nearestPlace(c: AppContext, lat: number, lon: number): Promise<{ city: string; state: string } | null> {
  try {
    const res = await c.env.KKAUTH.fetch(
      new Request(`https://kkauth/internal/nearest-place?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`, {
        headers: { 'X-Internal-Secret': c.env.INTERNAL_SECRET || '' },
        signal: AbortSignal.timeout(NEAREST_PLACE_TIMEOUT_MS),
      })
    );
    if (!res.ok) return null;
    const body = await res.json<any>();
    const city = body?.data?.city ?? null;
    const state = body?.data?.state ?? null;
    return city && state ? { city, state } : null;
  } catch (err) {
    console.error('[sponsors] nearest-place lookup failed:', err instanceof Error ? err.message : String(err));
    return null;
  }
}

/**
 * Geocodes a free-text "City, ST" admin input to lat/lon (Census/Nominatim,
 * same fetch as geocode.ts), then confirms it against the zip_codes-backed
 * nearest-place lookup and returns the CANONICAL "City, ST" string from that
 * table - so the value stored on a placement always matches the format
 * resolveSponsorDrawer will compute for a visitor's home ZIP. Throws a
 * friendly 400 if either step fails.
 */
async function resolveCityTarget(c: AppContext, cityText: string): Promise<string> {
  let lat: number, lon: number;
  try {
    const censusRes = await fetch(
      `https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=${encodeURIComponent(cityText)}&benchmark=2020&format=json`
    );
    const censusData = censusRes.ok ? await censusRes.json<any>() : null;
    const match = censusData?.result?.addressMatches?.[0];
    if (match) {
      lat = Number(match.coordinates.y);
      lon = Number(match.coordinates.x);
    } else {
      throw new Error('no census match');
    }
  } catch {
    throw new HTTPException(400, { message: `Could not find "${cityText}" - try "City, ST".` });
  }

  const place = await nearestPlace(c, lat, lon);
  if (!place) throw new HTTPException(400, { message: `Could not confirm "${cityText}" against known towns - try "City, ST".` });
  return `${place.city}, ${place.state}`;
}

interface SponsorInput {
  sponsor_name: string;
  message: string;
  app: string;
  route: string;
  target_kind: 'region' | 'city' | 'zip';
  target_value: string | null;
  link_url: string | null;
  image_url: string | null;
  sponsor_kkauth_uid: string | null;
  starts_at: string | null;
  ends_at: string | null;
}

/** Synchronous field validation shared by create + update. City geocoding happens separately (async) in the caller. */
function parseSponsorInput(body: any, existing?: any): Omit<SponsorInput, 'target_value'> & { rawCity: string | null; zipValue: string | null } {
  const sponsor_name = body.sponsor_name === undefined ? cleanText(existing?.sponsor_name, SPONSOR_NAME_MAX) : cleanText(body.sponsor_name, SPONSOR_NAME_MAX);
  if (!sponsor_name || sponsor_name.length < SPONSOR_NAME_MIN) {
    throw new HTTPException(400, { message: `Give the sponsor a name (${SPONSOR_NAME_MIN}-${SPONSOR_NAME_MAX} characters).` });
  }

  const message = body.message === undefined ? cleanText(existing?.message, MESSAGE_MAX) : cleanText(body.message, MESSAGE_MAX);
  if (!message || message.length < MESSAGE_MIN) {
    throw new HTTPException(400, { message: `Write a short message (${MESSAGE_MIN}-${MESSAGE_MAX} characters).` });
  }

  const app = body.app === undefined ? existing?.app : (typeof body.app === 'string' ? body.app.trim() : '');
  if (!app || !KNOWN_APP_VALUES.includes(app)) {
    throw new HTTPException(400, { message: 'Choose which app this sponsor message appears in.' });
  }

  const route = body.route === undefined ? existing?.route : (typeof body.route === 'string' ? body.route.trim() : '');
  if (!route || (route !== '*' && !knownRoutesFor(app).includes(route))) {
    throw new HTTPException(400, { message: 'Choose a route from the list, or "All routes".' });
  }

  const target_kind = body.target_kind === undefined ? existing?.target_kind : body.target_kind;
  if (!['region', 'city', 'zip'].includes(target_kind)) {
    throw new HTTPException(400, { message: 'Choose region-wide, city, or ZIP targeting.' });
  }

  let rawCity: string | null = null;
  let zipValue: string | null = null;
  if (target_kind === 'zip') {
    const zip = body.target_value === undefined ? existing?.target_value : cleanText(body.target_value, 5);
    if (!zip || !/^\d{5}$/.test(zip)) {
      throw new HTTPException(400, { message: 'Enter a 5-digit ZIP code.' });
    }
    zipValue = zip;
  } else if (target_kind === 'city') {
    const city = body.target_value === undefined ? existing?.target_value : cleanText(body.target_value, 100);
    if (!city) throw new HTTPException(400, { message: 'Enter a city, e.g. "Coldwater, MI".' });
    // Re-resolve every time target_kind/target_value could have changed; if
    // this is an update where target_value is unset (unchanged) AND the
    // existing target_kind was already 'city', skip the geocode round-trip.
    rawCity = (body.target_value === undefined && existing?.target_kind === 'city') ? null : city;
    if (rawCity === null) zipValue = existing?.target_value ?? null; // reuse stored canonical value below via caller
  }

  const link_url = body.link_url === undefined ? (existing?.link_url ?? null) : cleanText(body.link_url, 500);
  if (link_url && !isHubUrl(link_url)) {
    throw new HTTPException(400, { message: 'Link must go to a page in the Hub, not an outside site.' });
  }

  const image_url = body.image_url === undefined ? (existing?.image_url ?? null) : cleanText(body.image_url, 500);
  const sponsor_kkauth_uid = body.sponsor_kkauth_uid === undefined ? (existing?.sponsor_kkauth_uid ?? null) : cleanText(body.sponsor_kkauth_uid, 50);

  const starts_at = body.starts_at === undefined
    ? (existing?.starts_at ?? null)
    : (typeof body.starts_at === 'number' ? toSqlDatetime(body.starts_at) : null);
  const ends_at = body.ends_at === undefined
    ? (existing?.ends_at ?? null)
    : (typeof body.ends_at === 'number' ? toSqlDatetime(body.ends_at) : null);

  return {
    sponsor_name, message, app, route,
    target_kind: target_kind as 'region' | 'city' | 'zip',
    link_url, image_url, sponsor_kkauth_uid, starts_at, ends_at,
    rawCity, zipValue,
  };
}

/** Overlap test for the collision guard - NULL start = "now", NULL end = "open-ended". */
function windowsOverlap(aStart: string | null, aEnd: string | null, bStart: string | null, bEnd: string | null): boolean {
  const now = nowSql();
  const s1 = aStart ?? now, e1 = aEnd;
  const s2 = bStart ?? now, e2 = bEnd;
  const startsBeforeOtherEnds = e2 === null || s1 < e2;
  const otherStartsBeforeThisEnds = e1 === null || s2 < e1;
  return startsBeforeOtherEnds && otherStartsBeforeThisEnds;
}

async function checkCollision(c: AppContext, tenantId: string, app: string, route: string, targetKind: string, targetValue: string | null, startsAt: string | null, endsAt: string | null, excludeId?: number) {
  const { results } = await c.env.DB.prepare(`
    SELECT id, starts_at, ends_at FROM sponsorship
    WHERE tenant_id = ? AND deleted_at IS NULL AND is_active = 1
      AND app = ? AND route = ? AND target_kind = ? AND ${targetValue === null ? 'target_value IS NULL' : 'target_value = ?'}
  `).bind(...(targetValue === null ? [tenantId, app, route, targetKind] : [tenantId, app, route, targetKind, targetValue])).all<any>();

  for (const row of results || []) {
    if (excludeId !== undefined && row.id === excludeId) continue;
    if (windowsOverlap(startsAt, endsAt, row.starts_at, row.ends_at)) {
      throw new HTTPException(409, { message: COLLISION_MSG });
    }
  }
}

type SponsorState = 'live' | 'scheduled' | 'ended' | 'paused' | 'feature_off';

/** SQLite 'YYYY-MM-DD HH:MM:SS' -> a Date the JS parser accepts (needs 'T', not a space). */
function fromSqlDatetime(sql: string): Date {
  return new Date(sql.replace(' ', 'T') + 'Z');
}

function computeState(row: any, featureOn: boolean, now: string): { state: SponsorState; note: string } {
  if (!featureOn) return { state: 'feature_off', note: 'Feature is switched off' };
  if (!row.is_active) return { state: 'paused', note: 'Paused by you' };
  if (row.starts_at && row.starts_at > now) {
    return { state: 'scheduled', note: `Scheduled - starts ${fromSqlDatetime(row.starts_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` };
  }
  if (row.ends_at && row.ends_at <= now) {
    return { state: 'ended', note: `Ended ${fromSqlDatetime(row.ends_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` };
  }
  return { state: 'live', note: 'Live' };
}

function serializeSponsor(row: any) {
  return {
    id: row.id,
    app: row.app,
    route: row.route,
    target_kind: row.target_kind,
    target_value: row.target_value,
    sponsor_name: row.sponsor_name,
    message: row.message,
    link_url: row.link_url,
    image_url: row.image_url,
    sponsor_kkauth_uid: row.sponsor_kkauth_uid,
    is_active: !!row.is_active,
    starts_at: row.starts_at,
    ends_at: row.ends_at,
    created_at: row.created_at,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Public — resolve + beacon
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Best-effort read of the caller's KKAuth profile (uid + home ZIP lat/lon/
 * ZIP code) via the same verify-token Service Binding call requireAuth uses,
 * but never throws and never touches the local users table - an anonymous
 * caller is a perfectly valid caller here (frictionless-reads standing
 * order). Copied from support.ts's tryGetKkauthUid, extended with the
 * profile fields resolveSponsorDrawer needs for city/zip targeting.
 */
async function tryGetProfile(c: AppContext): Promise<{ zip: string | null; lat: number | null; lon: number | null } | null> {
  const authHeader = c.req.header('Authorization');
  const token = authHeader?.replace('Bearer ', '').trim();
  if (!token) return null;

  try {
    const res = await c.env.KKAUTH.fetch(
      new Request('https://kkauth/internal/verify-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Internal-Secret': c.env.INTERNAL_SECRET },
        body: JSON.stringify({ token }),
      })
    );
    if (!res.ok) return null;
    const json = await res.json<{ data: { profile: { home_zip_location: string | null; home_zip_lat: number | null; home_zip_lon: number | null } } }>();
    const profile = json.data?.profile;
    if (!profile) return null;
    return { zip: profile.home_zip_location ?? null, lat: profile.home_zip_lat ?? null, lon: profile.home_zip_lon ?? null };
  } catch {
    return null;
  }
}

/**
 * GET /sponsor-drawer/resolve?app=<slug>&route=<path> — the single winning
 * placement for this app + route + caller, or null. Returns null immediately
 * (before any query) when the tenant feature flag is off. `app` is required
 * (not just `route`) since a bare route string collides across sibling apps.
 */
export async function resolveSponsorDrawer(c: AppContext) {
  c.header('Cache-Control', 'no-store');
  const tenant = c.get('tenant');
  const config = tenant.config as TenantConfig;
  if (config.sponsor_drawer !== 'on') return c.json({ data: null });

  const app = c.req.query('app');
  if (!app || !KNOWN_APP_VALUES.includes(app)) throw new HTTPException(400, { message: 'app is required.' });
  const route = c.req.query('route');
  if (!route) throw new HTTPException(400, { message: 'route is required.' });

  const now = nowSql();
  const { results } = await c.env.DB.prepare(`
    SELECT * FROM sponsorship
    WHERE tenant_id = ? AND deleted_at IS NULL AND is_active = 1
      AND app = ?
      AND route IN (?, '*')
      AND (starts_at IS NULL OR starts_at <= ?)
      AND (ends_at IS NULL OR ends_at > ?)
  `).bind(tenant.id, app, route, now, now).all<any>();

  const candidates = results || [];
  if (candidates.length === 0) return c.json({ data: null });

  const profile = await tryGetProfile(c);
  let userCity: string | null = null;
  const needsCity = candidates.some((r: any) => r.target_kind === 'city');
  if (needsCity && profile?.lat != null && profile?.lon != null) {
    const place = await nearestPlace(c, profile.lat, profile.lon);
    userCity = place ? `${place.city}, ${place.state}` : null;
  }

  function matches(row: any): boolean {
    if (row.target_kind === 'region') return true;
    if (row.target_kind === 'zip') return !!profile?.zip && row.target_value === profile.zip;
    if (row.target_kind === 'city') return !!userCity && row.target_value?.toLowerCase() === userCity.toLowerCase();
    return false;
  }

  // Precedence: exact route + zip, exact route + city, exact route + region,
  // '*' + zip, '*' + city, '*' + region. Tie-break: oldest created_at wins.
  const levels: Array<(r: any) => boolean> = [
    r => r.route === route && r.target_kind === 'zip',
    r => r.route === route && r.target_kind === 'city',
    r => r.route === route && r.target_kind === 'region',
    r => r.route === '*' && r.target_kind === 'zip',
    r => r.route === '*' && r.target_kind === 'city',
    r => r.route === '*' && r.target_kind === 'region',
  ];

  let winner: any = null;
  for (const level of levels) {
    const atLevel = candidates.filter((r: any) => level(r) && matches(r));
    if (atLevel.length > 0) {
      winner = atLevel.sort((a: any, b: any) => (a.created_at < b.created_at ? -1 : 1))[0];
      break;
    }
  }

  if (!winner) return c.json({ data: null });
  return c.json({
    data: {
      id: winner.id,
      sponsor_name: winner.sponsor_name,
      message: winner.message,
      link_url: winner.link_url,
      image_url: winner.image_url,
    },
  });
}

/**
 * POST /sponsor-drawer/beacon { placement_id, kind } — fire-and-forget daily
 * aggregate increment. Always returns { data: true }; an invalid
 * placement_id or kind is silently dropped, never surfaced to the user.
 */
export async function sponsorBeacon(c: AppContext) {
  const tenant = c.get('tenant');
  const body = await c.req.json<any>().catch(() => ({}));
  const placementId = Number(body.placement_id);
  const kind = body.kind;

  if (!Number.isFinite(placementId) || !['show', 'dismiss', 'tap'].includes(kind)) {
    return c.json({ data: true });
  }

  const placement = await c.env.DB.prepare(
    'SELECT id FROM sponsorship WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL'
  ).bind(placementId, tenant.id).first<{ id: number }>();
  if (!placement) return c.json({ data: true });

  const day = new Intl.DateTimeFormat('en-CA', { timeZone: BOARD_TZ }).format(new Date()); // 'YYYY-MM-DD'
  const column = kind === 'show' ? 'shows' : kind === 'dismiss' ? 'dismisses' : 'taps';

  await c.env.DB.prepare(`
    INSERT INTO sponsor_impressions (placement_id, day, ${column})
    VALUES (?, ?, 1)
    ON CONFLICT(placement_id, day) DO UPDATE SET ${column} = ${column} + 1
  `).bind(placementId, day).run().catch((err) => {
    console.error('[sponsors] beacon write failed:', err instanceof Error ? err.message : String(err));
  });

  return c.json({ data: true });
}

// ─────────────────────────────────────────────────────────────────────────────
// Admin
// ─────────────────────────────────────────────────────────────────────────────

/** POST /sponsors/upload — admin uploads a sponsor image. Mirrors uploadFreshPhoto. */
export async function uploadSponsorPhoto(c: AppContext) {
  requireAdmin(c);
  const user = c.get('user');

  const form = await c.req.formData().catch(() => null);
  const file = form?.get('file');
  if (!file || typeof file === 'string') {
    throw new HTTPException(400, { message: 'Choose a photo to upload.' });
  }

  const uploadForm = new FormData();
  uploadForm.append('file', file as File);
  uploadForm.append('user_id', String(Number(user.sub)));
  uploadForm.append('variant', 'mobile');

  const res = await c.env.KKAUTH.fetch(
    new Request('https://kkauth/internal/uploads', {
      method: 'POST',
      headers: { 'X-Internal-Secret': c.env.INTERNAL_SECRET || '' },
      body: uploadForm,
    })
  );

  const kkBody = await res.json<any>().catch(() => ({}));
  if (!res.ok) return c.json(kkBody, res.status as any);

  return c.json({ data: { url: kkBody?.data?.url ?? null } });
}

/** GET /admin/sponsors — every placement, newest first, with computed state + impressions. */
export async function adminListSponsors(c: AppContext) {
  requireAdmin(c);
  const tenant = c.get('tenant');
  const config = tenant.config as TenantConfig;
  const featureOn = config.sponsor_drawer === 'on';
  const now = nowSql();

  const { results } = await c.env.DB.prepare(
    'SELECT * FROM sponsorship WHERE tenant_id = ? AND deleted_at IS NULL ORDER BY created_at DESC'
  ).bind(tenant.id).all<any>();
  const rows = results || [];

  const sevenDaysAgo = new Intl.DateTimeFormat('en-CA', { timeZone: BOARD_TZ }).format(new Date(Date.now() - 7 * 86400000));
  const { results: impressions } = await c.env.DB.prepare(`
    SELECT placement_id,
      SUM(shows) AS lifetime_shows, SUM(taps) AS lifetime_taps,
      SUM(CASE WHEN day >= ? THEN shows ELSE 0 END) AS recent_shows,
      SUM(CASE WHEN day >= ? THEN taps ELSE 0 END) AS recent_taps
    FROM sponsor_impressions
    WHERE placement_id IN (${rows.map(() => '?').join(',') || 'NULL'})
    GROUP BY placement_id
  `).bind(sevenDaysAgo, sevenDaysAgo, ...rows.map((r: any) => r.id)).all<any>();
  const impByPlacement = new Map((impressions || []).map((r: any) => [r.placement_id, r]));

  // Superseded hint: an active/live wildcard placement is always beaten by
  // ANY active/live exact-route placement on that same route, regardless of
  // target_kind (the resolve precedence puts every exact-route level ahead
  // of every wildcard level) - see resolveSponsorDrawer's `levels` array.
  // Scoped per app - a Field Notes wildcard is never "superseded" by an
  // Exchange placement, they never compete for the same resolve call.
  const appsWithLiveSpecificRoutes = new Set(
    rows.filter((r: any) => r.route !== '*' && r.is_active && (!r.starts_at || r.starts_at <= now) && (!r.ends_at || r.ends_at > now))
      .map((r: any) => r.app)
  );

  const data = rows.map((row: any) => {
    const { state, note } = computeState(row, featureOn, now);
    const superseded = state === 'live' && row.route === '*' && appsWithLiveSpecificRoutes.has(row.app);
    const imp = impByPlacement.get(row.id);
    return {
      ...serializeSponsor(row),
      state,
      state_note: superseded ? 'Superseded by a more specific placement on this route' : note,
      impressions: {
        lifetime_shows: imp?.lifetime_shows ?? 0,
        lifetime_taps: imp?.lifetime_taps ?? 0,
        recent_shows: imp?.recent_shows ?? 0,
        recent_taps: imp?.recent_taps ?? 0,
      },
    };
  });

  return c.json({ data });
}

/** POST /admin/sponsors — create. */
export async function adminCreateSponsor(c: AppContext) {
  requireAdmin(c);
  const tenant = c.get('tenant');
  const body = await c.req.json<any>().catch(() => ({}));

  const parsed = parseSponsorInput(body);
  let target_value: string | null = null;
  if (parsed.target_kind === 'zip') target_value = parsed.zipValue;
  else if (parsed.target_kind === 'city') target_value = parsed.rawCity ? await resolveCityTarget(c, parsed.rawCity) : parsed.zipValue;

  await checkCollision(c, tenant.id, parsed.app, parsed.route, parsed.target_kind, target_value, parsed.starts_at, parsed.ends_at);

  const row = await c.env.DB.prepare(`
    INSERT INTO sponsorship
      (tenant_id, app, route, target_kind, target_value, sponsor_name, message, link_url, image_url, sponsor_kkauth_uid, starts_at, ends_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING *
  `).bind(
    tenant.id, parsed.app, parsed.route, parsed.target_kind, target_value, parsed.sponsor_name, parsed.message,
    parsed.link_url, parsed.image_url, parsed.sponsor_kkauth_uid, parsed.starts_at, parsed.ends_at
  ).first<any>();

  return c.json({ data: serializeSponsor(row) }, 201);
}

/** PUT /admin/sponsors/:id — update. Full revalidation, same collision guard (excluding self). */
export async function adminUpdateSponsor(c: AppContext) {
  requireAdmin(c);
  const tenant = c.get('tenant');
  const id = Number(c.req.param('id'));
  const body = await c.req.json<any>().catch(() => ({}));

  const existing = await c.env.DB.prepare(
    'SELECT * FROM sponsorship WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL'
  ).bind(id, tenant.id).first<any>();
  if (!existing) throw new HTTPException(404, { message: 'Sponsor placement not found.' });

  const parsed = parseSponsorInput(body, existing);
  let target_value: string | null = null;
  if (parsed.target_kind === 'zip') target_value = parsed.zipValue;
  else if (parsed.target_kind === 'city') target_value = parsed.rawCity ? await resolveCityTarget(c, parsed.rawCity) : (parsed.zipValue ?? existing.target_value);

  await checkCollision(c, tenant.id, parsed.app, parsed.route, parsed.target_kind, target_value, parsed.starts_at, parsed.ends_at, id);

  await c.env.DB.prepare(`
    UPDATE sponsorship
    SET app = ?, route = ?, target_kind = ?, target_value = ?, sponsor_name = ?, message = ?, link_url = ?, image_url = ?,
        sponsor_kkauth_uid = ?, starts_at = ?, ends_at = ?, updated_at = datetime('now')
    WHERE id = ? AND tenant_id = ?
  `).bind(
    parsed.app, parsed.route, parsed.target_kind, target_value, parsed.sponsor_name, parsed.message,
    parsed.link_url, parsed.image_url, parsed.sponsor_kkauth_uid, parsed.starts_at, parsed.ends_at, id, tenant.id
  ).run();

  const row = await c.env.DB.prepare('SELECT * FROM sponsorship WHERE id = ?').bind(id).first<any>();
  return c.json({ data: serializeSponsor(row) });
}

/** POST /admin/sponsors/:id/active { active } — pause/resume. Orthogonal to the global feature toggle. */
export async function adminSetSponsorActive(c: AppContext) {
  requireAdmin(c);
  const tenant = c.get('tenant');
  const id = Number(c.req.param('id'));
  const body = await c.req.json<any>().catch(() => ({}));

  const res = await c.env.DB.prepare(
    'UPDATE sponsorship SET is_active = ?, updated_at = datetime(\'now\') WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL'
  ).bind(body.active ? 1 : 0, id, tenant.id).run();
  if (res.meta.changes !== 1) throw new HTTPException(404, { message: 'Sponsor placement not found.' });

  const row = await c.env.DB.prepare('SELECT * FROM sponsorship WHERE id = ?').bind(id).first<any>();
  return c.json({ data: serializeSponsor(row) });
}

/** POST /admin/sponsors/:id/end — set ends_at = now. */
export async function adminEndSponsor(c: AppContext) {
  requireAdmin(c);
  const tenant = c.get('tenant');
  const id = Number(c.req.param('id'));

  const res = await c.env.DB.prepare(
    'UPDATE sponsorship SET ends_at = datetime(\'now\'), updated_at = datetime(\'now\') WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL'
  ).bind(id, tenant.id).run();
  if (res.meta.changes !== 1) throw new HTTPException(404, { message: 'Sponsor placement not found.' });

  const row = await c.env.DB.prepare('SELECT * FROM sponsorship WHERE id = ?').bind(id).first<any>();
  return c.json({ data: serializeSponsor(row) });
}

/** DELETE /admin/sponsors/:id — soft delete. sponsor_impressions rows are kept (aggregate history). */
export async function adminDeleteSponsor(c: AppContext) {
  requireAdmin(c);
  const tenant = c.get('tenant');
  const id = Number(c.req.param('id'));

  const res = await c.env.DB.prepare(
    'UPDATE sponsorship SET deleted_at = datetime(\'now\'), updated_at = datetime(\'now\') WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL'
  ).bind(id, tenant.id).run();
  if (res.meta.changes !== 1) throw new HTTPException(404, { message: 'Sponsor placement not found.' });

  return c.json({ data: { removed: true } });
}

/** GET /admin/sponsors/feature — the global toggle. */
export async function adminGetSponsorFeature(c: AppContext) {
  requireAdmin(c);
  const tenant = c.get('tenant');
  const config = tenant.config as TenantConfig;
  return c.json({ data: { on: config.sponsor_drawer === 'on' } });
}

/**
 * POST /admin/sponsors/feature { on } — flips the tenant config JSON's
 * sponsor_drawer key and invalidates BOTH resolveTenant KV cache keys (by
 * slug and by hostname - middleware/tenant.ts:9) so the flip is effective
 * immediately instead of waiting out the 300s cache TTL. Default is 'off';
 * this is requirement 2 (admin kill switch) and the reason deploying the
 * code itself is always safe.
 */
export async function adminSetSponsorFeature(c: AppContext) {
  requireAdmin(c);
  const tenant = c.get('tenant');
  const body = await c.req.json<any>().catch(() => ({}));
  const on = !!body.on;

  const row = await c.env.DB.prepare('SELECT config, hostname FROM tenants WHERE id = ?').bind(tenant.id).first<any>();
  if (!row) throw new HTTPException(404, { message: 'Tenant not found.' });

  const config = JSON.parse(row.config || '{}');
  config.sponsor_drawer = on ? 'on' : 'off';

  await c.env.DB.prepare('UPDATE tenants SET config = ? WHERE id = ?').bind(JSON.stringify(config), tenant.id).run();
  await Promise.all([
    c.env.PASSPORT_CONFIG.delete(`tenant:slug:${tenant.id}`),
    c.env.PASSPORT_CONFIG.delete(`tenant:host:${row.hostname}`),
  ]);

  return c.json({ data: { on } });
}
