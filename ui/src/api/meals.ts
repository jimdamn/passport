import { api, getToken } from './client';
import type { ApiResponse } from '../types';

// Community Table — community-meal board (fire halls, churches, Legion/VFW).
// Mirrors api/fresh.ts / api/sales.ts / api/popups.ts's style. Backend is the
// source of truth for MEAL_CATEGORIES (src/handlers/meals.ts) - kept in sync
// by hand, same reasoning those files document for their own copy.

export const MEAL_CATEGORIES = [
  { key: 'fish_fry', label: 'Fish Fry' },
  { key: 'breakfast', label: 'Breakfast' },
  { key: 'supper', label: 'Supper' },
  { key: 'chicken_bbq', label: 'Chicken BBQ' },
  { key: 'ice_cream_social', label: 'Ice Cream Social' },
  { key: 'benefit', label: 'Benefit Meal' },
] as const;

export type MealCategory = typeof MEAL_CATEGORIES[number]['key'];

export function categoryLabel(key: string): string {
  return MEAL_CATEGORIES.find(c => c.key === key)?.label ?? key;
}

export function kitchenLocation(nearestCity: string | null, nearestState: string | null): string | null {
  if (!nearestCity) return null;
  return nearestState ? `${nearestCity}, ${nearestState}` : nearestCity;
}

// Mirrored from src/handlers/fresh.ts REGION_CENTER/REGION_BOUNDS (same values
// meals.ts imports from fresh.ts on the backend) - kept as a plain constant
// here, same reasoning api/fresh.ts and its siblings document for their own copy.
export const REGION_CENTER = { lat: 41.55, lon: -85.45 };
export const REGION_BOUNDS: [[number, number], [number, number]] = [
  [-86.3485, 40.9012],
  [-84.4557, 42.1392],
];

export type MealStatus = 'cancelled' | 'done' | 'sold_out' | 'serving_now' | 'today' | 'upcoming';

// ─────────────────────────────────────────────────────────────────────────────
// Public — GET /api/t/:tenant/meals, /meals/pins, /meals/kitchens/:id, /meals/meals/:id
// ─────────────────────────────────────────────────────────────────────────────

export interface MealFeedKitchen {
  id: string;
  name: string;
  phone: string | null;
  nearest_city: string | null;
  nearest_state: string | null;
}

export interface MealFeedRow {
  id: string;
  title: string;
  body: string;
  category: string;
  date: string;
  open: string;
  close: string;
  benefit_line: string | null;
  venue_hint: string | null;
  photo_url: string | null;
  sold_out: boolean;
  cancelled_at: number | null;
  created_at: number;
  lat: number;
  lon: number;
  status: MealStatus;
  status_note: string;
  distance_mi: number | null;
  kitchen: MealFeedKitchen;
}

export interface MealPin {
  id: string;
  lat: number;
  lon: number;
  title: string;
  kitchen_name: string;
  status: MealStatus;
  status_note: string;
  distance_mi: number | null;
}

export interface KitchenDetail {
  id: string;
  name: string;
  description: string | null;
  lat: number;
  lon: number;
  address_hint: string | null;
  phone: string | null;
  photo_url: string | null;
  created_at: number;
  nearest_city: string | null;
  nearest_state: string | null;
  meals: MealFeedRow[];
}

export function listMeals(tenant: string, category?: string, nearby?: { lat: number; lon: number; radius: number }) {
  const params = new URLSearchParams();
  if (category) params.set('category', category);
  if (nearby) {
    params.set('lat', String(nearby.lat));
    params.set('lon', String(nearby.lon));
    params.set('radius', String(nearby.radius));
  }
  const q = params.toString();
  return api.get<ApiResponse<MealFeedRow[]>>(`/t/${tenant}/meals${q ? `?${q}` : ''}`);
}

export function listMealPins(tenant: string, category?: string, nearby?: { lat: number; lon: number; radius: number }) {
  const params = new URLSearchParams();
  if (category) params.set('category', category);
  if (nearby) {
    params.set('lat', String(nearby.lat));
    params.set('lon', String(nearby.lon));
    params.set('radius', String(nearby.radius));
  }
  const q = params.toString();
  return api.get<ApiResponse<MealPin[]>>(`/t/${tenant}/meals/pins${q ? `?${q}` : ''}`);
}

export function getKitchen(tenant: string, id: string) {
  return api.get<ApiResponse<KitchenDetail>>(`/t/${tenant}/meals/kitchens/${id}`);
}

export function getMeal(tenant: string, id: string) {
  return api.get<ApiResponse<MealFeedRow>>(`/t/${tenant}/meals/meals/${id}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Authenticated — GET /meals/mine and owner kitchen/meal CRUD ("My Kitchen")
// ─────────────────────────────────────────────────────────────────────────────

export type MyKitchenState = 'visible' | 'quiet' | 'hidden_by_admin' | 'removed';
export type MyMealState = MealStatus | 'removed' | 'hidden_by_admin';

export interface MyMeal {
  id: string;
  title: string;
  body: string;
  category: string;
  date: string;
  open: string;
  close: string;
  benefit_line: string | null;
  lat: number | null;
  lon: number | null;
  venue_hint: string | null;
  photo_url: string | null;
  sold_out: boolean;
  cancelled_at: number | null;
  admin_hidden_reason: string | null;
  created_at: number;
  state: MyMealState;
  state_note: string;
  can_serve_again: boolean;
}

export interface MyKitchen {
  id: string;
  name: string;
  description: string | null;
  lat: number;
  lon: number;
  address_hint: string | null;
  phone: string | null;
  nearest_city: string | null;
  nearest_state: string | null;
  photo_url: string | null;
  is_hidden: boolean;
  admin_hidden_reason: string | null;
  created_at: number;
  state: MyKitchenState;
  state_note: string;
  meals: MyMeal[];
}

export interface KitchenInput {
  name: string;
  description?: string | null;
  lat: number;
  lon: number;
  address_hint?: string | null;
  phone?: string | null;
  photo_url?: string | null;
}

export interface MealInput {
  title: string;
  body: string;
  category: string;
  date: string;
  open: string;
  close: string;
  benefit_line?: string | null;
  lat?: number | null;
  lon?: number | null;
  venue_hint?: string | null;
  photo_url?: string | null;
}

// Raw meal_kitchens row (returned by create/update/visibility) - the owner UI
// always re-fetches listMyMeals after a mutation for the canonical,
// state-annotated view, so this is typed loosely, same reasoning
// api/fresh.ts's FreshStandRecord documents.
export interface KitchenRecord {
  id: string;
  name: string;
  description: string | null;
  lat: number;
  lon: number;
  address_hint: string | null;
  phone: string | null;
  photo_url: string | null;
  nearest_city: string | null;
  nearest_state: string | null;
  is_hidden: 0 | 1;
  admin_hidden: 0 | 1;
  admin_hidden_reason: string | null;
  deleted_at: number | null;
  created_at: number;
}

// Raw meals row - same reasoning as KitchenRecord above.
export interface MealRecord {
  id: string;
  kitchen_id: string;
  title: string;
  body: string;
  category: string;
  date: string;
  open: string;
  close: string;
  benefit_line: string | null;
  lat: number | null;
  lon: number | null;
  venue_hint: string | null;
  photo_url: string | null;
  sold_out: 0 | 1;
  sold_out_at: number | null;
  cancelled_at: number | null;
  admin_hidden: 0 | 1;
  admin_hidden_reason: string | null;
  deleted_at: number | null;
  created_at: number;
}

export function listMyMeals(tenant: string) {
  return api.get<ApiResponse<{ kitchens: MyKitchen[] }>>(`/t/${tenant}/meals/mine`);
}

/** Upload a kitchen or meal photo. Same multipart bypass as api/fresh.ts's uploadFreshPhoto. */
export async function uploadMealPhoto(tenant: string, file: File): Promise<ApiResponse<{ url: string | null }>> {
  const token = getToken();
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const form = new FormData();
  form.append('file', file);

  const res = await fetch(`/api/t/${tenant}/meals/upload`, {
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

export function createKitchen(tenant: string, body: KitchenInput) {
  return api.post<ApiResponse<KitchenRecord>>(`/t/${tenant}/meals/kitchens`, body);
}

export function updateKitchen(tenant: string, id: string, body: Partial<KitchenInput>) {
  return api.put<ApiResponse<KitchenRecord>>(`/t/${tenant}/meals/kitchens/${id}`, body);
}

export function setKitchenVisibility(tenant: string, id: string, hidden: boolean) {
  return api.post<ApiResponse<KitchenRecord>>(`/t/${tenant}/meals/kitchens/${id}/visibility`, { hidden });
}

export function deleteKitchen(tenant: string, id: string) {
  return api.delete<ApiResponse<{ removed: boolean }>>(`/t/${tenant}/meals/kitchens/${id}`);
}

export function createMeal(tenant: string, kitchenId: string, body: MealInput) {
  return api.post<ApiResponse<MealRecord>>(`/t/${tenant}/meals/kitchens/${kitchenId}/meals`, body);
}

export function updateMeal(tenant: string, id: string, body: Partial<MealInput>) {
  return api.put<ApiResponse<MealRecord>>(`/t/${tenant}/meals/meals/${id}`, body);
}

export function setMealSoldOut(tenant: string, id: string) {
  return api.post<ApiResponse<MealRecord>>(`/t/${tenant}/meals/meals/${id}/sold-out`);
}

export function cancelMeal(tenant: string, id: string) {
  return api.post<ApiResponse<MealRecord>>(`/t/${tenant}/meals/meals/${id}/cancel`);
}

export function deleteMeal(tenant: string, id: string) {
  return api.delete<ApiResponse<{ removed: boolean }>>(`/t/${tenant}/meals/meals/${id}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Admin — GET /admin/meals/kitchens, /admin/meals/meals, POST .../hide
// ─────────────────────────────────────────────────────────────────────────────

export interface AdminKitchenRow extends KitchenRecord {
  owner_email: string | null;
}

export interface AdminMealRow extends MealRecord {
  kitchen_name: string;
}

export function adminListKitchens(tenant: string) {
  return api.get<ApiResponse<AdminKitchenRow[]>>(`/t/${tenant}/admin/meals/kitchens`);
}

export function adminListMeals(tenant: string) {
  return api.get<ApiResponse<AdminMealRow[]>>(`/t/${tenant}/admin/meals/meals`);
}

export function adminHideKitchen(tenant: string, id: string, hidden: boolean, reason?: string) {
  return api.post<ApiResponse<KitchenRecord>>(`/t/${tenant}/admin/meals/kitchens/${id}/hide`, { hidden, reason });
}

export function adminHideMeal(tenant: string, id: string, hidden: boolean, reason?: string) {
  return api.post<ApiResponse<MealRecord>>(`/t/${tenant}/admin/meals/meals/${id}/hide`, { hidden, reason });
}
