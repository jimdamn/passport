/**
 * KrowdKwest hunt-creation defaults. Lives in tenants.config under a `kwest`
 * key, the same place and shape as splash-config.ts, per the 2026-07-26
 * decision that tunable config is tenants.config and not KV or module
 * constants (ARCHITECTURE.md:1101).
 *
 * These set what a NEW hunt is created with. A hunt snapshots them at
 * creation and is never rescaled afterwards: a running hunt's grand prize
 * must not change under people who already entered.
 */
import type { Env } from '../types';

export interface KwestDefaults {
  step_reward_default: number;
  rank2_10_kredits: number;
  rank11_20_kredits: number;
  grand_prize_kredits: number;
  minigame_max_award: number;
}

export const KWEST_DEFAULTS: KwestDefaults = {
  step_reward_default: 2,
  rank2_10_kredits: 10,
  rank11_20_kredits: 2,
  grand_prize_kredits: 25,
  minigame_max_award: 2,
};

export async function getKwestDefaults(env: Env, tenantId: string): Promise<KwestDefaults> {
  const row = await env.DB.prepare('SELECT config FROM tenants WHERE id = ?')
    .bind(tenantId).first<{ config: string }>();
  const config = JSON.parse(row?.config || '{}');
  return { ...KWEST_DEFAULTS, ...(config.kwest ?? {}) };
}

export async function setKwestDefaults(
  env: Env, tenantId: string, patch: Partial<KwestDefaults>,
): Promise<KwestDefaults> {
  const row = await env.DB.prepare('SELECT config, hostname FROM tenants WHERE id = ?')
    .bind(tenantId).first<{ config: string; hostname: string }>();
  if (!row) throw new Error('Tenant not found');

  const config = JSON.parse(row.config || '{}');
  const merged: KwestDefaults = { ...KWEST_DEFAULTS, ...(config.kwest ?? {}), ...patch };
  config.kwest = merged;

  await env.DB.prepare('UPDATE tenants SET config = ? WHERE id = ?')
    .bind(JSON.stringify(config), tenantId).run();
  await Promise.all([
    env.PASSPORT_CONFIG.delete(`tenant:slug:${tenantId}`),
    env.PASSPORT_CONFIG.delete(`tenant:host:${row.hostname}`),
  ]);
  return merged;
}
