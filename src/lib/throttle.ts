// Generic KV brute-force counters. Fail-open on KV errors (availability over
// strict enforcement during a KV outage). Ported from LVE's throttle.ts
// (C:\LVE\src\lib\throttle.ts), itself ported from KKAuth's throttle.ts.

export async function getCount(kv: KVNamespace, key: string): Promise<number> {
  try {
    const raw = await kv.get(key);
    return raw ? parseInt(raw, 10) || 0 : 0;
  } catch {
    return 0;
  }
}

export async function increment(kv: KVNamespace, key: string, ttlSeconds = 900): Promise<number> {
  try {
    const next = (await getCount(kv, key)) + 1;
    await kv.put(key, String(next), { expirationTtl: ttlSeconds });
    return next;
  } catch {
    return 1;
  }
}
