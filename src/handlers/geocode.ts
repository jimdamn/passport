/**
 * Address geocoding proxy - server-side because the US Census Geocoder sends
 * no CORS headers, so a browser fetch to it is silently blocked and always
 * falls through to the weaker fallback. Routing the call through our own
 * Worker sidesteps CORS entirely (server-to-server requests aren't subject
 * to it) and lets Census actually run - it handles rural county-road
 * formats ("1255 N 170 W") far better than Nominatim, which frequently has
 * no address-point data for them at all.
 *
 * Used by the Sale Day and Fresh Today pin-picker forms (RegionMap carries
 * no building footprints, so a typed address is the only way to start the
 * pin somewhere close instead of the region centroid).
 */

import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { Env } from '../types';

type AppContext = Context<{ Bindings: Env }>;

const NOT_FOUND_MSG = 'Include the full address - street, town, and state - so we can confirm it on the map.';

/** GET /geocode?q=<address> — { data: { lat, lon, matched } }. Authenticated (any signed-in user). */
export async function geocodeAddress(c: AppContext) {
  const q = c.req.query('q');
  const addr = typeof q === 'string' ? q.trim() : '';
  if (!addr) throw new HTTPException(400, { message: 'Enter an address to search.' });

  try {
    const censusRes = await fetch(
      `https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=${encodeURIComponent(addr)}&benchmark=2020&format=json`
    );
    if (censusRes.ok) {
      const censusData = await censusRes.json<any>();
      const match = censusData?.result?.addressMatches?.[0];
      if (match) {
        return c.json({ data: { lat: Number(match.coordinates.y), lon: Number(match.coordinates.x), matched: match.matchedAddress as string } });
      }
    }
  } catch (err) {
    console.error('[geocode] Census lookup failed:', err instanceof Error ? err.message : String(err));
  }

  try {
    // Nominatim's usage policy requires a descriptive User-Agent identifying
    // the application for automated (non-browser) callers.
    const nomRes = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(addr)}&format=json&limit=1&countrycodes=us`,
      { headers: { 'Accept-Language': 'en', 'User-Agent': 'KrowdKraft-Passport/1.0 (gottabuylocal@gmail.com)' } }
    );
    if (nomRes.ok) {
      const nomData = await nomRes.json<any[]>();
      if (nomData && nomData.length > 0) {
        return c.json({ data: { lat: Number(nomData[0].lat), lon: Number(nomData[0].lon), matched: nomData[0].display_name as string } });
      }
    }
  } catch (err) {
    console.error('[geocode] Nominatim lookup failed:', err instanceof Error ? err.message : String(err));
  }

  throw new HTTPException(404, { message: NOT_FOUND_MSG });
}
