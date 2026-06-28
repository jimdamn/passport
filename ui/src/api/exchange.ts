import { api } from './client';
import type { ApiResponse } from '../types';

export interface ExchangeOffer {
  id: string;
  title: string;
  offer_type: string;
  location: string | null;
  created_at: number;
  category_name: string | null;
  category_icon: string | null;
  creator_label: string | null;
  interest_count: number;
  user_id: number;
  persona_type: string;
}

export async function getExchangeOffers(tenantId: string, limit = 6) {
  return api.get<ApiResponse<ExchangeOffer[]>>(`/t/${tenantId}/exchange/offers?limit=${limit}`);
}
