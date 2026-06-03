import { SignJWT, jwtVerify } from 'jose';

export async function signAccessToken(
  payload: { sub: string; tid: string; email: string; name: string; credits: number },
  secret: string
): Promise<string> {
  const key = await getKey(secret);
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('15m')
    .sign(key);
}

export async function verifyAccessToken(token: string, secret: string) {
  const key = await getKey(secret);
  const { payload } = await jwtVerify(token, key);
  return payload as { sub: string; tid: string; email: string; name: string; credits: number };
}

async function getKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}
