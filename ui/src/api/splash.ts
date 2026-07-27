import { api, getToken } from './client';
import type { ApiResponse } from '../types';

// Social Splash — private guest-content pipeline. Mirrors fresh.ts's client
// style. There is no public board for this feature (content is never shown
// on-platform), so unlike fresh.ts this file has only the owner-facing calls.

export interface SplashEligibleBusiness {
  business_id: string;
  business_name: string;
  blurb: string | null;
}

export interface SplashOffer {
  id: number;
  submission_id: number;
  consideration_type: 'credits' | 'gift_certificate';
  credits_amount: number | null;
  cert_value_cents: number | null;
  cert_description: string | null;
  status: 'open' | 'agreed' | 'passed' | 'withdrawn' | 'expired';
  expires_at: number;
  agreed_at: number | null;
  created_at: number;
}

export interface SplashSubmission {
  id: number;
  business_id: string;
  business_name: string;
  media_type: 'image' | 'video';
  duration_seconds: number | null;
  caption: string | null;
  status: 'submitted' | 'held' | 'licensed' | 'declined' | 'removed';
  held_at: number | null;
  hold_expires_at: number | null;
  licensed_at: number | null;
  declined_at: number | null;
  destroy_after: number | null;
  original_unlocked: number;
  admin_removed_reason: string | null;
  created_at: number;
  open_offer: SplashOffer | null;
}

export interface SplashTombstone {
  id: number;
  business_name: string;
  final_status: string;
  destroyed_at: number;
}

export interface SplashCertificate {
  id: number;
  business_name: string;
  value_cents: number;
  description: string;
  status: 'active' | 'redeemed';
  redeemed_at: number | null;
  created_at: number;
}

export function getSplashEligible(tenant: string) {
  return api.get<ApiResponse<SplashEligibleBusiness[]>>(`/t/${tenant}/splash/eligible`);
}

export function getMySplash(tenant: string) {
  return api.get<ApiResponse<{ submissions: SplashSubmission[]; tombstones: SplashTombstone[]; certificates: SplashCertificate[] }>>(`/t/${tenant}/splash/mine`);
}

export function respondToSplashOffer(tenant: string, offerId: number, action: 'agree' | 'pass') {
  return api.post<ApiResponse<{ id: number; status: string; certificate_code: string | null }>>(
    `/t/${tenant}/splash/offers/${offerId}/respond`, { action }
  );
}

export function regenerateSplashCertificateCode(tenant: string, certId: number) {
  return api.post<ApiResponse<{ claim_code: string }>>(`/t/${tenant}/splash/certificates/${certId}/code`);
}

export function updateSplashCaption(tenant: string, id: number, caption: string | null) {
  return api.patch<ApiResponse<{ id: number; caption: string | null }>>(`/t/${tenant}/splash/${id}/caption`, { caption });
}

export function withdrawSplash(tenant: string, id: number) {
  return api.post<ApiResponse<{ id: number; status: string; destroy_after: number }>>(`/t/${tenant}/splash/${id}/withdraw`);
}

export function getSplashMediaViewUrl(tenant: string, id: number, original?: boolean) {
  const suffix = original ? '?original=true' : '';
  return api.get<ApiResponse<{ url: string; type: 'image' | 'video' }>>(`/t/${tenant}/splash/media/${id}/view${suffix}`);
}

/**
 * Submit a photo. Bypasses the JSON `api` client wrapper (same reason as
 * uploadFreshPhoto) — a multipart FormData body needs the browser to set its
 * own Content-Type boundary, which apiFetch would otherwise clobber.
 */
export async function submitSplash(
  tenant: string, businessId: string, file: File, caption: string
): Promise<ApiResponse<SplashSubmission>> {
  const token = getToken();
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const form = new FormData();
  form.append('business_id', businessId);
  form.append('file', file);
  if (caption.trim()) form.append('caption', caption.trim());

  const res = await fetch(`/api/t/${tenant}/splash/submit`, {
    method: 'POST',
    headers,
    body: form,
    credentials: 'include',
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((body as any).error || `Upload failed: ${res.status}`);
  }
  return res.json();
}

export const SPLASH_MAX_VIDEO_SECONDS = 60;

export function requestSplashVideoUpload(tenant: string) {
  return api.post<ApiResponse<{ uid: string; upload_url: string }>>(`/t/${tenant}/splash/video/direct-upload`);
}

/**
 * Submits a video whose bytes are already sitting in Stream (uploaded
 * directly by the browser to upload_url, bypassing this Worker entirely).
 * Plain JSON body - this is how submitSplash's Content-Type dispatcher on the
 * backend tells a video submission from a multipart photo one.
 */
export function submitSplashVideo(tenant: string, businessId: string, streamUid: string, caption: string) {
  return api.post<ApiResponse<SplashSubmission>>(`/t/${tenant}/splash/submit`, {
    business_id: businessId, stream_uid: streamUid, caption: caption.trim() || undefined,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Admin (Increment 6) — mirrors api/fresh.ts's adminListFreshStands/
// adminHideFreshStand client shape.
// ─────────────────────────────────────────────────────────────────────────────

export interface AdminSplashRow extends SplashSubmission {
  kkauth_uid: number;
  owner_email: string | null;
  admin_removed_by: string | null;
}

export interface SplashConfig {
  accept_award_k: number;
  hold_days: number;
  offer_days: number;
  destroy_delay_days: number;
  max_video_seconds: number;
  fee_original_cents: number;
}

export function adminListSplash(tenant: string) {
  return api.get<ApiResponse<AdminSplashRow[]>>(`/t/${tenant}/admin/splash`);
}

export function adminRemoveSplash(tenant: string, id: number, reason: string) {
  return api.post<ApiResponse<AdminSplashRow>>(`/t/${tenant}/admin/splash/${id}/remove`, { reason });
}

export function adminGetSplashConfig(tenant: string) {
  return api.get<ApiResponse<SplashConfig>>(`/t/${tenant}/admin/splash/config`);
}

export function adminSetSplashConfig(tenant: string, patch: Partial<SplashConfig>) {
  return api.post<ApiResponse<SplashConfig>>(`/t/${tenant}/admin/splash/config`, patch);
}
