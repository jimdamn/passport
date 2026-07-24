import { api } from './client';
import type { ApiResponse } from '../types';

export interface ContentSummaryItem {
  id: string | number;
  title: string;
  status: string;
  hidden: boolean;
  attention: boolean;
  created_at: number;
}

export interface ContentSummarySource {
  ok: boolean;
  counts: Record<string, number>;
  recent: ContentSummaryItem[];
  attention_total: number;
}

export interface ContentSummary {
  exchange: ContentSummarySource;
  field_notes: ContentSummarySource;
  fresh: ContentSummarySource;
  sales: ContentSummarySource;
  popups: ContentSummarySource;
  meals: ContentSummarySource;
}

export async function getContentSummary(tenant: string) {
  return api.get<ApiResponse<ContentSummary>>(`/t/${tenant}/me/content-summary`);
}
