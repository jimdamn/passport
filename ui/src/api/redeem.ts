import { api } from './client';
import type { ApiResponse } from '../types';

export interface ClaimLookup {
  status: 'pending' | 'claimed' | 'expired';
  redeemable: boolean;
  prize: {
    name: string;
    prize_type: string;
    value: number;
    details: string | null;
  };
  plaque_name: string;
  location_name: string;
  contact_info: string | null;
  created_at: number;
  expires_at: number;
}

export function lookupClaim(tenant: string, claimCode: string) {
  return api.post<ApiResponse<ClaimLookup>>(`/t/${tenant}/redeem/lookup`, { claim_code: claimCode });
}

export function confirmClaim(tenant: string, claimCode: string) {
  return api.post<ApiResponse<ClaimLookup>>(`/t/${tenant}/redeem/confirm`, { claim_code: claimCode });
}
