import { api } from './client';
import type { ApiResponse } from '../types';

export const CLAIM_WINDOW_PRESETS = [
  { minutes: 30, label: '30 minutes' },
  { minutes: 60, label: '1 hour' },
  { minutes: 120, label: '2 hours' },
  { minutes: 240, label: '4 hours' },
  { minutes: 1440, label: '24 hours' },
  { minutes: 10080, label: '7 days' },
  { minutes: 20160, label: '14 days' },
];

export function claimWindowLabel(minutes: number): string {
  return CLAIM_WINDOW_PRESETS.find(p => p.minutes === minutes)?.label ?? `${minutes} min`;
}

export interface Deal {
  id: string;
  merchant_id: string;
  merchant_name: string | null;
  title: string;
  details: string | null;
  kredit_price: number;
  quantity_left: number;
  per_user_limit: number;
  claim_window_minutes: number;
  is_hot_deal: number;
  starts_at: number | null;
  ends_at: number | null;
}

export interface MerchantDeal extends Deal {
  is_active: number;
  created_at: number;
  times_purchased: number;
  times_redeemed: number;
  times_refunded: number;
}

export interface DealInput {
  title?: string;
  details?: string | null;
  kredit_price?: number;
  quantity?: number;
  per_user_limit?: number;
  claim_window_minutes?: number;
  is_hot_deal?: boolean;
  ends_at?: number | null;
  is_active?: boolean;
}

export interface DealPurchase {
  claim_id: string;
  claim_code: string;
  deal_title: string;
  merchant_name: string | null;
  kredits_paid: number;
  expires_at: number;
}

export interface MyDealClaim {
  id: string;
  status: 'pending' | 'claimed' | 'refunded';
  kredits_paid: number;
  expires_at: number;
  created_at: number;
  claimed_at: number | null;
  refunded_at: number | null;
  deal_title: string;
  deal_details: string | null;
  merchant_name: string | null;
  is_hot_deal: number;
}

// Member
export function getDeals(tenant: string) {
  return api.get<ApiResponse<Deal[]>>(`/t/${tenant}/deals`);
}
export function purchaseDeal(tenant: string, dealId: string) {
  return api.post<ApiResponse<DealPurchase>>(`/t/${tenant}/deals/${dealId}/claim`);
}
export function getMyDealClaims(tenant: string) {
  return api.get<ApiResponse<MyDealClaim[]>>(`/t/${tenant}/deals/mine`);
}
export function regenerateClaimCode(tenant: string, claimId: string) {
  return api.post<ApiResponse<{ claim_code: string; expires_at: number }>>(`/t/${tenant}/deals/claims/${claimId}/code`);
}

// Merchant
export function getMerchantDeals(tenant: string) {
  return api.get<ApiResponse<MerchantDeal[]>>(`/t/${tenant}/merchant/deals`);
}
export function createMerchantDeal(tenant: string, input: DealInput) {
  return api.post<ApiResponse<MerchantDeal>>(`/t/${tenant}/merchant/deals`, input);
}
export function updateMerchantDeal(tenant: string, id: string, input: DealInput) {
  return api.put<ApiResponse<MerchantDeal>>(`/t/${tenant}/merchant/deals/${id}`, input);
}
export function deleteMerchantDeal(tenant: string, id: string) {
  return api.delete<ApiResponse<{ removed: boolean; deactivated: boolean }>>(`/t/${tenant}/merchant/deals/${id}`);
}

// Admin
export function getAdminDeals(tenant: string) {
  return api.get<ApiResponse<MerchantDeal[]>>(`/t/${tenant}/admin/deals`);
}
export function adminUpdateDeal(tenant: string, id: string, input: DealInput) {
  return api.put<ApiResponse<MerchantDeal>>(`/t/${tenant}/admin/deals/${id}`, input);
}
export function adminDeleteDeal(tenant: string, id: string) {
  return api.delete<ApiResponse<{ removed: boolean; deactivated: boolean }>>(`/t/${tenant}/admin/deals/${id}`);
}
