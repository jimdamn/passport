import { api } from './client';
import type { ApiResponse } from '../types';

// Address-to-pin geocoding, used by the Sale Day and Fresh Today pin-picker
// forms. Proxied through our own backend (src/handlers/geocode.ts) rather
// than calling Census/Nominatim directly from the browser - the US Census
// Geocoder sends no CORS headers, so a direct browser fetch to it is
// silently blocked and always falls through to the weaker Nominatim-only
// path.

export interface GeocodeResult {
  lat: number;
  lon: number;
  matched: string;
}

export function geocodeAddress(tenant: string, query: string) {
  return api.get<ApiResponse<GeocodeResult>>(`/t/${tenant}/geocode?q=${encodeURIComponent(query)}`);
}
