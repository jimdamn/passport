import { api, getToken } from './client';
import type { ApiResponse } from '../types';

// Fresh Today — resident-owned farm-stand board. Mirrors happenings.ts style.
//
// This file currently covers only the PUBLIC endpoints needed by the browse
// page (/fresh) and stand detail page (/fresh/stand/:id). The authenticated
// owner endpoints (/fresh/mine, create/update/delete stand+post) and the
// admin endpoints are a later sub-task's addition to this same file — the
// section markers below leave clean room for that without requiring a
// restructure.

// Exact slugs the backend accepts (src/handlers/fresh.ts FRESH_CATEGORIES is
// the source of truth — kept in sync by hand since the UI build can't import
// from the Worker's src/handlers tree).
export const FRESH_CATEGORIES = [
  { key: 'produce', label: 'Produce' },
  { key: 'eggs', label: 'Eggs' },
  { key: 'meat', label: 'Meat' },
  { key: 'dairy', label: 'Dairy' },
  { key: 'baked_goods', label: 'Baked Goods' },
  { key: 'honey_syrup', label: 'Honey & Syrup' },
  { key: 'plants_flowers', label: 'Plants & Flowers' },
  { key: 'upick', label: 'U-Pick' },
  { key: 'csa', label: 'CSA' },
  { key: 'prepared', label: 'Prepared Food' },
] as const;

export type FreshCategory = typeof FRESH_CATEGORIES[number]['key'];

export function categoryLabel(key: string): string {
  return FRESH_CATEGORIES.find(c => c.key === key)?.label ?? key;
}

// Region center for the map view, mirrored from src/handlers/fresh.ts
// REGION_CENTER (Tri-State Lakes Region, zoom 9) — kept as a plain constant
// here since the UI build doesn't import from the Worker's src tree.
export const REGION_CENTER = { lat: 41.55, lon: -85.45 };

// Region bounds for the pin picker's maxBounds prop, converted from the
// backend's REGION_BOUNDS ({ minLat: 40.9012, maxLat: 42.1392, minLon:
// -86.3485, maxLon: -84.4557 } in src/handlers/fresh.ts) into the [[west,
// south], [east, north]] lng/lat tuple RegionMap's maxBounds prop actually
// expects (confirmed by reading kk-shared-ui/src/components/map/RegionMap.tsx
// directly). This now matches the platform's real geo-fence boundary
// (kk-login/kk-apps-hub geo.ts) exactly instead of a looser approximation.
export const REGION_BOUNDS: [[number, number], [number, number]] = [
  [-86.3485, 40.9012],
  [-84.4557, 42.1392],
];

// ─────────────────────────────────────────────────────────────────────────────
// Public — GET /api/t/:tenant/fresh, /fresh/stands, /fresh/stands/:id, /fresh/seasons
// ─────────────────────────────────────────────────────────────────────────────

// A stand as embedded on a public feed row (listFresh). Nested under `stand`
// on each post row — confirmed by reading listFresh in src/handlers/fresh.ts,
// NOT a flattened shape.
export interface FreshFeedStand {
  id: string;
  name: string;
  lat: number;
  lon: number;
  address_hint: string | null;
  phone: string | null;
  categories: string[];
}

// GET /api/t/:tenant/fresh row shape.
export interface FreshFeedPost {
  id: string;
  body: string;
  photo_url: string | null;
  sold_out: boolean;
  created_at: number;
  expires_at: number;
  stand: FreshFeedStand;
}

// GET /api/t/:tenant/fresh/stands row shape (map pins). Every publicly visible
// stand, even ones with no live post today.
export interface FreshStandPin {
  id: string;
  name: string;
  lat: number;
  lon: number;
  address_hint: string | null;
  phone: string | null;
  categories: string[];
  has_live_post: 0 | 1;
  latest_body: string | null;
}

// A post as returned nested in getFreshStand's `posts` array. NOTE: unlike
// FreshFeedPost above, this comes straight off the DB row without the
// `!!r.sold_out` boolean coercion listFresh applies — sold_out here is the
// raw SQLite integer (0 or 1), confirmed by reading getFreshStand.
export interface FreshStandPost {
  id: string;
  body: string;
  photo_url: string | null;
  sold_out: 0 | 1;
  sold_out_at: number | null;
  created_at: number;
  expires_at: number;
}

// GET /api/t/:tenant/fresh/stands/:id shape (serializeStand(stand) + posts).
export interface FreshStandDetail {
  id: string;
  name: string;
  description: string | null;
  lat: number;
  lon: number;
  address_hint: string | null;
  phone: string | null;
  categories: string[];
  photo_url: string | null;
  created_at: number;
  posts: FreshStandPost[];
}

// GET /api/t/:tenant/fresh/seasons row shape.
export interface FreshSeason {
  id: number;
  item_name: string;
  start_month: number;
  start_day: number;
  end_month: number;
  end_day: number;
  sort_order: number;
  in_season_now: boolean;
}

export function listFresh(tenant: string, category?: string) {
  const q = category ? `?category=${encodeURIComponent(category)}` : '';
  return api.get<ApiResponse<FreshFeedPost[]>>(`/t/${tenant}/fresh${q}`);
}

export function listFreshStands(tenant: string) {
  return api.get<ApiResponse<FreshStandPin[]>>(`/t/${tenant}/fresh/stands`);
}

export function getFreshStand(tenant: string, id: string) {
  return api.get<ApiResponse<FreshStandDetail>>(`/t/${tenant}/fresh/stands/${id}`);
}

export function listFreshSeasons(tenant: string) {
  return api.get<ApiResponse<FreshSeason[]>>(`/t/${tenant}/fresh/seasons`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Authenticated — GET /fresh/mine and owner stand/post CRUD ("My Stand").
// Shapes below are read directly off src/handlers/fresh.ts, not guessed:
//  - listMyFresh nests each stand's own posts array (already the owner-state
//    augmented shape: state/state_note/can_relist), NOT the raw DB row.
//  - create/update/visibility on a stand return serializeStand(row) - the
//    full raw fresh_stands DB row (including admin_hidden as 0|1, is_hidden
//    as 0|1, deleted_at) with categories parsed to a string array. The owner
//    UI always re-fetches listMyFresh after a mutation for the canonical,
//    state-annotated view, so these are typed loosely (FreshStandRecord) -
//    only used for the brief moment before the list refetch resolves.
//  - create/update/sold-out/relist on a post return the raw fresh_posts DB
//    row (sold_out as 0|1, no state/state_note - those are computed only by
//    listMyFresh), same reasoning.
// ─────────────────────────────────────────────────────────────────────────────

export type FreshStandState = 'visible' | 'paused' | 'hidden_by_admin' | 'removed';
export type FreshPostState = 'live' | 'sold_out' | 'expired' | 'removed' | 'hidden_by_admin';

export interface MyFreshPost {
  id: string;
  body: string;
  photo_url: string | null;
  sold_out: boolean;
  created_at: number;
  expires_at: number;
  state: FreshPostState;
  state_note: string;
  can_relist: boolean;
}

export interface MyFreshStand {
  id: string;
  name: string;
  description: string | null;
  lat: number;
  lon: number;
  address_hint: string | null;
  phone: string | null;
  categories: string[];
  photo_url: string | null;
  is_hidden: boolean;
  admin_hidden_reason: string | null;
  created_at: number;
  state: FreshStandState;
  state_note: string;
  posts: MyFreshPost[];
}

export interface FreshStandInput {
  name: string;
  description?: string | null;
  lat: number;
  lon: number;
  categories: string[];
  address_hint?: string | null;
  phone?: string | null;
  photo_url?: string | null;
}

// Raw fresh_stands row (serializeStand output) - see the comment block above.
export interface FreshStandRecord {
  id: string;
  name: string;
  description: string | null;
  lat: number;
  lon: number;
  address_hint: string | null;
  phone: string | null;
  categories: string[];
  photo_url: string | null;
  is_hidden: 0 | 1;
  admin_hidden: 0 | 1;
  admin_hidden_reason: string | null;
  deleted_at: number | null;
  created_at: number;
}

// Raw fresh_posts row - see the comment block above.
export interface FreshPostRecord {
  id: string;
  stand_id: string;
  body: string;
  photo_url: string | null;
  sold_out: 0 | 1;
  sold_out_at: number | null;
  created_at: number;
  expires_at: number;
}

export function listMyFresh(tenant: string) {
  return api.get<ApiResponse<{ stands: MyFreshStand[] }>>(`/t/${tenant}/fresh/mine`);
}

/**
 * Upload a stand or post photo. Sends multipart FormData with a `file` field
 * to the Passport backend, which forwards it to KKAuth's generic uploads
 * route and returns only { data: { url } } — no fresh_stands/fresh_posts row
 * is touched here; the caller includes the returned url as photo_url in the
 * normal create/update stand or post call, below.
 *
 * Bypasses the JSON `api` client wrapper deliberately (same reason as
 * uploadAvatar in api/profile.ts) — apiFetch always forces
 * Content-Type: application/json, which would strip the multipart boundary
 * the browser needs to set itself for a FormData body.
 */
export async function uploadFreshPhoto(tenant: string, file: File): Promise<ApiResponse<{ url: string | null }>> {
  const token = getToken();
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const form = new FormData();
  form.append('file', file);

  const res = await fetch(`/api/t/${tenant}/fresh/upload`, {
    method: 'POST',
    headers,
    body: form,
    credentials: 'include',
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((body as any).error || `Upload failed: ${res.status}`);
  }

  return res.json();
}

export function createFreshStand(tenant: string, body: FreshStandInput) {
  return api.post<ApiResponse<FreshStandRecord>>(`/t/${tenant}/fresh/stands`, body);
}

export function updateFreshStand(tenant: string, id: string, body: Partial<FreshStandInput>) {
  return api.put<ApiResponse<FreshStandRecord>>(`/t/${tenant}/fresh/stands/${id}`, body);
}

export function setFreshStandVisibility(tenant: string, id: string, hidden: boolean) {
  return api.post<ApiResponse<FreshStandRecord>>(`/t/${tenant}/fresh/stands/${id}/visibility`, { hidden });
}

export function deleteFreshStand(tenant: string, id: string) {
  return api.delete<ApiResponse<{ removed: boolean }>>(`/t/${tenant}/fresh/stands/${id}`);
}

export function createFreshPost(tenant: string, standId: string, body: { body: string; photo_url?: string | null }) {
  return api.post<ApiResponse<FreshPostRecord>>(`/t/${tenant}/fresh/stands/${standId}/posts`, body);
}

export function updateFreshPost(tenant: string, id: string, body: { body?: string; photo_url?: string | null }) {
  return api.put<ApiResponse<FreshPostRecord>>(`/t/${tenant}/fresh/posts/${id}`, body);
}

export function setFreshPostSoldOut(tenant: string, id: string) {
  return api.post<ApiResponse<FreshPostRecord>>(`/t/${tenant}/fresh/posts/${id}/sold-out`);
}

export function relistFreshPost(tenant: string, id: string) {
  return api.post<ApiResponse<FreshPostRecord>>(`/t/${tenant}/fresh/posts/${id}/relist`);
}

export function deleteFreshPost(tenant: string, id: string) {
  return api.delete<ApiResponse<{ removed: boolean }>>(`/t/${tenant}/fresh/posts/${id}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Admin — GET /admin/fresh/stands, /admin/fresh/posts, POST .../hide (sub-task
// 4c). Shapes read directly off src/handlers/fresh.ts's adminListFreshStands/
// adminListFreshPosts/adminHideFreshStand/adminHideFreshPost:
//  - adminListFreshStands returns serializeStand(row) for every stand (any
//    state, including deleted), with an extra owner_email joined in from the
//    users table (left join - null if the owning account can't be resolved).
//  - adminListFreshPosts returns the raw fresh_posts row (sold_out as 0|1,
//    same as FreshPostRecord) plus stand_name - it does NOT join owner_email,
//    unlike the stands endpoint, so posts have no owner field to display.
//  - Both hide endpoints return the same raw row shape as the owner CRUD
//    endpoints above (FreshStandRecord / FreshPostRecord).
// ─────────────────────────────────────────────────────────────────────────────

export interface AdminFreshStandRow extends FreshStandRecord {
  owner_email: string | null;
}

// NOTE: does not extend FreshPostRecord above - that type is deliberately
// typed loosely (see the comment on FreshPostRecord) and omits several
// columns (is_active, admin_hidden, admin_hidden_reason) that are present on
// the raw row and that this admin view needs to render state correctly.
export interface AdminFreshPostRow {
  id: string;
  stand_id: string;
  body: string;
  photo_url: string | null;
  sold_out: 0 | 1;
  sold_out_at: number | null;
  is_active: 0 | 1;
  admin_hidden: 0 | 1;
  admin_hidden_reason: string | null;
  created_at: number;
  expires_at: number;
  stand_name: string;
}

export function adminListFreshStands(tenant: string) {
  return api.get<ApiResponse<AdminFreshStandRow[]>>(`/t/${tenant}/admin/fresh/stands`);
}

export function adminListFreshPosts(tenant: string) {
  return api.get<ApiResponse<AdminFreshPostRow[]>>(`/t/${tenant}/admin/fresh/posts`);
}

export function adminHideFreshStand(tenant: string, id: string, hidden: boolean, reason?: string) {
  return api.post<ApiResponse<FreshStandRecord>>(`/t/${tenant}/admin/fresh/stands/${id}/hide`, { hidden, reason });
}

export function adminHideFreshPost(tenant: string, id: string, hidden: boolean, reason?: string) {
  return api.post<ApiResponse<FreshPostRecord>>(`/t/${tenant}/admin/fresh/posts/${id}/hide`, { hidden, reason });
}
