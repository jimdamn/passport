import { api } from './client';
import type { ApiResponse } from '../types';

export const SUPPORT_CATEGORIES = [
  { value: 'problem', label: "Something's broken" },
  { value: 'question', label: 'I have a question' },
  { value: 'idea', label: 'I have an idea' },
  { value: 'business', label: 'I own a business' },
] as const;

export const SUPPORT_STATUS_LABEL: Record<string, string> = {
  new: 'Received',
  seen: 'In review',
  resolved: 'Resolved',
};

export interface SupportMessage {
  id: number;
  tenant_id: string;
  kkauth_uid: number | null;
  email: string | null;
  source_app: string;
  category: string;
  body: string;
  route: string | null;
  user_agent: string | null;
  status: 'new' | 'seen' | 'resolved';
  admin_note: string | null;
  created_at: number;
}

export interface SupportInput {
  category: string;
  body: string;
  email?: string;
  route?: string;
}

// Public - logged out submitters must include email.
export function submitSupport(tenant: string, input: SupportInput) {
  return api.post<ApiResponse<SupportMessage>>(`/t/${tenant}/support`, input);
}

// Member
export function getMySupport(tenant: string) {
  return api.get<ApiResponse<SupportMessage[]>>(`/t/${tenant}/support/mine`);
}

// Admin
export function getAdminSupport(tenant: string, status: string) {
  return api.get<ApiResponse<SupportMessage[]>>(`/t/${tenant}/admin/support?status=${status}`);
}
export function getAdminSupportCount(tenant: string) {
  return api.get<ApiResponse<{ new_count: number }>>(`/t/${tenant}/admin/support/count`);
}
export function adminUpdateSupport(tenant: string, id: number, input: { status?: string; admin_note?: string }) {
  return api.patch<ApiResponse<SupportMessage>>(`/t/${tenant}/admin/support/${id}`, input);
}
