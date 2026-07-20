import { api } from './client';
import type { ApiResponse } from '../types';

export interface AdminUserRow {
  id: number;
  email: string;
  display_name: string | null;
  created_at: string;
  is_active: number;
  suspended_at: number | null;
  suspended_reason: string | null;
  business_name: string | null;
  business_status: string | null;
}

export interface AdminUsersPage {
  users: AdminUserRow[];
  next_cursor: string | null;
}

export function getAdminUsers(params: {
  segment: 'general' | 'business';
  q?: string;
  from?: string;
  to?: string;
  cursor?: string | null;
  limit?: number;
}) {
  const qs = new URLSearchParams();
  qs.set('segment', params.segment);
  if (params.q) qs.set('q', params.q);
  if (params.from) qs.set('from', params.from);
  if (params.to) qs.set('to', params.to);
  if (params.cursor) qs.set('cursor', params.cursor);
  qs.set('limit', String(params.limit ?? 25));
  return api.get<ApiResponse<AdminUsersPage>>(`/auth/profile/admin/users?${qs}`);
}

export function suspendUser(id: number, reason?: string) {
  return api.post<ApiResponse<{ user: AdminUserRow }>>(`/auth/profile/admin/users/${id}/suspend`, { reason });
}

export function unsuspendUser(id: number) {
  return api.post<ApiResponse<{ user: AdminUserRow }>>(`/auth/profile/admin/users/${id}/unsuspend`, {});
}
