import { api, getToken } from './client';
import type { ApiResponse } from '../types';

// Pop-Ups — mobile/pop-up business board. Mirrors api/fresh.ts / api/sales.ts's
// style. Backend is the source of truth for POPUP_CATEGORIES (src/handlers/
// popups.ts) - kept in sync by hand, same reasoning those files document for
// their own copy.

export const POPUP_CATEGORIES = [
  { key: 'food_truck', label: 'Food Truck' },
  { key: 'popup_shop', label: 'Pop-Up Shop' },
  { key: 'market_vendor', label: 'Market Vendor' },
  { key: 'mobile_service', label: 'Mobile Service' },
] as const;

export type PopupCategory = typeof POPUP_CATEGORIES[number]['key'];

export function categoryLabel(key: string): string {
  return POPUP_CATEGORIES.find(c => c.key === key)?.label ?? key;
}

// Mirrored from src/handlers/fresh.ts REGION_CENTER/REGION_BOUNDS (same values
// popups.ts imports from fresh.ts on the backend) - kept as a plain constant
// here, same reasoning api/fresh.ts and api/sales.ts document for their own copy.
export const REGION_CENTER = { lat: 41.55, lon: -85.45 };
export const REGION_BOUNDS: [[number, number], [number, number]] = [
  [-86.3485, 40.9012],
  [-84.4557, 42.1392],
];

export type StopStatus = 'cancelled' | 'done' | 'sold_out' | 'here_now' | 'scheduled_now' | 'today' | 'upcoming';
export type StopLayer = 'confirmed' | 'scheduled';

// ─────────────────────────────────────────────────────────────────────────────
// Public — GET /api/t/:tenant/popups, /popups/pins, /popups/vendors/:id
// ─────────────────────────────────────────────────────────────────────────────

export interface PopupFeedVendor {
  id: string;
  name: string;
  category: string;
  phone: string | null;
  photo_url: string | null;
}

export interface PopupFeedStop {
  id: string;
  date: string;
  open: string;
  close: string;
  lat: number;
  lon: number;
  checkin_lat: number | null;
  checkin_lon: number | null;
  address: string | null;
  location_hint: string | null;
  note: string | null;
  nearest_city: string | null;
  nearest_state: string | null;
  checked_in_at: number | null;
  sold_out: boolean;
  cancelled_at: number | null;
  created_at: number;
  status: StopStatus;
  status_note: string;
  vendor: PopupFeedVendor;
}

export interface PopupStopPin {
  id: string;
  vendor_id: string;
  vendor_name: string;
  lat: number;
  lon: number;
  status: StopStatus;
  status_note: string;
  layer: StopLayer;
}

export interface PopupVendorStop {
  id: string;
  date: string;
  open: string;
  close: string;
  lat: number;
  lon: number;
  checkin_lat: number | null;
  checkin_lon: number | null;
  address: string | null;
  location_hint: string | null;
  note: string | null;
  nearest_city: string | null;
  nearest_state: string | null;
  checked_in_at: number | null;
  sold_out: boolean;
  cancelled_at: number | null;
  status: StopStatus;
  status_note: string;
}

export interface PopupVendorDetail {
  id: string;
  name: string;
  category: string;
  description: string | null;
  phone: string | null;
  photo_url: string | null;
  created_at: number;
  stops: PopupVendorStop[];
  last_checked_in: { date: string; location_hint: string | null; nearest_city: string | null } | null;
}

export type PopupWhen = 'today' | 'coming';

export function listPopups(tenant: string, category?: string, when?: PopupWhen) {
  const params = new URLSearchParams();
  if (category) params.set('category', category);
  if (when) params.set('when', when);
  const q = params.toString();
  return api.get<ApiResponse<PopupFeedStop[]>>(`/t/${tenant}/popups${q ? `?${q}` : ''}`);
}

export function listPopupPins(tenant: string, category?: string, when?: PopupWhen) {
  const params = new URLSearchParams();
  if (category) params.set('category', category);
  if (when) params.set('when', when);
  const q = params.toString();
  return api.get<ApiResponse<PopupStopPin[]>>(`/t/${tenant}/popups/pins${q ? `?${q}` : ''}`);
}

export function getPopupVendor(tenant: string, id: string) {
  return api.get<ApiResponse<PopupVendorDetail>>(`/t/${tenant}/popups/vendors/${id}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Authenticated — GET /popups/mine and owner vendor/stop CRUD ("My Schedule")
// ─────────────────────────────────────────────────────────────────────────────

export type MyVendorState = 'visible' | 'off_road' | 'hidden_by_admin' | 'removed';
export type MyStopState = StopStatus | 'removed' | 'hidden_by_admin';

export interface MyPopupStop {
  id: string;
  date: string;
  open: string;
  close: string;
  lat: number;
  lon: number;
  checkin_lat: number | null;
  checkin_lon: number | null;
  address: string | null;
  location_hint: string | null;
  note: string | null;
  nearest_city: string | null;
  nearest_state: string | null;
  checked_in_at: number | null;
  sold_out: boolean;
  cancelled_at: number | null;
  admin_hidden_reason: string | null;
  created_at: number;
  state: MyStopState;
  state_note: string;
  can_repeat: boolean;
}

export interface MyPopupVendor {
  id: string;
  name: string;
  category: string;
  description: string | null;
  phone: string | null;
  photo_url: string | null;
  is_hidden: boolean;
  admin_hidden_reason: string | null;
  created_at: number;
  state: MyVendorState;
  state_note: string;
  stops: MyPopupStop[];
}

export interface PopupVendorInput {
  name: string;
  category: string;
  description?: string | null;
  phone?: string | null;
  photo_url?: string | null;
}

export interface PopupStopInput {
  date: string;
  open: string;
  close: string;
  lat: number;
  lon: number;
  address: string;
  location_hint?: string | null;
  note?: string | null;
}

// Raw popup_vendors row (returned by create/update/visibility) - the owner UI
// always re-fetches listMyPopups after a mutation for the canonical,
// state-annotated view, so this is typed loosely, same reasoning
// api/fresh.ts's FreshStandRecord documents.
export interface PopupVendorRecord {
  id: string;
  name: string;
  category: string;
  description: string | null;
  phone: string | null;
  photo_url: string | null;
  is_hidden: 0 | 1;
  admin_hidden: 0 | 1;
  admin_hidden_reason: string | null;
  deleted_at: number | null;
  created_at: number;
}

// Raw popup_stops row - same reasoning as PopupVendorRecord above.
export interface PopupStopRecord {
  id: string;
  vendor_id: string;
  date: string;
  open: string;
  close: string;
  lat: number;
  lon: number;
  checkin_lat: number | null;
  checkin_lon: number | null;
  address: string | null;
  location_hint: string | null;
  note: string | null;
  nearest_city: string | null;
  nearest_state: string | null;
  checked_in_at: number | null;
  sold_out: 0 | 1;
  sold_out_at: number | null;
  cancelled_at: number | null;
  admin_hidden: 0 | 1;
  admin_hidden_reason: string | null;
  deleted_at: number | null;
  created_at: number;
}

export function listMyPopups(tenant: string) {
  return api.get<ApiResponse<{ vendors: MyPopupVendor[] }>>(`/t/${tenant}/popups/mine`);
}

/** Upload a vendor photo. Same multipart bypass as api/fresh.ts's uploadFreshPhoto. */
export async function uploadPopupPhoto(tenant: string, file: File): Promise<ApiResponse<{ url: string | null }>> {
  const token = getToken();
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const form = new FormData();
  form.append('file', file);

  const res = await fetch(`/api/t/${tenant}/popups/upload`, {
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

export function createPopupVendor(tenant: string, body: PopupVendorInput) {
  return api.post<ApiResponse<PopupVendorRecord>>(`/t/${tenant}/popups/vendors`, body);
}

export function updatePopupVendor(tenant: string, id: string, body: Partial<PopupVendorInput>) {
  return api.put<ApiResponse<PopupVendorRecord>>(`/t/${tenant}/popups/vendors/${id}`, body);
}

export function setPopupVendorVisibility(tenant: string, id: string, hidden: boolean) {
  return api.post<ApiResponse<PopupVendorRecord>>(`/t/${tenant}/popups/vendors/${id}/visibility`, { hidden });
}

export function deletePopupVendor(tenant: string, id: string) {
  return api.delete<ApiResponse<{ removed: boolean }>>(`/t/${tenant}/popups/vendors/${id}`);
}

export function createPopupStop(tenant: string, vendorId: string, body: PopupStopInput) {
  return api.post<ApiResponse<PopupStopRecord>>(`/t/${tenant}/popups/vendors/${vendorId}/stops`, body);
}

export function updatePopupStop(tenant: string, id: string, body: Partial<PopupStopInput>) {
  return api.put<ApiResponse<PopupStopRecord>>(`/t/${tenant}/popups/stops/${id}`, body);
}

export function checkInPopupStop(tenant: string, id: string, coords?: { lat: number; lon: number }) {
  return api.post<ApiResponse<PopupStopRecord>>(`/t/${tenant}/popups/stops/${id}/checkin`, coords ?? {});
}

export function setPopupStopSoldOut(tenant: string, id: string) {
  return api.post<ApiResponse<PopupStopRecord>>(`/t/${tenant}/popups/stops/${id}/sold-out`);
}

export function cancelPopupStop(tenant: string, id: string) {
  return api.post<ApiResponse<PopupStopRecord>>(`/t/${tenant}/popups/stops/${id}/cancel`);
}

export function deletePopupStop(tenant: string, id: string) {
  return api.delete<ApiResponse<{ removed: boolean }>>(`/t/${tenant}/popups/stops/${id}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Admin — GET /admin/popups/vendors, /admin/popups/stops, POST .../hide
// ─────────────────────────────────────────────────────────────────────────────

export interface AdminPopupVendorRow extends PopupVendorRecord {
  owner_email: string | null;
  stops_past: number;
  stops_checked_in: number;
}

export interface AdminPopupStopRow extends PopupStopRecord {
  vendor_name: string;
}

export function adminListPopupVendors(tenant: string) {
  return api.get<ApiResponse<AdminPopupVendorRow[]>>(`/t/${tenant}/admin/popups/vendors`);
}

export function adminListPopupStops(tenant: string) {
  return api.get<ApiResponse<AdminPopupStopRow[]>>(`/t/${tenant}/admin/popups/stops`);
}

export function adminHidePopupVendor(tenant: string, id: string, hidden: boolean, reason?: string) {
  return api.post<ApiResponse<PopupVendorRecord>>(`/t/${tenant}/admin/popups/vendors/${id}/hide`, { hidden, reason });
}

export function adminHidePopupStop(tenant: string, id: string, hidden: boolean, reason?: string) {
  return api.post<ApiResponse<PopupStopRecord>>(`/t/${tenant}/admin/popups/stops/${id}/hide`, { hidden, reason });
}
