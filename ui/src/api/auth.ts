import { api, apiFetch } from './client';
import type { ApiResponse, User } from '../types';

export interface AuthResult {
  access_token: string;
  is_new?: boolean;
  user: User;
}

export async function ssoLogin(params: Record<string, string>): Promise<AuthResult> {
  const res = await api.post<ApiResponse<AuthResult>>('/auth/sso', params);
  return res.data;
}

/**
 * Request an OTP - tenant_id is still passed so the Exchange adapter can
 * associate the login with the correct tenant, but KKAuth just needs email.
 */
export async function otpRequest(email: string, display_name: string, location: string, tenant_id: string) {
  return api.post('/auth/otp/request', { email, display_name, location, tenant_id });
}

export async function otpVerify(email: string, otp: string, tenant_id: string, display_name?: string, location?: string): Promise<AuthResult> {
  const res = await api.post<ApiResponse<AuthResult>>('/auth/otp/verify', { email, otp, tenant_id, display_name, location });
  return res.data;
}

export async function refreshToken(): Promise<{ access_token: string; user: Partial<User> } | null> {
  // data is null when there is no session (anonymous visitor or expired
  // cookie) - the server answers 200 either way to keep the console clean.
  const res = await apiFetch<ApiResponse<{ access_token: string; user: Partial<User> } | null>>('/auth/refresh', { method: 'POST' });
  return res.data;
}

export async function getMe(tenant_id: string): Promise<User> {
  const res = await api.get<ApiResponse<{ user: User }>>(`/auth/me?tenant_id=${tenant_id}`);
  return res.data.user;
}

export async function updateMe(tenant_id: string, fields: { display_name?: string; location?: string; bio?: string }): Promise<User> {
  const res = await api.put<ApiResponse<{ user: User }>>(`/auth/me?tenant_id=${tenant_id}`, fields);
  return res.data.user;
}

export async function logout() {
  return api.post('/auth/logout');
}
