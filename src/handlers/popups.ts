/**
 * Pop-Ups — mobile/pop-up business board (food trucks, pop-up shops, market
 * vendors, mobile services)
 *
 * A donor-diff of Fresh Today (src/handlers/fresh.ts): still a two-table
 * Vendor + Stop shape (Vendor = Stand, Stop = Post), but the Vendor profile
 * carries NO PIN - a mobile business's location is wherever today's stop is,
 * so lat/lon (and the per-stop nearest-town snapshot) live entirely on the
 * Stop, posted up to 60 days out. Sale Day (src/handlers/sales.ts) donates
 * the scheduled single-date clock machinery (board-TZ date/time helpers,
 * status helper shape, lazy-retirement read filter, public cancelled state).
 *
 * The defining feature (Jim's framing, POP-UPS-BUILD-PLAN.md §0): the board
 * shows two layers everywhere - CONFIRMED (green, the vendor checked in
 * today and is verifiably there) vs SCHEDULED (amber, it's on their
 * schedule - a plan, not a promise). Check-in is a soft signal: it flips a
 * stop to confirmed and snaps the exact pin, but it is NEVER a visibility
 * gate - an unchecked stop still shows, in amber, with attribution wording.
 *
 * Zero economy surface: no credits, no KKGame calls, no notifications, no
 * streaks. Cash at the window like always.
 */

import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { Env } from '../types';
import { nanoid } from 'nanoid';
import { REGION_BOUNDS, REGION_CENTER } from './fresh'; // never redefine

type AppContext = Context<{ Bindings: Env }>;

// The board's wall-clock timezone - same as fresh.ts's BOARD_TZ / sales.ts's BOARD_TZ.
const BOARD_TZ = 'America/New_York';

export const POPUP_CATEGORIES = [
  'food_truck', 'popup_shop', 'market_vendor', 'mobile_service',
] as const;
// UI labels (exact): Food Truck, Pop-Up Shop, Market Vendor, Mobile Service

const VENDOR_CAP_PER_USER = 3;
const UPCOMING_STOP_CAP = 15;         // per vendor - a two-week circuit plus slack
const STOP_COOLDOWN_MINUTES = 2;      // brake, not a wall - batch posting is legit
const NAME_MIN = 3;
const NAME_MAX = 60;
const DESC_MAX = 280;
const NOTE_MAX = 280;
const HINT_MAX = 120;
const ADDRESS_MAX = 120;
const PHONE_MAX = 25;
const EVENT_NAME_MAX = 60;
const MAX_DAYS_AHEAD = 60;            // fair vendors book far out

const TIMES_INVALID_MSG = "Check the stop - it needs a date coming up, an opening time, and a closing time after it.";
const PIN_BOUNDS_MSG = "Place the pin inside the Lakes Region - drag it to where you'll set up.";
const ADDRESS_REQUIRED_MSG = "Add an address so the map can find your stop.";

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

// Great-circle distance (miles) as a SQL expression over a stop's pin
// coordinates - COALESCE(checkin, scheduled), matching stopPinCoords()'s own
// fallback exactly, so distance always reflects the same location the pin
// itself renders at. Copied from happenings.ts's DISTANCE_SQL.
const DISTANCE_SQL = `
  3958.8 * acos(MIN(1.0, MAX(-1.0,
    sin(radians(COALESCE(s.checkin_lat, s.lat))) * sin(radians(?)) +
    cos(radians(COALESCE(s.checkin_lat, s.lat))) * cos(radians(?)) * cos(radians(COALESCE(s.checkin_lon, s.lon)) - radians(?))
  )))
`;

// ─────────────────────────────────────────────────────────────────────────────
// Board-TZ date/time helpers - copied from sales.ts (same reasoning fresh.ts
// itself documents for not sharing these across board modules).
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

/** Full weekday name ('Saturday') - the house style for every {weekday} in §7 copy. */
function weekdayFull(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'long' });
}

/** Short weekday ('Sat') - only for the compact OG share description (§6.1). */
function weekdayShort(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short' });
}

function dateLabel(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' });
}

/** 'h:mm' with no AM/PM suffix, e.g. '10:58' - the check-in timestamp format used
 *  throughout §7 ("Checked in 10:58"), distinct from clockLabel's "10:58 AM". */
function checkinTimeLabel(unixSeconds: number): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: BOARD_TZ, hour12: true, hour: 'numeric', minute: '2-digit',
  }).formatToParts(new Date(unixSeconds * 1000));
  const hour = parts.find(p => p.type === 'hour')?.value ?? '12';
  const minute = parts.find(p => p.type === 'minute')?.value ?? '00';
  return `${hour}:${minute}`;
}

export { weekdayShort, dateLabel };

// ─────────────────────────────────────────────────────────────────────────────
// The status helper - single-date, adapted from sales.ts's saleStatus() with
// renamed states (plan §4). Every badge (public feed, pins, vendor page, My
// Schedule) hangs off this one pure function.
// ─────────────────────────────────────────────────────────────────────────────

export type StopStatus = 'cancelled' | 'done' | 'sold_out' | 'here_now' | 'scheduled_now' | 'today' | 'upcoming';

export function stopStatus(
  date: string, open: string, close: string,
  soldOut: boolean, cancelledAt: number | null, checkedInAt: number | null,
  now: number = Math.floor(Date.now() / 1000),
): StopStatus {
  if (cancelledAt) return 'cancelled';

  const today = boardDateStr(new Date(now * 1000));
  if (date > today) return 'upcoming';

  const closeAt = boardWallTimeToUnix(date, close);
  if (date < today || now > closeAt) return 'done';

  if (soldOut) return 'sold_out';
  if (checkedInAt) return 'here_now'; // checked in early (before open) still reads here_now

  const openAt = boardWallTimeToUnix(date, open);
  if (now < openAt) return 'today';
  return 'scheduled_now';
}

/** 'confirmed' (green) when checked in and still live, else 'scheduled' (amber). */
function stopLayer(status: StopStatus, checkedInAt: number | null): 'confirmed' | 'scheduled' {
  if (status === 'here_now') return 'confirmed';
  if (status === 'sold_out' && checkedInAt) return 'confirmed';
  return 'scheduled';
}

/** Check-in pin when present (the exact spot), else the scheduled pin. */
function stopPinCoords(row: any): { lat: number; lon: number } {
  if (row.checkin_lat != null && row.checkin_lon != null) return { lat: row.checkin_lat, lon: row.checkin_lon };
  return { lat: row.lat, lon: row.lon };
}

/** Public-facing status note (§7.1). Attribution rule: green states say what
 *  the platform verified; amber states say whose claim it is. */
function publicStopStatusNote(status: StopStatus, row: any): string {
  switch (status) {
    case 'cancelled': return 'Cancelled';
    case 'done': return `Was here ${dateLabel(row.date)}`;
    case 'sold_out': return 'Sold out';
    case 'here_now': return `Checked in ${checkinTimeLabel(row.checked_in_at)} - here until ${clockLabel(row.close)}`;
    case 'scheduled_now': return 'On their schedule now - not confirmed';
    case 'today': return `On their schedule today, ${clockLabel(row.open)} - ${clockLabel(row.close)}`;
    case 'upcoming': return `${weekdayFull(row.date)} ${dateLabel(row.date)} · ${clockLabel(row.open)} - ${clockLabel(row.close)}`;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Owner-visible state helpers (used by listMyPopups) - mirrors fresh.ts's
// standState/postState, sales.ts's ownerSaleState.
// ─────────────────────────────────────────────────────────────────────────────

type VendorState = 'visible' | 'off_road' | 'hidden_by_admin' | 'removed';
type StopOwnerState = StopStatus | 'removed' | 'hidden_by_admin';

function vendorState(row: any): VendorState {
  if (row.deleted_at) return 'removed';
  if (row.admin_hidden) return 'hidden_by_admin';
  if (row.is_hidden) return 'off_road';
  return 'visible';
}

function hiddenByAdminNote(row: any): string {
  return `Hidden by an admin: "${row.admin_hidden_reason}" - reply from your profile's Talk to Us if you have questions.`;
}

function vendorStateNote(state: VendorState, row: any): string {
  switch (state) {
    case 'visible': return 'Live - neighbors can see your page and your stops.';
    case 'off_road': return "Off the road - only you can see it. Tap Back out when you're rolling again.";
    case 'hidden_by_admin': return hiddenByAdminNote(row);
    case 'removed': return 'Removed.';
  }
}

function stopOwnerState(row: any, now: number): StopOwnerState {
  if (row.deleted_at) return 'removed';
  if (row.admin_hidden) return 'hidden_by_admin';
  return stopStatus(row.date, row.open, row.close, !!row.sold_out, row.cancelled_at, row.checked_in_at, now);
}

function stopOwnerStateNote(state: StopOwnerState, row: any): string {
  switch (state) {
    case 'removed': return 'Removed.';
    case 'hidden_by_admin': return hiddenByAdminNote(row);
    case 'cancelled': return "Cancelled - it stays listed until the day ends so nobody drives out.";
    case 'done': return `Was here ${dateLabel(row.date)}.`;
    case 'sold_out': return 'Sold out - still listed so folks know how it went.';
    case 'here_now': return `Checked in ${checkinTimeLabel(row.checked_in_at)} - green on the map until ${clockLabel(row.close)}.`;
    case 'scheduled_now': return 'Your window is open but you haven\'t checked in - fans see "not confirmed" until you tap I\'m here.';
    case 'today': return `Today, ${clockLabel(row.open)} to ${clockLabel(row.close)}. Tap I'm here when you're set up - it turns your pin green.`;
    case 'upcoming': return `On the board - ${weekdayFull(row.date)} ${dateLabel(row.date)}, ${clockLabel(row.open)} to ${clockLabel(row.close)}.`;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Nearest-town snapshot - copied verbatim (in behavior) from fresh.ts's
// fetchNearestPlace, called per-stop (not per-vendor - the vendor has no pin).
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
      console.error('[popups] nearest-place lookup returned non-OK status:', res.status);
      return { city: null, state: null };
    }
    const body = await res.json<any>();
    return {
      city: body?.data?.city ?? null,
      state: body?.data?.state ?? null,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[popups] nearest-place lookup failed:', msg);
    return { city: null, state: null };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Input validation
// ─────────────────────────────────────────────────────────────────────────────

function parseVendorInput(body: any, existing?: any) {
  const name = cleanText(body.name, NAME_MAX) ?? (existing ? existing.name : null);
  if (!name || name.length < NAME_MIN) {
    throw new HTTPException(400, { message: 'Give your vendor page a name (3-60 characters).' });
  }

  const category = body.category === undefined ? (existing?.category ?? null) : body.category;
  if (!category || !(POPUP_CATEGORIES as readonly string[]).includes(category)) {
    throw new HTTPException(400, { message: 'Pick a category for your vendor page.' });
  }

  const description = body.description === undefined ? (existing?.description ?? null) : cleanText(body.description, DESC_MAX);
  const phone = body.phone === undefined ? (existing?.phone ?? null) : cleanText(body.phone, PHONE_MAX);
  const photoUrl = body.photo_url === undefined ? (existing?.photo_url ?? null) : cleanText(body.photo_url, 500);

  return { name, category, description, phone, photoUrl };
}

interface StopInput {
  date: string; open: string; close: string; lat: number; lon: number;
  address: string; locationHint: string | null; note: string | null; eventName: string | null;
}

function parseStopInput(body: any, existing?: any): StopInput {
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

  const lat = body.lat !== undefined ? Number(body.lat) : Number(existing?.lat);
  const lon = body.lon !== undefined ? Number(body.lon) : Number(existing?.lon);
  if (
    !Number.isFinite(lat) || !Number.isFinite(lon) ||
    lat < REGION_BOUNDS.minLat || lat > REGION_BOUNDS.maxLat ||
    lon < REGION_BOUNDS.minLon || lon > REGION_BOUNDS.maxLon
  ) {
    throw new HTTPException(400, { message: PIN_BOUNDS_MSG });
  }

  const address = body.address === undefined ? (existing?.address ?? null) : cleanText(body.address, ADDRESS_MAX);
  if (!address) {
    throw new HTTPException(400, { message: ADDRESS_REQUIRED_MSG });
  }

  const locationHint = body.location_hint === undefined ? (existing?.location_hint ?? null) : cleanText(body.location_hint, HINT_MAX);
  const note = body.note === undefined ? (existing?.note ?? null) : cleanText(body.note, NOTE_MAX);
  const eventName = body.event_name === undefined ? (existing?.event_name ?? null) : cleanText(body.event_name, EVENT_NAME_MAX);

  return { date, open, close, lat, lon, address, locationHint, note, eventName };
}

/** Cooldown + upcoming-stop cap, per vendor. Brake, not a wall - batch posting a
 *  whole week is legit (only the 2-min cooldown paces successive creates). */
async function guardStopCapAndCooldown(c: AppContext, vendorId: string) {
  const last = await c.env.DB.prepare(
    'SELECT created_at FROM popup_stops WHERE vendor_id = ? ORDER BY created_at DESC LIMIT 1'
  ).bind(vendorId).first<{ created_at: number }>();
  if (last) {
    const since = Math.floor(Date.now() / 1000) - last.created_at;
    if (since < STOP_COOLDOWN_MINUTES * 60) {
      throw new HTTPException(429, { message: 'Give it a minute between stops - you can add the next one shortly.' });
    }
  }

  const today = boardDateStr();
  const upcoming = await c.env.DB.prepare(
    'SELECT COUNT(*) AS n FROM popup_stops WHERE vendor_id = ? AND deleted_at IS NULL AND cancelled_at IS NULL AND admin_hidden = 0 AND date >= ?'
  ).bind(vendorId, today).first<{ n: number }>();
  if ((upcoming?.n ?? 0) >= UPCOMING_STOP_CAP) {
    throw new HTTPException(409, {
      message: `You have ${UPCOMING_STOP_CAP} stops coming up - that's the board's limit. Edit one instead, or add more as they happen.`,
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Public board
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/t/:tenant/popups — the feed. Joins stops -> vendors. Optional
 * ?category= (vendor category), ?when=today|coming, and ?event= (event_name).
 */
export async function listStops(c: AppContext) {
  const tenant = c.get('tenant');
  const category = c.req.query('category');
  const when = c.req.query('when');
  const event = c.req.query('event');
  const today = boardDateStr();
  const now = Math.floor(Date.now() / 1000);
  const near = parseNearby(c);

  const filters = [
    's.tenant_id = ?', 's.deleted_at IS NULL', 's.admin_hidden = 0', 's.date >= ?',
    'v.deleted_at IS NULL', 'v.is_hidden = 0', 'v.admin_hidden = 0',
  ];
  const binds: any[] = [tenant.id, today];
  if (category && (POPUP_CATEGORIES as readonly string[]).includes(category)) {
    filters.push('v.category = ?');
    binds.push(category);
  }
  if (when === 'today') {
    filters.push('s.date = ?');
    binds.push(today);
  } else if (when === 'coming') {
    filters.push('s.date > ?');
    binds.push(today);
  }
  if (event) {
    filters.push('s.event_name = ?');
    binds.push(event);
  }

  // "Near me": filter to the radius *before* the 200-cap, same reasoning as
  // happenings.ts/fresh.ts/sales.ts.
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
    SELECT s.*, v.id AS vendor_id, v.name AS vendor_name, v.category AS vendor_category,
           v.phone AS vendor_phone, v.photo_url AS vendor_photo_url,
           ${distanceSelect}
    FROM popup_stops s
    JOIN popup_vendors v ON v.id = s.vendor_id
    WHERE ${filters.join(' AND ')}
    ORDER BY s.date ASC, s.open ASC
    LIMIT 200
  `).bind(...binds).all<any>();

  const data = (results || []).map((r: any) => {
    const status = stopStatus(r.date, r.open, r.close, !!r.sold_out, r.cancelled_at, r.checked_in_at, now);
    return {
      id: r.id, date: r.date, open: r.open, close: r.close,
      lat: r.lat, lon: r.lon, checkin_lat: r.checkin_lat, checkin_lon: r.checkin_lon,
      address: r.address, location_hint: r.location_hint, note: r.note, event_name: r.event_name ?? null,
      nearest_city: r.nearest_city ?? null, nearest_state: r.nearest_state ?? null,
      checked_in_at: r.checked_in_at, sold_out: !!r.sold_out, cancelled_at: r.cancelled_at,
      created_at: r.created_at,
      status, status_note: publicStopStatusNote(status, r),
      distance_mi: r.distance_mi == null ? null : Math.round(r.distance_mi * 10) / 10,
      vendor: {
        id: r.vendor_id, name: r.vendor_name, category: r.vendor_category,
        phone: r.vendor_phone, photo_url: r.vendor_photo_url,
      },
    };
  });

  return c.json({ data });
}

/**
 * GET /api/t/:tenant/popups/pins — one pin per visible stop, with a `layer`
 * field ('confirmed' | 'scheduled') for the two-layer map. Pin coordinates
 * are the check-in pin when present, else the scheduled pin. Registered
 * before /popups/vendors/:id (Hono order, sibling lesson).
 */
export async function listStopPins(c: AppContext) {
  const tenant = c.get('tenant');
  const category = c.req.query('category');
  const when = c.req.query('when');
  const event = c.req.query('event');
  const today = boardDateStr();
  const now = Math.floor(Date.now() / 1000);
  const near = parseNearby(c);

  const filters = [
    's.tenant_id = ?', 's.deleted_at IS NULL', 's.admin_hidden = 0', 's.date >= ?',
    'v.deleted_at IS NULL', 'v.is_hidden = 0', 'v.admin_hidden = 0',
  ];
  const binds: any[] = [tenant.id, today];
  if (category && (POPUP_CATEGORIES as readonly string[]).includes(category)) {
    filters.push('v.category = ?');
    binds.push(category);
  }
  if (when === 'today') {
    filters.push('s.date = ?');
    binds.push(today);
  } else if (when === 'coming') {
    filters.push('s.date > ?');
    binds.push(today);
  }
  if (event) {
    filters.push('s.event_name = ?');
    binds.push(event);
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
    SELECT s.id, s.date, s.open, s.close, s.lat, s.lon, s.checkin_lat, s.checkin_lon,
           s.sold_out, s.cancelled_at, s.checked_in_at,
           v.id AS vendor_id, v.name AS vendor_name,
           ${distanceSelect}
    FROM popup_stops s
    JOIN popup_vendors v ON v.id = s.vendor_id
    WHERE ${filters.join(' AND ')}
    ORDER BY s.date ASC, s.open ASC
    LIMIT 300
  `).bind(...binds).all<any>();

  const data = (results || []).map((r: any) => {
    const status = stopStatus(r.date, r.open, r.close, !!r.sold_out, r.cancelled_at, r.checked_in_at, now);
    const coords = stopPinCoords(r);
    return {
      id: r.id,
      vendor_id: r.vendor_id,
      vendor_name: r.vendor_name,
      lat: coords.lat, lon: coords.lon,
      status, status_note: publicStopStatusNote(status, r),
      layer: stopLayer(status, r.checked_in_at),
      distance_mi: r.distance_mi == null ? null : Math.round(r.distance_mi * 10) / 10,
    };
  });

  return c.json({ data });
}

/**
 * GET /api/t/:tenant/popups/events — event chips, 2+ visible stops sharing an
 * event_name (mirrors sales.ts's listSaleEvents). Registered before
 * /popups/vendors/:id (Hono order, sibling lesson).
 */
export async function listPopupEvents(c: AppContext) {
  const tenant = c.get('tenant');
  const today = boardDateStr();
  const now = Math.floor(Date.now() / 1000);

  const { results } = await c.env.DB.prepare(`
    SELECT s.event_name, s.date FROM popup_stops s
    JOIN popup_vendors v ON v.id = s.vendor_id
    WHERE s.tenant_id = ? AND s.deleted_at IS NULL AND s.admin_hidden = 0 AND s.cancelled_at IS NULL AND s.date >= ?
      AND v.deleted_at IS NULL AND v.is_hidden = 0 AND v.admin_hidden = 0 AND s.event_name IS NOT NULL
  `).bind(tenant.id, today).all<any>();

  const counts = new Map<string, number>();
  for (const r of (results || [])) {
    if (now >= endOfBoardDay(r.date)) continue;
    counts.set(r.event_name, (counts.get(r.event_name) ?? 0) + 1);
  }

  const data = [...counts.entries()]
    .filter(([, n]) => n >= 2)
    .map(([event_name, count]) => ({ event_name, count }));

  return c.json({ data });
}

/**
 * GET /api/t/:tenant/popups/vendors/:id — the fan page: profile + every
 * publicly visible upcoming stop soonest-first (the full schedule) +
 * last_checked_in (the vendor's most recent checked-in stop, or null - the
 * factual track-record line). 404 if not publicly visible.
 */
export async function getVendor(c: AppContext) {
  const tenant = c.get('tenant');
  const id = c.req.param('id') ?? '';
  const today = boardDateStr();
  const now = Math.floor(Date.now() / 1000);

  const vendor = await c.env.DB.prepare(`
    SELECT id, name, category, description, phone, photo_url, created_at
    FROM popup_vendors
    WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL AND is_hidden = 0 AND admin_hidden = 0
  `).bind(id, tenant.id).first<any>();
  if (!vendor) throw new HTTPException(404, { message: "That vendor isn't on the board." });

  const { results: stopRows } = await c.env.DB.prepare(`
    SELECT * FROM popup_stops
    WHERE vendor_id = ? AND deleted_at IS NULL AND admin_hidden = 0 AND date >= ?
    ORDER BY date ASC, open ASC
  `).bind(id, today).all<any>();

  const stops = (stopRows || []).map((r: any) => {
    const status = stopStatus(r.date, r.open, r.close, !!r.sold_out, r.cancelled_at, r.checked_in_at, now);
    return {
      id: r.id, date: r.date, open: r.open, close: r.close,
      lat: r.lat, lon: r.lon, checkin_lat: r.checkin_lat, checkin_lon: r.checkin_lon,
      address: r.address, location_hint: r.location_hint, note: r.note, event_name: r.event_name ?? null,
      nearest_city: r.nearest_city ?? null, nearest_state: r.nearest_state ?? null,
      checked_in_at: r.checked_in_at, sold_out: !!r.sold_out, cancelled_at: r.cancelled_at,
      status, status_note: publicStopStatusNote(status, r),
    };
  });

  const lastCheckedIn = await c.env.DB.prepare(`
    SELECT date, location_hint, nearest_city FROM popup_stops
    WHERE vendor_id = ? AND deleted_at IS NULL AND admin_hidden = 0 AND cancelled_at IS NULL AND checked_in_at IS NOT NULL
    ORDER BY checked_in_at DESC LIMIT 1
  `).bind(id).first<{ date: string; location_hint: string | null; nearest_city: string | null }>();

  return c.json({
    data: {
      ...vendor,
      stops,
      last_checked_in: lastCheckedIn
        ? { date: lastCheckedIn.date, location_hint: lastCheckedIn.location_hint, nearest_city: lastCheckedIn.nearest_city }
        : null,
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Authenticated — owner CRUD (any signed-in user, no merchant verification)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /popups/mine — every vendor the caller owns, in every state, each with
 * every stop, every state (upcoming soonest-first, then latest 10 past) and
 * `can_repeat` on done/cancelled stops of visible vendors.
 */
export async function listMyPopups(c: AppContext) {
  const user = c.get('user');
  const tenant = c.get('tenant');
  const kkauthUid = Number(user.sub);
  const now = Math.floor(Date.now() / 1000);
  const today = boardDateStr(new Date(now * 1000));

  const { results: vendorRows } = await c.env.DB.prepare(
    'SELECT * FROM popup_vendors WHERE tenant_id = ? AND kkauth_uid = ? ORDER BY created_at DESC'
  ).bind(tenant.id, kkauthUid).all<any>();

  const vendors = [];
  for (const v of (vendorRows || [])) {
    const vState = vendorState(v);
    const vVisible = vState === 'visible';

    const { results: stopRows } = await c.env.DB.prepare(
      'SELECT * FROM popup_stops WHERE vendor_id = ? ORDER BY date DESC, open DESC'
    ).bind(v.id).all<any>();

    const stops = (stopRows || []).map((r: any) => {
      const state = stopOwnerState(r, now);
      return {
        id: r.id, date: r.date, open: r.open, close: r.close,
        lat: r.lat, lon: r.lon, checkin_lat: r.checkin_lat, checkin_lon: r.checkin_lon,
        address: r.address, location_hint: r.location_hint, note: r.note, event_name: r.event_name ?? null,
        nearest_city: r.nearest_city ?? null, nearest_state: r.nearest_state ?? null,
        checked_in_at: r.checked_in_at, sold_out: !!r.sold_out, cancelled_at: r.cancelled_at,
        admin_hidden_reason: r.admin_hidden ? r.admin_hidden_reason : null,
        created_at: r.created_at,
        state, state_note: stopOwnerStateNote(state, r),
        can_repeat: vVisible && (state === 'done' || state === 'cancelled'),
      };
    });

    const upcoming = stops
      .filter(s => s.date >= today)
      .sort((a, b) => (a.date + a.open).localeCompare(b.date + b.open));
    const past = stops
      .filter(s => s.date < today)
      .sort((a, b) => (b.date + b.open).localeCompare(a.date + a.open))
      .slice(0, 10);

    vendors.push({
      id: v.id, name: v.name, category: v.category, description: v.description,
      phone: v.phone, photo_url: v.photo_url,
      is_hidden: !!v.is_hidden,
      admin_hidden_reason: v.admin_hidden ? v.admin_hidden_reason : null,
      created_at: v.created_at,
      state: vState, state_note: vendorStateNote(vState, v),
      stops: [...upcoming, ...past],
    });
  }

  return c.json({ data: { vendors } });
}

/** POST /popups/upload — owner uploads a vendor photo. Clone of uploadFreshPhoto. */
export async function uploadPopupPhoto(c: AppContext) {
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

/** POST /popups/vendors — create a vendor page. Max 3 per kkauth_uid. */
export async function createVendor(c: AppContext) {
  const user = c.get('user');
  const tenant = c.get('tenant');
  const kkauthUid = Number(user.sub);
  const body = await c.req.json<any>().catch(() => ({}));

  const countRow = await c.env.DB.prepare(
    'SELECT COUNT(*) AS n FROM popup_vendors WHERE tenant_id = ? AND kkauth_uid = ? AND deleted_at IS NULL'
  ).bind(tenant.id, kkauthUid).first<{ n: number }>();
  if ((countRow?.n ?? 0) >= VENDOR_CAP_PER_USER) {
    throw new HTTPException(409, { message: 'You can run up to three vendor pages. Remove one to add another.' });
  }

  const input = parseVendorInput(body);
  const id = nanoid(10);

  await c.env.DB.prepare(`
    INSERT INTO popup_vendors (id, tenant_id, kkauth_uid, name, category, description, phone, photo_url)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(id, tenant.id, kkauthUid, input.name, input.category, input.description, input.phone, input.photoUrl).run();

  const vendor = await c.env.DB.prepare('SELECT * FROM popup_vendors WHERE id = ?').bind(id).first<any>();
  return c.json({ data: vendor }, 201);
}

/** PUT /popups/vendors/:id — owner edits everything anytime except deleted/admin-hidden. */
export async function updateVendor(c: AppContext) {
  const user = c.get('user');
  const tenant = c.get('tenant');
  const kkauthUid = Number(user.sub);
  const id = c.req.param('id') ?? '';
  const body = await c.req.json<any>().catch(() => ({}));

  const existing = await c.env.DB.prepare(
    'SELECT * FROM popup_vendors WHERE id = ? AND tenant_id = ?'
  ).bind(id, tenant.id).first<any>();
  if (!existing || existing.deleted_at) throw new HTTPException(404, { message: 'Vendor not found.' });
  if (existing.kkauth_uid !== kkauthUid) throw new HTTPException(403, { message: 'This is not your vendor page.' });
  if (existing.admin_hidden) {
    throw new HTTPException(403, { message: 'An admin has hidden this vendor page. The reason is on your My Schedule page.' });
  }

  const input = parseVendorInput(body, existing);

  await c.env.DB.prepare(`
    UPDATE popup_vendors
    SET name = ?, category = ?, description = ?, phone = ?, photo_url = ?, updated_at = unixepoch()
    WHERE id = ? AND tenant_id = ? AND kkauth_uid = ?
  `).bind(input.name, input.category, input.description, input.phone, input.photoUrl, id, tenant.id, kkauthUid).run();

  const vendor = await c.env.DB.prepare('SELECT * FROM popup_vendors WHERE id = ?').bind(id).first<any>();
  return c.json({ data: vendor });
}

/**
 * POST /popups/vendors/:id/visibility — owner "Off the road" / "Back out".
 * Flips is_hidden only; never touches admin_hidden - always 403s while
 * admin-hidden regardless of the requested value.
 */
export async function setVendorVisibility(c: AppContext) {
  const user = c.get('user');
  const tenant = c.get('tenant');
  const kkauthUid = Number(user.sub);
  const id = c.req.param('id') ?? '';
  const body = await c.req.json<any>().catch(() => ({}));

  const existing = await c.env.DB.prepare(
    'SELECT * FROM popup_vendors WHERE id = ? AND tenant_id = ?'
  ).bind(id, tenant.id).first<any>();
  if (!existing || existing.deleted_at) throw new HTTPException(404, { message: 'Vendor not found.' });
  if (existing.kkauth_uid !== kkauthUid) throw new HTTPException(403, { message: 'This is not your vendor page.' });
  if (existing.admin_hidden) {
    throw new HTTPException(403, { message: 'An admin has hidden this vendor page. The reason is on your My Schedule page.' });
  }

  const hidden = asBool(body.hidden, !!existing.is_hidden) ? 1 : 0;
  await c.env.DB.prepare(
    'UPDATE popup_vendors SET is_hidden = ?, updated_at = unixepoch() WHERE id = ? AND tenant_id = ? AND kkauth_uid = ?'
  ).bind(hidden, id, tenant.id, kkauthUid).run();

  const vendor = await c.env.DB.prepare('SELECT * FROM popup_vendors WHERE id = ?').bind(id).first<any>();
  return c.json({ data: vendor });
}

/** DELETE /popups/vendors/:id — owner soft-delete. Stops keep their FK, drop
 *  from public via the join; photo stays an R2 object referenced by URL. */
export async function deleteVendor(c: AppContext) {
  const user = c.get('user');
  const tenant = c.get('tenant');
  const kkauthUid = Number(user.sub);
  const id = c.req.param('id') ?? '';

  const res = await c.env.DB.prepare(
    'UPDATE popup_vendors SET deleted_at = unixepoch(), updated_at = unixepoch() WHERE id = ? AND tenant_id = ? AND kkauth_uid = ? AND deleted_at IS NULL'
  ).bind(id, tenant.id, kkauthUid).run();
  if (res.meta.changes !== 1) throw new HTTPException(404, { message: 'Vendor not found.' });

  return c.json({ data: { removed: true } });
}

/**
 * POST /popups/vendors/:id/stops — owner posts a scheduled stop. Vendor must
 * be visible (409 with why if off-road/admin-hidden); cap + cooldown guard.
 */
export async function createStop(c: AppContext) {
  const user = c.get('user');
  const tenant = c.get('tenant');
  const kkauthUid = Number(user.sub);
  const vendorId = c.req.param('id') ?? '';
  const body = await c.req.json<any>().catch(() => ({}));

  const vendor = await c.env.DB.prepare(
    'SELECT * FROM popup_vendors WHERE id = ? AND tenant_id = ? AND kkauth_uid = ?'
  ).bind(vendorId, tenant.id, kkauthUid).first<any>();
  if (!vendor || vendor.deleted_at) throw new HTTPException(404, { message: 'Vendor not found.' });
  if (vendor.admin_hidden) {
    throw new HTTPException(403, { message: 'An admin has hidden this vendor page. The reason is on your My Schedule page.' });
  }
  if (vendor.is_hidden) {
    throw new HTTPException(409, { message: 'Your vendor page is off the road - tap Back out on My Schedule and then add the stop.' });
  }

  const input = parseStopInput(body);
  await guardStopCapAndCooldown(c, vendorId);

  const id = nanoid(10);
  const nearest = await fetchNearestPlace(c, input.lat, input.lon);

  await c.env.DB.prepare(`
    INSERT INTO popup_stops
      (id, tenant_id, vendor_id, kkauth_uid, date, open, close, lat, lon, address, location_hint, note, event_name, nearest_city, nearest_state)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    id, tenant.id, vendorId, kkauthUid, input.date, input.open, input.close,
    input.lat, input.lon, input.address, input.locationHint, input.note, input.eventName, nearest.city, nearest.state
  ).run();

  const stop = await c.env.DB.prepare('SELECT * FROM popup_stops WHERE id = ?').bind(id).first<any>();
  return c.json({ data: stop }, 201);
}

/**
 * PUT /popups/stops/:id — owner edits everything while date >= today and not
 * cancelled/removed/admin-hidden. Full revalidation; lat/lon never blankable.
 */
export async function updateStop(c: AppContext) {
  const user = c.get('user');
  const tenant = c.get('tenant');
  const kkauthUid = Number(user.sub);
  const id = c.req.param('id') ?? '';
  const body = await c.req.json<any>().catch(() => ({}));

  const existing = await c.env.DB.prepare(
    'SELECT * FROM popup_stops WHERE id = ? AND tenant_id = ? AND kkauth_uid = ?'
  ).bind(id, tenant.id, kkauthUid).first<any>();
  if (!existing || existing.deleted_at) throw new HTTPException(404, { message: 'Stop not found.' });
  if (existing.admin_hidden) {
    throw new HTTPException(403, { message: 'An admin has hidden this stop. The reason is on your My Schedule page.' });
  }

  const today = boardDateStr();
  if (existing.cancelled_at || existing.date < today) {
    throw new HTTPException(409, { message: 'This stop already happened or was cancelled - use Stop here again to post a new one.' });
  }

  const input = parseStopInput(body, existing);

  const pinMoved = input.lat !== existing.lat || input.lon !== existing.lon;
  let nearestCity = existing.nearest_city ?? null;
  let nearestState = existing.nearest_state ?? null;
  if (pinMoved || nearestCity === null) {
    const nearest = await fetchNearestPlace(c, input.lat, input.lon);
    nearestCity = nearest.city;
    nearestState = nearest.state;
  }

  await c.env.DB.prepare(`
    UPDATE popup_stops
    SET date = ?, open = ?, close = ?, lat = ?, lon = ?, address = ?, location_hint = ?, note = ?, event_name = ?,
        nearest_city = ?, nearest_state = ?, updated_at = unixepoch()
    WHERE id = ? AND tenant_id = ? AND kkauth_uid = ?
  `).bind(
    input.date, input.open, input.close, input.lat, input.lon, input.address, input.locationHint, input.note, input.eventName,
    nearestCity, nearestState, id, tenant.id, kkauthUid
  ).run();

  const stop = await c.env.DB.prepare('SELECT * FROM popup_stops WHERE id = ?').bind(id).first<any>();
  return c.json({ data: stop });
}

/**
 * POST /popups/stops/:id/checkin — owner, on the stop's date only. Optional
 * { lat, lon } bounds-checked; stamps checked_in_at, stores checkin_lat/lon
 * when provided. Repeatable - updates the stamp and pin ("Fix my pin"). Never
 * a visibility condition.
 */
export async function checkInStop(c: AppContext) {
  const user = c.get('user');
  const tenant = c.get('tenant');
  const kkauthUid = Number(user.sub);
  const id = c.req.param('id') ?? '';
  const body = await c.req.json<any>().catch(() => ({}));

  const existing = await c.env.DB.prepare(
    'SELECT * FROM popup_stops WHERE id = ? AND tenant_id = ? AND kkauth_uid = ?'
  ).bind(id, tenant.id, kkauthUid).first<any>();
  if (!existing || existing.deleted_at) throw new HTTPException(404, { message: 'Stop not found.' });
  if (existing.admin_hidden) {
    throw new HTTPException(403, { message: 'An admin has hidden this stop. The reason is on your My Schedule page.' });
  }
  if (existing.cancelled_at) {
    throw new HTTPException(409, { message: 'This stop was cancelled - nothing to check in to.' });
  }

  const today = boardDateStr();
  if (existing.date !== today) {
    throw new HTTPException(409, { message: `You can check in on the day of the stop - this one's ${weekdayFull(existing.date)}.` });
  }

  let checkinLat: number | null = existing.checkin_lat ?? null;
  let checkinLon: number | null = existing.checkin_lon ?? null;
  if (body.lat !== undefined || body.lon !== undefined) {
    const lat = Number(body.lat);
    const lon = Number(body.lon);
    if (
      !Number.isFinite(lat) || !Number.isFinite(lon) ||
      lat < REGION_BOUNDS.minLat || lat > REGION_BOUNDS.maxLat ||
      lon < REGION_BOUNDS.minLon || lon > REGION_BOUNDS.maxLon
    ) {
      throw new HTTPException(400, { message: "That location is outside the Lakes Region - drag the pin to where you're set up." });
    }
    checkinLat = lat;
    checkinLon = lon;
  }

  await c.env.DB.prepare(
    'UPDATE popup_stops SET checked_in_at = unixepoch(), checkin_lat = ?, checkin_lon = ?, updated_at = unixepoch() WHERE id = ? AND tenant_id = ? AND kkauth_uid = ?'
  ).bind(checkinLat, checkinLon, id, tenant.id, kkauthUid).run();

  const stop = await c.env.DB.prepare('SELECT * FROM popup_stops WHERE id = ?').bind(id).first<any>();
  return c.json({ data: stop });
}

/** POST /popups/stops/:id/sold-out — owner marks today's stop sold out (idempotent). */
export async function setStopSoldOut(c: AppContext) {
  const user = c.get('user');
  const tenant = c.get('tenant');
  const kkauthUid = Number(user.sub);
  const id = c.req.param('id') ?? '';

  const existing = await c.env.DB.prepare(
    'SELECT * FROM popup_stops WHERE id = ? AND tenant_id = ? AND kkauth_uid = ?'
  ).bind(id, tenant.id, kkauthUid).first<any>();
  if (!existing || existing.deleted_at) throw new HTTPException(404, { message: 'Stop not found.' });
  if (existing.admin_hidden) {
    throw new HTTPException(403, { message: 'An admin has hidden this stop. The reason is on your My Schedule page.' });
  }
  if (existing.cancelled_at) {
    throw new HTTPException(409, { message: 'This stop was cancelled - nothing to mark sold out.' });
  }

  const today = boardDateStr();
  if (existing.date !== today) {
    throw new HTTPException(409, { message: 'You can mark sold out on the day of the stop.' });
  }

  if (!existing.sold_out) {
    await c.env.DB.prepare(
      'UPDATE popup_stops SET sold_out = 1, sold_out_at = unixepoch() WHERE id = ? AND tenant_id = ? AND kkauth_uid = ?'
    ).bind(id, tenant.id, kkauthUid).run();
  }

  const stop = await c.env.DB.prepare('SELECT * FROM popup_stops WHERE id = ?').bind(id).first<any>();
  return c.json({ data: stop });
}

/**
 * POST /popups/stops/:id/cancel — public "Cancelled" badge until day end (a
 * vanished stop strands the fans who planned on it). 409 once the day is over.
 */
export async function cancelStop(c: AppContext) {
  const user = c.get('user');
  const tenant = c.get('tenant');
  const kkauthUid = Number(user.sub);
  const id = c.req.param('id') ?? '';

  const existing = await c.env.DB.prepare(
    'SELECT * FROM popup_stops WHERE id = ? AND tenant_id = ? AND kkauth_uid = ?'
  ).bind(id, tenant.id, kkauthUid).first<any>();
  if (!existing || existing.deleted_at) throw new HTTPException(404, { message: 'Stop not found.' });
  if (existing.admin_hidden) {
    throw new HTTPException(403, { message: 'An admin has hidden this stop. The reason is on your My Schedule page.' });
  }

  const now = Math.floor(Date.now() / 1000);
  if (now >= endOfBoardDay(existing.date)) {
    throw new HTTPException(409, { message: "That stop's day is over - nothing to cancel." });
  }

  if (!existing.cancelled_at) {
    await c.env.DB.prepare(
      'UPDATE popup_stops SET cancelled_at = unixepoch(), updated_at = unixepoch() WHERE id = ? AND tenant_id = ? AND kkauth_uid = ?'
    ).bind(id, tenant.id, kkauthUid).run();
  }

  const stop = await c.env.DB.prepare('SELECT * FROM popup_stops WHERE id = ?').bind(id).first<any>();
  return c.json({ data: stop });
}

/** DELETE /popups/stops/:id — owner soft-delete (posted-by-mistake; vanishes immediately). */
export async function deleteStop(c: AppContext) {
  const user = c.get('user');
  const tenant = c.get('tenant');
  const kkauthUid = Number(user.sub);
  const id = c.req.param('id') ?? '';

  const res = await c.env.DB.prepare(
    'UPDATE popup_stops SET deleted_at = unixepoch(), updated_at = unixepoch() WHERE id = ? AND tenant_id = ? AND kkauth_uid = ? AND deleted_at IS NULL'
  ).bind(id, tenant.id, kkauthUid).run();
  if (res.meta.changes !== 1) throw new HTTPException(404, { message: 'Stop not found.' });

  return c.json({ data: { removed: true } });
}

// ─────────────────────────────────────────────────────────────────────────────
// Admin — hide with a required, owner-visible reason; only admin reverses
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /admin/popups/vendors — every vendor, every state, newest first, plus
 * per-vendor accountability counts over the last 30 days: stops_past (visible,
 * non-cancelled stops scheduled in that window) and stops_checked_in (how many
 * of those got a check-in tap) - the steward's no-show radar.
 */
export async function adminListVendors(c: AppContext) {
  requireAdmin(c);
  const tenant = c.get('tenant');
  const today = boardDateStr();
  const windowStart = addDaysToDateStr(today, -30);

  const { results } = await c.env.DB.prepare(`
    SELECT v.*, u.email AS owner_email,
      (SELECT COUNT(*) FROM popup_stops s WHERE s.vendor_id = v.id AND s.deleted_at IS NULL
        AND s.cancelled_at IS NULL AND s.date >= ? AND s.date < ?) AS stops_past,
      (SELECT COUNT(*) FROM popup_stops s WHERE s.vendor_id = v.id AND s.deleted_at IS NULL
        AND s.cancelled_at IS NULL AND s.date >= ? AND s.date < ? AND s.checked_in_at IS NOT NULL) AS stops_checked_in
    FROM popup_vendors v
    LEFT JOIN users u ON u.kkauth_uid = v.kkauth_uid AND u.tenant_id = v.tenant_id
    WHERE v.tenant_id = ?
    ORDER BY v.created_at DESC
    LIMIT 200
  `).bind(windowStart, today, windowStart, today, tenant.id).all<any>();

  return c.json({ data: results || [] });
}

/** GET /admin/popups/stops — every stop, every state, newest first. */
export async function adminListStops(c: AppContext) {
  requireAdmin(c);
  const tenant = c.get('tenant');

  const { results } = await c.env.DB.prepare(`
    SELECT s.*, v.name AS vendor_name
    FROM popup_stops s
    JOIN popup_vendors v ON v.id = s.vendor_id
    WHERE s.tenant_id = ?
    ORDER BY s.created_at DESC
    LIMIT 200
  `).bind(tenant.id).all<any>();

  return c.json({ data: results || [] });
}

/** POST /admin/popups/vendors/:id/hide — { hidden, reason? }. Reason required when hiding. */
export async function adminHideVendor(c: AppContext) {
  requireAdmin(c);
  const user = c.get('user');
  const tenant = c.get('tenant');
  const id = c.req.param('id') ?? '';
  const body = await c.req.json<any>().catch(() => ({}));

  const existing = await c.env.DB.prepare(
    'SELECT * FROM popup_vendors WHERE id = ? AND tenant_id = ?'
  ).bind(id, tenant.id).first<any>();
  if (!existing) throw new HTTPException(404, { message: 'Vendor not found.' });

  if (body.hidden) {
    const reason = cleanText(body.reason, 500);
    if (!reason) throw new HTTPException(400, { message: "A reason is required when hiding a member's vendor page." });
    await c.env.DB.prepare(
      'UPDATE popup_vendors SET admin_hidden = 1, admin_hidden_reason = ?, admin_hidden_by = ?, updated_at = unixepoch() WHERE id = ? AND tenant_id = ?'
    ).bind(reason, Number(user.sub), id, tenant.id).run();
  } else {
    await c.env.DB.prepare(
      'UPDATE popup_vendors SET admin_hidden = 0, admin_hidden_reason = NULL, admin_hidden_by = NULL, updated_at = unixepoch() WHERE id = ? AND tenant_id = ?'
    ).bind(id, tenant.id).run();
  }

  const vendor = await c.env.DB.prepare('SELECT * FROM popup_vendors WHERE id = ?').bind(id).first<any>();
  return c.json({ data: vendor });
}

/** POST /admin/popups/stops/:id/hide — same contract as adminHideVendor. */
export async function adminHideStop(c: AppContext) {
  requireAdmin(c);
  const user = c.get('user');
  const tenant = c.get('tenant');
  const id = c.req.param('id') ?? '';
  const body = await c.req.json<any>().catch(() => ({}));

  const existing = await c.env.DB.prepare(
    'SELECT * FROM popup_stops WHERE id = ? AND tenant_id = ?'
  ).bind(id, tenant.id).first<any>();
  if (!existing) throw new HTTPException(404, { message: 'Stop not found.' });

  if (body.hidden) {
    const reason = cleanText(body.reason, 500);
    if (!reason) throw new HTTPException(400, { message: "A reason is required when hiding a member's stop." });
    await c.env.DB.prepare(
      'UPDATE popup_stops SET admin_hidden = 1, admin_hidden_reason = ?, admin_hidden_by = ?, updated_at = unixepoch() WHERE id = ? AND tenant_id = ?'
    ).bind(reason, Number(user.sub), id, tenant.id).run();
  } else {
    await c.env.DB.prepare(
      'UPDATE popup_stops SET admin_hidden = 0, admin_hidden_reason = NULL, admin_hidden_by = NULL, updated_at = unixepoch() WHERE id = ? AND tenant_id = ?'
    ).bind(id, tenant.id).run();
  }

  const stop = await c.env.DB.prepare('SELECT * FROM popup_stops WHERE id = ?').bind(id).first<any>();
  return c.json({ data: stop });
}

// REGION_CENTER is not used directly by this handler (the map center is a UI
// concern) - imported alongside REGION_BOUNDS per the plan's "import, never
// redefine" rule, and re-exported here so a future server-side consumer never
// has a reason to redefine it either.
export { REGION_CENTER };
