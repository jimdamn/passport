/**
 * Sale Day — yard/barn/moving/estate sales and auctions
 *
 * A donor-diff of Fresh Today (src/handlers/fresh.ts): ONE table (a sale is a
 * standalone, self-contained object - no seller profile; households run a
 * sale or two a year, a profile step is pure friction), a `days` JSON
 * schedule instead of end-of-day expiry, and an optional `event_name` for
 * corridor events (the US-12 "Michigan's Longest Garage Sale" weekend).
 * Everything else - guard style, admin-hide-with-reason, soft deletes, lazy
 * expiry, owner state transparency, share cards, help sections, copy voice -
 * is the donor, verbatim in shape (ARCHITECTURE.md Section 13, item 10, the
 * content-lifecycle CRUD gate; see SALE-DAY-BUILD-PLAN.md).
 *
 * Zero economy surface: no credits, no KKGame calls, no notifications, no
 * streaks. Cash in the driveway like always.
 *
 * This file does not import from fresh.ts except REGION_BOUNDS/REGION_CENTER
 * (the plan's explicit "import, never redefine" rule) - every other helper
 * (endOfBoardDay-equivalent, input cleaning, nearest-town snapshot, guard
 * shape) is copied rather than shared, same reasoning fresh.ts itself
 * documents for not importing from happenings.ts.
 */

import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { Env } from '../types';
import { nanoid } from 'nanoid';
import { REGION_BOUNDS, REGION_CENTER } from './fresh';

type AppContext = Context<{ Bindings: Env }>;

// The board's wall-clock timezone - same as fresh.ts's BOARD_TZ.
const BOARD_TZ = 'America/New_York';

export const SALE_CATEGORIES = [
  'yard', 'multi_family', 'barn', 'moving', 'estate', 'auction',
] as const;
// UI labels (exact): Yard Sale, Multi-Family, Barn Sale, Moving Sale,
// Estate Sale, Auction

const SALE_CAP_PER_USER = 3;        // active (not deleted, not ended)
const CREATE_COOLDOWN_MINUTES = 10;
const TITLE_MIN = 3;
const TITLE_MAX = 60;
const BODY_MAX = 500;
const EVENT_NAME_MAX = 60;
const ADDRESS_HINT_MAX = 120;
const PHONE_MAX = 25;
const MAX_DAYS = 5;
const MAX_DAYS_AHEAD = 60;

const DAYS_INVALID_MSG = 'Check your sale days - each day needs a date coming up soon, an opening time, and a closing time after it.';

export interface SaleDayEntry { date: string; open: string; close: string; }
export type SaleStatus = 'upcoming' | 'later_today' | 'on_now' | 'done_today' | 'ended';
type OwnerSaleState = 'active' | 'postponed' | 'hidden_by_admin' | 'removed' | 'ended';

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
// Board-TZ date/time helpers. fresh.ts's endOfBoardDay() only ever computes
// "end of today" - Sale Day needs end-of-day for an arbitrary, possibly
// future or past, calendar date (a sale's last day), so this generalizes it.
// ─────────────────────────────────────────────────────────────────────────────

/** Today's 'YYYY-MM-DD' in BOARD_TZ. */
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

/**
 * Unix seconds for a wall-clock 'HH:MM' on a 'YYYY-MM-DD' date, interpreted
 * in BOARD_TZ. Works by reading the board-TZ wall clock at the naive-UTC
 * instant of the same date/time, then applying the resulting UTC-vs-board
 * offset once - the standard manual zoned-time-to-instant conversion (no
 * date library available in this Worker).
 */
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

// ─────────────────────────────────────────────────────────────────────────────
// The status helper - one pure function, mirrored in the UI (§4 of the plan).
// Every badge (public feed, pins, detail, My Sales) hangs off this.
// ─────────────────────────────────────────────────────────────────────────────

export function saleStatus(days: SaleDayEntry[], wrappedDate: string | null, now: number = Math.floor(Date.now() / 1000)): SaleStatus {
  const last = days[days.length - 1];
  if (now >= endOfBoardDay(last.date) || wrappedDate === last.date) return 'ended';

  const today = boardDateStr(new Date(now * 1000));
  const todayIdx = days.findIndex(d => d.date === today);
  if (todayIdx === -1) return 'upcoming'; // before the first day, or a gap day

  const todayDay = days[todayIdx];
  const openAt = boardWallTimeToUnix(todayDay.date, todayDay.open);
  const closeAt = boardWallTimeToUnix(todayDay.date, todayDay.close);
  const laterDaysRemain = todayIdx < days.length - 1;

  // Past close (wrapped or not) on a day with later days remaining reads as
  // "back tomorrow"; past close with no later days remaining has nothing
  // left to say beyond "ended" - the read filter keeps it visible until
  // midnight regardless, per the plan's own §2 Close/complete row.
  if (wrappedDate === today || now > closeAt) return laterDaysRemain ? 'done_today' : 'ended';
  if (now < openAt) return 'later_today';
  return 'on_now';
}

/** Public-facing status line (§7.1) - shares one template between 'upcoming'
 *  and 'later_today', varying only the weekday-or-"today" label. */
function publicStatusNote(days: SaleDayEntry[], wrappedDate: string | null, now: number): { status: SaleStatus; note: string } {
  const status = saleStatus(days, wrappedDate, now);
  const today = boardDateStr(new Date(now * 1000));

  if (status === 'ended') return { status, note: 'Wrapped up' };

  if (status === 'on_now') {
    const day = days.find(d => d.date === today)!;
    return { status, note: `On now until ${clockLabel(day.close)}` };
  }

  if (status === 'done_today') {
    const todayIdx = days.findIndex(d => d.date === today);
    const next = days[todayIdx + 1];
    return { status, note: `Done for today - back ${weekdayShort(next.date)} ${clockLabel(next.open)}` };
  }

  if (status === 'later_today') {
    const day = days.find(d => d.date === today)!;
    return { status, note: `Opens ${clockLabel(day.open)} today` };
  }

  // upcoming
  const next = days.find(d => d.date > today) ?? days[0];
  return { status, note: `Opens ${clockLabel(next.open)} ${weekdayShort(next.date)}` };
}

/** Sort key within a status rank group - "next-open ascending" per §1.2. */
function statusSortKey(days: SaleDayEntry[], status: SaleStatus, now: number, today: string): number {
  if (status === 'on_now') {
    const day = days.find(d => d.date === today)!;
    return boardWallTimeToUnix(day.date, day.close);
  }
  if (status === 'later_today') {
    const day = days.find(d => d.date === today)!;
    return boardWallTimeToUnix(day.date, day.open);
  }
  if (status === 'done_today') {
    const todayIdx = days.findIndex(d => d.date === today);
    const next = days[todayIdx + 1];
    return boardWallTimeToUnix(next.date, next.open);
  }
  if (status === 'upcoming') {
    const next = days.find(d => d.date > today) ?? days[0];
    return boardWallTimeToUnix(next.date, next.open);
  }
  return endOfBoardDay(days[days.length - 1].date); // ended
}

const STATUS_RANK: Record<SaleStatus, number> = { on_now: 0, later_today: 1, done_today: 2, upcoming: 3, ended: 4 };

// ─────────────────────────────────────────────────────────────────────────────
// Owner-visible state (used by listMySales) - mirrors fresh.ts's standState/
// postState, collapsed onto one table since a sale has no separate profile.
// ─────────────────────────────────────────────────────────────────────────────

function ownerSaleState(row: any, days: SaleDayEntry[], now: number): OwnerSaleState {
  if (row.deleted_at) return 'removed';
  if (row.admin_hidden) return 'hidden_by_admin';
  if (row.is_hidden) return 'postponed';
  if (saleStatus(days, row.wrapped_date, now) === 'ended') return 'ended';
  return 'active';
}

function ownerStateNote(row: any, days: SaleDayEntry[], state: OwnerSaleState, now: number): string {
  const today = boardDateStr(new Date(now * 1000));
  switch (state) {
    case 'postponed':
      return 'Postponed - only you can see it. Fix the days if you need to, then tap Show.';
    case 'hidden_by_admin':
      return `Hidden by an admin: "${row.admin_hidden_reason}" - reply from your profile's Talk to Us if you have questions.`;
    case 'removed':
      return 'Removed.';
    case 'ended':
      return `Ended ${dateLabel(days[days.length - 1].date)}.`;
    default: {
      const status = saleStatus(days, row.wrapped_date, now);
      if (status === 'on_now') {
        const day = days.find(d => d.date === today)!;
        return `On now - neighbors can see you're open until ${clockLabel(day.close)}.`;
      }
      if (status === 'later_today') {
        const day = days.find(d => d.date === today)!;
        return `On the board - opens today at ${clockLabel(day.open)}.`;
      }
      if (status === 'done_today') {
        const todayIdx = days.findIndex(d => d.date === today);
        const next = days[todayIdx + 1];
        return `Done for today - back ${weekdayShort(next.date)} ${clockLabel(next.open)}.`;
      }
      const next = days.find(d => d.date > today) ?? days[0];
      return `On the board - opens ${weekdayShort(next.date)} ${clockLabel(next.open)}.`;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Nearest-town snapshot - copied verbatim from fresh.ts's fetchNearestPlace.
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
      console.error('[sales] nearest-place lookup returned non-OK status:', res.status);
      return { city: null, state: null };
    }
    const body = await res.json<any>();
    return {
      city: body?.data?.city ?? null,
      state: body?.data?.state ?? null,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[sales] nearest-place lookup failed:', msg);
    return { city: null, state: null };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Input validation
// ─────────────────────────────────────────────────────────────────────────────

function parseDaysInput(value: unknown): SaleDayEntry[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_DAYS) {
    throw new HTTPException(400, { message: DAYS_INVALID_MSG });
  }

  const today = boardDateStr();
  const maxDateStr = addDaysToDateStr(today, MAX_DAYS_AHEAD);
  const days: SaleDayEntry[] = [];

  for (const entry of value) {
    if (
      typeof entry !== 'object' || entry === null ||
      typeof (entry as any).date !== 'string' || typeof (entry as any).open !== 'string' || typeof (entry as any).close !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test((entry as any).date) ||
      !/^\d{2}:\d{2}$/.test((entry as any).open) || !/^\d{2}:\d{2}$/.test((entry as any).close)
    ) {
      throw new HTTPException(400, { message: DAYS_INVALID_MSG });
    }
    const date = (entry as any).date as string;
    const open = (entry as any).open as string;
    const close = (entry as any).close as string;
    if (open >= close) throw new HTTPException(400, { message: DAYS_INVALID_MSG });
    if (date < today || date > maxDateStr) throw new HTTPException(400, { message: DAYS_INVALID_MSG });
    days.push({ date, open, close });
  }

  for (let i = 1; i < days.length; i++) {
    if (days[i].date <= days[i - 1].date) throw new HTTPException(400, { message: DAYS_INVALID_MSG });
  }

  const last = days[days.length - 1];
  if (endOfBoardDay(last.date) <= Math.floor(Date.now() / 1000)) {
    throw new HTTPException(400, { message: DAYS_INVALID_MSG });
  }

  return days;
}

interface SaleInput {
  title: string; body: string; category: string; lat: number; lon: number;
  addressHint: string | null; phone: string | null; eventName: string | null;
  days: SaleDayEntry[]; photoUrl: string | null;
}

function parseSaleInput(body: any, existing?: any): SaleInput {
  const title = cleanText(body.title, TITLE_MAX) ?? (existing ? existing.title : null);
  if (!title || title.length < TITLE_MIN) {
    throw new HTTPException(400, { message: 'Give your sale a title (3-60 characters).' });
  }

  const bodyText = body.body === undefined ? (existing?.body ?? null) : cleanText(body.body, BODY_MAX);
  if (!bodyText) throw new HTTPException(400, { message: "Say what's there (1-500 characters)." });

  const category = body.category === undefined ? (existing?.category ?? null) : body.category;
  if (!category || !(SALE_CATEGORIES as readonly string[]).includes(category)) {
    throw new HTTPException(400, { message: 'Pick a category for your sale.' });
  }

  const lat = body.lat !== undefined ? Number(body.lat) : Number(existing?.lat);
  const lon = body.lon !== undefined ? Number(body.lon) : Number(existing?.lon);
  if (
    !Number.isFinite(lat) || !Number.isFinite(lon) ||
    lat < REGION_BOUNDS.minLat || lat > REGION_BOUNDS.maxLat ||
    lon < REGION_BOUNDS.minLon || lon > REGION_BOUNDS.maxLon
  ) {
    throw new HTTPException(400, { message: 'Place the pin inside the Lakes Region - drag it to where the sale is.' });
  }

  const days = body.days === undefined
    ? (existing ? (JSON.parse(existing.days || '[]') as SaleDayEntry[]) : null)
    : parseDaysInput(body.days);
  if (!days || days.length < 1) {
    throw new HTTPException(400, { message: DAYS_INVALID_MSG });
  }

  const addressHint = body.address_hint === undefined ? (existing?.address_hint ?? null) : cleanText(body.address_hint, ADDRESS_HINT_MAX);
  const phone = body.phone === undefined ? (existing?.phone ?? null) : cleanText(body.phone, PHONE_MAX);
  const eventName = body.event_name === undefined ? (existing?.event_name ?? null) : cleanText(body.event_name, EVENT_NAME_MAX);
  const photoUrl = body.photo_url === undefined ? (existing?.photo_url ?? null) : cleanText(body.photo_url, 500);

  return { title, body: bodyText, category, lat, lon, addressHint, phone, eventName, days, photoUrl };
}

/** Cooldown + active cap, both scoped directly to the user (no stand entity). */
async function guardCapAndCooldown(c: AppContext, tenantId: string, kkauthUid: number) {
  const last = await c.env.DB.prepare(
    'SELECT created_at FROM sales WHERE tenant_id = ? AND kkauth_uid = ? ORDER BY created_at DESC LIMIT 1'
  ).bind(tenantId, kkauthUid).first<{ created_at: number }>();
  if (last) {
    const since = Math.floor(Date.now() / 1000) - last.created_at;
    if (since < CREATE_COOLDOWN_MINUTES * 60) {
      const mins = Math.ceil((CREATE_COOLDOWN_MINUTES * 60 - since) / 60);
      throw new HTTPException(429, {
        message: `Give it a few minutes between posts - you can add another sale in about ${mins} min.`,
      });
    }
  }

  const today = boardDateStr();
  const active = await c.env.DB.prepare(
    'SELECT COUNT(*) AS n FROM sales WHERE tenant_id = ? AND kkauth_uid = ? AND deleted_at IS NULL AND last_date >= ?'
  ).bind(tenantId, kkauthUid, today).first<{ n: number }>();
  if ((active?.n ?? 0) >= SALE_CAP_PER_USER) {
    throw new HTTPException(409, { message: 'You have three sales on the board. Remove or wrap one to add another.' });
  }
}

function saleFeedShape(row: any, days: SaleDayEntry[]) {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    category: row.category,
    event_name: row.event_name,
    lat: row.lat,
    lon: row.lon,
    address_hint: row.address_hint,
    phone: row.phone,
    photo_url: row.photo_url,
    nearest_city: row.nearest_city ?? null,
    nearest_state: row.nearest_state ?? null,
    days,
    // Public, like Fresh Today's sold_out flag - the detail page's day-by-day
    // schedule needs to know which day (if any) has been wrapped, to render
    // the strikethrough without a second authenticated round-trip.
    wrapped_date: row.wrapped_date ?? null,
    created_at: row.created_at,
  };
}

function publicSaleShape(row: any) {
  return { ...row, days: JSON.parse(row.days || '[]') };
}

// ─────────────────────────────────────────────────────────────────────────────
// Public board
// ─────────────────────────────────────────────────────────────────────────────

/** GET /api/t/:tenant/sales — the public feed. Optional ?category= / ?event=. */
export async function listSales(c: AppContext) {
  const tenant = c.get('tenant');
  const category = c.req.query('category');
  const event = c.req.query('event');
  const today = boardDateStr();
  const now = Math.floor(Date.now() / 1000);

  const filters = ['tenant_id = ?', 'deleted_at IS NULL', 'is_hidden = 0', 'admin_hidden = 0', 'last_date >= ?'];
  const binds: any[] = [tenant.id, today];
  if (category && (SALE_CATEGORIES as readonly string[]).includes(category)) {
    filters.push('category = ?');
    binds.push(category);
  }
  if (event) {
    filters.push('event_name = ?');
    binds.push(event);
  }

  const { results } = await c.env.DB.prepare(`
    SELECT * FROM sales WHERE ${filters.join(' AND ')} ORDER BY created_at DESC LIMIT 200
  `).bind(...binds).all<any>();

  const shaped = (results || [])
    .map((r: any) => {
      const days: SaleDayEntry[] = JSON.parse(r.days || '[]');
      // Belt-and-suspenders: the last_date >= today string compare above and
      // this endOfBoardDay check both retire a sale at the same board-TZ
      // midnight - kept as two checks per the plan's own §1.2 description.
      if (now >= endOfBoardDay(days[days.length - 1].date)) return null;
      const { status, note } = publicStatusNote(days, r.wrapped_date, now);
      return { shaped: { ...saleFeedShape(r, days), status, status_note: note }, status, sortKey: statusSortKey(days, status, now, today) };
    })
    .filter((r: any): r is { shaped: any; status: SaleStatus; sortKey: number } => r !== null)
    .sort((a, b) => (STATUS_RANK[a.status] - STATUS_RANK[b.status]) || (a.sortKey - b.sortKey))
    .map(r => r.shaped);

  return c.json({ data: shaped });
}

/** GET /api/t/:tenant/sales/pins — map pins, same filter as listSales. */
export async function listSalePins(c: AppContext) {
  const tenant = c.get('tenant');
  const today = boardDateStr();
  const now = Math.floor(Date.now() / 1000);

  const { results } = await c.env.DB.prepare(`
    SELECT * FROM sales
    WHERE tenant_id = ? AND deleted_at IS NULL AND is_hidden = 0 AND admin_hidden = 0 AND last_date >= ?
    ORDER BY created_at DESC LIMIT 300
  `).bind(tenant.id, today).all<any>();

  const data = (results || [])
    .map((r: any) => {
      const days: SaleDayEntry[] = JSON.parse(r.days || '[]');
      if (now >= endOfBoardDay(days[days.length - 1].date)) return null;
      const { status, note } = publicStatusNote(days, r.wrapped_date, now);
      return { id: r.id, lat: r.lat, lon: r.lon, title: r.title, status, status_note: note };
    })
    .filter((r: any) => r !== null);

  return c.json({ data });
}

/** GET /api/t/:tenant/sales/events — corridor event chips, 2+ visible sales only. */
export async function listSaleEvents(c: AppContext) {
  const tenant = c.get('tenant');
  const today = boardDateStr();
  const now = Math.floor(Date.now() / 1000);

  const { results } = await c.env.DB.prepare(`
    SELECT event_name, days FROM sales
    WHERE tenant_id = ? AND deleted_at IS NULL AND is_hidden = 0 AND admin_hidden = 0 AND last_date >= ? AND event_name IS NOT NULL
  `).bind(tenant.id, today).all<any>();

  const counts = new Map<string, number>();
  for (const r of (results || [])) {
    const days: SaleDayEntry[] = JSON.parse(r.days || '[]');
    if (now >= endOfBoardDay(days[days.length - 1].date)) continue;
    counts.set(r.event_name, (counts.get(r.event_name) ?? 0) + 1);
  }

  const data = [...counts.entries()]
    .filter(([, n]) => n >= 2)
    .map(([event_name, count]) => ({ event_name, count }));

  return c.json({ data });
}

/**
 * GET /api/t/:tenant/sales/:id — public detail. 404 if not publicly visible.
 * MUST be registered after /sales/pins and /sales/events (Hono matches
 * overlapping patterns by registration order - see the plan's §1.2 note).
 */
export async function getSale(c: AppContext) {
  const tenant = c.get('tenant');
  const id = c.req.param('id') ?? '';
  const today = boardDateStr();
  const now = Math.floor(Date.now() / 1000);

  const row = await c.env.DB.prepare(`
    SELECT * FROM sales
    WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL AND is_hidden = 0 AND admin_hidden = 0 AND last_date >= ?
  `).bind(id, tenant.id, today).first<any>();
  if (!row) throw new HTTPException(404, { message: 'Sale not found.' });

  const days: SaleDayEntry[] = JSON.parse(row.days || '[]');
  if (now >= endOfBoardDay(days[days.length - 1].date)) {
    throw new HTTPException(404, { message: 'Sale not found.' });
  }

  const { status, note } = publicStatusNote(days, row.wrapped_date, now);
  return c.json({ data: { ...saleFeedShape(row, days), status, status_note: note } });
}

// ─────────────────────────────────────────────────────────────────────────────
// Authenticated — owner CRUD (any signed-in user, no merchant verification)
// ─────────────────────────────────────────────────────────────────────────────

/** GET /sales/mine — every sale the caller owns, in every state, latest 10 ended included. */
export async function listMySales(c: AppContext) {
  const user = c.get('user');
  const tenant = c.get('tenant');
  const kkauthUid = Number(user.sub);
  const now = Math.floor(Date.now() / 1000);

  const { results } = await c.env.DB.prepare(
    'SELECT * FROM sales WHERE tenant_id = ? AND kkauth_uid = ? ORDER BY created_at DESC'
  ).bind(tenant.id, kkauthUid).all<any>();

  const annotated = (results || []).map((r: any) => {
    const days: SaleDayEntry[] = JSON.parse(r.days || '[]');
    const state = ownerSaleState(r, days, now);
    return {
      state,
      shaped: {
        ...saleFeedShape(r, days),
        is_hidden: !!r.is_hidden,
        admin_hidden_reason: r.admin_hidden ? r.admin_hidden_reason : null,
        state,
        state_note: ownerStateNote(r, days, state, now),
      },
    };
  });

  let endedSeen = 0;
  const sales = annotated
    .filter(a => {
      if (a.state !== 'ended') return true;
      endedSeen += 1;
      return endedSeen <= 10;
    })
    .map(a => a.shaped);

  return c.json({ data: { sales } });
}

/** POST /sales/upload — owner uploads a sale photo. Clone of uploadFreshPhoto. */
export async function uploadSalePhoto(c: AppContext) {
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

/** POST /sales — create a sale. Max 3 active per user; 10-min cooldown. */
export async function createSale(c: AppContext) {
  const user = c.get('user');
  const tenant = c.get('tenant');
  const kkauthUid = Number(user.sub);
  const body = await c.req.json<any>().catch(() => ({}));

  const input = parseSaleInput(body);
  await guardCapAndCooldown(c, tenant.id, kkauthUid);

  const id = nanoid(10);
  const nearest = await fetchNearestPlace(c, input.lat, input.lon);

  await c.env.DB.prepare(`
    INSERT INTO sales
      (id, tenant_id, kkauth_uid, title, body, category, lat, lon, address_hint, phone, event_name,
       days, first_date, last_date, photo_url, nearest_city, nearest_state)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    id, tenant.id, kkauthUid, input.title, input.body, input.category, input.lat, input.lon,
    input.addressHint, input.phone, input.eventName,
    JSON.stringify(input.days), input.days[0].date, input.days[input.days.length - 1].date,
    input.photoUrl, nearest.city, nearest.state
  ).run();

  const sale = await c.env.DB.prepare('SELECT * FROM sales WHERE id = ?').bind(id).first<any>();
  return c.json({ data: publicSaleShape(sale) }, 201);
}

/** PUT /sales/:id — owner edits everything, anytime except deleted/admin-hidden. */
export async function updateSale(c: AppContext) {
  const user = c.get('user');
  const tenant = c.get('tenant');
  const kkauthUid = Number(user.sub);
  const id = c.req.param('id') ?? '';
  const body = await c.req.json<any>().catch(() => ({}));

  const existing = await c.env.DB.prepare(
    'SELECT * FROM sales WHERE id = ? AND tenant_id = ?'
  ).bind(id, tenant.id).first<any>();
  if (!existing || existing.deleted_at) throw new HTTPException(404, { message: 'Sale not found.' });
  if (existing.kkauth_uid !== kkauthUid) throw new HTTPException(403, { message: 'This is not your sale.' });
  if (existing.admin_hidden) {
    throw new HTTPException(403, { message: 'An admin has hidden this sale. The reason is on your My Sales page.' });
  }

  const input = parseSaleInput(body, existing);

  const pinMoved = input.lat !== existing.lat || input.lon !== existing.lon;
  let nearestCity = existing.nearest_city ?? null;
  let nearestState = existing.nearest_state ?? null;
  if (pinMoved || nearestCity === null) {
    const nearest = await fetchNearestPlace(c, input.lat, input.lon);
    nearestCity = nearest.city;
    nearestState = nearest.state;
  }

  await c.env.DB.prepare(`
    UPDATE sales
    SET title = ?, body = ?, category = ?, lat = ?, lon = ?, address_hint = ?, phone = ?, event_name = ?,
        days = ?, first_date = ?, last_date = ?, photo_url = ?, nearest_city = ?, nearest_state = ?,
        updated_at = unixepoch()
    WHERE id = ? AND tenant_id = ? AND kkauth_uid = ?
  `).bind(
    input.title, input.body, input.category, input.lat, input.lon, input.addressHint, input.phone, input.eventName,
    JSON.stringify(input.days), input.days[0].date, input.days[input.days.length - 1].date,
    input.photoUrl, nearestCity, nearestState, id, tenant.id, kkauthUid
  ).run();

  const sale = await c.env.DB.prepare('SELECT * FROM sales WHERE id = ?').bind(id).first<any>();
  return c.json({ data: publicSaleShape(sale) });
}

/** POST /sales/:id/visibility — owner postpone/show. Never touches admin_hidden. */
export async function setSaleVisibility(c: AppContext) {
  const user = c.get('user');
  const tenant = c.get('tenant');
  const kkauthUid = Number(user.sub);
  const id = c.req.param('id') ?? '';
  const body = await c.req.json<any>().catch(() => ({}));

  const existing = await c.env.DB.prepare(
    'SELECT * FROM sales WHERE id = ? AND tenant_id = ?'
  ).bind(id, tenant.id).first<any>();
  if (!existing || existing.deleted_at) throw new HTTPException(404, { message: 'Sale not found.' });
  if (existing.kkauth_uid !== kkauthUid) throw new HTTPException(403, { message: 'This is not your sale.' });
  if (existing.admin_hidden) {
    throw new HTTPException(403, { message: 'An admin has hidden this sale. The reason is on your My Sales page.' });
  }

  const hidden = asBool(body.hidden, !!existing.is_hidden) ? 1 : 0;
  await c.env.DB.prepare(
    'UPDATE sales SET is_hidden = ?, updated_at = unixepoch() WHERE id = ? AND tenant_id = ? AND kkauth_uid = ?'
  ).bind(hidden, id, tenant.id, kkauthUid).run();

  const sale = await c.env.DB.prepare('SELECT * FROM sales WHERE id = ?').bind(id).first<any>();
  return c.json({ data: publicSaleShape(sale) });
}

/** POST /sales/:id/wrap — owner "Wrapped up for today". Idempotent per day. */
export async function wrapSale(c: AppContext) {
  const user = c.get('user');
  const tenant = c.get('tenant');
  const kkauthUid = Number(user.sub);
  const id = c.req.param('id') ?? '';

  const existing = await c.env.DB.prepare(
    'SELECT * FROM sales WHERE id = ? AND tenant_id = ? AND kkauth_uid = ?'
  ).bind(id, tenant.id, kkauthUid).first<any>();
  if (!existing || existing.deleted_at) throw new HTTPException(404, { message: 'Sale not found.' });
  if (existing.admin_hidden) {
    throw new HTTPException(403, { message: 'An admin has hidden this sale. The reason is on your My Sales page.' });
  }

  const today = boardDateStr();
  const days: SaleDayEntry[] = JSON.parse(existing.days || '[]');
  if (!days.some(d => d.date === today)) {
    throw new HTTPException(409, { message: "This sale isn't running today - nothing to wrap up." });
  }

  if (existing.wrapped_date !== today) {
    await c.env.DB.prepare(
      'UPDATE sales SET wrapped_date = ?, updated_at = unixepoch() WHERE id = ? AND tenant_id = ? AND kkauth_uid = ?'
    ).bind(today, id, tenant.id, kkauthUid).run();
  }

  const sale = await c.env.DB.prepare('SELECT * FROM sales WHERE id = ?').bind(id).first<any>();
  return c.json({ data: publicSaleShape(sale) });
}

/** DELETE /sales/:id — owner soft-delete (sets deleted_at). No child rows exist. */
export async function deleteSale(c: AppContext) {
  const user = c.get('user');
  const tenant = c.get('tenant');
  const kkauthUid = Number(user.sub);
  const id = c.req.param('id') ?? '';

  const res = await c.env.DB.prepare(
    'UPDATE sales SET deleted_at = unixepoch(), updated_at = unixepoch() WHERE id = ? AND tenant_id = ? AND kkauth_uid = ? AND deleted_at IS NULL'
  ).bind(id, tenant.id, kkauthUid).run();
  if (res.meta.changes !== 1) throw new HTTPException(404, { message: 'Sale not found.' });

  return c.json({ data: { removed: true } });
}

// ─────────────────────────────────────────────────────────────────────────────
// Admin — hide with a required, owner-visible reason; only admin reverses
// ─────────────────────────────────────────────────────────────────────────────

/** GET /admin/sales — every sale, every state, newest first. */
export async function adminListSales(c: AppContext) {
  requireAdmin(c);
  const tenant = c.get('tenant');

  const { results } = await c.env.DB.prepare(`
    SELECT s.*, u.email AS owner_email
    FROM sales s
    LEFT JOIN users u ON u.kkauth_uid = s.kkauth_uid AND u.tenant_id = s.tenant_id
    WHERE s.tenant_id = ?
    ORDER BY s.created_at DESC
    LIMIT 200
  `).bind(tenant.id).all<any>();

  const data = (results || []).map((r: any) => publicSaleShape(r));
  return c.json({ data });
}

/** POST /admin/sales/:id/hide — { hidden, reason? }. Reason required when hiding. */
export async function adminHideSale(c: AppContext) {
  requireAdmin(c);
  const user = c.get('user');
  const tenant = c.get('tenant');
  const id = c.req.param('id') ?? '';
  const body = await c.req.json<any>().catch(() => ({}));

  const existing = await c.env.DB.prepare(
    'SELECT * FROM sales WHERE id = ? AND tenant_id = ?'
  ).bind(id, tenant.id).first<any>();
  if (!existing) throw new HTTPException(404, { message: 'Sale not found.' });

  if (body.hidden) {
    const reason = cleanText(body.reason, 500);
    if (!reason) throw new HTTPException(400, { message: "A reason is required when hiding a member's sale." });
    await c.env.DB.prepare(
      'UPDATE sales SET admin_hidden = 1, admin_hidden_reason = ?, admin_hidden_by = ?, updated_at = unixepoch() WHERE id = ? AND tenant_id = ?'
    ).bind(reason, Number(user.sub), id, tenant.id).run();
  } else {
    await c.env.DB.prepare(
      'UPDATE sales SET admin_hidden = 0, admin_hidden_reason = NULL, admin_hidden_by = NULL, updated_at = unixepoch() WHERE id = ? AND tenant_id = ?'
    ).bind(id, tenant.id).run();
  }

  const sale = await c.env.DB.prepare('SELECT * FROM sales WHERE id = ?').bind(id).first<any>();
  return c.json({ data: publicSaleShape(sale) });
}
