import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

// Money-path test environment for Social Splash (Category Thesis Remediation
// item 8 / G0-B): the real worker (test/worker-entry.ts re-exports the actual
// Hono app) runs in workerd against a fresh local D1 and KV, same shape as
// KKCredits' own money-paths.spec.ts. KKAUTH and KKCREDITS are stubbed at the
// service-binding layer below so no live KKAuth/KKCredits is needed;
// everything else - resolveTenant, requireAuth, the splash handlers - is the
// production code path.
//
// Deliberately a SEPARATE config file from vitest.config.mts, not a shared
// project covering both pools: the existing source-scan tests use real
// node:fs reads (readFileSync + fileURLToPath) that only resolve against the
// host filesystem under the plain node pool - workerd's nodejs_compat does
// not give them one, so running everything through this pool 404s all five
// of them. `npm test` runs both configs.
//
// The KKCREDITS stub keeps a real in-memory ledger and honors the
// (ref_type, ref_id) idempotency contract transferCredits() depends on -
// that idempotency behavior is exactly what the race-condition tests need to
// observe, so it can't be faked away.

interface LedgerEntry {
  from: number;
  to: number;
  amount: number;
  balanceAfterFrom: number;
  balanceAfterTo: number;
}

const balances = new Map<number, number>();
const replays = new Map<string, LedgerEntry>();
const legs: Array<{ refType: string; refId: string; from: number; to: number; amount: number }> = [];
let failNextTransfers = 0;

function balanceOf(uid: number): number {
  return balances.get(uid) ?? 0;
}

export default defineConfig({
  plugins: [
    cloudflareTest({
      main: './test/worker-entry.ts',
      isolatedStorage: true,
      miniflare: {
        compatibilityDate: '2024-06-14',
        compatibilityFlags: ['nodejs_compat'],
        d1Databases: { DB: 'passport-test-db' },
        kvNamespaces: ['PASSPORT_CONFIG'],
        bindings: {
          ENVIRONMENT: 'test',
          COOKIE_DOMAIN: '.test.local',
          INTERNAL_SECRET: 'test-internal-secret',
          KKAUTH_APP_KEY: 'test-key-kkauth',
          KKCREDITS_APP_KEY: 'test-key-kkcredits',
          KKGAME_APP_KEY: 'test-key-kkgame',
          DEALS_ESCROW_UID: '900000101',
          QR_SIGNING_SECRET: 'test-qr-secret',
          KWEST_GUEST_SECRET: 'test-kwest-secret',
          SPLASH_MEDIA_SECRET: 'test-splash-media-secret',
          STREAM_ACCOUNT_ID: 'test-stream-account',
          STREAM_API_TOKEN: 'test-stream-token',
          STREAM_KEY_ID: 'test-stream-key-id',
          STREAM_JWK: '{}',
          STREAM_PLAYBACK_DOMAIN: 'https://stream.test.local',
        },
        serviceBindings: {
          // Stub KKAuth: tokens of the form "valid:<sub>" verify as that user.
          // "valid:<sub>:biz:<business_id>:verified" additionally returns a
          // verified-business profile, for the merchant-bridge-gated routes
          // (createSplashOffer et al).
          async KKAUTH(request: Request): Promise<Response> {
            const url = new URL(request.url);
            if (url.pathname !== '/internal/verify-token') {
              return Response.json({ error: 'not found' }, { status: 404 });
            }
            if (request.headers.get('X-Internal-Secret') !== 'test-internal-secret') {
              return Response.json({ error: 'Unauthorized internal call' }, { status: 401 });
            }
            const { token } = (await request.json()) as { token: string };
            const parts = token?.split(':') ?? [];
            if (parts[0] !== 'valid') {
              return Response.json({ error: 'Invalid or expired token' }, { status: 401 });
            }
            const sub = parts[1];
            const businessIdx = parts.indexOf('biz');
            const businessId = businessIdx >= 0 ? parts[businessIdx + 1] : null;
            const verified = parts.includes('verified');
            return Response.json({
              data: {
                payload: {
                  sub, email: `user${sub}@test.local`, name: null, bd_member: false,
                  app: null, iat: 0, exp: 4102444800,
                },
                profile: {
                  avatar_url: null, home_zip_location: null, home_zip_lat: null,
                  home_zip_lon: null, home_distance_preference: null,
                  business_id: businessId, business_status: verified ? 'verified' : null,
                  business_name: businessId ? `Test Business ${businessId}` : null,
                },
              },
            });
          },
          // Stub KKCredits: a real in-memory ledger honoring the
          // (ref_type, ref_id) idempotency key exactly like the live service -
          // a replayed key returns the ORIGINAL result and moves nothing.
          async KKCREDITS(request: Request): Promise<Response> {
            const url = new URL(request.url);
            if (url.pathname === '/test-reset') {
              balances.clear();
              replays.clear();
              legs.length = 0;
              failNextTransfers = 0;
              return Response.json({ data: { ok: true } });
            }
            if (url.pathname === '/test-legs') {
              return Response.json({ data: legs });
            }
            if (url.pathname === '/test-set-balance') {
              const { user_id, amount } = (await request.json()) as { user_id: number; amount: number };
              balances.set(user_id, amount);
              return Response.json({ data: { ok: true } });
            }
            if (url.pathname === '/test-fail-next') {
              const { count } = (await request.json()) as { count: number };
              failNextTransfers = count;
              return Response.json({ data: { ok: true } });
            }
            if (url.pathname !== '/transfer') {
              return Response.json({ error: 'not found' }, { status: 404 });
            }
            if (request.headers.get('X-App-Key') !== 'test-key-kkcredits') {
              return Response.json({ error: 'Unauthorized' }, { status: 401 });
            }
            if (failNextTransfers > 0) {
              failNextTransfers--;
              return Response.json({ error: 'simulated KKCredits outage' }, { status: 502 });
            }
            const body = (await request.json()) as {
              from_user_id: number; to_user_id: number; amount: number;
              ref_type: string; ref_id: string;
            };
            const key = `${body.ref_type}:${body.ref_id}`;
            const existing = replays.get(key);
            if (existing) {
              return Response.json({
                data: {
                  debit: { balance_after: existing.balanceAfterFrom },
                  credit: { balance_after: existing.balanceAfterTo },
                  replayed: true,
                },
              });
            }
            const fromBalance = balanceOf(body.from_user_id) - body.amount;
            const toBalance = balanceOf(body.to_user_id) + body.amount;
            balances.set(body.from_user_id, fromBalance);
            balances.set(body.to_user_id, toBalance);
            const entry: LedgerEntry = {
              from: body.from_user_id, to: body.to_user_id, amount: body.amount,
              balanceAfterFrom: fromBalance, balanceAfterTo: toBalance,
            };
            replays.set(key, entry);
            legs.push({ refType: body.ref_type, refId: body.ref_id, from: body.from_user_id, to: body.to_user_id, amount: body.amount });
            return Response.json({
              data: {
                debit: { balance_after: fromBalance },
                credit: { balance_after: toBalance },
                replayed: false,
              },
            });
          },
        },
      },
    }),
  ],
  test: {
    include: ['test/splash-money-paths.spec.ts'],
  },
});
