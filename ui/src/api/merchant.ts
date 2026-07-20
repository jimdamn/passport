import { api } from './client';
import type { ApiResponse } from '../types';

export interface MerchantPrize {
  id: string;
  name: string;
  prize_type: string;
  value: number;
  details: string | null;
  probability: number;
  quantity_left: number;
  is_active: number;
  times_won: number;
  times_redeemed: number;
}

export interface MerchantPrizeInput {
  name: string;
  prize_type: string;
  value?: number;
  details?: string | null;
  probability?: number;
  quantity?: number;
  is_active?: boolean;
}

export interface MerchantClaim {
  status: 'pending' | 'claimed' | 'expired';
  contact_info: string | null;
  created_at: number;
  expires_at: number;
  prize_name: string;
  prize_type: string;
  plaque_name: string;
}

export function getMyPrizes(tenant: string) {
  return api.get<ApiResponse<MerchantPrize[]>>(`/t/${tenant}/merchant/prizes`);
}

export function createMyPrize(tenant: string, input: MerchantPrizeInput) {
  return api.post<ApiResponse<MerchantPrize>>(`/t/${tenant}/merchant/prizes`, input);
}

export function updateMyPrize(tenant: string, id: string, input: Partial<MerchantPrizeInput>) {
  return api.put<ApiResponse<MerchantPrize>>(`/t/${tenant}/merchant/prizes/${id}`, input);
}

export function deleteMyPrize(tenant: string, id: string) {
  return api.delete<ApiResponse<{ removed: boolean; deactivated: boolean }>>(`/t/${tenant}/merchant/prizes/${id}`);
}

export function getMyClaims(tenant: string) {
  return api.get<ApiResponse<MerchantClaim[]>>(`/t/${tenant}/merchant/claims`);
}

export interface BusinessProfile {
  id: number;
  name: string;
  category: string;
  description: string | null;
  address: string | null;
  zip: string | null;
  lat: number | null;
  lon: number | null;
  phone: string | null;
  website: string | null;
  hide_address: number;
  hide_phone: number;
  verification_status: string;
  created_at: string;
}

export function getMyBusiness(tenant: string) {
  return api.get<ApiResponse<BusinessProfile>>(`/t/${tenant}/merchant/business`);
}

export interface BusinessUpdateInput {
  category?: string;
  phone?: string;
  address?: string;
  zip?: string;
  lat?: number;
  lon?: number;
  hide_address?: boolean;
}

export function updateMyBusiness(tenant: string, updates: BusinessUpdateInput) {
  return api.patch<ApiResponse<BusinessProfile>>(`/t/${tenant}/merchant/business`, updates);
}
