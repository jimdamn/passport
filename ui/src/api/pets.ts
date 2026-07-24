import { api, getToken } from './client';
import type { ApiResponse } from '../types';

// Home Safe — lost-and-found pet posts. Mirrors api/sales.ts's style (the
// one-table donor). Backend is the source of truth for PET_TYPES/PET_SPECIES
// (src/handlers/pets.ts) - kept in sync by hand, same reasoning fresh.ts's/
// sales.ts's UI clients document for their own copies.

export const PET_TYPES = [
  { key: 'lost', label: 'Lost' },
  { key: 'found', label: 'Found' },
] as const;

export const PET_SPECIES = [
  { key: 'dog', label: 'Dog' },
  { key: 'cat', label: 'Cat' },
  { key: 'bird', label: 'Bird' },
  { key: 'small_pet', label: 'Small Pet' },
  { key: 'horse_livestock', label: 'Horse & Livestock' },
  { key: 'other', label: 'Other' },
] as const;

export type PetType = typeof PET_TYPES[number]['key'];
export type PetSpecies = typeof PET_SPECIES[number]['key'];

export function speciesLabel(key: string): string {
  return PET_SPECIES.find(s => s.key === key)?.label ?? key;
}

// Mirrored from src/handlers/fresh.ts REGION_CENTER/REGION_BOUNDS (same
// values pets.ts imports from fresh.ts on the backend) - kept as a plain
// constant here, same reasoning api/fresh.ts/api/sales.ts document for their
// own copies.
export const REGION_CENTER = { lat: 41.55, lon: -85.45 };
export const REGION_BOUNDS: [[number, number], [number, number]] = [
  [-86.3485, 40.9012],
  [-84.4557, 42.1392],
];

export type PetStatus = 'looking' | 'archived' | 'home_safe';
export type OwnerPetState = PetStatus | 'hidden_by_admin' | 'removed';

// ─────────────────────────────────────────────────────────────────────────────
// Public — GET /api/t/:tenant/pets, /pets/pins, /pets/:id
// ─────────────────────────────────────────────────────────────────────────────

// Masked posts (contact_public = false) never carry phone/email - only the
// has_phone/has_email booleans. contact_public posts carry phone/email
// directly, the old inline behavior. Both are optional here so one type
// covers both shapes.
export interface PetFeedRow {
  id: string;
  type: PetType;
  species: PetSpecies;
  pet_name: string | null;
  body: string;
  lat: number;
  lon: number;
  location_hint: string | null;
  seen_date: string | null;
  photo_url: string | null;
  nearest_city: string | null;
  nearest_state: string | null;
  contact_public: boolean;
  created_at: number;
  active_until: number;
  resolved_at: number | null;
  status: PetStatus;
  phone?: string;
  email?: string | null;
  has_phone?: boolean;
  has_email?: boolean;
}

export interface PetPin {
  id: string;
  lat: number;
  lon: number;
  type: PetType;
  species: PetSpecies;
  pet_name: string | null;
  location_hint: string | null;
  nearest_city: string | null;
  status: PetStatus;
  kind: 'amber' | 'green';
}

export function listPetPosts(tenant: string, type?: string, species?: string) {
  const params = new URLSearchParams();
  if (type) params.set('type', type);
  if (species) params.set('species', species);
  const q = params.toString();
  return api.get<ApiResponse<PetFeedRow[]>>(`/t/${tenant}/pets${q ? `?${q}` : ''}`);
}

export function listPetPins(tenant: string) {
  return api.get<ApiResponse<PetPin[]>>(`/t/${tenant}/pets/pins`);
}

export function getPetPost(tenant: string, id: string) {
  return api.get<ApiResponse<PetFeedRow>>(`/t/${tenant}/pets/${id}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Authenticated — GET /pets/mine and owner CRUD ("My Posts")
// ─────────────────────────────────────────────────────────────────────────────

export interface PetReveal {
  display_name: string;
  created_at: number;
}

export interface MyPetPost {
  id: string;
  type: PetType;
  species: PetSpecies;
  pet_name: string | null;
  body: string;
  lat: number;
  lon: number;
  location_hint: string | null;
  seen_date: string | null;
  phone: string | null;
  email: string | null;
  contact_public: boolean;
  photo_url: string | null;
  nearest_city: string | null;
  nearest_state: string | null;
  active_until: number;
  renewed_at: number | null;
  resolved_at: number | null;
  admin_hidden_reason: string | null;
  created_at: number;
  updated_at: number;
  state: OwnerPetState;
  state_note: string;
  reveal_count: number;
  reveals: PetReveal[];
}

export interface PetInput {
  type: string;
  species: string;
  pet_name?: string | null;
  body: string;
  lat: number;
  lon: number;
  location_hint?: string | null;
  seen_date?: string | null;
  phone?: string | null;
  email?: string | null;
  contact_public?: boolean;
  photo_url?: string | null;
}

export function listMyPetPosts(tenant: string) {
  return api.get<ApiResponse<{ posts: MyPetPost[] }>>(`/t/${tenant}/pets/mine`);
}

/** Upload a pet photo. Same multipart bypass as api/sales.ts's uploadSalePhoto. */
export async function uploadPetPhoto(tenant: string, file: File): Promise<ApiResponse<{ url: string | null }>> {
  const token = getToken();
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const form = new FormData();
  form.append('file', file);

  const res = await fetch(`/api/t/${tenant}/pets/upload`, {
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

export function createPetPost(tenant: string, body: PetInput) {
  return api.post<ApiResponse<MyPetPost>>(`/t/${tenant}/pets`, body);
}

export function updatePetPost(tenant: string, id: string, body: Partial<PetInput>) {
  return api.put<ApiResponse<MyPetPost>>(`/t/${tenant}/pets/posts/${id}`, body);
}

export function resolvePetPost(tenant: string, id: string) {
  return api.post<ApiResponse<MyPetPost>>(`/t/${tenant}/pets/posts/${id}/home-safe`);
}

export function renewPetPost(tenant: string, id: string) {
  return api.post<ApiResponse<MyPetPost>>(`/t/${tenant}/pets/posts/${id}/renew`);
}

export function deletePetPost(tenant: string, id: string) {
  return api.delete<ApiResponse<{ removed: boolean }>>(`/t/${tenant}/pets/posts/${id}`);
}

export interface PetContactReveal {
  phone: string | null;
  email: string | null;
  poster_note: string;
}

export function revealPetContact(tenant: string, id: string) {
  return api.post<ApiResponse<PetContactReveal>>(`/t/${tenant}/pets/posts/${id}/contact`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Admin — GET /admin/pets, POST /admin/pets/:id/hide
// ─────────────────────────────────────────────────────────────────────────────

export interface AdminPetRow {
  id: string;
  type: PetType;
  species: PetSpecies;
  pet_name: string | null;
  body: string;
  lat: number;
  lon: number;
  active_until: number;
  resolved_at: number | null;
  admin_hidden: 0 | 1;
  admin_hidden_reason: string | null;
  deleted_at: number | null;
  created_at: number;
  owner_email: string | null;
}

export function adminListPetPosts(tenant: string) {
  return api.get<ApiResponse<AdminPetRow[]>>(`/t/${tenant}/admin/pets`);
}

export function adminHidePetPost(tenant: string, id: string, hidden: boolean, reason?: string) {
  return api.post<ApiResponse<AdminPetRow>>(`/t/${tenant}/admin/pets/${id}/hide`, { hidden, reason });
}
