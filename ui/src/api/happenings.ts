import { api } from './client';
import type { ApiResponse } from '../types';

export const HAPPENING_CATEGORIES = [
  { key: 'live_music', label: 'Live Music' },
  { key: 'markets', label: 'Markets' },
  { key: 'food_drink', label: 'Food & Drink' },
  { key: 'sales', label: 'Sales' },
  { key: 'community', label: 'Community' },
  { key: 'family', label: 'Family' },
  { key: 'outdoors', label: 'Outdoors' },
  { key: 'arts', label: 'Arts' },
] as const;

export type HappeningCategory = typeof HAPPENING_CATEGORIES[number]['key'];

export function categoryLabel(key: string): string {
  return HAPPENING_CATEGORIES.find(c => c.key === key)?.label ?? key;
}

// Public board shape — contact fields already gated by the merchant's show flags.
export interface Happening {
  id: string;
  category: string;
  body: string;
  photo_url: string | null;
  starts_at: number | null;
  expires_at: number;
  created_at: number;
  merchant_name: string | null;
  merchant_address: string | null;
  merchant_lat: number | null;
  merchant_lon: number | null;
  merchant_phone: string | null;
  merchant_website: string | null;
  deal: { id: string; title: string } | null;
}

// Merchant/admin shape — full row plus attached-deal info.
export interface MerchantHappening {
  id: string;
  merchant_id: string;
  merchant_name: string | null;
  merchant_phone: string | null;
  merchant_address: string | null;
  merchant_website: string | null;
  merchant_lat: number | null;
  merchant_lon: number | null;
  show_name: number;
  show_address: number;
  show_phone: number;
  category: string;
  body: string;
  photo_url: string | null;
  starts_at: number | null;
  expires_at: number;
  is_active: number;
  created_at: number;
  deal_id: string | null;
  deal_title: string | null;
}

export interface HappeningInput {
  body?: string;
  category?: string;
  photo_url?: string | null;
  starts_at?: number | null;
  show_name?: boolean;
  show_address?: boolean;
  show_phone?: boolean;
  deal_id?: string | null;
  is_active?: boolean;
}

// Public
export function getHappenings(tenant: string, category?: string) {
  const q = category ? `?category=${encodeURIComponent(category)}` : '';
  return api.get<ApiResponse<Happening[]>>(`/t/${tenant}/happenings${q}`);
}

// Merchant
export function getMerchantHappenings(tenant: string) {
  return api.get<ApiResponse<MerchantHappening[]>>(`/t/${tenant}/merchant/happenings`);
}
export function createHappening(tenant: string, input: HappeningInput) {
  return api.post<ApiResponse<MerchantHappening>>(`/t/${tenant}/merchant/happenings`, input);
}
export function updateHappening(tenant: string, id: string, input: HappeningInput) {
  return api.put<ApiResponse<MerchantHappening>>(`/t/${tenant}/merchant/happenings/${id}`, input);
}
export function deleteHappening(tenant: string, id: string) {
  return api.delete<ApiResponse<{ removed: boolean }>>(`/t/${tenant}/merchant/happenings/${id}`);
}

// Admin
export function getAdminHappenings(tenant: string) {
  return api.get<ApiResponse<MerchantHappening[]>>(`/t/${tenant}/admin/happenings`);
}
export function adminUpdateHappening(tenant: string, id: string, input: HappeningInput) {
  return api.put<ApiResponse<MerchantHappening>>(`/t/${tenant}/admin/happenings/${id}`, input);
}
export function adminDeleteHappening(tenant: string, id: string) {
  return api.delete<ApiResponse<{ removed: boolean }>>(`/t/${tenant}/admin/happenings/${id}`);
}
