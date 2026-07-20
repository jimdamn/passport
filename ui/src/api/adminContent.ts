import { api } from './client';
import type { ApiResponse } from '../types';

export interface AdminExchangeOfferRow {
  id: string;
  niche_id: string;
  niche_name: string;
  niche_slug: string;
  offer_type: string;
  title: string;
  status: string;
  is_published: number;
  zip_code: string | null;
  hidden_by: 'owner' | 'admin' | null;
  hidden_reason: string | null;
  created_at: number;
  owner_kkauth_uid: number;
  owner_display_name: string;
  owner_email: string;
}

export interface AdminFieldNotesStoryRow {
  id: number;
  title: string;
  status: string;
  hidden: number;
  hidden_by: 'owner' | 'admin' | null;
  hidden_reason: string | null;
  author_name: string;
  author_uid: number;
  submitted_at: number;
  category_name: string | null;
}

export interface ContentFilterParams {
  q?: string;
  from?: string;
  to?: string;
  status?: string;
  cursor?: string | null;
  limit?: number;
}

export function getAdminExchangeOffers(tenant: string, params: ContentFilterParams) {
  const qs = new URLSearchParams();
  if (params.q) qs.set('q', params.q);
  if (params.from) qs.set('from', params.from);
  if (params.to) qs.set('to', params.to);
  if (params.status) qs.set('status', params.status);
  if (params.cursor) qs.set('cursor', params.cursor);
  qs.set('limit', String(params.limit ?? 25));
  qs.set('include_hidden', '1');
  return api.get<ApiResponse<{ offers: AdminExchangeOfferRow[]; next_cursor: string | null }>>(
    `/t/${tenant}/admin/content/exchange?${qs}`
  );
}

export function getAdminFieldNotesStories(tenant: string, params: ContentFilterParams) {
  const qs = new URLSearchParams();
  if (params.q) qs.set('q', params.q);
  if (params.from) qs.set('from', params.from);
  if (params.to) qs.set('to', params.to);
  if (params.status) qs.set('status', params.status);
  qs.set('limit', String(params.limit ?? 25));
  qs.set('offset', params.cursor ? params.cursor : '0');
  return api.get<ApiResponse<{ stories: AdminFieldNotesStoryRow[]; total: number }>>(
    `/t/${tenant}/admin/content/field-notes?${qs}`
  );
}

export function setExchangeVisibility(tenant: string, id: string, niche: string, published: boolean, reason?: string) {
  return api.post<ApiResponse<{ offer: AdminExchangeOfferRow }>>(
    `/t/${tenant}/admin/content/exchange/${id}/visibility`,
    { published, niche, reason }
  );
}

export function setFieldNotesVisibility(tenant: string, id: number, hidden: boolean, reason?: string) {
  return api.post<ApiResponse<{ story: AdminFieldNotesStoryRow }>>(
    `/t/${tenant}/admin/content/field-notes/${id}/visibility`,
    { hidden, reason }
  );
}
