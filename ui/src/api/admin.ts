import { api } from './client';
import type { ApiResponse } from '../types';

export interface TestPlaqueResult {
  scan_url: string;
  qr_svg: string;
  lat: number;
  lon: number;
}

export function createTestPlaque(tenant: string, lat: number, lon: number) {
  return api.post<ApiResponse<TestPlaqueResult>>(`/t/${tenant}/admin/test-plaque`, { lat, lon });
}

export function removeTestPlaque(tenant: string) {
  return api.delete<ApiResponse<{ removed: boolean }>>(`/t/${tenant}/admin/test-plaque`);
}

// ── Plaques ──────────────────────────────────────────────────

export interface AdminPlaque {
  id: string;
  name: string;
  location_name: string;
  lat: number;
  lon: number;
  category: string;
  is_active: number;
  is_event: number;
  event_start: number | null;
  event_end: number | null;
  created_at: number;
  scan_count: number;
  scan_url: string;
  qr_svg: string;
}

export interface PlaqueInput {
  name: string;
  location_name: string;
  category: string;
  lat?: number;
  lon?: number;
  is_event?: boolean;
  event_start?: number | null;
  event_end?: number | null;
  is_active?: boolean;
}

export function getAdminPlaques(tenant: string) {
  return api.get<ApiResponse<AdminPlaque[]>>(`/t/${tenant}/admin/plaques`);
}

export function createAdminPlaque(tenant: string, input: PlaqueInput) {
  return api.post<ApiResponse<AdminPlaque>>(`/t/${tenant}/admin/plaques`, input);
}

export function updateAdminPlaque(tenant: string, id: string, input: Partial<PlaqueInput>) {
  return api.put<ApiResponse<AdminPlaque>>(`/t/${tenant}/admin/plaques/${id}`, input);
}

export function deleteAdminPlaque(tenant: string, id: string) {
  return api.delete<ApiResponse<{ removed: boolean; deactivated: boolean }>>(`/t/${tenant}/admin/plaques/${id}`);
}

// ── Prizes ───────────────────────────────────────────────────

export interface AdminPrize {
  id: string;
  name: string;
  prize_type: string;
  value: number;
  details: string | null;
  probability: number;
  quantity_left: number;
  is_active: number;
  plaque_id: string | null;
  plaque_name: string | null;
  is_paced: number;
  drops_total: number;
  drops_won: number;
}

export interface PrizeInput {
  name: string;
  prize_type: string;
  value?: number;
  details?: string | null;
  probability?: number;
  quantity?: number;
  plaque_id?: string | null;
  is_paced?: boolean;
  is_active?: boolean;
}

export function getAdminPrizes(tenant: string) {
  return api.get<ApiResponse<AdminPrize[]>>(`/t/${tenant}/admin/prizes`);
}

export function createAdminPrize(tenant: string, input: PrizeInput) {
  return api.post<ApiResponse<AdminPrize>>(`/t/${tenant}/admin/prizes`, input);
}

export function updateAdminPrize(tenant: string, id: string, input: Partial<PrizeInput>) {
  return api.put<ApiResponse<AdminPrize>>(`/t/${tenant}/admin/prizes/${id}`, input);
}

export function deleteAdminPrize(tenant: string, id: string) {
  return api.delete<ApiResponse<{ removed: boolean; deactivated: boolean }>>(`/t/${tenant}/admin/prizes/${id}`);
}
