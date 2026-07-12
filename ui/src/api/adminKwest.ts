import { api } from './client';
import type { ApiResponse } from '../types';

export interface AdminKwestHunt {
  id: number;
  tenant_id: string;
  slug: string;
  name: string;
  narrative: string;
  scope: 'location_specific' | 'region_wide';
  location_label: string | null;
  status: 'draft' | 'scheduled' | 'live' | 'paused' | 'ended' | 'archived';
  starts_at: number;
  ends_at: number;
  official_end_at: number | null;
  sponsor_name: string;
  sponsor_business_id: number | null;
  grand_prize_kredits: number;
  grand_prize_description: string;
  grand_prize_fulfillment: string;
  rank2_10_kredits: number;
  rank11_20_kredits: number;
  step_reward_default: number;
  minigame_offer_bp: number;
  minigame_max_award: number;
  kk_budget_cap: number;
  kk_spent: number;
  rules_version: number;
  retro_published: number;
  weather_paused: number;
  created_at: number;
  updated_at: number;
}

export interface HuntInput {
  slug?: string;
  name?: string;
  narrative?: string;
  scope?: 'location_specific' | 'region_wide';
  location_label?: string | null;
  starts_at?: number;
  ends_at?: number;
  sponsor_name?: string;
  grand_prize_kredits?: number;
  grand_prize_description?: string;
  grand_prize_fulfillment?: string;
  rank2_10_kredits?: number;
  rank11_20_kredits?: number;
  step_reward_default?: number;
  minigame_offer_bp?: number;
  minigame_max_award?: number;
  kk_budget_cap?: number;
}

export interface AdminKwestStep {
  id: number;
  hunt_id: number;
  tenant_id: string;
  seq: number;
  clues_json: string;
  hint_body: string | null;
  hint_after_misses: number;
  target_lat: number;
  target_lng: number;
  radius_m: number;
  step_reward: number | null;
  minigame_enabled: number;
  is_final: number;
  field_tested_at: number | null;
  field_tested_by: string | null;
  field_test_json: string | null;
  created_at: number;
}

export interface Clue { type: string; body: string; media_key?: string }

export interface StepInput {
  clues?: Clue[];
  hint_body?: string | null;
  hint_after_misses?: number;
  target_lat?: number;
  target_lng?: number;
  radius_m?: number;
  step_reward?: number | null;
  minigame_enabled?: boolean;
}

export interface FieldTestInput {
  accuracy_m_observed: number;
  fix_seconds: number;
  note?: string;
  public_access: boolean;
  safe: boolean;
}

export interface DashboardData {
  hunt_status: string;
  players_started: number;
  funnel: { seq: number; n: number }[];
  reveals_last_hour: number;
  per_step: { seq: number; step_id: number; hits: number; nears: number; misses: number; avg_accuracy_m: number | null }[];
  finishes: { finish_rank: number; finished_at: number; prize_kind: string; prize_kredits: number; display_name_snapshot: string; user_id: string }[];
  budget_spent: number;
  budget_cap: number;
  claim_statuses: { status: string; n: number }[];
}

export interface PlayerLookupResult {
  found: boolean;
  progress?: { current_seq: number; started_at: number; finished_at: number | null; is_test: number } | null;
  reveals?: { created_at: number; seq: number; result: string; device_lat: number; device_lng: number; accuracy_m: number | null; distance_m: number; sim: number }[];
  finish?: any;
}

export interface ClaimRow {
  finish_rank: number;
  user_id: string;
  display_name_snapshot: string;
  prize_kind: string;
  prize_kredits: number;
  finished_at: number;
  claim_id: number | null;
  claim_status: string | null;
  claimant_name: string | null;
  contact_json: string | null;
  id_check_note: string | null;
  reviewer: string | null;
  reviewed_at: number | null;
}

export function getAdminKwestHunts(tenant: string) {
  return api.get<ApiResponse<AdminKwestHunt[]>>(`/t/${tenant}/admin/kwest`);
}
export function createAdminKwestHunt(tenant: string, input: HuntInput) {
  return api.post<ApiResponse<AdminKwestHunt>>(`/t/${tenant}/admin/kwest`, input);
}
export function getAdminKwestHunt(tenant: string, id: number) {
  return api.get<ApiResponse<AdminKwestHunt>>(`/t/${tenant}/admin/kwest/${id}`);
}
export function updateAdminKwestHunt(tenant: string, id: number, input: Partial<HuntInput>) {
  return api.put<ApiResponse<AdminKwestHunt>>(`/t/${tenant}/admin/kwest/${id}`, input);
}
export function deleteAdminKwestHunt(tenant: string, id: number) {
  return api.delete<ApiResponse<{ removed: boolean }>>(`/t/${tenant}/admin/kwest/${id}`);
}
export function setAdminKwestHuntStatus(tenant: string, id: number, status: string) {
  return api.post<ApiResponse<AdminKwestHunt>>(`/t/${tenant}/admin/kwest/${id}/status`, { status });
}

export function getAdminKwestSteps(tenant: string, huntId: number) {
  return api.get<ApiResponse<AdminKwestStep[]>>(`/t/${tenant}/admin/kwest/${huntId}/steps`);
}
export function createAdminKwestStep(tenant: string, huntId: number, input: StepInput) {
  return api.post<ApiResponse<AdminKwestStep>>(`/t/${tenant}/admin/kwest/${huntId}/steps`, input);
}
export function updateAdminKwestStep(tenant: string, stepId: number, input: Partial<StepInput>) {
  return api.put<ApiResponse<AdminKwestStep>>(`/t/${tenant}/admin/kwest/steps/${stepId}`, input);
}
export function deleteAdminKwestStep(tenant: string, stepId: number) {
  return api.delete<ApiResponse<{ removed: boolean }>>(`/t/${tenant}/admin/kwest/steps/${stepId}`);
}
export function reorderAdminKwestSteps(tenant: string, huntId: number, orderedStepIds: number[]) {
  return api.post<ApiResponse<AdminKwestStep[]>>(`/t/${tenant}/admin/kwest/${huntId}/steps/reorder`, { ordered_step_ids: orderedStepIds });
}
export function recordAdminKwestFieldTest(tenant: string, stepId: number, input: FieldTestInput) {
  return api.post<ApiResponse<AdminKwestStep>>(`/t/${tenant}/admin/kwest/steps/${stepId}/field-test`, input);
}

export function createAdminKwestTestRun(tenant: string, huntId: number) {
  return api.post<ApiResponse<{ reset: boolean; player_key: string }>>(`/t/${tenant}/admin/kwest/${huntId}/test-run`, {});
}
export function runAdminKwestHealthCheck(tenant: string, huntId: number) {
  return api.post<ApiResponse<{ ok: boolean; reason?: string; message?: string; checked_step_seq?: number; distance_m?: number; radius_m?: number }>>(
    `/t/${tenant}/admin/kwest/${huntId}/health-check`, {}
  );
}
export function getAdminKwestDashboard(tenant: string, huntId: number) {
  return api.get<ApiResponse<DashboardData>>(`/t/${tenant}/admin/kwest/${huntId}/dashboard`);
}
export function lookupAdminKwestPlayer(tenant: string, huntId: number, email: string) {
  return api.get<ApiResponse<PlayerLookupResult>>(`/t/${tenant}/admin/kwest/${huntId}/players?email=${encodeURIComponent(email)}`);
}
export function getAdminKwestClaims(tenant: string, huntId: number) {
  return api.get<ApiResponse<ClaimRow[]>>(`/t/${tenant}/admin/kwest/${huntId}/claims`);
}
export function updateAdminKwestClaim(tenant: string, claimId: number, input: { status: string; id_check_note?: string; claimant_name?: string }) {
  return api.post<ApiResponse<any>>(`/t/${tenant}/admin/kwest/claims/${claimId}`, input);
}
export function setAdminKwestRetroPublished(tenant: string, huntId: number, published: boolean) {
  return api.post<ApiResponse<{ retro_published: boolean }>>(`/t/${tenant}/admin/kwest/${huntId}/retro`, { published });
}
export function setAdminKwestWeatherPause(tenant: string, huntId: number, paused: boolean) {
  return api.post<ApiResponse<{ weather_paused: boolean }>>(`/t/${tenant}/admin/kwest/${huntId}/weather-pause`, { paused });
}
