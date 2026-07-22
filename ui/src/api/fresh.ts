import { api } from './client';
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
// Authenticated owner endpoints (My Stand) and admin endpoints are added here
// by a later sub-task. Nothing below this line yet.
// ─────────────────────────────────────────────────────────────────────────────
