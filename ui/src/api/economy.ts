import { api } from './client';
import type { ApiResponse } from '../types';

// Economy admin route (increment 1) - typed client for GET/preview/apply.
// Preview and apply both round-trip through the server's shared
// computePlan/classifyEconomyValue path (src/handlers/economy.ts) - this
// file never recomputes a value itself, only sends the modifier and renders
// whatever the server returns.

export type EconomySourceKind =
  | 'kkgame_action' | 'kkgame_quest' | 'kwest_defaults'
  | 'passport_tenant_config' | 'exchange_tenant_config' | 'hunt_tiers';

export type EconomyRowStatus = 'ok' | 'unavailable' | 'orphaned';

export interface EconomyValueRow {
  id: string;
  source_kind: EconomySourceKind;
  source_ref: string;
  tenant_id: string | null;
  baseline: number;
  computed: number;
  live: number | null;
  drift: boolean;
  status: EconomyRowStatus;
  group_key?: string;
  label?: string;
  clue?: string;
  rate_note?: string | null;
  sort_order?: number;
}

export interface EconomyGuardRow {
  key: string;
  label: string;
  value: string;
  home: string;
  deployTarget: string;
  ratioNow: string | null;
  ratioAtBaseline: string | null;
  outOfBand: boolean;
}

export interface EconomyView {
  modifier: number;
  values: EconomyValueRow[];
  guards: EconomyGuardRow[];
}

export type EconomyApplyOutcome = 'applied' | 'partial' | 'failed';

export interface EconomyApplyResult extends EconomyView {
  outcome: EconomyApplyOutcome;
  per_target: Record<string, 'ok' | 'failed'>;
}

export function getEconomy(tenant: string) {
  return api.get<ApiResponse<EconomyView>>(`/t/${tenant}/admin/economy`);
}

export function previewEconomy(tenant: string, modifier: number) {
  return api.post<ApiResponse<EconomyView>>(`/t/${tenant}/admin/economy/preview`, { modifier });
}

export function applyEconomy(tenant: string, modifier: number) {
  return api.post<ApiResponse<EconomyApplyResult>>(`/t/${tenant}/admin/economy/apply`, { modifier });
}
