/**
 * Social Splash execution test suite (Category Thesis Remediation item 8 /
 * G0-B). Runs the real worker (test/worker-entry.ts re-exports the actual
 * Hono app) in workerd against a fresh local D1 and KV - the first execution
 * test in passport, following KKCredits' money-paths.spec.ts pattern.
 * KKAuth and KKCredits are stubbed at the service-binding layer (see
 * vitest.config.mts); everything else - resolveTenant, requireAuth, the
 * splash handlers - is the production code path.
 *
 * What this suite proves that splash-escrow-keys.spec.ts (a source scan)
 * cannot: that a concurrent agree/pass on the same offer actually settles
 * exactly once against the real handler and the real (fake) ledger, that a
 * failed settlement actually reopens the offer for a clean retry, and that
 * the credits-amount cap is actually enforced.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SELF, env } from 'cloudflare:test';
import schemaSql from '../schema.sql?raw';

const migrationModules = import.meta.glob('../migrations/*.sql', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>;

/**
 * Filename order is NOT chronological order in this repo (a live G0-C
 * finding, not something introduced here): the numbered scheme (0001-0021)
 * started 2026-07-11, after three date-named migrations already existed, and
 * some numbered files (0019, 0021) were actually added weeks after several
 * later date-named ones - e.g. 0019-splash-escrow-ref.sql ALTERs
 * splash_offers but sorts before 2026-07-26-social-splash.sql, which CREATEs
 * it. This is each file's true first-commit order (`git log --follow`),
 * matching what was actually applied to production - fixing the repo's own
 * migration ordering/naming is out of scope here (Remediation item 9).
 */
const MIGRATION_ORDER = [
  '2026-06-12-deals-marketplace.sql',
  '2026-06-12-welcome-credited.sql',
  '2026-06-13-plaques-services-category.sql',
  '2026-07-05-visit-claims.sql',
  '0001-schema-migrations.sql',
  '0002-kwest-core.sql',
  '0003-kwest-minigames.sql',
  '0004-kwest-retention.sql',
  '0005-support-messages.sql',
  '0006-fresh-today.sql',
  '0007-fresh-today-nearest-town.sql',
  '0008-fresh-today-season-corrections.sql',
  '0009-around-interests.sql',
  '0010-sale-day.sql',
  '0012-popping-up.sql',
  '0013-popups-stop-address.sql',
  '0014-popups-event-name.sql',
  '0011-community-table.sql',
  '0015-home-safe.sql',
  '0016-sponsor-drawer.sql',
  '0017-sponsor-drawer-siblings.sql',
  '0018-inline-sponsor-banner.sql',
  '2026-07-26-social-splash.sql',
  '2026-07-26-social-splash-video.sql',
  '2026-07-26-social-splash-watermark.sql',
  '2026-07-27-prize-review-reason.sql',
  '2026-07-31-economy-registry.sql',
  '2026-07-31-economy-registry-five-star.sql',
  '0019-splash-escrow-ref.sql',
  '0021-prize-matrix-redenomination.sql',
];

function orderedMigrations(): string[] {
  const byName = new Map(Object.entries(migrationModules).map(([k, v]) => [k.split('/').pop()!, v]));
  const ordered = MIGRATION_ORDER.filter((name) => byName.has(name)).map((name) => byName.get(name)!);
  if (ordered.length !== byName.size) {
    const missing = [...byName.keys()].filter((name) => !MIGRATION_ORDER.includes(name));
    throw new Error(`MIGRATION_ORDER is missing new migration file(s): ${missing.join(', ')}`);
  }
  return ordered;
}

/**
 * Strip comments, split on ';', run each statement. (D1's exec() chokes on
 * multi-line DDL.) Strips from the first `--` to end of line on EVERY line,
 * not just whole-line comments - several migrations here have trailing
 * inline comments containing a semicolon in the prose (e.g. "NULL when
 * region_wide" / "key invalid afterward; ..."), which a whole-line-only
 * strip leaves behind to be mis-read as a real statement terminator.
 */
async function applySql(raw: string): Promise<void> {
  const statements = raw
    .split('\n')
    .map((line) => {
      const idx = line.indexOf('--');
      return idx === -1 ? line : line.slice(0, idx);
    })
    .join('\n')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
  for (const stmt of statements) {
    try {
      await env.DB.prepare(stmt).run();
    } catch (err) {
      // schema.sql is a periodically-consolidated snapshot, not a clean
      // migration-0 baseline (a live G0-C finding) - it has already absorbed
      // some older migrations' ALTER TABLEs, which have no IF NOT EXISTS.
      // Replaying that migration against the current schema.sql is a no-op
      // in production terms; anything else is a real failure.
      if (!/duplicate column name|already exists/i.test((err as Error).message)) throw err;
    }
  }
}

const TENANT_ID = 'lake-locals';
const ESCROW_UID = 900000101;
const GUEST_UID = 1001;
const MERCHANT_UID = 2001;
const BUSINESS_ID = 'biz1';

const guestToken = () => `valid:${GUEST_UID}`;
const merchantToken = () => `valid:${MERCHANT_UID}:biz:${BUSINESS_ID}:verified`;

interface Leg { refType: string; refId: string; from: number; to: number; amount: number }

async function resetLedger(): Promise<void> {
  await env.KKCREDITS.fetch('https://kkcredits/test-reset', { method: 'POST' });
}
async function setBalance(userId: number, amount: number): Promise<void> {
  await env.KKCREDITS.fetch('https://kkcredits/test-set-balance', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: userId, amount }),
  });
}
async function failNextTransfers(count: number): Promise<void> {
  await env.KKCREDITS.fetch('https://kkcredits/test-fail-next', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ count }),
  });
}
async function getLegs(): Promise<Leg[]> {
  const res = await env.KKCREDITS.fetch('https://kkcredits/test-legs');
  const json = await res.json<{ data: Leg[] }>();
  return json.data;
}

async function seedOffer(overrides: { creditsAmount?: number } = {}): Promise<void> {
  const creditsAmount = overrides.creditsAmount ?? 50;
  await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO splash_submissions (id, tenant_id, kkauth_uid, business_id, business_name, media_type, scan_ref, created_day, status)
      VALUES (1, ?, ?, ?, 'Test Biz', 'image', 'scan-1', '2026-08-07', 'held')
    `).bind(TENANT_ID, GUEST_UID, BUSINESS_ID),
    env.DB.prepare(`
      INSERT INTO splash_offers (id, tenant_id, submission_id, business_id, merchant_uid, consideration_type, credits_amount, status, expires_at, escrow_ref)
      VALUES (1, ?, 1, ?, ?, 'credits', ?, 'open', unixepoch() + 86400, 'escrow-ref-1')
    `).bind(TENANT_ID, BUSINESS_ID, MERCHANT_UID, creditsAmount),
  ]);
}

function respond(offerId: number, action: string, bearer: string): Promise<Response> {
  return SELF.fetch(`https://passport.test/api/t/${TENANT_ID}/splash/offers/${offerId}/respond`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearer}` },
    body: JSON.stringify({ action }),
  });
}

function createOffer(submissionId: number, creditsAmount: number): Promise<Response> {
  return SELF.fetch(`https://passport.test/api/internal/splash/${submissionId}/offer`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Internal-Secret': 'test-internal-secret',
      Authorization: `Bearer ${merchantToken()}`,
    },
    body: JSON.stringify({
      tenant_id: TENANT_ID, business_id: BUSINESS_ID,
      consideration_type: 'credits', credits_amount: creditsAmount,
    }),
  });
}

beforeAll(async () => {
  await applySql(schemaSql);
  // Several migrations (e.g. 0006-fresh-today's fresh_seasons seed, keyed to
  // 'lake-locals') insert data FK-bound to a tenant row - the tenant must
  // exist before migrations run, not just before the tests that use it.
  await env.DB.prepare(
    `INSERT INTO tenants (id, hostname, name, config) VALUES (?, 'passport.test', 'Lake & Locals', '{}')`
  ).bind(TENANT_ID).run();
  for (const raw of orderedMigrations()) {
    await applySql(raw);
  }
});

beforeEach(async () => {
  await resetLedger();
  for (const table of ['splash_certificates', 'splash_offers', 'splash_submissions', 'splash_tombstones', 'users']) {
    await env.DB.prepare(`DELETE FROM ${table}`).run();
  }
  const keys = await env.PASSPORT_CONFIG.list();
  for (const k of keys.keys) await env.PASSPORT_CONFIG.delete(k.name);
  await setBalance(ESCROW_UID, 100000);
});

describe('respondToSplashOffer — agree/pass race (G0-B)', () => {
  it('a concurrent pass and agree settle exactly once - no double payment out of escrow', async () => {
    await seedOffer({ creditsAmount: 50 });

    const [passRes, agreeRes] = await Promise.all([
      respond(1, 'pass', guestToken()),
      respond(1, 'agree', guestToken()),
    ]);

    expect([passRes.status, agreeRes.status].sort()).toEqual([200, 400]);

    const offer = await env.DB.prepare('SELECT status FROM splash_offers WHERE id = 1').first<{ status: string }>();
    expect(['agreed', 'passed']).toContain(offer!.status);

    // Exactly one money leg moved for this offer's escrow_ref - not both a
    // refund AND a license settlement out of the same escrowed amount.
    const offerLegs = (await getLegs()).filter(l => l.refId === 'escrow-ref-1');
    expect(offerLegs.length).toBe(1);
    expect(['splash_offer_refund', 'splash_license']).toContain(offerLegs[0].refType);

    // The winning branch's DB status matches which leg actually settled.
    if (offerLegs[0].refType === 'splash_license') {
      expect(offer!.status).toBe('agreed');
      expect(offerLegs[0].to).toBe(GUEST_UID);
    } else {
      expect(offer!.status).toBe('passed');
      expect(offerLegs[0].to).toBe(MERCHANT_UID);
    }
  });

  it('two concurrent agrees on the same offer settle exactly once (retry-storm safe)', async () => {
    await seedOffer({ creditsAmount: 50 });

    const [r1, r2] = await Promise.all([
      respond(1, 'agree', guestToken()),
      respond(1, 'agree', guestToken()),
    ]);

    expect([r1.status, r2.status].sort()).toEqual([200, 400]);
    const licenseLegs = (await getLegs()).filter(l => l.refId === 'escrow-ref-1' && l.refType === 'splash_license');
    expect(licenseLegs.length).toBe(1);

    const guestBalance = licenseLegs[0].to === GUEST_UID ? licenseLegs[0].amount : 0;
    expect(guestBalance).toBe(50); // paid once, not twice
  });

  it('reopens the offer for a clean retry if settlement fails after the flip', async () => {
    await seedOffer({ creditsAmount: 50 });
    await failNextTransfers(1);

    const failed = await respond(1, 'agree', guestToken());
    expect(failed.status).toBe(502);

    const afterFailure = await env.DB.prepare('SELECT status FROM splash_offers WHERE id = 1').first<{ status: string }>();
    expect(afterFailure!.status).toBe('open'); // rolled back, not stranded 'agreed'

    const retried = await respond(1, 'agree', guestToken());
    expect(retried.status).toBe(200);

    const afterRetry = await env.DB.prepare('SELECT status FROM splash_offers WHERE id = 1').first<{ status: string }>();
    expect(afterRetry!.status).toBe('agreed');

    const legs = (await getLegs()).filter(l => l.refId === 'escrow-ref-1');
    expect(legs.length).toBe(1); // the failed attempt moved no money
  });

  it('rejects a second response once the offer is already settled', async () => {
    await seedOffer({ creditsAmount: 50 });
    const first = await respond(1, 'agree', guestToken());
    expect(first.status).toBe(200);

    const second = await respond(1, 'pass', guestToken());
    expect(second.status).toBe(400);

    const legs = (await getLegs()).filter(l => l.refId === 'escrow-ref-1');
    expect(legs.length).toBe(1);
  });
});

describe('createSplashOffer — credits amount cap', () => {
  beforeEach(async () => {
    await env.DB.prepare(`
      INSERT INTO splash_submissions (id, tenant_id, kkauth_uid, business_id, business_name, media_type, scan_ref, created_day, status)
      VALUES (1, ?, ?, ?, 'Test Biz', 'image', 'scan-1', '2026-08-07', 'held')
    `).bind(TENANT_ID, GUEST_UID, BUSINESS_ID).run();
    await setBalance(MERCHANT_UID, 100000);
  });

  it('rejects an offer above the default 200-credit cap', async () => {
    const res = await createOffer(1, 500);
    expect(res.status).toBe(400);
    const legs = await getLegs();
    expect(legs.length).toBe(0); // nothing was escrowed
  });

  it('accepts an offer at or below the cap', async () => {
    const res = await createOffer(1, 200);
    expect(res.status).toBe(201);
  });
});
