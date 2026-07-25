import { api, getToken } from './client';
import type { ApiResponse } from '../types';

// Sponsor Drawer — admin-created "Brought to you by X" route sponsorships.
// Mirrors src/handlers/sponsors.ts's SPONSOR_APPS / SPONSOR_ROUTES_BY_APP
// exactly - kept in sync by hand (UI build can't import from the Worker's
// src tree). A bare route string collides across apps ('/' and '/help'
// exist in nearly every sibling), so every placement names both an app and
// a route within it.
export const SPONSOR_APPS = [
  { value: 'passport', label: 'Passport' },
  { value: 'exchange', label: 'Exchange' },
  { value: 'field-notes', label: 'Field Notes' },
  { value: 'apps-hub', label: 'Apps Hub' },
] as const;
export type SponsorApp = typeof SPONSOR_APPS[number]['value'];

export const SPONSOR_ROUTES_BY_APP: Record<SponsorApp, { value: string; label: string }[]> = {
  passport: [
    { value: '/explore', label: 'Around Town' },
    { value: '/happenings', label: 'Happenings' },
    { value: '/deals', label: 'Deals' },
    { value: '/fresh', label: 'Fresh Today' },
    { value: '/sales', label: 'Sale Day' },
    { value: '/pets', label: 'Home Safe' },
    { value: '/popups', label: 'Pop-Ups' },
    { value: '/meals', label: 'Community Table' },
    { value: '/kwest', label: 'KrowdKwest' },
  ],
  exchange: [
    { value: '/', label: 'Browse' },
    { value: '/trades', label: 'My Trades' },
    { value: '/me/posts', label: 'My Posts' },
  ],
  'field-notes': [
    { value: '/', label: 'Stories Feed' },
    { value: '/submit', label: 'Share a Story' },
    { value: '/my-stories', label: 'My Stories' },
  ],
  'apps-hub': [
    { value: '/', label: 'Hub Home' },
  ],
};

export function appLabel(app: string): string {
  return SPONSOR_APPS.find(a => a.value === app)?.label ?? app;
}

export function routeLabel(app: string, route: string): string {
  if (route === '*') return 'All routes';
  return SPONSOR_ROUTES_BY_APP[app as SponsorApp]?.find(r => r.value === route)?.label ?? route;
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
  app: string;
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
  app?: string;
  route?: string;
  target_kind?: SponsorTargetKind;
  target_value?: string | null;
  link_url?: string | null;
  image_url?: string | null;
  starts_at?: number | null; // epoch ms; server converts to its SQL datetime format
  ends_at?: number | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public — resolve + beacon (optional auth; frictionless-reads standing order)
// ─────────────────────────────────────────────────────────────────────────────

export function resolveSponsorDrawer(tenant: string, app: string, route: string) {
  return api.get<ApiResponse<SponsorPlacement | null>>(`/t/${tenant}/sponsor-drawer/resolve?app=${encodeURIComponent(app)}&route=${encodeURIComponent(route)}`);
}

export function sponsorBeacon(tenant: string, placementId: number, kind: 'show' | 'dismiss' | 'tap') {
  return api.post<ApiResponse<boolean>>(`/t/${tenant}/sponsor-drawer/beacon`, { placement_id: placementId, kind });
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
