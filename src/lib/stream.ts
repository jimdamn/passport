/**
 * Cloudflare Stream integration — Social Splash video (Increment 5). Direct
 * REST calls only (no SDK package — matches this codebase's "no npm packages
 * for HTTP" standing rule, ARCHITECTURE.md §3). All calls use STREAM_API_TOKEN
 * (account-wide Stream:Edit) except signed-playback minting, which self-signs
 * an RS256 JWT locally using a one-time-created signing key (STREAM_KEY_ID +
 * STREAM_JWK) — avoids a live Cloudflare API round-trip on every media view,
 * the same reasoning Passport already applies to its own HMAC photo tokens.
 */

import type { Env } from '../types';

const API_BASE = 'https://api.cloudflare.com/client/v4';

async function streamFetch(env: Env, path: string, init: RequestInit = {}): Promise<any> {
  const res = await fetch(`${API_BASE}/accounts/${env.STREAM_ACCOUNT_ID}/stream${path}`, {
    ...init,
    headers: {
      'Authorization': `Bearer ${env.STREAM_API_TOKEN}`,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers as Record<string, string> | undefined),
    },
  });
  const json = await res.json<{ success: boolean; result: any; errors: Array<{ message: string }> }>();
  if (!res.ok || !json.success) {
    const message = json.errors?.[0]?.message ?? `Stream API error (${res.status})`;
    throw new Error(message);
  }
  return json.result;
}

export interface DirectUpload {
  uid: string;
  uploadURL: string;
}

/** Mints a one-time direct-upload session; the client POSTs raw bytes straight to uploadURL, bypassing this Worker entirely. */
export async function createDirectUpload(env: Env, maxDurationSeconds: number): Promise<DirectUpload> {
  const result = await streamFetch(env, '/direct_upload', {
    method: 'POST',
    body: JSON.stringify({
      maxDurationSeconds,
      requireSignedURLs: true,
      expiry: new Date(Date.now() + 30 * 60 * 1000).toISOString(), // 30-minute upload window
    }),
  });
  return { uid: result.uid, uploadURL: result.uploadURL };
}

export interface VideoDetails {
  readyToStream: boolean;
  duration: number; // seconds; -1 if not yet known
}

export async function getVideoDetails(env: Env, uid: string): Promise<VideoDetails> {
  const result = await streamFetch(env, `/${uid}`);
  return {
    readyToStream: !!result.readyToStream,
    duration: typeof result.duration === 'number' ? result.duration : -1,
  };
}

function playbackDomain(env: Env): string {
  return env.STREAM_PLAYBACK_DOMAIN; // e.g. "https://customer-xxxxx.cloudflarestream.com" — same for every video on this account
}

/**
 * Self-signs an RS256 JWT for a private (requireSignedURLs) video, per
 * Cloudflare's documented recipe. The key is created once via the
 * createSigningKey utility below and stored as STREAM_KEY_ID/STREAM_JWK.
 * `downloadable` must be set for a token to authorize the MP4 download route
 * specifically - a token minted without it plays back fine (iframe/HLS/DASH)
 * but Stream rejects it with a 403 on `/downloads/*` (undocumented in the
 * REST API reference; confirmed by testing - see SOCIAL-SPLASH-BUILD-LOG.md).
 */
export async function mintSignedPlaybackToken(env: Env, uid: string, ttlSeconds: number, downloadable = false): Promise<string> {
  const jwk = JSON.parse(atob(env.STREAM_JWK));
  const key = await crypto.subtle.importKey(
    'jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']
  );
  const now = Math.floor(Date.now() / 1000);
  const b64url = (s: string) => s.replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const header = b64url(btoa(JSON.stringify({ alg: 'RS256', kid: env.STREAM_KEY_ID })));
  const payload = b64url(btoa(JSON.stringify({
    sub: uid, kid: env.STREAM_KEY_ID, exp: now + ttlSeconds, nbf: now,
    ...(downloadable ? { downloadable: true } : {}),
  })));
  const message = `${header}.${payload}`;
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(message));
  const sigB64 = b64url(btoa(String.fromCharCode(...new Uint8Array(sig))));
  return `${message}.${sigB64}`;
}

/** The signed token replaces the video UID in the path entirely — this is Stream's own convention, not a query param. */
export function signedIframeUrl(env: Env, token: string): string {
  return `${playbackDomain(env)}/${token}/iframe`;
}

export function signedDownloadUrl(env: Env, token: string): string {
  return `${playbackDomain(env)}/${token}/downloads/default.mp4`;
}

export interface DownloadStatus {
  status: 'inprogress' | 'ready' | 'none';
  url: string | null;
  percentComplete: number;
}

/** Idempotent — calling again while in-progress just returns the current status. */
export async function enableMp4Download(env: Env, uid: string): Promise<DownloadStatus> {
  const result = await streamFetch(env, `/${uid}/downloads`, { method: 'POST' });
  const d = result.default;
  return { status: d?.status ?? 'none', url: d?.url ?? null, percentComplete: d?.percentComplete ?? 0 };
}

export async function deleteStreamVideo(env: Env, uid: string): Promise<void> {
  await streamFetch(env, `/${uid}`, { method: 'DELETE' });
}

/**
 * One-time setup utility — creates the signing key pair used by
 * mintSignedPlaybackToken. Not wired to any route; run once via a local
 * script (see passport/SETUP.md), then store the result as STREAM_KEY_ID/
 * STREAM_JWK secrets. Kept here (rather than deleted after use) since a
 * future key rotation needs the exact same call.
 */
export async function createSigningKey(env: Env): Promise<{ id: string; jwk: string }> {
  const result = await streamFetch(env, '/keys', { method: 'POST' });
  return { id: result.id, jwk: result.jwk };
}
