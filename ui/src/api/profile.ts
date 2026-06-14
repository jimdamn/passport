import { api, getToken } from './client';
import type { ApiResponse, User, Review } from '../types';

export interface ProfileUpdate {
  display_name?: string;
  location?: string;
  bio?: string;
}

export interface LocationUpdate {
  home_zip_location?: string | null;
  home_distance_preference?: number | null;
}

export async function updateProfile(tenantId: string, updates: ProfileUpdate) {
  return api.put<ApiResponse<{ user: User }>>(`/auth/me?tenant_id=${tenantId}`, updates);
}

export async function updatePersona(persona: 'anonymous' | 'personal' | 'business') {
  return api.put<ApiResponse<{ active_persona: string }>>('/auth/persona', { active_persona: persona });
}

export async function getPersonalPersona(tenantId: string) {
  return api.get<{ data: { facebook_url: string|null; x_handle: string|null; linkedin_url: string|null; website_url: string|null } }>(
    `/auth/personal-persona?tenant_id=${tenantId}`
  );
}

export async function updatePersonalPersona(tenantId: string, data: {
  facebook_url?: string | null;
  x_handle?: string | null;
  linkedin_url?: string | null;
  website_url?: string | null;
}) {
  return api.put<{ data: typeof data }>(`/auth/personal-persona?tenant_id=${tenantId}`, data);
}

export async function getAnonymousPersona(tenantId: string) {
  return api.get<{ data: { display_name: string } }>(`/auth/anonymous-persona?tenant_id=${tenantId}`);
}

export async function updateAnonymousPersona(tenantId: string, display_name: string) {
  return api.put<{ data: { display_name: string } }>(`/auth/anonymous-persona?tenant_id=${tenantId}`, { display_name });
}


export async function updateLocation(updates: LocationUpdate) {
  return api.patch<{ data: { profile: {
    home_zip_location: string | null;
    home_zip_lat: number | null;
    home_zip_lon: number | null;
    home_distance_preference: number | null;
  } } }>('/auth/profile/location', updates);
}

export async function getMember(tenant: string, memberId: string) {
  return api.get<ApiResponse<{
    member: User & { bio: string | null; created_at: number };
    active_offers: Array<{
      id: string; title: string; offer_type: string;
      location: string | null; created_at: number;
      category_name: string | null; category_icon: string | null;
    }>;
  }>>(`/t/${tenant}/members/${memberId}`);
}

/**
 * Upload a profile image for the current user.
 * blob should already be resized/converted to WebP by the caller (Canvas API).
 * Sends raw binary with correct Content-Type — bypasses the JSON client wrapper.
 */
export async function uploadAvatar(
  tenantId: string,
  blob: Blob
): Promise<{ data: { avatar_url: string | null } }> {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': blob.type || 'image/webp',
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`/api/auth/profile/avatar?tenant_id=${tenantId}`, {
    method: 'POST',
    headers,
    body: blob,
    credentials: 'include',
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((body as any).error || `Upload failed: ${res.status}`);
  }

  return res.json();
}

export interface MerchantApplication {
  name: string;
  category: string;
  description?: string;
  address?: string;
  zip?: string;
  phone?: string;
  website?: string;
  lat?: number;
  lon?: number;
  hide_address?: boolean;
  hide_phone?: boolean;
}

export async function applyMerchant(application: MerchantApplication) {
  return api.post<ApiResponse<any>>('/auth/profile/apply-merchant', application);
}

export async function getAdminMerchants() {
  return api.get<ApiResponse<any[]>>('/auth/profile/admin/merchants');
}

export async function reviewMerchant(id: number, status: 'verified' | 'rejected' | 'pending') {
  return api.post<ApiResponse<any>>(`/auth/profile/admin/merchants/${id}/review`, { status });
}

export async function getMemberRatings(tenantId: string, memberId: string, limit = 20, offset = 0) {
  return api.get<ApiResponse<{
    ratings: Review[];
    rating_avg: number;
    rating_count: number;
  }>>(`/t/${tenantId}/members/${memberId}/ratings?limit=${limit}&offset=${offset}`);
}

export async function submitRating(
  tenantId:     string,
  memberId:     string,
  score:        number,
  comment?:     string | null,
  contextType?: string | null,
  contextId?:   string | null,
) {
  return api.post<ApiResponse<{ id: string }>>(`/t/${tenantId}/members/${memberId}/rate`, {
    score,
    comment:      comment      ?? null,
    context_type: contextType  ?? null,
    context_id:   contextId    ?? null,
  });
}

