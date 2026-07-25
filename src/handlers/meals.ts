/**
 * Community Table — community-meal board (fire department fish fries and
 * pancake breakfasts, church suppers, Legion/VFW dinners, ice cream socials,
 * chicken BBQs, benefit meals for neighbors)
 *
 * A donor-diff of Fresh Today (src/handlers/fresh.ts): the same two-table
 * shape (Kitchen = Stand, Meal = Post) - recurring volunteer organizations
 * warrant a persistent-profile anchor households don't. Sale Day
 * (src/handlers/sales.ts) donates the scheduled single-date clock machinery
 * (board-TZ date/time helpers, status helper shape, lazy-retirement read
 * filter). The plan's own addition on top of both donors: `benefit_line`
 * (whose cause the meal helps - the mission-core field, never cut) and a
 * PUBLIC `cancelled` state that stays visible with a badge until the meal's
 * day ends, same reasoning Pop-Ups' cancelStop already proved out - a
 * vanished fish fry strands the neighbors who planned on it. Optional
 * per-meal venue override (benefit dinners borrow halls) falls back to the
 * kitchen's pin/hint when not set.
 *
 * Zero economy surface: no credits, no KKGame calls, no notifications, no
 * streaks. Cash at the door like always.
 *
 * This file does not import from fresh.ts except REGION_BOUNDS/REGION_CENTER
 * (the plan's explicit "import, never redefine" rule) - every other helper
 * is copied rather than shared, same reasoning fresh.ts itself documents for
 * not importing from happenings.ts (ARCHITECTURE.md Section 13, item 10, the
 * content-lifecycle CRUD gate; see COMMUNITY-TABLE-BUILD-PLAN.md).
 */

import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { Env } from '../types';
import { nanoid } from 'nanoid';
import { REGION_BOUNDS, REGION_CENTER } from './fresh'; // never redefine

type AppContext = Context<{ Bindings: Env }>;

// The board's wall-clock timezone - same as fresh.ts's BOARD_TZ / sales.ts's / popups.ts's.
const BOARD_TZ = 'America/New_York';

export const MEAL_CATEGORIES = [
  'fish_fry', 'breakfast', 'supper', 'chicken_bbq', 'ice_cream_social', 'benefit',
] as const;
// UI labels (exact): Fish Fry, Breakfast, Supper, Chicken BBQ,
// Ice Cream Social, Benefit Meal

const KITCHEN_CAP_PER_USER = 3;
const UPCOMING_MEAL_CAP = 8;          // per kitchen - all of Lent in one sitting
const MEAL_COOLDOWN_MINUTES = 2;      // brake, not a wall - batch posting is legit
const TITLE_MIN = 3;
const TITLE_MAX = 60;
const BODY_MAX = 500;
const BENEFIT_MAX = 120;
const NAME_MIN = 3;
const NAME_MAX = 60;
const DESCRIPTION_MAX = 280;
const ADDRESS_HINT_MAX = 120;
const VENUE_HINT_MAX = 120;
const PHONE_MAX = 25;
const MAX_DAYS_AHEAD = 120;           // Lent gets planned in December

const TIMES_INVALID_MSG = 'Check the serving times - it needs a date coming up, a start time, and an end time after it.';
const PIN_BOUNDS_MSG = 'Place the pin inside the Lakes Region - drag it to the hall.';
const VENUE_OVERRIDE_MSG = 'To use a different location, place the pin there - or clear it to serve at your kitchen.';

export type MealStatus = 'cancelled' | 'done' | 'sold_out' | 'serving_now' | 'today' | 'upcoming';
type KitchenState = 'visible' | 'quiet' | 'hidden_by_admin' | 'removed';
type MealOwnerState = MealStatus | 'removed' | 'hidden_by_admin';

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
 * Parse the optional ?lat=&lon=&radius= "near me" params. Copied from
 * happenings.ts's parseNearby - board-module "copy, never share code"
 * convention (ARCHITECTURE.md §13).
 */
function parseNearby(c: AppContext): { lat: number; lon: number; radius: number } | null {
  const lat = Number(c.req.query('lat'));
  const lon = Number(c.req.query('lon'));
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return null;
  }
  const radius = Math.max(0, Math.min(500, Number(c.req.query('radius')) || 0));
  return { lat, lon, radius };
}

// Great-circle distance (miles) as a SQL expression over the resolved venue
// - COALESCE(meal override, kitchen) - matching resolvedVenue()'s own
// fallback exactly. Copied from happenings.ts's DISTANCE_SQL.
const DISTANCE_SQL = `
  3958.8 * acos(MIN(1.0, MAX(-1.0,
    sin(radians(COALESCE(m.lat, k.lat))) * sin(radians(?)) +
    cos(radians(COALESCE(m.lat, k.lat))) * cos(radians(?)) * cos(radians(COALESCE(m.lon, k.lon)) - radians(?))
  )))
`;

// ─────────────────────────────────────────────────────────────────────────────
// Board-TZ date/time helpers - copied from sales.ts/popups.ts (same reasoning
// fresh.ts itself documents for not sharing these across board modules).
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

function boardWallTimeToUnix(dateStr: string, timeStr: string): number {
  const naiveUtcMs = Date.parse(`${dateStr}T${timeStr}:00Z`);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: BOARD_TZ, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(naiveUtcMs));
  const get = (t: string) => Number(parts.find(p => p.type === t)?.value ?? 0);
  let hour = get('hour');
  if (hour === 24) hour = 0;
  const asBoardMs = Date.UTC(get('year'), get('month') - 1, get('day'), hour, get('minute'), get('second'));
  const offsetMs = naiveUtcMs - asBoardMs;
  return Math.floor((naiveUtcMs + offsetMs) / 1000);
}

/** Unix seconds for the next local midnight after a given 'YYYY-MM-DD' in BOARD_TZ. */
function endOfBoardDay(dateStr: string): number {
  return boardWallTimeToUnix(addDaysToDateStr(dateStr, 1), '00:00');
}

function clockLabel(hhmm: string): string {
  const [hStr, mStr] = hhmm.split(':');
  const h = Number(hStr);
  const m = Number(mStr);
  const ampm = h >= 12 ? 'PM' : 'AM';
  let h12 = h % 12;
  if (h12 === 0) h12 = 12;
  return m === 0 ? `${h12} ${ampm}` : `${h12}:${mStr} ${ampm}`;
}

function weekdayShort(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short' });
}

function dateLabel(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' });
}

export { weekdayShort, dateLabel };

// ─────────────────────────────────────────────────────────────────────────────
// The status helper - one pure function, mirrored in the UI (plan §4). Every
// badge (public feed, pins, meal detail, My Kitchen) hangs off this.
//
// mealStatus(date, open, close, soldOut, cancelledAt, now) →
//   'cancelled'   cancelled_at set (until day end retires it - read filter's job)
//   'done'        day passed, or today after close (visible until end of day)
//   'sold_out'    sold_out on the meal's day (before close)
//   'serving_now' today, open <= now <= close
//   'today'       today, now < open → sublabel "Serving 4 PM - 7 PM tonight"
//   'upcoming'    date in the future → sublabel "Fri Feb 20 · 4 - 7 PM"
// ─────────────────────────────────────────────────────────────────────────────

export function mealStatus(
  date: string, open: string, close: string,
  soldOut: boolean, cancelledAt: number | null,
  now: number = Math.floor(Date.now() / 1000),
): MealStatus {
  if (cancelledAt) return 'cancelled';

  const today = boardDateStr(new Date(now * 1000));
  if (date > today) return 'upcoming';

  const closeAt = boardWallTimeToUnix(date, close);
  if (date < today || now > closeAt) return 'done';

  if (soldOut) return 'sold_out';

  const openAt = boardWallTimeToUnix(date, open);
  if (now < openAt) return 'today';
  return 'serving_now';
}

/** Public-facing status line (plan §7.1). */
function publicMealStatusNote(status: MealStatus, row: any): string {
  switch (status) {
    case 'cancelled': return 'Cancelled';
    case 'done': return `Served ${dateLabel(row.date)}`;
    case 'sold_out': return 'Sold out';
    case 'serving_now': return `Serving now until ${clockLabel(row.close)}`;
    case 'today': return `Serving ${clockLabel(row.open)} - ${clockLabel(row.close)} tonight`;
    case 'upcoming': return `${weekdayShort(row.date)} ${dateLabel(row.date)} · ${clockLabel(row.open)} - ${clockLabel(row.close)}`;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Owner-visible state helpers (used by listMyMeals + fetchMealsSummary)
// ─────────────────────────────────────────────────────────────────────────────

function kitchenState(row: any): KitchenState {
  if (row.deleted_at) return 'removed';
  if (row.admin_hidden) return 'hidden_by_admin';
  if (row.is_hidden) return 'quiet';
  return 'visible';
}

function hiddenByAdminNote(row: any): string {
  return `Hidden by an admin: "${row.admin_hidden_reason}" - reply from your profile's Talk to Us if you have questions.`;
}

function kitchenStateNote(state: KitchenState, row: any): string {
  switch (state) {
    case 'visible': return 'Live - neighbors can see your kitchen and its meals.';
    case 'quiet': return "Quiet - only you can see it. Tap Show when you're cooking again.";
    case 'hidden_by_admin': return hiddenByAdminNote(row);
    case 'removed': return 'Removed.';
  }
}

function mealOwnerState(row: any, now: number): MealOwnerState {
  if (row.deleted_at) return 'removed';
  if (row.admin_hidden) return 'hidden_by_admin';
  return mealStatus(row.date, row.open, row.close, !!row.sold_out, row.cancelled_at, now);
}

function mealOwnerStateNote(state: MealOwnerState, row: any): string {
  switch (state) {
    case 'removed': return 'Removed.';
    case 'hidden_by_admin': return hiddenByAdminNote(row);
    case 'upcoming': return `On the board - ${weekdayFull(row.date)} ${dateLabel(row.date)}, ${clockLabel(row.open)} to ${clockLabel(row.close)}.`;
    case 'today': return `Today - serving ${clockLabel(row.open)} to ${clockLabel(row.close)}.`;
    case 'serving_now': return `Serving now - until ${clockLabel(row.close)}.`;
    case 'sold_out': return 'Sold out - still listed so folks know how it went.';
    case 'cancelled': return "Cancelled - it stays listed until the day ends so nobody drives out.";
    case 'done': return `Served ${dateLabel(row.date)}.`;
  }
}

function weekdayFull(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'long' });
}

// ─────────────────────────────────────────────────────────────────────────────
// Nearest-town snapshot - copied verbatim (in behavior) from fresh.ts's
// fetchNearestPlace. Kitchens only - meal venue overrides don't need a town
// label, the kitchen's serves.
// ─────────────────────────────────────────────────────────────────────────────

const NEAREST_PLACE_TIMEOUT_MS = 3000;

async function fetchNearestPlace(c: AppContext, lat: number, lon: number): Promise<{ city: string | null; state: string | null }> {
  try {
    const res = await c.env.KKAUTH.fetch(
      new Request(`https://kkauth/internal/nearest-place?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`, {
        headers: { 'X-Internal-Secret': c.env.INTERNAL_SECRET || '' },
        signal: AbortSignal.timeout(NEAREST_PLACE_TIMEOUT_MS),
      })
    );
    if (!res.ok) {
      console.error('[meals] nearest-place lookup returned non-OK status:', res.status);
      return { city: null, state: null };
    }
    const body = await res.json<any>();
    return {
      city: body?.data?.city ?? null,
      state: body?.data?.state ?? null,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[meals] nearest-place lookup failed:', msg);
    return { city: null, state: null };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Input validation
// ─────────────────────────────────────────────────────────────────────────────

function parseKitchenInput(body: any, existing?: any) {
  const name = cleanText(body.name, NAME_MAX) ?? (existing ? existing.name : null);
  if (!name || name.length < NAME_MIN) {
    throw new HTTPException(400, { message: 'Give your kitchen a name (3-60 characters).' });
  }

  const lat = body.lat !== undefined ? Number(body.lat) : Number(existing?.lat);
  const lon = body.lon !== undefined ? Number(body.lon) : Number(existing?.lon);
  if (
    !Number.isFinite(lat) || !Number.isFinite(lon) ||
    lat < REGION_BOUNDS.minLat || lat > REGION_BOUNDS.maxLat ||
    lon < REGION_BOUNDS.minLon || lon > REGION_BOUNDS.maxLon
  ) {
    throw new HTTPException(400, { message: PIN_BOUNDS_MSG });
  }

  const description = body.description === undefined ? (existing?.description ?? null) : cleanText(body.description, DESCRIPTION_MAX);
  const addressHint = body.address_hint === undefined ? (existing?.address_hint ?? null) : cleanText(body.address_hint, ADDRESS_HINT_MAX);
  const phone = body.phone === undefined ? (existing?.phone ?? null) : cleanText(body.phone, PHONE_MAX);
  const photoUrl = body.photo_url === undefined ? (existing?.photo_url ?? null) : cleanText(body.photo_url, 500);

  return { name, lat, lon, description, addressHint, phone, photoUrl };
}

interface MealInput {
  title: string; body: string; category: string; date: string; open: string; close: string;
  benefitLine: string | null; lat: number | null; lon: number | null; venueHint: string | null;
  photoUrl: string | null;
}

function parseMealInput(body: any, existing?: any): MealInput {
  const title = cleanText(body.title, TITLE_MAX) ?? (existing ? existing.title : null);
  if (!title || title.length < TITLE_MIN) {
    throw new HTTPException(400, { message: 'Give your meal a title (3-60 characters).' });
  }

  const bodyText = body.body === undefined ? (existing?.body ?? null) : cleanText(body.body, BODY_MAX);
  if (!bodyText) throw new HTTPException(400, { message: "Say what's cooking (1-500 characters)." });

  const category = body.category === undefined ? (existing?.category ?? null) : body.category;
  if (!category || !(MEAL_CATEGORIES as readonly string[]).includes(category)) {
    throw new HTTPException(400, { message: 'Pick a category for your meal.' });
  }

  const date = body.date === undefined ? (existing?.date ?? null) : body.date;
  const open = body.open === undefined ? (existing?.open ?? null) : body.open;
  const close = body.close === undefined ? (existing?.close ?? null) : body.close;
  if (
    typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    typeof open !== 'string' || !/^\d{2}:\d{2}$/.test(open) ||
    typeof close !== 'string' || !/^\d{2}:\d{2}$/.test(close) ||
    open >= close
  ) {
    throw new HTTPException(400, { message: TIMES_INVALID_MSG });
  }

  const today = boardDateStr();
  const maxDateStr = addDaysToDateStr(today, MAX_DAYS_AHEAD);
  if (date < today || date > maxDateStr) {
    throw new HTTPException(400, { message: TIMES_INVALID_MSG });
  }

  const benefitLine = body.benefit_line === undefined ? (existing?.benefit_line ?? null) : cleanText(body.benefit_line, BENEFIT_MAX);

  // Venue override: both lat/lon or neither. Explicit null on both clears the
  // override back to the kitchen's own pin/hint.
  let lat: number | null;
  let lon: number | null;
  if (body.lat === undefined && body.lon === undefined) {
    lat = existing ? (existing.lat ?? null) : null;
    lon = existing ? (existing.lon ?? null) : null;
  } else if (body.lat === null && body.lon === null) {
    lat = null;
    lon = null;
  } else {
    const latNum = Number(body.lat);
    const lonNum = Number(body.lon);
    if (
      !Number.isFinite(latNum) || !Number.isFinite(lonNum) ||
      latNum < REGION_BOUNDS.minLat || latNum > REGION_BOUNDS.maxLat ||
      lonNum < REGION_BOUNDS.minLon || lonNum > REGION_BOUNDS.maxLon
    ) {
      throw new HTTPException(400, { message: VENUE_OVERRIDE_MSG });
    }
    lat = latNum;
    lon = lonNum;
  }
  const venueHint = body.venue_hint === undefined ? (existing?.venue_hint ?? null) : cleanText(body.venue_hint, VENUE_HINT_MAX);

  const photoUrl = body.photo_url === undefined ? (existing?.photo_url ?? null) : cleanText(body.photo_url, 500);

  return { title, body: bodyText, category, date, open, close, benefitLine, lat, lon, venueHint, photoUrl };
}

/** Cooldown + upcoming-meal cap, per kitchen. Brake, not a wall - batch
 *  posting all seven Lenten Fridays in one sitting is legit. */
async function guardMealCapAndCooldown(c: AppContext, kitchenId: string) {
  const last = await c.env.DB.prepare(
    'SELECT created_at FROM meals WHERE kitchen_id = ? ORDER BY created_at DESC LIMIT 1'
  ).bind(kitchenId).first<{ created_at: number }>();
  if (last) {
    const since = Math.floor(Date.now() / 1000) - last.created_at;
    if (since < MEAL_COOLDOWN_MINUTES * 60) {
      throw new HTTPException(429, { message: 'Give it a minute between meals - you can post the next one shortly.' });
    }
  }

  const today = boardDateStr();
  const upcoming = await c.env.DB.prepare(
    'SELECT COUNT(*) AS n FROM meals WHERE kitchen_id = ? AND deleted_at IS NULL AND cancelled_at IS NULL AND admin_hidden = 0 AND date >= ?'
  ).bind(kitchenId, today).first<{ n: number }>();
  if ((upcoming?.n ?? 0) >= UPCOMING_MEAL_CAP) {
    throw new HTTPException(409, {
      message: `You have ${UPCOMING_MEAL_CAP} meals coming up - that's the board's limit. Edit one instead, or wait until one is served.`,
    });
  }
}

/** Resolved venue: the meal's override when set, else the kitchen's pin/hint. */
function resolvedVenue(meal: any, kitchen: any) {
  const hasOverride = meal.lat != null && meal.lon != null;
  return {
    lat: hasOverride ? meal.lat : kitchen.lat,
    lon: hasOverride ? meal.lon : kitchen.lon,
    venue_hint: hasOverride ? (meal.venue_hint ?? null) : (kitchen.address_hint ?? null),
    is_override: hasOverride,
  };
}

function serializeKitchen(row: any) {
  return { ...row };
}

// ─────────────────────────────────────────────────────────────────────────────
// Public board
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/t/:tenant/meals — the public feed. Joins meals -> kitchens.
 * Optional ?category= filters.
 */
export async function listMeals(c: AppContext) {
  const tenant = c.get('tenant');
  const category = c.req.query('category');
  const today = boardDateStr();
  const now = Math.floor(Date.now() / 1000);
  const near = parseNearby(c);

  const filters = [
    'm.tenant_id = ?', 'm.deleted_at IS NULL', 'm.admin_hidden = 0', 'm.date >= ?',
    'k.deleted_at IS NULL', 'k.is_hidden = 0', 'k.admin_hidden = 0',
  ];
  const binds: any[] = [tenant.id, today];
  if (category && (MEAL_CATEGORIES as readonly string[]).includes(category)) {
    filters.push('m.category = ?');
    binds.push(category);
  }

  // "Near me": filter to the radius *before* the 200-cap, same reasoning as
  // happenings.ts/fresh.ts/sales.ts/popups.ts.
  let distanceSelect = 'NULL AS distance_mi';
  if (near) {
    distanceSelect = `(${DISTANCE_SQL}) AS distance_mi`;
    binds.unshift(near.lat, near.lat, near.lon);
    if (near.radius > 0) {
      filters.push(`(${DISTANCE_SQL}) <= ?`);
      binds.push(near.lat, near.lat, near.lon, near.radius);
    }
  }

  const { results } = await c.env.DB.prepare(`
    SELECT m.*, k.id AS kitchen_id_join, k.name AS kitchen_name, k.phone AS kitchen_phone,
           k.lat AS kitchen_lat, k.lon AS kitchen_lon, k.address_hint AS kitchen_address_hint,
           k.nearest_city AS kitchen_nearest_city, k.nearest_state AS kitchen_nearest_state,
           ${distanceSelect}
    FROM meals m
    JOIN meal_kitchens k ON k.id = m.kitchen_id
    WHERE ${filters.join(' AND ')}
    ORDER BY m.date ASC, m.open ASC
    LIMIT 200
  `).bind(...binds).all<any>();

  const data = (results || [])
    .map((r: any) => {
      if (now >= endOfBoardDay(r.date)) return null;
      const status = mealStatus(r.date, r.open, r.close, !!r.sold_out, r.cancelled_at, now);
      const venue = resolvedVenue(r, { lat: r.kitchen_lat, lon: r.kitchen_lon, address_hint: r.kitchen_address_hint });
      return {
        id: r.id, title: r.title, body: r.body, category: r.category,
        date: r.date, open: r.open, close: r.close, benefit_line: r.benefit_line,
        venue_hint: venue.venue_hint, photo_url: r.photo_url,
        sold_out: !!r.sold_out, cancelled_at: r.cancelled_at, created_at: r.created_at,
        lat: venue.lat, lon: venue.lon,
        status, status_note: publicMealStatusNote(status, r),
        distance_mi: r.distance_mi == null ? null : Math.round(r.distance_mi * 10) / 10,
        kitchen: {
          id: r.kitchen_id_join, name: r.kitchen_name, phone: r.kitchen_phone,
          nearest_city: r.kitchen_nearest_city ?? null, nearest_state: r.kitchen_nearest_state ?? null,
        },
      };
    })
    .filter((r: any) => r !== null);

  return c.json({ data });
}

/**
 * GET /api/t/:tenant/meals/pins — one pin per visible meal at its resolved
 * venue, with status for coloring. Registered before /meals/kitchens/:id and
 * /meals/meals/:id (Hono order, Sale Day lesson).
 */
export async function listMealPins(c: AppContext) {
  const tenant = c.get('tenant');
  const category = c.req.query('category');
  const today = boardDateStr();
  const now = Math.floor(Date.now() / 1000);
  const near = parseNearby(c);

  const filters = [
    'm.tenant_id = ?', 'm.deleted_at IS NULL', 'm.admin_hidden = 0', 'm.date >= ?',
    'k.deleted_at IS NULL', 'k.is_hidden = 0', 'k.admin_hidden = 0',
  ];
  const binds: any[] = [tenant.id, today];
  if (category && (MEAL_CATEGORIES as readonly string[]).includes(category)) {
    filters.push('m.category = ?');
    binds.push(category);
  }

  let distanceSelect = 'NULL AS distance_mi';
  if (near) {
    distanceSelect = `(${DISTANCE_SQL}) AS distance_mi`;
    binds.unshift(near.lat, near.lat, near.lon);
    if (near.radius > 0) {
      filters.push(`(${DISTANCE_SQL}) <= ?`);
      binds.push(near.lat, near.lat, near.lon, near.radius);
    }
  }

  const { results } = await c.env.DB.prepare(`
    SELECT m.id, m.title, m.date, m.open, m.close, m.sold_out, m.cancelled_at, m.lat, m.lon,
           k.lat AS kitchen_lat, k.lon AS kitchen_lon, k.name AS kitchen_name,
           ${distanceSelect}
    FROM meals m
    JOIN meal_kitchens k ON k.id = m.kitchen_id
    WHERE ${filters.join(' AND ')}
    ORDER BY m.date ASC, m.open ASC
    LIMIT 300
  `).bind(...binds).all<any>();

  const data = (results || [])
    .map((r: any) => {
      if (now >= endOfBoardDay(r.date)) return null;
      const status = mealStatus(r.date, r.open, r.close, !!r.sold_out, r.cancelled_at, now);
      const venue = resolvedVenue(r, { lat: r.kitchen_lat, lon: r.kitchen_lon, address_hint: null });
      return {
        id: r.id, lat: venue.lat, lon: venue.lon, title: r.title,
        kitchen_name: r.kitchen_name,
        status, status_note: publicMealStatusNote(status, r),
        distance_mi: r.distance_mi == null ? null : Math.round(r.distance_mi * 10) / 10,
      };
    })
    .filter((r: any) => r !== null);

  return c.json({ data });
}

/**
 * GET /api/t/:tenant/meals/kitchens/:id — public kitchen page: profile + its
 * visible upcoming meals. 404 if not publicly visible.
 */
export async function getKitchen(c: AppContext) {
  const tenant = c.get('tenant');
  const id = c.req.param('id') ?? '';
  const today = boardDateStr();
  const now = Math.floor(Date.now() / 1000);

  const kitchen = await c.env.DB.prepare(`
    SELECT id, name, description, lat, lon, address_hint, phone, photo_url, created_at,
           nearest_city, nearest_state
    FROM meal_kitchens
    WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL AND is_hidden = 0 AND admin_hidden = 0
  `).bind(id, tenant.id).first<any>();
  if (!kitchen) throw new HTTPException(404, { message: "That kitchen isn't on the board." });

  const { results: mealRows } = await c.env.DB.prepare(`
    SELECT * FROM meals
    WHERE kitchen_id = ? AND deleted_at IS NULL AND admin_hidden = 0 AND date >= ?
    ORDER BY date ASC, open ASC
  `).bind(id, today).all<any>();

  const meals = (mealRows || [])
    .map((r: any) => {
      if (now >= endOfBoardDay(r.date)) return null;
      const status = mealStatus(r.date, r.open, r.close, !!r.sold_out, r.cancelled_at, now);
      const venue = resolvedVenue(r, kitchen);
      return {
        id: r.id, title: r.title, body: r.body, category: r.category,
        date: r.date, open: r.open, close: r.close, benefit_line: r.benefit_line,
        venue_hint: venue.venue_hint, photo_url: r.photo_url,
        sold_out: !!r.sold_out, cancelled_at: r.cancelled_at, created_at: r.created_at,
        lat: venue.lat, lon: venue.lon,
        status, status_note: publicMealStatusNote(status, r),
      };
    })
    .filter((r: any) => r !== null);

  return c.json({ data: { ...kitchen, meals } });
}

/**
 * GET /api/t/:tenant/meals/meals/:id — public meal detail (the shareable
 * object). 404 if not publicly visible. MUST be registered after
 * /meals/pins and /meals/kitchens/:id (Hono order, Sale Day lesson).
 */
export async function getMeal(c: AppContext) {
  const tenant = c.get('tenant');
  const id = c.req.param('id') ?? '';
  const today = boardDateStr();
  const now = Math.floor(Date.now() / 1000);

  const row = await c.env.DB.prepare(`
    SELECT m.*, k.id AS kitchen_id_join, k.name AS kitchen_name, k.phone AS kitchen_phone,
           k.lat AS kitchen_lat, k.lon AS kitchen_lon, k.address_hint AS kitchen_address_hint,
           k.nearest_city AS kitchen_nearest_city, k.nearest_state AS kitchen_nearest_state
    FROM meals m
    JOIN meal_kitchens k ON k.id = m.kitchen_id
    WHERE m.id = ? AND m.tenant_id = ? AND m.deleted_at IS NULL AND m.admin_hidden = 0 AND m.date >= ?
      AND k.deleted_at IS NULL AND k.is_hidden = 0 AND k.admin_hidden = 0
  `).bind(id, tenant.id, today).first<any>();
  if (!row) throw new HTTPException(404, { message: "That meal isn't on the board." });

  if (now >= endOfBoardDay(row.date)) throw new HTTPException(404, { message: "That meal isn't on the board." });

  const status = mealStatus(row.date, row.open, row.close, !!row.sold_out, row.cancelled_at, now);
  const venue = resolvedVenue(row, { lat: row.kitchen_lat, lon: row.kitchen_lon, address_hint: row.kitchen_address_hint });

  return c.json({
    data: {
      id: row.id, title: row.title, body: row.body, category: row.category,
      date: row.date, open: row.open, close: row.close, benefit_line: row.benefit_line,
      venue_hint: venue.venue_hint, photo_url: row.photo_url,
      sold_out: !!row.sold_out, cancelled_at: row.cancelled_at, created_at: row.created_at,
      lat: venue.lat, lon: venue.lon,
      status, status_note: publicMealStatusNote(status, row),
      kitchen: {
        id: row.kitchen_id_join, name: row.kitchen_name, phone: row.kitchen_phone,
        nearest_city: row.kitchen_nearest_city ?? null, nearest_state: row.kitchen_nearest_state ?? null,
      },
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Authenticated — owner CRUD (any signed-in user, no organization verification)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /meals/mine — every kitchen the caller owns, in every state, each with
 * its meals (every status, soonest-first for upcoming then newest-first for
 * past, latest 10 past) and `can_serve_again` on done/cancelled meals of
 * visible kitchens.
 */
export async function listMyMeals(c: AppContext) {
  const user = c.get('user');
  const tenant = c.get('tenant');
  const kkauthUid = Number(user.sub);
  const now = Math.floor(Date.now() / 1000);
  const today = boardDateStr(new Date(now * 1000));

  const { results: kitchenRows } = await c.env.DB.prepare(
    'SELECT * FROM meal_kitchens WHERE tenant_id = ? AND kkauth_uid = ? ORDER BY created_at DESC'
  ).bind(tenant.id, kkauthUid).all<any>();

  const kitchens = [];
  for (const k of (kitchenRows || [])) {
    const kState = kitchenState(k);
    const kVisible = kState === 'visible';

    const { results: mealRows } = await c.env.DB.prepare(
      'SELECT * FROM meals WHERE kitchen_id = ? ORDER BY date DESC, open DESC'
    ).bind(k.id).all<any>();

    const meals = (mealRows || []).map((r: any) => {
      const state = mealOwnerState(r, now);
      return {
        id: r.id, title: r.title, body: r.body, category: r.category,
        date: r.date, open: r.open, close: r.close, benefit_line: r.benefit_line,
        lat: r.lat, lon: r.lon, venue_hint: r.venue_hint, photo_url: r.photo_url,
        sold_out: !!r.sold_out, cancelled_at: r.cancelled_at,
        admin_hidden_reason: r.admin_hidden ? r.admin_hidden_reason : null,
        created_at: r.created_at,
        state, state_note: mealOwnerStateNote(state, r),
        can_serve_again: kVisible && (state === 'done' || state === 'cancelled'),
      };
    });

    const upcoming = meals
      .filter(m => m.date >= today)
      .sort((a, b) => (a.date + a.open).localeCompare(b.date + b.open));
    const past = meals
      .filter(m => m.date < today)
      .sort((a, b) => (b.date + b.open).localeCompare(a.date + a.open))
      .slice(0, 10);

    kitchens.push({
      id: k.id, name: k.name, description: k.description,
      lat: k.lat, lon: k.lon, address_hint: k.address_hint, phone: k.phone,
      nearest_city: k.nearest_city ?? null, nearest_state: k.nearest_state ?? null,
      photo_url: k.photo_url,
      is_hidden: !!k.is_hidden,
      admin_hidden_reason: k.admin_hidden ? k.admin_hidden_reason : null,
      created_at: k.created_at,
      state: kState, state_note: kitchenStateNote(kState, k),
      meals: [...upcoming, ...past],
    });
  }

  return c.json({ data: { kitchens } });
}

/** POST /meals/upload — owner uploads a kitchen or meal photo. Clone of uploadFreshPhoto. */
export async function uploadMealPhoto(c: AppContext) {
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

/** POST /meals/kitchens — create a kitchen. Max 3 per kkauth_uid. */
export async function createKitchen(c: AppContext) {
  const user = c.get('user');
  const tenant = c.get('tenant');
  const kkauthUid = Number(user.sub);
  const body = await c.req.json<any>().catch(() => ({}));

  const countRow = await c.env.DB.prepare(
    'SELECT COUNT(*) AS n FROM meal_kitchens WHERE tenant_id = ? AND kkauth_uid = ? AND deleted_at IS NULL'
  ).bind(tenant.id, kkauthUid).first<{ n: number }>();
  if ((countRow?.n ?? 0) >= KITCHEN_CAP_PER_USER) {
    throw new HTTPException(409, { message: 'You can run up to three kitchens. Remove one to add another.' });
  }

  const input = parseKitchenInput(body);
  const id = nanoid(10);
  const nearest = await fetchNearestPlace(c, input.lat, input.lon);

  await c.env.DB.prepare(`
    INSERT INTO meal_kitchens
      (id, tenant_id, kkauth_uid, name, description, lat, lon, address_hint, phone, photo_url, nearest_city, nearest_state)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    id, tenant.id, kkauthUid, input.name, input.description, input.lat, input.lon,
    input.addressHint, input.phone, input.photoUrl, nearest.city, nearest.state
  ).run();

  const kitchen = await c.env.DB.prepare('SELECT * FROM meal_kitchens WHERE id = ?').bind(id).first<any>();
  return c.json({ data: serializeKitchen(kitchen) }, 201);
}

/** PUT /meals/kitchens/:id — owner edits everything anytime except deleted/admin-hidden. Lat/lon never blankable. */
export async function updateKitchen(c: AppContext) {
  const user = c.get('user');
  const tenant = c.get('tenant');
  const kkauthUid = Number(user.sub);
  const id = c.req.param('id') ?? '';
  const body = await c.req.json<any>().catch(() => ({}));

  const existing = await c.env.DB.prepare(
    'SELECT * FROM meal_kitchens WHERE id = ? AND tenant_id = ?'
  ).bind(id, tenant.id).first<any>();
  if (!existing || existing.deleted_at) throw new HTTPException(404, { message: 'Kitchen not found.' });
  if (existing.kkauth_uid !== kkauthUid) throw new HTTPException(403, { message: 'This is not your kitchen.' });
  if (existing.admin_hidden) {
    throw new HTTPException(403, { message: 'An admin has hidden this kitchen. The reason is on your My Kitchen page.' });
  }

  const input = parseKitchenInput(body, existing);

  const pinMoved = input.lat !== existing.lat || input.lon !== existing.lon;
  let nearestCity = existing.nearest_city ?? null;
  let nearestState = existing.nearest_state ?? null;
  if (pinMoved || nearestCity === null) {
    const nearest = await fetchNearestPlace(c, input.lat, input.lon);
    nearestCity = nearest.city;
    nearestState = nearest.state;
  }

  await c.env.DB.prepare(`
    UPDATE meal_kitchens
    SET name = ?, description = ?, lat = ?, lon = ?, address_hint = ?, phone = ?, photo_url = ?,
        nearest_city = ?, nearest_state = ?, updated_at = unixepoch()
    WHERE id = ? AND tenant_id = ? AND kkauth_uid = ?
  `).bind(
    input.name, input.description, input.lat, input.lon, input.addressHint, input.phone,
    input.photoUrl, nearestCity, nearestState, id, tenant.id, kkauthUid
  ).run();

  const kitchen = await c.env.DB.prepare('SELECT * FROM meal_kitchens WHERE id = ?').bind(id).first<any>();
  return c.json({ data: serializeKitchen(kitchen) });
}

/**
 * POST /meals/kitchens/:id/visibility — owner "Go quiet" / "Show". Flips
 * is_hidden only; never touches admin_hidden - always 403s while
 * admin-hidden regardless of the requested value.
 */
export async function setKitchenVisibility(c: AppContext) {
  const user = c.get('user');
  const tenant = c.get('tenant');
  const kkauthUid = Number(user.sub);
  const id = c.req.param('id') ?? '';
  const body = await c.req.json<any>().catch(() => ({}));

  const existing = await c.env.DB.prepare(
    'SELECT * FROM meal_kitchens WHERE id = ? AND tenant_id = ?'
  ).bind(id, tenant.id).first<any>();
  if (!existing || existing.deleted_at) throw new HTTPException(404, { message: 'Kitchen not found.' });
  if (existing.kkauth_uid !== kkauthUid) throw new HTTPException(403, { message: 'This is not your kitchen.' });
  if (existing.admin_hidden) {
    throw new HTTPException(403, { message: 'An admin has hidden this kitchen. The reason is on your My Kitchen page.' });
  }

  const hidden = asBool(body.hidden, !!existing.is_hidden) ? 1 : 0;
  await c.env.DB.prepare(
    'UPDATE meal_kitchens SET is_hidden = ?, updated_at = unixepoch() WHERE id = ? AND tenant_id = ? AND kkauth_uid = ?'
  ).bind(hidden, id, tenant.id, kkauthUid).run();

  const kitchen = await c.env.DB.prepare('SELECT * FROM meal_kitchens WHERE id = ?').bind(id).first<any>();
  return c.json({ data: serializeKitchen(kitchen) });
}

/** DELETE /meals/kitchens/:id — owner soft-delete. Meals keep their FK, drop
 *  from public via the join; photos stay R2 objects referenced by URL. */
export async function deleteKitchen(c: AppContext) {
  const user = c.get('user');
  const tenant = c.get('tenant');
  const kkauthUid = Number(user.sub);
  const id = c.req.param('id') ?? '';

  const res = await c.env.DB.prepare(
    'UPDATE meal_kitchens SET deleted_at = unixepoch(), updated_at = unixepoch() WHERE id = ? AND tenant_id = ? AND kkauth_uid = ? AND deleted_at IS NULL'
  ).bind(id, tenant.id, kkauthUid).run();
  if (res.meta.changes !== 1) throw new HTTPException(404, { message: 'Kitchen not found.' });

  return c.json({ data: { removed: true } });
}

/**
 * POST /meals/kitchens/:id/meals — owner posts a scheduled meal. Kitchen must
 * be visible (409 with why if quiet/admin-hidden); cap + cooldown guard.
 */
export async function createMeal(c: AppContext) {
  const user = c.get('user');
  const tenant = c.get('tenant');
  const kkauthUid = Number(user.sub);
  const kitchenId = c.req.param('id') ?? '';
  const body = await c.req.json<any>().catch(() => ({}));

  const kitchen = await c.env.DB.prepare(
    'SELECT * FROM meal_kitchens WHERE id = ? AND tenant_id = ? AND kkauth_uid = ?'
  ).bind(kitchenId, tenant.id, kkauthUid).first<any>();
  if (!kitchen || kitchen.deleted_at) throw new HTTPException(404, { message: 'Kitchen not found.' });
  if (kitchen.admin_hidden) {
    throw new HTTPException(403, { message: 'An admin has hidden this kitchen. The reason is on your My Kitchen page.' });
  }
  if (kitchen.is_hidden) {
    throw new HTTPException(409, { message: 'Your kitchen is quiet - tap Show on My Kitchen and then post the meal.' });
  }

  const input = parseMealInput(body);
  await guardMealCapAndCooldown(c, kitchenId);

  const id = nanoid(10);

  await c.env.DB.prepare(`
    INSERT INTO meals
      (id, tenant_id, kitchen_id, kkauth_uid, title, body, category, date, open, close,
       benefit_line, lat, lon, venue_hint, photo_url)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    id, tenant.id, kitchenId, kkauthUid, input.title, input.body, input.category,
    input.date, input.open, input.close, input.benefitLine, input.lat, input.lon, input.venueHint, input.photoUrl
  ).run();

  const meal = await c.env.DB.prepare('SELECT * FROM meals WHERE id = ?').bind(id).first<any>();
  return c.json({ data: meal }, 201);
}

/**
 * PUT /meals/meals/:id — owner edits everything while date >= today and not
 * cancelled/removed/admin-hidden. Date/times revalidated in full.
 */
export async function updateMeal(c: AppContext) {
  const user = c.get('user');
  const tenant = c.get('tenant');
  const kkauthUid = Number(user.sub);
  const id = c.req.param('id') ?? '';
  const body = await c.req.json<any>().catch(() => ({}));

  const existing = await c.env.DB.prepare(
    'SELECT * FROM meals WHERE id = ? AND tenant_id = ? AND kkauth_uid = ?'
  ).bind(id, tenant.id, kkauthUid).first<any>();
  if (!existing || existing.deleted_at) throw new HTTPException(404, { message: 'Meal not found.' });
  if (existing.admin_hidden) {
    throw new HTTPException(403, { message: 'An admin has hidden this meal. The reason is on your My Kitchen page.' });
  }

  const today = boardDateStr();
  if (existing.cancelled_at || existing.date < today) {
    throw new HTTPException(409, { message: 'This meal already happened or was cancelled - use Serve it again to post a new one.' });
  }

  const input = parseMealInput(body, existing);

  await c.env.DB.prepare(`
    UPDATE meals
    SET title = ?, body = ?, category = ?, date = ?, open = ?, close = ?, benefit_line = ?,
        lat = ?, lon = ?, venue_hint = ?, photo_url = ?, updated_at = unixepoch()
    WHERE id = ? AND tenant_id = ? AND kkauth_uid = ?
  `).bind(
    input.title, input.body, input.category, input.date, input.open, input.close, input.benefitLine,
    input.lat, input.lon, input.venueHint, input.photoUrl, id, tenant.id, kkauthUid
  ).run();

  const meal = await c.env.DB.prepare('SELECT * FROM meals WHERE id = ?').bind(id).first<any>();
  return c.json({ data: meal });
}

/** POST /meals/meals/:id/sold-out — owner marks today's meal sold out (idempotent). */
export async function setMealSoldOut(c: AppContext) {
  const user = c.get('user');
  const tenant = c.get('tenant');
  const kkauthUid = Number(user.sub);
  const id = c.req.param('id') ?? '';

  const existing = await c.env.DB.prepare(
    'SELECT * FROM meals WHERE id = ? AND tenant_id = ? AND kkauth_uid = ?'
  ).bind(id, tenant.id, kkauthUid).first<any>();
  if (!existing || existing.deleted_at) throw new HTTPException(404, { message: 'Meal not found.' });
  if (existing.admin_hidden) {
    throw new HTTPException(403, { message: 'An admin has hidden this meal. The reason is on your My Kitchen page.' });
  }
  if (existing.cancelled_at) {
    throw new HTTPException(409, { message: 'This meal was cancelled - nothing to mark sold out.' });
  }

  const today = boardDateStr();
  if (existing.date !== today) {
    throw new HTTPException(409, { message: 'You can mark sold out on the day of the meal.' });
  }

  if (!existing.sold_out) {
    await c.env.DB.prepare(
      'UPDATE meals SET sold_out = 1, sold_out_at = unixepoch() WHERE id = ? AND tenant_id = ? AND kkauth_uid = ?'
    ).bind(id, tenant.id, kkauthUid).run();
  }

  const meal = await c.env.DB.prepare('SELECT * FROM meals WHERE id = ?').bind(id).first<any>();
  return c.json({ data: meal });
}

/**
 * POST /meals/meals/:id/cancel — public "Cancelled" badge until day end (a
 * vanished fish fry strands the neighbors who planned on it). 409 once the
 * day is over.
 */
export async function cancelMeal(c: AppContext) {
  const user = c.get('user');
  const tenant = c.get('tenant');
  const kkauthUid = Number(user.sub);
  const id = c.req.param('id') ?? '';

  const existing = await c.env.DB.prepare(
    'SELECT * FROM meals WHERE id = ? AND tenant_id = ? AND kkauth_uid = ?'
  ).bind(id, tenant.id, kkauthUid).first<any>();
  if (!existing || existing.deleted_at) throw new HTTPException(404, { message: 'Meal not found.' });
  if (existing.admin_hidden) {
    throw new HTTPException(403, { message: 'An admin has hidden this meal. The reason is on your My Kitchen page.' });
  }

  const now = Math.floor(Date.now() / 1000);
  if (now >= endOfBoardDay(existing.date)) {
    throw new HTTPException(409, { message: "That meal's day is over - nothing to cancel." });
  }

  if (!existing.cancelled_at) {
    await c.env.DB.prepare(
      'UPDATE meals SET cancelled_at = unixepoch(), updated_at = unixepoch() WHERE id = ? AND tenant_id = ? AND kkauth_uid = ?'
    ).bind(id, tenant.id, kkauthUid).run();
  }

  const meal = await c.env.DB.prepare('SELECT * FROM meals WHERE id = ?').bind(id).first<any>();
  return c.json({ data: meal });
}

/** DELETE /meals/meals/:id — owner soft-delete (posted-by-mistake; vanishes immediately). */
export async function deleteMeal(c: AppContext) {
  const user = c.get('user');
  const tenant = c.get('tenant');
  const kkauthUid = Number(user.sub);
  const id = c.req.param('id') ?? '';

  const res = await c.env.DB.prepare(
    'UPDATE meals SET deleted_at = unixepoch(), updated_at = unixepoch() WHERE id = ? AND tenant_id = ? AND kkauth_uid = ? AND deleted_at IS NULL'
  ).bind(id, tenant.id, kkauthUid).run();
  if (res.meta.changes !== 1) throw new HTTPException(404, { message: 'Meal not found.' });

  return c.json({ data: { removed: true } });
}

// ─────────────────────────────────────────────────────────────────────────────
// Admin — hide with a required, owner-visible reason; only admin reverses
// ─────────────────────────────────────────────────────────────────────────────

/** GET /admin/meals/kitchens — every kitchen, every state, newest first. */
export async function adminListKitchens(c: AppContext) {
  requireAdmin(c);
  const tenant = c.get('tenant');

  const { results } = await c.env.DB.prepare(`
    SELECT k.*, u.email AS owner_email
    FROM meal_kitchens k
    LEFT JOIN users u ON u.kkauth_uid = k.kkauth_uid AND u.tenant_id = k.tenant_id
    WHERE k.tenant_id = ?
    ORDER BY k.created_at DESC
    LIMIT 200
  `).bind(tenant.id).all<any>();

  return c.json({ data: results || [] });
}

/** GET /admin/meals/meals — every meal, every state, newest first. */
export async function adminListMeals(c: AppContext) {
  requireAdmin(c);
  const tenant = c.get('tenant');

  const { results } = await c.env.DB.prepare(`
    SELECT m.*, k.name AS kitchen_name
    FROM meals m
    JOIN meal_kitchens k ON k.id = m.kitchen_id
    WHERE m.tenant_id = ?
    ORDER BY m.created_at DESC
    LIMIT 200
  `).bind(tenant.id).all<any>();

  return c.json({ data: results || [] });
}

/** POST /admin/meals/kitchens/:id/hide — { hidden, reason? }. Reason required when hiding. */
export async function adminHideKitchen(c: AppContext) {
  requireAdmin(c);
  const user = c.get('user');
  const tenant = c.get('tenant');
  const id = c.req.param('id') ?? '';
  const body = await c.req.json<any>().catch(() => ({}));

  const existing = await c.env.DB.prepare(
    'SELECT * FROM meal_kitchens WHERE id = ? AND tenant_id = ?'
  ).bind(id, tenant.id).first<any>();
  if (!existing) throw new HTTPException(404, { message: 'Kitchen not found.' });

  if (body.hidden) {
    const reason = cleanText(body.reason, 500);
    if (!reason) throw new HTTPException(400, { message: "A reason is required when hiding a member's kitchen." });
    await c.env.DB.prepare(
      'UPDATE meal_kitchens SET admin_hidden = 1, admin_hidden_reason = ?, admin_hidden_by = ?, updated_at = unixepoch() WHERE id = ? AND tenant_id = ?'
    ).bind(reason, Number(user.sub), id, tenant.id).run();
  } else {
    await c.env.DB.prepare(
      'UPDATE meal_kitchens SET admin_hidden = 0, admin_hidden_reason = NULL, admin_hidden_by = NULL, updated_at = unixepoch() WHERE id = ? AND tenant_id = ?'
    ).bind(id, tenant.id).run();
  }

  const kitchen = await c.env.DB.prepare('SELECT * FROM meal_kitchens WHERE id = ?').bind(id).first<any>();
  return c.json({ data: serializeKitchen(kitchen) });
}

/** POST /admin/meals/meals/:id/hide — same contract as adminHideKitchen. */
export async function adminHideMeal(c: AppContext) {
  requireAdmin(c);
  const user = c.get('user');
  const tenant = c.get('tenant');
  const id = c.req.param('id') ?? '';
  const body = await c.req.json<any>().catch(() => ({}));

  const existing = await c.env.DB.prepare(
    'SELECT * FROM meals WHERE id = ? AND tenant_id = ?'
  ).bind(id, tenant.id).first<any>();
  if (!existing) throw new HTTPException(404, { message: 'Meal not found.' });

  if (body.hidden) {
    const reason = cleanText(body.reason, 500);
    if (!reason) throw new HTTPException(400, { message: "A reason is required when hiding a member's meal." });
    await c.env.DB.prepare(
      'UPDATE meals SET admin_hidden = 1, admin_hidden_reason = ?, admin_hidden_by = ?, updated_at = unixepoch() WHERE id = ? AND tenant_id = ?'
    ).bind(reason, Number(user.sub), id, tenant.id).run();
  } else {
    await c.env.DB.prepare(
      'UPDATE meals SET admin_hidden = 0, admin_hidden_reason = NULL, admin_hidden_by = NULL, updated_at = unixepoch() WHERE id = ? AND tenant_id = ?'
    ).bind(id, tenant.id).run();
  }

  const meal = await c.env.DB.prepare('SELECT * FROM meals WHERE id = ?').bind(id).first<any>();
  return c.json({ data: meal });
}

// REGION_CENTER is not used directly by this handler (the map center is a UI
// concern) - imported alongside REGION_BOUNDS per the plan's "import, never
// redefine" rule, and re-exported here so a future server-side consumer never
// has a reason to redefine it either.
export { REGION_CENTER };
