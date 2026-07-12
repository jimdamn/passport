import { api } from './client';
import type { ApiResponse } from '../types';

// Durable guest key, per KROWDKWEST-DEVELOPMENT-PLAN.md Section 1 namespace map.
const GUEST_TOKEN_KEY = 'kk_kwest_guest';

export function getGuestToken(): string | null {
  try { return localStorage.getItem(GUEST_TOKEN_KEY); } catch { return null; }
}

export function setGuestToken(token: string | null) {
  try {
    if (token) localStorage.setItem(GUEST_TOKEN_KEY, token);
    else localStorage.removeItem(GUEST_TOKEN_KEY);
  } catch { /* localStorage unavailable (private mode etc) - guest play just won't persist across reloads */ }
}

export interface KwestHuntSummary {
  slug: string;
  name: string;
  narrative: string;
  scope: 'location_specific' | 'region_wide';
  location_label: string | null;
  status: string;
  starts_at: number;
  ends_at: number;
  sponsor_name: string;
  grand_prize_description: string;
  retro_published: number;
}

export interface KwestHuntDetail {
  id: number;
  slug: string;
  name: string;
  narrative: string;
  scope: 'location_specific' | 'region_wide';
  location_label: string | null;
  status: string;
  starts_at: number;
  ends_at: number;
  sponsor_name: string;
  grand_prize_description: string;
  rules_version: number;
  weather_paused: boolean;
  all_prizes_claimed: boolean;
  first_clue: Clue[] | null;
}

export interface Clue {
  type: 'riddle' | 'story' | 'photo' | 'local_knowledge' | 'business';
  body: string;
  media_key?: string;
}

export interface KwestRules {
  rules_version: number;
  short_disclaimer: string;
  official_rules: string;
}

export interface KwestStartResult {
  player_key: string;
  guest_token: string | null;
  current_seq: number;
  finished: boolean;
  needs_ack: boolean;
  rules_version: number;
  blocked?: string;
  message?: string;
}

export interface KwestStateResult {
  finished?: boolean;
  needs_ack?: boolean;
  rules_version?: number;
  seq?: number;
  clues?: Clue[];
  hint?: string | null;
  is_final?: boolean;
  weather_paused?: boolean;
  all_prizes_claimed?: boolean;
  is_test?: boolean;
}

export interface MinigameOffer {
  offer_id: string;
  game: 'chest_pick' | 'compass_stop' | 'scratch_off';
  tease: string;
}

export interface KwestRevealResult {
  result?: 'hit' | 'near' | 'miss' | 'already_finished';
  message?: string;
  blocked?: string;
  step_reward?: number;
  next_clues?: Clue[] | null;
  next_is_final?: boolean | null;
  minigame_offer?: MinigameOffer | null;
  finish_pending_auth?: boolean;
  finished?: boolean;
  rank?: number;
  prize_kind?: 'grand' | 'kk_rank' | 'kk_consolation' | 'none';
  prize_kredits?: number;
  grand_prize_description?: string | null;
  display_prompt?: { default_choice: 'anonymous' | 'real'; real_name: string | null; anonymous_name: string };
}

export interface KwestRetroWinner {
  rank: number;
  prize_kind: string;
  display_name: string;
}

export interface KwestRetroResult {
  published: boolean;
  hunt_name?: string;
  narrative?: string;
  grand_prize_description?: string;
  total_finishers?: number;
  winners?: KwestRetroWinner[];
}

export interface MyKwestProgress {
  slug: string;
  name: string;
  status: string;
  current_seq: number;
  finished_at: number | null;
  finish_rank: number | null;
  prize_kind: string | null;
}

function withGuestToken(body: Record<string, unknown> = {}) {
  const guestToken = getGuestToken();
  return guestToken ? { ...body, guest_token: guestToken } : body;
}

export function getKwestHunts(tenant: string) {
  return api.get<ApiResponse<KwestHuntSummary[]>>(`/t/${tenant}/kwest`);
}
export function getKwestHunt(tenant: string, slug: string) {
  return api.get<ApiResponse<KwestHuntDetail>>(`/t/${tenant}/kwest/${slug}`);
}
export function getKwestRules(tenant: string, slug: string) {
  return api.get<ApiResponse<KwestRules>>(`/t/${tenant}/kwest/${slug}/rules`);
}
export function startKwest(tenant: string, slug: string) {
  return api.post<ApiResponse<KwestStartResult>>(`/t/${tenant}/kwest/${slug}/start`, withGuestToken());
}
export function ackKwest(tenant: string, slug: string) {
  return api.post<ApiResponse<{ acknowledged: boolean; rules_version: number }>>(`/t/${tenant}/kwest/${slug}/ack`, withGuestToken());
}
export function getKwestState(tenant: string, slug: string) {
  const guestToken = getGuestToken();
  const qs = guestToken ? `?guest_token=${encodeURIComponent(guestToken)}` : '';
  return api.get<ApiResponse<KwestStateResult>>(`/t/${tenant}/kwest/${slug}/state${qs}`);
}
export function revealKwest(tenant: string, slug: string, coords: { lat?: number; lng?: number; accuracy?: number; sim_lat?: number; sim_lng?: number }) {
  return api.post<ApiResponse<KwestRevealResult>>(`/t/${tenant}/kwest/${slug}/reveal`, withGuestToken(coords));
}
export function attachKwestGuest(tenant: string, guestToken: string) {
  return api.post<ApiResponse<{ attached: boolean; reason?: string }>>(`/t/${tenant}/kwest/attach`, { guest_token: guestToken });
}
export function setKwestDisplayChoice(tenant: string, slug: string, choice: 'anonymous' | 'real') {
  return api.post<ApiResponse<{ updated: boolean; reason?: string; choice?: string; display_name?: string }>>(
    `/t/${tenant}/kwest/${slug}/display-choice`, { choice }
  );
}
export function getMyKwestProgress(tenant: string) {
  return api.get<ApiResponse<MyKwestProgress[]>>(`/t/${tenant}/kwest/mine`);
}
export function getKwestRetro(tenant: string, slug: string) {
  return api.get<ApiResponse<KwestRetroResult>>(`/t/${tenant}/kwest/${slug}/retro`);
}
export function playKwestMinigame(tenant: string, offerId: string, input: unknown) {
  return api.post<ApiResponse<{ outcome: string; game?: string; outcome_kredits?: number }>>(
    `/t/${tenant}/kwest/minigame/${offerId}`, withGuestToken({ input })
  );
}
