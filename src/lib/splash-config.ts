/**
 * Social Splash — admin-tunable config (Increment 6, step 3a). Values live in
 * the same `tenants.config` JSON column every other tenant setting already
 * uses (sponsors.ts's adminGetSponsorFeature/adminSetSponsorFeature is the
 * pattern this copies), nested under a `splash` key so they don't collide
 * with unrelated top-level config fields. Shared between splash.ts and
 * splash-internal.ts (one feature split across two files for auth-boundary
 * reasons, not two independent features) - unlike the sponsor toggles, which
 * are deliberately duplicated per module, these numbers must be identical
 * wherever either file reads them, so a shared helper is correct here.
 *
 * Read at request time, not cached in module scope - a config change takes
 * effect on the very next request once the KV cache invalidation below runs,
 * same as adminSetSponsorFeature.
 */

import type { Env } from '../types';

export interface SplashConfig {
  accept_award_k: number;
  hold_days: number;
  offer_days: number;
  destroy_delay_days: number;
  max_video_seconds: number;
  fee_original_cents: number;
}

export const SPLASH_CONFIG_DEFAULTS: SplashConfig = {
  accept_award_k: 25,
  hold_days: 30,
  offer_days: 14,
  destroy_delay_days: 7,
  max_video_seconds: 60,
  fee_original_cents: 199,
};

export async function getSplashConfig(env: Env, tenantId: string): Promise<SplashConfig> {
  const row = await env.DB.prepare('SELECT config FROM tenants WHERE id = ?').bind(tenantId).first<{ config: string }>();
  const config = JSON.parse(row?.config || '{}');
  return { ...SPLASH_CONFIG_DEFAULTS, ...(config.splash ?? {}) };
}

/** Merges `patch` over the current config and invalidates both resolveTenant KV cache keys, same as adminSetSponsorFeature. */
export async function setSplashConfig(env: Env, tenantId: string, patch: Partial<SplashConfig>): Promise<SplashConfig> {
  const row = await env.DB.prepare('SELECT config, hostname FROM tenants WHERE id = ?').bind(tenantId).first<{ config: string; hostname: string }>();
  if (!row) throw new Error('Tenant not found');

  const config = JSON.parse(row.config || '{}');
  const merged: SplashConfig = { ...SPLASH_CONFIG_DEFAULTS, ...(config.splash ?? {}), ...patch };
  config.splash = merged;

  await env.DB.prepare('UPDATE tenants SET config = ? WHERE id = ?').bind(JSON.stringify(config), tenantId).run();
  await Promise.all([
    env.PASSPORT_CONFIG.delete(`tenant:slug:${tenantId}`),
    env.PASSPORT_CONFIG.delete(`tenant:host:${row.hostname}`),
  ]);
  return merged;
}
