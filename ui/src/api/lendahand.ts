import { getToken } from './client';

/**
 * Lend a Hand - volunteer shifts, served by the Business Hub's API
 * (kk-business owns the volunteer tables; DISSOLUTION-PLAN §1). Browse is
 * public; claiming and My Shifts ride the resident's KKAuth bearer, which
 * kk-business verifies against the same KKAuth the whole platform shares.
 */

const BUSINESS_API = 'https://business.lakeandlocals.com/api';

export interface Shift {
  id: number;
  business_name: string;
  title: string;
  description: string;
  location: string;
  event_date: number;
  duration_hours: number;
  spots_total: number;
  spots_filled: number;
  credits_reward: number;
}

export interface MyShift {
  id: number;
  status: 'signed_up' | 'confirmed' | 'no_show' | 'cancelled';
  confirm_token: string;
  credits_awarded: number;
  title: string;
  business_name: string;
  location: string;
  event_date: number;
  duration_hours: number;
  credits_reward: number;
}

async function req<T>(path: string, init: RequestInit = {}, auth = false): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init.headers as Record<string, string> | undefined),
  };
  if (auth) {
    const token = getToken();
    if (!token) throw new Error('Please sign in.');
    headers['Authorization'] = `Bearer ${token}`;
  }
  const res = await fetch(`${BUSINESS_API}${path}`, { ...init, headers });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error || `Request failed: ${res.status}`);
  return (body as { data: T }).data;
}

export function getShifts(): Promise<Shift[]> {
  return req<Shift[]>('/public/volunteer/listings');
}

export function claimShift(listingId: number): Promise<{ signup_id: number }> {
  return req<{ signup_id: number }>('/volunteer-resident/claim', {
    method: 'POST',
    body: JSON.stringify({ listing_id: listingId }),
  }, true);
}

export function cancelMyShift(signupId: number): Promise<{ ok: boolean }> {
  return req<{ ok: boolean }>(`/volunteer-resident/shifts/${signupId}/cancel`, { method: 'POST' }, true);
}

export function getMyShifts(): Promise<MyShift[]> {
  return req<MyShift[]>('/volunteer-resident/shifts', {}, true);
}

/** The URL inside the volunteer's QR code - the organizer scans it and lands
 * on the Business Hub check-in page for this signup. */
export function checkinUrl(confirmToken: string): string {
  return `https://business.lakeandlocals.com/volunteer/checkin/${confirmToken}`;
}

// ── Steward review (admin only; kk-business enforces is_admin server-side) ──

export interface PendingShift {
  id: number;
  business_name: string;
  title: string;
  description: string;
  location: string;
  event_date: number;
  duration_hours: number;
  spots_total: number;
  credits_reward: number;
}

export function stewardPendingShifts(): Promise<PendingShift[]> {
  return req<PendingShift[]>('/steward/volunteer', {}, true);
}

export function stewardReviewShift(id: number, status: 'active' | 'rejected', note?: string): Promise<{ ok: boolean }> {
  return req<{ ok: boolean }>(`/steward/volunteer/${id}/review`, {
    method: 'POST',
    body: JSON.stringify({ status, note }),
  }, true);
}
