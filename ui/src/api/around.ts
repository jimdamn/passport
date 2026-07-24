import { useEffect, useRef, useState } from 'react';
import type { RegionPin } from 'kk-shared-ui';
import { api } from './client';
import type { ApiResponse } from '../types';
import { getHappenings, type Happening } from './happenings';
import { listFresh, listFreshStands, standLocation, type FreshFeedPost, type FreshStandPin } from './fresh';
import { listSales, listSalePins, type SaleFeedRow, type SalePin } from './sales';
import { listPopups, listPopupPins, type PopupFeedStop, type PopupStopPin } from './popups';
import { listMeals, listMealPins, type MealFeedRow, type MealPin } from './meals';
import { getDeals, type Deal } from './deals';
import { getShifts, type Shift } from './lendahand';
import { listPetPosts, listPetPins, speciesLabel, type PetFeedRow, type PetPin } from './pets';

// Around Town — the town board. Shared constants, the client-side feed/pin
// merge, and the useLens() hook consumed by both Explore.tsx (the board) and
// explore/MapRoom.tsx (the full map). No algorithmic personalization lives
// here: the only inputs to ordering are the member's own explicit interest
// picks (server-stored) and their last-used lens (localStorage, device-local)
// — see AROUND-TOWN-BUILD-PLAN.md Section 0 and Section 10.

export const LENSES = [
  { slug: 'everything', label: 'Everything' },
  { slug: 'events', label: 'Events' },       // happenings
  { slug: 'fresh', label: 'Fresh' },         // fresh today
  { slug: 'sales', label: 'Sales' },         // sale day
  { slug: 'popups', label: 'Pop-Ups' },      // mobile/pop-up vendors
  { slug: 'meals', label: 'Meals' },         // community table
  { slug: 'deals', label: 'Deals' },
  { slug: 'hands', label: 'Volunteer' },     // lend a hand
  { slug: 'places', label: 'Places' },       // the member directory
  { slug: 'pets', label: 'Pets' },           // home safe
] as const;
export const LENS_SLUGS = LENSES.map(l => l.slug);

// Picker chip labels differ from the lens-row chip labels above (warmer,
// plan §7.2). 'everything' is never a pickable interest - it is the absence
// of picks, so the picker only ever offers the other seven.
export const PICKER_LABELS: Record<string, string> = {
  events: 'Events',
  fresh: 'Fresh food',
  sales: 'Sale Day',
  popups: 'Pop-Ups',
  meals: 'Community meals',
  deals: 'Deals',
  hands: 'Volunteer shifts',
  places: 'The businesses',
  pets: 'Lost & found pets',
};
export const PICKABLE_SLUGS = LENSES.filter(l => l.slug !== 'everything').map(l => l.slug);

export const TODAY_FEED_CAP_EVERYTHING = 5;   // single-lens feeds cap 50 (applied in todayFeedForLens)
export const LAST_LENS_KEY = 'around_town_lens';   // localStorage, device-local

// Mirrors src/handlers/fresh.ts's REGION_CENTER/REGION_BOUNDS - copied rather
// than imported, same reasoning fresh.ts itself documents for its own copy:
// the UI build doesn't import from the Worker's src tree.
export const REGION_CENTER = { lat: 41.55, lon: -85.45 };
export const REGION_BOUNDS: [[number, number], [number, number]] = [
  [-86.3485, 40.9012],
  [-84.4557, 42.1392],
];

// ─────────────────────────────────────────────────────────────────────────────
// Interests — GET/PUT /api/t/:tenant/around/interests (Increment 2, live)
// ─────────────────────────────────────────────────────────────────────────────

export interface AroundInterests {
  interests: string[];
  chosen_at: number | null;
}

export function getAroundInterests(tenantId: string) {
  return api.get<ApiResponse<AroundInterests>>(`/t/${tenantId}/around/interests`);
}

export function putAroundInterests(tenantId: string, interests: string[]) {
  return api.put<ApiResponse<AroundInterests>>(`/t/${tenantId}/around/interests`, { interests });
}

/** Single-select: tapping a chip selects exactly that one slug (`[slug]`) -
 * tapping the already-selected chip deselects it (`[]`). Shared by the
 * board's picker card and the profile edit drawer (both render via the
 * shared InterestChips component). Jim rejected the earlier multi-pick /
 * order-preserving version along with the lens-row reordering it fed; the
 * saved payload is still an array to keep the backend contract unchanged. */
export function toggleInterest(current: string[], slug: string): string[] {
  return current[0] === slug ? [] : [slug];
}

// ─────────────────────────────────────────────────────────────────────────────
// useLens() — the device-local "which lens am I on" hook, shared by the board
// and the map room so a lens change in either place is remembered in both.
// ─────────────────────────────────────────────────────────────────────────────

export interface UseLensResult {
  activeLens: string;
  order: string[];
  setLens: (slug: string) => void;
}

export function useLens(picks: string[]): UseLensResult {
  // `locked` becomes true the moment we know the real default: either a
  // remembered lens existed at mount, or the member's picks arrived and we
  // applied "first pick" once. After that, further pick-array changes (e.g.
  // editing interests from the profile drawer while already on the board)
  // must never yank the visitor to a different lens mid-visit - a save
  // re-aims explicitly via setLens() instead (see Explore.tsx / the profile
  // drawer), never by this effect firing again.
  const lockedRef = useRef(false);

  const [activeLens, setActiveLens] = useState<string>(() => {
    const stored = localStorage.getItem(LAST_LENS_KEY);
    if (stored && (LENS_SLUGS as readonly string[]).includes(stored)) {
      lockedRef.current = true;
      return stored;
    }
    return 'everything';
  });

  useEffect(() => {
    if (lockedRef.current) return;
    if (picks.length > 0) {
      lockedRef.current = true;
      setActiveLens(picks[0]);
    }
  }, [picks]);

  function setLens(slug: string) {
    lockedRef.current = true;
    setActiveLens(slug);
    localStorage.setItem(LAST_LENS_KEY, slug);
  }

  // Row order is ALWAYS the fixed LENS_SLUGS order, regardless of picks.
  // Jim rejected picks-first reordering (2026-07-23): a chip row that moves
  // per-member breaks consistent navigation. The interest pick decides ONLY
  // where the board opens (activeLens above) - it never gains authority over
  // the chip row itself. Every visitor, every state, sees the same order.
  const order = LENS_SLUGS.slice();

  return { activeLens, order, setLens };
}

// ─────────────────────────────────────────────────────────────────────────────
// The Today feed — client-side merge of the four modules' existing public
// endpoints, plus the network-members list (for Places pins and the deals
// coordinate match). No new backend surface (plan §2.2/§10).
// ─────────────────────────────────────────────────────────────────────────────

export interface TodayRow {
  key: string;
  source: 'events' | 'fresh' | 'sales' | 'popups' | 'meals' | 'deals' | 'hands' | 'pets';
  title: string;              // real sentence, plan §7.4 composition rules
  meta: string;                // module name + place/time line
  href: string;                 // module deep link
  pinLabel: string;            // popup title when this row has a map pin
  lat: number | null;
  lon: number | null;
  created_at: number;          // sort key
}

export interface NetworkMember {
  member_uid: number;
  name: string;
  category: string;
  description: string | null;
  address: string | null;
  zip: string | null;
  lat: number | null;
  lon: number | null;
  phone: string | null;
  website: string | null;
}

export interface AroundBoardData {
  todayRows: TodayRow[];            // every source, merged and sorted created_at DESC
  members: NetworkMember[];         // raw network-members rows (Places lens + member pins)
  freshStandPins: FreshStandPin[];  // every publicly visible stand (Fresh lens pins)
  salePins: SalePin[];              // every publicly visible sale (Sales lens pins)
  popupStopPins: PopupStopPin[];    // every publicly visible stop (Pop-Ups lens pins, both layers)
  mealPins: MealPin[];              // every publicly visible meal (Meals lens pins)
  petPins: PetPin[];                // every publicly visible pet post (Pets lens pins)
  amberMemberUids: Set<string>;     // member_uid (stringified) with news today - the postcard/map overlay
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 1).trimEnd() + '…';
}

// "123 Main St, Somewhere MI" -> "123 Main St" - a short at-a-glance location
// for the events feed row's meta line, not the full mailing address.
function firstAddressSegment(address: string): string {
  const idx = address.indexOf(',');
  return idx > 0 ? address.slice(0, idx) : address;
}

function weekdayOf(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleDateString('en-US', { weekday: 'long' });
}

function coordKey(lat: number, lon: number): string {
  return `${lat.toFixed(5)},${lon.toFixed(5)}`;
}

export async function fetchAroundBoardData(tenantId: string): Promise<AroundBoardData> {
  // Every source fails independently to an empty result - one module having a
  // bad day must never blank the whole board (this mirrors how each module's
  // own page already handles its own fetch failures).
  const [membersRes, happeningsRes, freshRes, freshStandsRes, salesRes, salePinsRes, popupsRes, popupPinsRes, mealsRes, mealPinsRes, dealsRes, shifts, petsRes, petPinsRes] = await Promise.all([
    api.get<ApiResponse<NetworkMember[]>>(`/t/${tenantId}/network-members`).catch(() => ({ data: [] as NetworkMember[] })),
    getHappenings(tenantId).catch(() => ({ data: [] as Happening[] })),
    listFresh(tenantId).catch(() => ({ data: [] as FreshFeedPost[] })),
    listFreshStands(tenantId).catch(() => ({ data: [] as FreshStandPin[] })),
    listSales(tenantId).catch(() => ({ data: [] as SaleFeedRow[] })),
    listSalePins(tenantId).catch(() => ({ data: [] as SalePin[] })),
    listPopups(tenantId).catch(() => ({ data: [] as PopupFeedStop[] })),
    listPopupPins(tenantId).catch(() => ({ data: [] as PopupStopPin[] })),
    listMeals(tenantId).catch(() => ({ data: [] as MealFeedRow[] })),
    listMealPins(tenantId).catch(() => ({ data: [] as MealPin[] })),
    getDeals(tenantId).catch(() => ({ data: [] as Deal[] })),
    getShifts().catch(() => [] as Shift[]),
    listPetPosts(tenantId).catch(() => ({ data: [] as PetFeedRow[] })),
    listPetPins(tenantId).catch(() => ({ data: [] as PetPin[] })),
  ]);

  const members = membersRes.data || [];
  const happenings = happeningsRes.data || [];
  const freshPosts = freshRes.data || [];
  const freshStands = freshStandsRes.data || [];
  const sales = salesRes.data || [];
  const salePins = salePinsRes.data || [];
  const popupStops = popupsRes.data || [];
  const popupStopPins = popupPinsRes.data || [];
  const meals = mealsRes.data || [];
  const mealPins = mealPinsRes.data || [];
  const deals = dealsRes.data || [];
  const petPosts = petsRes.data || [];
  const petPins = petPinsRes.data || [];

  // member_uid (stringified) -> coords, for matching a deal to its merchant's
  // pin (deals carry a real merchant_id) and for the Places "news today"
  // overlay below.
  const memberCoords = new Map<string, { lat: number; lon: number }>();
  for (const m of members) {
    if (m.lat != null && m.lon != null) memberCoords.set(String(m.member_uid), { lat: m.lat, lon: m.lon });
  }

  // Happenings carry no merchant_id, only a snapshotted merchant lat/lon - so
  // coordinate equality is the only link back to a member pin (both read the
  // same stored business record, so an exact match is reliable here).
  const happeningCoordKeys = new Set(
    happenings
      .filter(h => h.merchant_lat != null && h.merchant_lon != null)
      .map(h => coordKey(h.merchant_lat as number, h.merchant_lon as number)),
  );

  const amberMemberUids = new Set<string>();
  for (const m of members) {
    if (m.lat == null || m.lon == null) continue;
    if (happeningCoordKeys.has(coordKey(m.lat, m.lon))) amberMemberUids.add(String(m.member_uid));
  }
  for (const d of deals) {
    if (memberCoords.has(String(d.merchant_id))) amberMemberUids.add(String(d.merchant_id));
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const rows: TodayRow[] = [];

  for (const h of happenings) {
    rows.push({
      key: `events:${h.id}`,
      source: 'events',
      title: truncate(h.body, 70),
      meta: `Happenings · ${h.merchant_name ?? 'A member business'}${h.merchant_address ? ' · ' + firstAddressSegment(h.merchant_address) : ''}`,
      href: '/happenings',
      pinLabel: h.merchant_name ?? 'A member business',
      lat: h.merchant_lat,
      lon: h.merchant_lon,
      created_at: h.created_at,
    });
  }

  for (const p of freshPosts) {
    const locationBit = p.stand.nearest_city ?? p.stand.address_hint;
    rows.push({
      key: `fresh:${p.id}`,
      source: 'fresh',
      title: `${truncate(p.body, 70)} - ${p.stand.name}`,
      meta: `Fresh Today${locationBit ? ' · ' + locationBit : ''}`,
      href: `/fresh/stand/${p.stand.id}`,
      pinLabel: p.stand.name,
      lat: p.stand.lat,
      lon: p.stand.lon,
      created_at: p.created_at,
    });
  }

  for (const s of sales) {
    const locationBit = s.nearest_city ?? s.address_hint;
    rows.push({
      key: `sales:${s.id}`,
      source: 'sales',
      title: `${s.title} - ${s.status_note}`,
      meta: `Sale Day${locationBit ? ' · ' + locationBit : ''}`,
      href: `/sales/sale/${s.id}`,
      pinLabel: s.title,
      lat: s.lat,
      lon: s.lon,
      created_at: s.created_at,
    });
  }

  for (const s of popupStops) {
    const locationBit = s.nearest_city ?? s.location_hint;
    rows.push({
      key: `popups:${s.id}`,
      source: 'popups',
      title: `${s.vendor.name} - ${s.status_note}`,
      meta: `Pop-Ups${locationBit ? ' · ' + locationBit : ''}`,
      href: `/popups/vendor/${s.vendor.id}`,
      pinLabel: s.vendor.name,
      lat: s.checkin_lat ?? s.lat,
      lon: s.checkin_lon ?? s.lon,
      created_at: s.created_at,
    });
  }

  for (const m of meals) {
    const locationBit = m.kitchen.nearest_city ?? m.venue_hint;
    rows.push({
      key: `meals:${m.id}`,
      source: 'meals',
      title: `${m.title} - ${m.kitchen.name}`,
      meta: `Community Table${locationBit ? ' · ' + locationBit : ''}`,
      href: `/meals/meal/${m.id}`,
      pinLabel: m.title,
      lat: m.lat,
      lon: m.lon,
      created_at: m.created_at,
    });
  }

  for (const d of deals) {
    const coords = memberCoords.get(String(d.merchant_id)) ?? null;
    rows.push({
      key: `deals:${d.id}`,
      source: 'deals',
      title: d.merchant_name ? `${d.title} - ${d.merchant_name}` : d.title,
      meta: `Deals${d.ends_at ? ' · through ' + weekdayOf(d.ends_at) : ''}`,
      href: '/deals',
      pinLabel: d.merchant_name ?? d.title,
      lat: coords?.lat ?? null,
      lon: coords?.lon ?? null,
      // Spec: deals rows sort by starts_at, falling back to "now" - never a
      // countdown, just a recency stand-in for the merge sort below.
      created_at: d.starts_at ?? nowSec,
    });
  }

  for (const p of petPosts) {
    const locationBit = p.location_hint ?? p.nearest_city;
    const title = p.pet_name || speciesLabel(p.species);
    rows.push({
      key: `pets:${p.id}`,
      source: 'pets',
      title: `${p.type === 'lost' ? 'Lost' : 'Found'}: ${title}`,
      meta: `Home Safe${locationBit ? ' · near ' + locationBit : ''}`,
      href: `/pets/post/${p.id}`,
      pinLabel: title,
      lat: p.lat,
      lon: p.lon,
      created_at: p.created_at,
    });
  }

  // "Today or the next 7 days, with open spots." Shifts carry no free
  // recency signal of their own (a hand-picked event_date, not a posted-at
  // timestamp) - approximate "today" with a day-boundary a little generous
  // on the near side rather than fuss over exact local midnight.
  const startOfToday = nowSec - (nowSec % 86400) - 86400;
  const sevenDaysOut = nowSec + 7 * 86400;
  const openShifts = shifts.filter(s => s.event_date >= startOfToday && s.event_date <= sevenDaysOut && s.spots_filled < s.spots_total);
  openShifts.forEach((s, i) => {
    rows.push({
      key: `hands:${s.id}`,
      source: 'hands',
      title: `${s.title} - ${s.business_name}`,
      meta: `Lend a Hand · ${s.location}`,
      href: '/lend-a-hand',
      pinLabel: s.business_name,
      lat: null,
      lon: null,
      // Spec: "hands use listing order" - there's no created_at to sort by,
      // so anchor near "now" and step back by position to preserve the
      // module's own ordering without re-deriving a timestamp for it.
      created_at: nowSec - i,
    });
  });

  rows.sort((a, b) => b.created_at - a.created_at);

  return { todayRows: rows, members, freshStandPins: freshStands, salePins, popupStopPins, mealPins, petPins, amberMemberUids };
}

export function todayFeedForLens(lens: string, allRows: TodayRow[]): { rows: TodayRow[]; hasMore: boolean } {
  if (lens === 'everything') {
    return {
      rows: allRows.slice(0, TODAY_FEED_CAP_EVERYTHING),
      hasMore: allRows.length > TODAY_FEED_CAP_EVERYTHING,
    };
  }
  const filtered = allRows.filter(r => r.source === lens);
  return { rows: filtered.slice(0, 50), hasMore: false };
}

export const FEED_SECTION_LABEL: Record<string, string> = {
  everything: 'TODAY AROUND TOWN',
  events: 'EVENTS TODAY',
  fresh: 'FRESH TODAY',
  sales: 'SALE DAY',
  popups: 'POP-UPS',
  meals: 'COMMUNITY TABLE',
  deals: 'DEALS RIGHT NOW',
  hands: 'SHIFTS THIS WEEK',
  pets: 'HOME SAFE',
};

export const FEED_EMPTY_COPY: Record<string, { title: string; body: string }> = {
  everything: { title: 'Quiet day on the board.', body: 'The businesses below are always open to a visit - and mornings are when stands and events post.' },
  events: { title: 'Nothing on the board for today.', body: 'Happenings post morning-of, most days.' },
  fresh: { title: 'No stands have posted yet today.', body: 'Fresh posts usually land in the morning.' },
  sales: { title: 'No sales on the board right now.', body: 'Sales show up here as neighbors post them - weekends fill up fast.' },
  popups: { title: "Nobody's popped up yet.", body: 'Food trucks, pop-up shops and market vendors post their stops here - today\'s and the week ahead.' },
  meals: { title: 'Nothing on the table right now.', body: 'Fire halls, churches and clubs post their meals here - breakfasts, fish fries, benefits.' },
  deals: { title: 'No deals running right now.', body: '' },
  hands: { title: 'No open shifts this week.', body: '' },
  pets: { title: 'No lost or found pets posted right now.', body: '' },
};

// ─────────────────────────────────────────────────────────────────────────────
// Pins and captions per lens - shared by the postcard (capped, static) and the
// map room (uncapped, interactive). Plan §3.3/§4.1: "same builders... share
// the code, do not duplicate."
// ─────────────────────────────────────────────────────────────────────────────

function freshStandPinsMapped(stands: FreshStandPin[]): RegionPin[] {
  return stands.map(s => {
    const location = standLocation(s.nearest_city, s.nearest_state);
    const bodyLine = s.latest_body ? truncate(s.latest_body, 60) : 'Nothing posted today';
    return {
      id: `fresh:${s.id}`,
      lat: s.lat,
      lon: s.lon,
      label: s.name,
      sublabel: location ? `${location} · ${bodyLine}` : bodyLine,
      href: `/fresh/stand/${s.id}`,
      kind: s.has_live_post ? 'amber' : 'green',
    };
  });
}

function salePinsMapped(pins: SalePin[]): RegionPin[] {
  return pins.map(p => ({
    id: `sales:${p.id}`,
    lat: p.lat,
    lon: p.lon,
    label: p.title,
    sublabel: p.status_note,
    href: `/sales/sale/${p.id}`,
    kind: p.status === 'on_now' ? 'amber' : 'green',
  }));
}

// Two-layer contract per Pop-Ups' own board (POP-UPS-BUILD-PLAN.md §1): GREEN
// = checked in and verifiably there, AMBER = on the schedule, a plan not a
// promise. This is the inverse of Fresh/Sale Day's amber-means-active-now
// convention above - deliberate, since those boards carry no verification
// axis and this one's whole point is the confirmed/scheduled distinction
// (decision log, §10 - platform-wide pin color language is unsettled).
function popupPinsMapped(pins: PopupStopPin[]): RegionPin[] {
  return pins.map(p => ({
    id: `popups:${p.id}`,
    lat: p.lat,
    lon: p.lon,
    label: p.vendor_name,
    sublabel: p.status_note,
    href: `/popups/vendor/${p.vendor_id}`,
    kind: p.layer === 'confirmed' ? 'green' : 'amber',
  }));
}

function mealPinsMapped(pins: MealPin[]): RegionPin[] {
  return pins.map(p => ({
    id: `meals:${p.id}`,
    lat: p.lat,
    lon: p.lon,
    label: p.title,
    sublabel: p.status_note,
    href: `/meals/meal/${p.id}`,
    kind: (p.status === 'serving_now' || p.status === 'today') ? 'amber' : 'green',
  }));
}

// AMBER = lost (a missing pet - caution), GREEN = found or home safe - Home
// Safe's own traffic-light convention (HOME-SAFE-BUILD-PLAN.md §1), already
// computed server-side into pin.kind.
function petPinsMapped(pins: PetPin[]): RegionPin[] {
  return pins.map(p => ({
    id: `pets:${p.id}`,
    lat: p.lat,
    lon: p.lon,
    label: p.pet_name || speciesLabel(p.species),
    sublabel: p.status === 'home_safe' ? 'Home safe' : (p.type === 'lost' ? `Lost near ${p.location_hint || p.nearest_city || 'the area'}` : `Found near ${p.location_hint || p.nearest_city || 'the area'}`),
    href: `/pets/post/${p.id}`,
    kind: p.kind,
  }));
}

export function pinsForLens(lens: string, data: AroundBoardData, opts?: { cap?: number }): RegionPin[] {
  let pins: RegionPin[] = [];

  if (lens === 'places' || lens === 'everything') {
    const memberPins: RegionPin[] = data.members
      .filter(m => m.lat != null && m.lon != null)
      .map(m => ({
        id: `member:${m.member_uid}`,
        lat: m.lat as number,
        lon: m.lon as number,
        label: m.name,
        sublabel: m.category || undefined,
        href: `/members/${m.member_uid}`,
        kind: data.amberMemberUids.has(String(m.member_uid)) ? 'amber' : 'green',
      }));
    pins = lens === 'everything'
      ? [...memberPins, ...freshStandPinsMapped(data.freshStandPins), ...salePinsMapped(data.salePins), ...popupPinsMapped(data.popupStopPins), ...mealPinsMapped(data.mealPins), ...petPinsMapped(data.petPins)]
      : memberPins;
  } else if (lens === 'events') {
    pins = data.todayRows
      .filter(r => r.source === 'events' && r.lat != null && r.lon != null)
      .map(r => ({
        id: r.key, lat: r.lat as number, lon: r.lon as number,
        label: r.pinLabel, sublabel: truncate(r.title, 60), href: r.href, kind: 'amber' as const,
      }));
  } else if (lens === 'fresh') {
    pins = freshStandPinsMapped(data.freshStandPins);
  } else if (lens === 'sales') {
    pins = salePinsMapped(data.salePins);
  } else if (lens === 'popups') {
    pins = popupPinsMapped(data.popupStopPins);
  } else if (lens === 'meals') {
    pins = mealPinsMapped(data.mealPins);
  } else if (lens === 'pets') {
    pins = petPinsMapped(data.petPins);
  } else if (lens === 'deals') {
    pins = data.todayRows
      .filter(r => r.source === 'deals' && r.lat != null && r.lon != null)
      .map(r => ({
        id: r.key, lat: r.lat as number, lon: r.lon as number,
        label: r.pinLabel, sublabel: truncate(r.title, 60), href: r.href, kind: 'amber' as const,
      }));
  }
  // hands: no pins, ever - shifts carry no coordinates (v1 has no volunteer
  // pins; the caption swaps to the "no map pins yet" line instead).

  const cap = opts?.cap;
  return cap != null ? pins.slice(0, cap) : pins;
}

export function captionForLens(lens: string, data: AroundBoardData): string {
  if (lens === 'hands') {
    return 'Volunteer shifts list their address on each listing - no map pins yet.';
  }
  if (lens === 'events') {
    const n = data.todayRows.filter(r => r.source === 'events' && r.lat != null && r.lon != null).length;
    return `${n} happenings on the map`;
  }
  if (lens === 'fresh') {
    return `${data.freshStandPins.length} stands`;
  }
  if (lens === 'sales') {
    return `${data.salePins.length} sales`;
  }
  if (lens === 'popups') {
    const confirmed = data.popupStopPins.filter(p => p.layer === 'confirmed').length;
    return confirmed > 0 ? `${data.popupStopPins.length} stops · ${confirmed} checked in` : `${data.popupStopPins.length} stops`;
  }
  if (lens === 'meals') {
    return `${data.mealPins.length} meals on the board`;
  }
  if (lens === 'pets') {
    return `${data.petPins.length} lost & found posts`;
  }
  if (lens === 'deals') {
    const n = data.todayRows.filter(r => r.source === 'deals' && r.lat != null && r.lon != null).length;
    return `${n} deals on the map`;
  }
  // places / everything
  const withCoords = data.members.filter(m => m.lat != null && m.lon != null);
  const n = withCoords.length;
  const m = withCoords.filter(mm => data.amberMemberUids.has(String(mm.member_uid))).length;
  return m > 0 ? `${n} places · ${m} with news today` : `${n} places`;
}
