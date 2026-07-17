export async function verifyBDSignature(
  uid: string,
  ts: string,
  email: string,
  sig: string,
  secret: string
): Promise<boolean> {
  const message = `${uid}|${ts}|${email}`;
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const mac = await crypto.subtle.sign('HMAC', keyMaterial, new TextEncoder().encode(message));
  const expected = Array.from(new Uint8Array(mac))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  if (expected.length !== sig.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  }
  return diff === 0;
}

export async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(sig))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

// Dual-key check for X-Internal-Secret (ARCHITECTURE.md §J): the secondary
// slot lets the fleet rotate the shared secret without a coordinated outage.
export function matchesInternalSecret(
  provided: string | undefined,
  env: { INTERNAL_SECRET?: string; INTERNAL_SECRET_SECONDARY?: string }
): boolean {
  if (!provided) return false;
  if (env.INTERNAL_SECRET && timingSafeEqual(provided, env.INTERNAL_SECRET)) return true;
  if (env.INTERNAL_SECRET_SECONDARY && timingSafeEqual(provided, env.INTERNAL_SECRET_SECONDARY)) {
    return true;
  }
  return false;
}

