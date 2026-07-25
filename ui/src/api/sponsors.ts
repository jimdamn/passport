import { api, getToken } from './client';
import type { ApiResponse } from '../types';

// Sponsor Drawer — admin-created "Brought to you by X" route sponsorships.
// Passport-only known routes for Increment 1+2; Increment 3 extends this
// list when siblings mount the drawer. Mirrors src/handlers/sponsors.ts's
// SPONSOR_KNOWN_ROUTES exactly - kept in sync by hand (UI build can't import
// from the Worker's src tree).
export const SPONSOR_KNOWN_ROUTES = [
  { value: '/explore', label: 'Around Town' },
  { value: '/happenings', label: 'Happenings' },
  { value: '/deals', label: 'Deals' },
  { value: '/fresh', label: 'Fresh Today' },
  { value: '/sales', label: 'Sale Day' },
  { value: '/pets', label: 'Home Safe' },
  { value: '/popups', label: 'Pop-Ups' },
  { value: '/meals', label: 'Community Table' },
  { value: '/kwest', label: 'KrowdKwest' },
] as const;

export function routeLabel(route: string): string {
  if (route === '*') return 'All routes';
  return SPONSOR_KNOWN_ROUTES.find(r => r.value === route)?.label ?? route;
}

export type SponsorTargetKind = 'region' | 'city' | 'zip';
export type SponsorState = 'live' | 'scheduled' | 'ended' | 'paused' | 'feature_off';

// GET /sponsor-drawer/resolve winning-placement shape (what the drawer itself renders).
export interface SponsorPlacement {
  id: number;
  sponsor_name: string;
  message: string;
  link_url: string | null;
  image_url: string | null;
}

// Admin CRUD row shape (serializeSponsor in src/handlers/sponsors.ts) plus
// the computed state/state_note/impressions adminListSponsors adds.
export interface AdminSponsor {
  id: number;
  route: string;
  target_kind: SponsorTargetKind;
  target_value: string | null;
  sponsor_name: string;
  message: string;
  link_url: string | null;
  image_url: string | null;
  sponsor_kkauth_uid: string | null;
  is_active: boolean;
  starts_at: string | null;
  ends_at: string | null;
  created_at: string;
  state: SponsorState;
  state_note: string;
  impressions: {
    lifetime_shows: number;
    lifetime_taps: number;
    recent_shows: number;
    recent_taps: number;
  };
}

export interface SponsorInput {
  sponsor_name?: string;
  message?: string;
  route?: string;
  target_kind?: SponsorTargetKind;
  target_value?: string | null;
  link_url?: string | null;
  image_url?: string | null;
  starts_at?: number | null; // epoch ms; server converts to its SQL datetime format
  ends_at?: number | null;
}

export function adminListSponsors(tenant: string) {
  return api.get<ApiResponse<AdminSponsor[]>>(`/t/${tenant}/admin/sponsors`);
}

export function adminCreateSponsor(tenant: string, body: SponsorInput) {
  return api.post<ApiResponse<AdminSponsor>>(`/t/${tenant}/admin/sponsors`, body);
}

export function adminUpdateSponsor(tenant: string, id: number, body: SponsorInput) {
  return api.put<ApiResponse<AdminSponsor>>(`/t/${tenant}/admin/sponsors/${id}`, body);
}

export function adminSetSponsorActive(tenant: string, id: number, active: boolean) {
  return api.post<ApiResponse<AdminSponsor>>(`/t/${tenant}/admin/sponsors/${id}/active`, { active });
}

export function adminEndSponsor(tenant: string, id: number) {
  return api.post<ApiResponse<AdminSponsor>>(`/t/${tenant}/admin/sponsors/${id}/end`);
}

export function adminDeleteSponsor(tenant: string, id: number) {
  return api.delete<ApiResponse<{ removed: boolean }>>(`/t/${tenant}/admin/sponsors/${id}`);
}

export function adminGetSponsorFeature(tenant: string) {
  return api.get<ApiResponse<{ on: boolean }>>(`/t/${tenant}/admin/sponsors/feature`);
}

export function adminSetSponsorFeature(tenant: string, on: boolean) {
  return api.post<ApiResponse<{ on: boolean }>>(`/t/${tenant}/admin/sponsors/feature`, { on });
}

/**
 * Upload a sponsor image. Bypasses the JSON `api` client wrapper deliberately
 * (same reason as uploadFreshPhoto in api/fresh.ts) — apiFetch always forces
 * Content-Type: application/json, which would strip the multipart boundary
 * the browser needs to set itself for a FormData body.
 */
export async function uploadSponsorPhoto(tenant: string, file: File): Promise<ApiResponse<{ url: string | null }>> {
  const token = getToken();
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const form = new FormData();
  form.append('file', file);

  const res = await fetch(`/api/t/${tenant}/sponsors/upload`, {
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
