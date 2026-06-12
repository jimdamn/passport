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
