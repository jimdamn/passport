import { api, getToken } from './client';
import type { ApiResponse } from '../types';

// Sale Day — yard/barn/moving/estate sales and auctions. Mirrors api/fresh.ts's
// style. Backend is the source of truth for SALE_CATEGORIES (src/handlers/
// sales.ts) - kept in sync by hand, same reasoning fresh.ts's UI client
// documents for its own copy.

export const SALE_CATEGORIES = [
  { key: 'yard', label: 'Yard Sale' },
  { key: 'multi_family', label: 'Multi-Family' },
  { key: 'barn', label: 'Barn Sale' },
  { key: 'moving', label: 'Moving Sale' },
  { key: 'estate', label: 'Estate Sale' },
  { key: 'auction', label: 'Auction' },
] as const;

export type SaleCategory = typeof SALE_CATEGORIES[number]['key'];

export function categoryLabel(key: string): string {
  return SALE_CATEGORIES.find(c => c.key === key)?.label ?? key;
}

/** "City, State" for a sale's auto-derived nearest town/state, or null. */
export function saleLocation(nearestCity: string | null, nearestState: string | null): string | null {
  if (!nearestCity || !nearestState) return null;
  return `${nearestCity}, ${nearestState}`;
}

// Mirrored from src/handlers/fresh.ts REGION_CENTER/REGION_BOUNDS (same
// values sales.ts imports from fresh.ts on the backend) - kept as a plain
// constant here, same reasoning api/fresh.ts documents for its own copy.
export const REGION_CENTER = { lat: 41.55, lon: -85.45 };
export const REGION_BOUNDS: [[number, number], [number, number]] = [
  [-86.3485, 40.9012],
  [-84.4557, 42.1392],
];

export interface SaleDayEntry { date: string; open: string; close: string; }
export type SaleStatus = 'upcoming' | 'later_today' | 'on_now' | 'done_today' | 'ended';
export type OwnerSaleState = 'active' | 'postponed' | 'hidden_by_admin' | 'removed' | 'ended';

// ─────────────────────────────────────────────────────────────────────────────
// Public — GET /api/t/:tenant/sales, /sales/pins, /sales/events, /sales/:id
// ─────────────────────────────────────────────────────────────────────────────

export interface SaleFeedRow {
  id: string;
  title: string;
  body: string;
  category: string;
  event_name: string | null;
  lat: number;
  lon: number;
  address_hint: string | null;
  phone: string | null;
  photo_url: string | null;
  nearest_city: string | null;
  nearest_state: string | null;
  days: SaleDayEntry[];
  wrapped_date: string | null;
  created_at: number;
  status: SaleStatus;
  status_note: string;
  distance_mi: number | null;
}

export interface SalePin {
  id: string;
  lat: number;
  lon: number;
  title: string;
  status: SaleStatus;
  status_note: string;
  distance_mi: number | null;
}

export interface SaleEventChip {
  event_name: string;
  count: number;
}

export function listSales(tenant: string, category?: string, event?: string, nearby?: { lat: number; lon: number; radius: number }) {
  const params = new URLSearchParams();
  if (category) params.set('category', category);
  if (event) params.set('event', event);
  if (nearby) {
    params.set('lat', String(nearby.lat));
    params.set('lon', String(nearby.lon));
    params.set('radius', String(nearby.radius));
  }
  const q = params.toString();
  return api.get<ApiResponse<SaleFeedRow[]>>(`/t/${tenant}/sales${q ? `?${q}` : ''}`);
}

export function listSalePins(tenant: string, nearby?: { lat: number; lon: number; radius: number }) {
  const params = new URLSearchParams();
  if (nearby) {
    params.set('lat', String(nearby.lat));
    params.set('lon', String(nearby.lon));
    params.set('radius', String(nearby.radius));
  }
  const q = params.toString();
  return api.get<ApiResponse<SalePin[]>>(`/t/${tenant}/sales/pins${q ? `?${q}` : ''}`);
}

export function listSaleEvents(tenant: string) {
  return api.get<ApiResponse<SaleEventChip[]>>(`/t/${tenant}/sales/events`);
}

export function getSale(tenant: string, id: string) {
  return api.get<ApiResponse<SaleFeedRow>>(`/t/${tenant}/sales/${id}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Authenticated — GET /sales/mine and owner CRUD ("My Sales")
// ─────────────────────────────────────────────────────────────────────────────

export interface MySale extends SaleFeedRow {
  is_hidden: boolean;
  admin_hidden_reason: string | null;
  state: OwnerSaleState;
  state_note: string;
}

export interface SaleInput {
  title: string;
  body: string;
  category: string;
  lat: number;
  lon: number;
  address_hint: string;
  phone?: string | null;
  event_name?: string | null;
  days: SaleDayEntry[];
  photo_url?: string | null;
}

// Raw `sales` row (publicSaleShape output on the backend) - returned by
// create/update/visibility/wrap. The owner UI always re-fetches listMySales
// after a mutation for the canonical, state-annotated view (same pattern as
// api/fresh.ts's FreshStandRecord), so this is typed loosely.
export interface SaleRecord {
  id: string;
  title: string;
  body: string;
  category: string;
  lat: number;
  lon: number;
  address_hint: string | null;
  phone: string | null;
  event_name: string | null;
  days: SaleDayEntry[];
  first_date: string;
  last_date: string;
  wrapped_date: string | null;
  photo_url: string | null;
  nearest_city: string | null;
  nearest_state: string | null;
  is_hidden: 0 | 1;
  admin_hidden: 0 | 1;
  admin_hidden_reason: string | null;
  deleted_at: number | null;
  created_at: number;
}

export function listMySales(tenant: string) {
  return api.get<ApiResponse<{ sales: MySale[] }>>(`/t/${tenant}/sales/mine`);
}

/** Upload a sale photo. Same multipart bypass as api/fresh.ts's uploadFreshPhoto. */
export async function uploadSalePhoto(tenant: string, file: File): Promise<ApiResponse<{ url: string | null }>> {
  const token = getToken();
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const form = new FormData();
  form.append('file', file);

  const res = await fetch(`/api/t/${tenant}/sales/upload`, {
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

export function createSale(tenant: string, body: SaleInput) {
  return api.post<ApiResponse<SaleRecord>>(`/t/${tenant}/sales`, body);
}

export function updateSale(tenant: string, id: string, body: Partial<SaleInput>) {
  return api.put<ApiResponse<SaleRecord>>(`/t/${tenant}/sales/${id}`, body);
}

export function setSaleVisibility(tenant: string, id: string, hidden: boolean) {
  return api.post<ApiResponse<SaleRecord>>(`/t/${tenant}/sales/${id}/visibility`, { hidden });
}

export function wrapSale(tenant: string, id: string) {
  return api.post<ApiResponse<SaleRecord>>(`/t/${tenant}/sales/${id}/wrap`);
}

export function deleteSale(tenant: string, id: string) {
  return api.delete<ApiResponse<{ removed: boolean }>>(`/t/${tenant}/sales/${id}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Admin — GET /admin/sales, POST /admin/sales/:id/hide
// ─────────────────────────────────────────────────────────────────────────────

export interface AdminSaleRow extends SaleRecord {
  owner_email: string | null;
}

export function adminListSales(tenant: string) {
  return api.get<ApiResponse<AdminSaleRow[]>>(`/t/${tenant}/admin/sales`);
}

export function adminHideSale(tenant: string, id: string, hidden: boolean, reason?: string) {
  return api.post<ApiResponse<SaleRecord>>(`/t/${tenant}/admin/sales/${id}/hide`, { hidden, reason });
}
