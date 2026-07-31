/**
 * The concrete `EconomyClients` implementation - the actual read/apply calls
 * that fan out to KKGame, Exchange and Passport's own D1 for the economy
 * admin route. `economy-registry.ts` only knows the `EconomyClients`
 * interface and is tested against fakes; this file is the one place that
 * knows how to really reach each service.
 */
import type { Env } from '../types';
import type { EconomyClients } from './economy-registry';
import { exchangeBaseUrl } from './exchange';
import { KWEST_DEFAULTS, setKwestDefaults, type KwestDefaults } from './kwest-defaults';

const KWEST_DEFAULT_KEYS = Object.keys(KWEST_DEFAULTS) as Array<keyof KwestDefaults>;

// - KKGame - reachable via Service Binding -

async function kkgameRead(env: Env): Promise<Array<{ ref: string; kind: string; credits: number }>> {
  const res = await env.KKGAME.fetch(
    new Request('https://kkgame/internal/economy/values', {
      headers: { 'X-Internal-Secret': env.INTERNAL_SECRET },
    })
  );
  if (!res.ok) throw new Error(`KKGame economy read failed: ${res.status}`);
  const json = await res.json<{ data: { values: Array<{ ref: string; kind: string; credits: number }> } }>();
  return json.data.values;
}

async function kkgameApply(env: Env, values: Array<{ ref: string; kind: string; credits: number }>): Promise<void> {
  const res = await env.KKGAME.fetch(
    new Request('https://kkgame/internal/economy/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Internal-Secret': env.INTERNAL_SECRET },
      body: JSON.stringify({ values }),
    })
  );
  if (!res.ok) throw new Error(`KKGame economy apply failed: ${res.status}`);
}

// - Exchange - a Cloudflare Pages project, not a Worker, so it has no
// Service Binding target (see src/lib/exchange.ts). Reached over public
// HTTPS instead, same as every other Passport-to-Exchange call in this repo.
//
// Auth is X-Economy-Key / ECONOMY_API_KEY, NOT X-Internal-Secret. A security
// review found that sending the fleet-wide INTERNAL_SECRET over a public
// HTTPS call to an operator-settable URL meant that one secret also
// authorised rewriting every tenant's credit config - far more reach than
// this one call needs. Exchange's economy endpoints now only accept
// X-Economy-Key, so this client must use the same dedicated key. -

const ECONOMY_ALLOWED_HOST_SUFFIX = '.lakeandlocals.com';

/**
 * Guards the Exchange base URL before any economy call leaves this process.
 * EXCHANGE_BASE_URL is an operator-settable override with no allowlist of
 * its own (see src/lib/exchange.ts) - without this check, a mis-set env var
 * would send X-Economy-Key to an arbitrary host. Exported so it is directly
 * testable.
 *
 * The suffix check is `endsWith('.lakeandlocals.com')` with the leading dot,
 * not `includes('lakeandlocals.com')` - a naive includes() would accept
 * `https://lakeandlocals.com.evil.com`, whose hostname merely contains the
 * allowed domain as a substring rather than actually being a subdomain of it.
 */
export function assertAllowedEconomyHost(rawUrl: string): void {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    console.error(`[economy] rejected unparseable Exchange base URL: ${rawUrl}`);
    throw new Error('Exchange base URL is not a valid URL.');
  }

  const allowed = parsed.protocol === 'https:' && parsed.hostname.endsWith(ECONOMY_ALLOWED_HOST_SUFFIX);
  if (!allowed) {
    console.error(`[economy] rejected disallowed Exchange host: ${parsed.protocol}//${parsed.hostname}`);
    throw new Error(`Exchange base URL is not an allowed lakeandlocals.com host: ${parsed.hostname}`);
  }
}

async function exchangeRead(env: Env): Promise<Array<{ ref: string; tenant_id: string; credits: number }>> {
  const baseUrl = exchangeBaseUrl(env);
  assertAllowedEconomyHost(baseUrl);
  const res = await fetch(`${baseUrl}/api/internal/economy/values`, {
    headers: { 'X-Economy-Key': env.ECONOMY_API_KEY },
  });
  if (!res.ok) throw new Error(`Exchange economy read failed: ${res.status}`);
  const json = await res.json<{ data: { values: Array<{ ref: string; tenant_id: string; credits: number }> } }>();
  return json.data.values;
}

async function exchangeApply(env: Env, values: Array<{ ref: string; tenant_id: string; credits: number }>): Promise<void> {
  const baseUrl = exchangeBaseUrl(env);
  assertAllowedEconomyHost(baseUrl);
  const res = await fetch(`${baseUrl}/api/internal/economy/apply`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Economy-Key': env.ECONOMY_API_KEY },
    body: JSON.stringify({ values }),
  });
  if (!res.ok) throw new Error(`Exchange economy apply failed: ${res.status}`);
}

// - Passport - local D1. Two different homes share this one target:
// kwest_defaults (tenants.config.kwest, via getKwestDefaults/setKwestDefaults)
// and passport_tenant_config (top-level tenants.config fields, e.g.
// welcome_credits). Both must go through a read-modify-write plus the same
// dual KV invalidation resolveTenant relies on - writing the column directly
// would leave a stale tenant cache and the change would not take effect. -

async function passportRead(env: Env): Promise<Array<{ ref: string; tenant_id: string; credits: number }>> {
  const { results } = await env.DB.prepare('SELECT id, config FROM tenants').all<{ id: string; config: string }>();
  const values: Array<{ ref: string; tenant_id: string; credits: number }> = [];
  for (const row of results ?? []) {
    const config = JSON.parse(row.config || '{}');
    values.push({ ref: 'welcome_credits', tenant_id: row.id, credits: Number(config.welcome_credits ?? 0) });

    const kwest: KwestDefaults = { ...KWEST_DEFAULTS, ...(config.kwest ?? {}) };
    for (const key of KWEST_DEFAULT_KEYS) {
      values.push({ ref: key, tenant_id: row.id, credits: Number(kwest[key] ?? 0) });
    }
  }
  return values;
}

/**
 * Writes a top-level `tenants.config` field (e.g. `welcome_credits`) with the
 * same read-modify-write plus dual KV invalidation shape as
 * setKwestDefaults/setSplashConfig. This is deliberately NOT a plain
 * `UPDATE tenants SET config = json_set(...)` - skipping the
 * PASSPORT_CONFIG.delete calls would leave resolveTenant's cached tenant
 * config stale, so the new value would not take effect until the cache
 * happened to expire on its own.
 */
async function setTenantEconomyField(env: Env, tenantId: string, patch: Record<string, number>): Promise<void> {
  const row = await env.DB.prepare('SELECT config, hostname FROM tenants WHERE id = ?')
    .bind(tenantId).first<{ config: string; hostname: string }>();
  if (!row) throw new Error(`Tenant not found: ${tenantId}`);

  const config = { ...JSON.parse(row.config || '{}'), ...patch };
  await env.DB.prepare('UPDATE tenants SET config = ? WHERE id = ?')
    .bind(JSON.stringify(config), tenantId).run();
  await Promise.all([
    env.PASSPORT_CONFIG.delete(`tenant:slug:${tenantId}`),
    env.PASSPORT_CONFIG.delete(`tenant:host:${row.hostname}`),
  ]);
}

async function passportApply(env: Env, values: Array<{ ref: string; tenant_id: string; credits: number }>): Promise<void> {
  const kwestPatchByTenant = new Map<string, Partial<KwestDefaults>>();
  const configPatchByTenant = new Map<string, Record<string, number>>();

  for (const v of values) {
    if ((KWEST_DEFAULT_KEYS as string[]).includes(v.ref)) {
      const bucket = (kwestPatchByTenant.get(v.tenant_id) ?? {}) as Record<string, number>;
      bucket[v.ref] = v.credits;
      kwestPatchByTenant.set(v.tenant_id, bucket as Partial<KwestDefaults>);
    } else {
      const bucket = configPatchByTenant.get(v.tenant_id) ?? {};
      bucket[v.ref] = v.credits;
      configPatchByTenant.set(v.tenant_id, bucket);
    }
  }

  // Sequential, not concurrent: both patch types are a read-modify-write
  // against the very same tenants.config column for a given tenant, so
  // running kwest defaults first and then the tenant-config fields means the
  // second write starts from what the first one just wrote instead of
  // racing it and clobbering it.
  for (const [tenantId, patch] of kwestPatchByTenant) {
    await setKwestDefaults(env, tenantId, patch);
  }
  for (const [tenantId, patch] of configPatchByTenant) {
    await setTenantEconomyField(env, tenantId, patch);
  }
}

export function buildEconomyClients(env: Env): EconomyClients {
  return {
    kkgame: {
      read: () => kkgameRead(env),
      apply: (values) => kkgameApply(env, values),
    },
    exchange: {
      read: () => exchangeRead(env),
      apply: (values) => exchangeApply(env, values),
    },
    passport: {
      read: () => passportRead(env),
      apply: (values) => passportApply(env, values),
    },
  };
}
