#!/usr/bin/env node
/**
 * KrowdKwest gauntlet - increment 1 core subset (per
 * KROWDKWEST-DEVELOPMENT-PLAN.md Section 7d / 11). Runs against a locally
 * running `wrangler pages dev` (port 8788) with local KKAuth/KKCredits
 * stubs (scratchpad kwest-stubs) connected via service binding - never
 * touches any real KrowdKraft infrastructure.
 *
 * Covers: happy path, ack enforcement, guest -> attach flow, idempotent
 * concurrent double-reveal, concurrent finish race (10 parallel -> ranks
 * 1-10 unique/gapless), budget cap exhaustion, oracle tripwire (no
 * "target_" in any player-facing response), sim-coord rejection for
 * non-test callers, the full admin suite (CRUD, go-live gate, test mode,
 * dashboard, claims review), and lifecycle/retention with a simulated clock
 * (scheduled->live via both the lazy read path and the cron sweep, live->ended
 * on both the scheduled-end and rank-20 branches, display_locked freeze,
 * 30-day coordinate retention truncation).
 *
 * Usage: node scripts/kwest-gauntlet.mjs
 */

import { execSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = 'http://127.0.0.1:8788';
const TENANT = 'lake-locals';
const NODE_EXTRA_CA_CERTS = 'C:\\projects\\.avg-root-ca.pem';

const allResponseBodies = [];
let failures = 0;

function assert(cond, message) {
  if (!cond) {
    failures++;
    console.error(`FAIL: ${message}`);
  } else {
    console.log(`ok   ${message}`);
  }
}

function token(uid, email, isAdmin = false, persona = 'a') {
  return `test:${uid}:${email}:${isAdmin ? 1 : 0}:${persona}`;
}

async function api(method, path, { body, bearer } = {}, attempt = 0) {
  const headers = { 'Content-Type': 'application/json' };
  if (bearer) headers['Authorization'] = `Bearer ${bearer}`;
  let res;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    // Local wrangler dev occasionally drops a socket under rapid-fire
    // requests - a transient flake, not a real failure. Retry once.
    if (attempt >= 2) throw err;
    await new Promise((r) => setTimeout(r, 300));
    return api(method, path, { body, bearer }, attempt + 1);
  }
  const text = await res.text();
  allResponseBodies.push({ path, text });
  let json;
  try { json = JSON.parse(text); } catch { json = { __raw: text }; }
  return { status: res.status, json };
}

function sql(statements) {
  const dir = mkdtempSync(join(tmpdir(), 'kwest-gauntlet-'));
  const file = join(dir, 'seed.sql');
  writeFileSync(file, statements, 'utf8');
  execSync(
    `npx wrangler d1 execute krowdkraft-passport --local --file="${file}"`,
    { cwd: 'C:\\projects\\passport', env: { ...process.env, NODE_EXTRA_CA_CERTS }, stdio: 'pipe' }
  );
}

function sqlQuery(query) {
  const out = execSync(
    `npx wrangler d1 execute krowdkraft-passport --local --command="${query.replace(/"/g, '\\"')}" --json`,
    { cwd: 'C:\\projects\\passport', env: { ...process.env, NODE_EXTRA_CA_CERTS }, stdio: 'pipe' }
  ).toString();
  const parsed = JSON.parse(out);
  return parsed[0]?.results ?? [];
}

async function resetStubs() {
  await fetch('http://127.0.0.1:8791/__stub/reset');
}

// Matches .dev.vars INTERNAL_SECRET for local dev only.
const INTERNAL_SECRET = 'local-dev-test-secret-not-real';

async function apiInternal(path, secret = INTERNAL_SECRET, attempt = 0) {
  const headers = {};
  if (secret !== null) headers['X-Internal-Secret'] = secret;
  let res;
  try {
    res = await fetch(`${BASE}${path}`, { method: 'POST', headers });
  } catch (err) {
    if (attempt >= 2) throw err;
    await new Promise((r) => setTimeout(r, 300));
    return apiInternal(path, secret, attempt + 1);
  }
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { __raw: text }; }
  return { status: res.status, json };
}

async function balanceOf(uid, attempt = 0) {
  try {
    const res = await fetch(`http://127.0.0.1:8791/internal/balance/${uid}`);
    const json = await res.json();
    return json.data.balance;
  } catch (err) {
    if (attempt >= 2) throw err;
    await new Promise((r) => setTimeout(r, 300));
    return balanceOf(uid, attempt + 1);
  }
}

// ------------------------------------------------------------------
// Seed data - three isolated hunts so tests never interfere with each
// other's budget/rank state.
// ------------------------------------------------------------------

function huntInsert(slug, name, budgetCap, minigameBp = 0, minigameMaxAward = 10) {
  return `
INSERT INTO kwest_hunts
  (tenant_id, slug, name, narrative, scope, status, starts_at, ends_at,
   grand_prize_kredits, grand_prize_description, rank2_10_kredits, rank11_20_kredits,
   step_reward_default, minigame_offer_bp, minigame_max_award, kk_budget_cap, kk_spent, rules_version)
VALUES
  ('${TENANT}', '${slug}', '${name}', 'Test narrative', 'location_specific', 'live',
   unixepoch() - 3600, unixepoch() + 2592000,
   100, '$100 cash', 50, 10, 10, ${minigameBp}, ${minigameMaxAward}, ${budgetCap}, 0, 1);
`;
}

function stepInsert(slug, seq, lat, lng, isFinal) {
  return `
INSERT INTO kwest_steps (hunt_id, tenant_id, seq, clues_json, target_lat, target_lng, radius_m, is_final)
VALUES (
  (SELECT id FROM kwest_hunts WHERE tenant_id='${TENANT}' AND slug='${slug}'),
  '${TENANT}', ${seq}, '[{"type":"riddle","body":"Find the spot"}]', ${lat}, ${lng}, 50, ${isFinal}
);
`;
}

const ALL_SLUGS = [
  'gauntlet-core', 'gauntlet-race', 'gauntlet-budget', 'gauntlet-persona', 'gauntlet-minigame',
  'admin-toy-hunt', 'admin-claims-hunt', 'admin-throwaway',
  'lifecycle-scheduled', 'lifecycle-ended-time', 'lifecycle-ended-rank20', 'lifecycle-notyet',
  'retention-old', 'retention-fresh',
];
const SLUG_LIST = ALL_SLUGS.map((s) => `'${s}'`).join(',');

function seedAll() {
  const cleanup = `
DELETE FROM kwest_reveals WHERE hunt_id IN (SELECT id FROM kwest_hunts WHERE tenant_id='${TENANT}' AND slug IN (${SLUG_LIST}));
DELETE FROM kwest_finishes WHERE hunt_id IN (SELECT id FROM kwest_hunts WHERE tenant_id='${TENANT}' AND slug IN (${SLUG_LIST}));
DELETE FROM kwest_claims WHERE hunt_id IN (SELECT id FROM kwest_hunts WHERE tenant_id='${TENANT}' AND slug IN (${SLUG_LIST}));
DELETE FROM kwest_acknowledgements WHERE hunt_id IN (SELECT id FROM kwest_hunts WHERE tenant_id='${TENANT}' AND slug IN (${SLUG_LIST}));
DELETE FROM kwest_progress WHERE hunt_id IN (SELECT id FROM kwest_hunts WHERE tenant_id='${TENANT}' AND slug IN (${SLUG_LIST}));
DELETE FROM kwest_minigame_plays WHERE hunt_id IN (SELECT id FROM kwest_hunts WHERE tenant_id='${TENANT}' AND slug IN (${SLUG_LIST}));
DELETE FROM kwest_steps WHERE hunt_id IN (SELECT id FROM kwest_hunts WHERE tenant_id='${TENANT}' AND slug IN (${SLUG_LIST}));
DELETE FROM kwest_hunts WHERE tenant_id='${TENANT}' AND slug IN (${SLUG_LIST});
`;
  const core = [
    huntInsert('gauntlet-core', 'Gauntlet Core', 100000),
    stepInsert('gauntlet-core', 1, 41.9000, -85.0000, 0),
    stepInsert('gauntlet-core', 2, 41.9100, -85.0100, 0),
    stepInsert('gauntlet-core', 3, 41.9200, -85.0200, 1),
  ].join('\n');
  const race = [
    huntInsert('gauntlet-race', 'Gauntlet Race', 100000),
    stepInsert('gauntlet-race', 1, 41.9000, -85.0000, 0),
    stepInsert('gauntlet-race', 2, 41.9100, -85.0100, 0),
    stepInsert('gauntlet-race', 3, 41.9200, -85.0200, 1),
  ].join('\n');
  const budget = [
    huntInsert('gauntlet-budget', 'Gauntlet Budget', 15),
    stepInsert('gauntlet-budget', 1, 41.9000, -85.0000, 0),
    stepInsert('gauntlet-budget', 2, 41.9100, -85.0100, 1),
  ].join('\n');
  const persona = [
    huntInsert('gauntlet-persona', 'Gauntlet Persona', 100000),
    stepInsert('gauntlet-persona', 1, 41.9000, -85.0000, 1),
  ].join('\n');
  const minigame = [
    huntInsert('gauntlet-minigame', 'Gauntlet Minigame', 100000, 10000, 20), // 100% offer chance
    stepInsert('gauntlet-minigame', 1, 41.9000, -85.0000, 0),
    stepInsert('gauntlet-minigame', 2, 41.9100, -85.0100, 1),
  ].join('\n');
  sql(cleanup + core + race + budget + persona + minigame);
}

// ------------------------------------------------------------------
// Test flows
// ------------------------------------------------------------------

async function startAckReveal(slug, bearer, guestToken, coords) {
  const startBody = guestToken !== undefined ? { guest_token: guestToken } : {};
  const start = await api('POST', `/api/t/${TENANT}/kwest/${slug}/start`, { body: startBody, bearer });
  const gt = start.json.data?.guest_token ?? guestToken;
  await api('POST', `/api/t/${TENANT}/kwest/${slug}/ack`, { body: { guest_token: gt }, bearer });
  return gt;
}

async function reveal(slug, bearer, guestToken, coords) {
  return api('POST', `/api/t/${TENANT}/kwest/${slug}/reveal`, {
    body: { guest_token: guestToken, ...coords },
    bearer,
  });
}

async function testHappyPath() {
  console.log('\n-- happy path --');
  const uid = 8001;
  const bearer = token(uid, 'happy@test.com');
  await startAckReveal('gauntlet-core', bearer);

  const r1 = await reveal('gauntlet-core', bearer, undefined, { lat: 41.9000, lng: -85.0000 });
  assert(r1.status === 200 && r1.json.data.result === 'hit', 'step 1 reveal hits');
  assert(r1.json.data.step_reward === 10, 'step 1 reward is 10');

  const r2 = await reveal('gauntlet-core', bearer, undefined, { lat: 41.9100, lng: -85.0100 });
  assert(r2.json.data.result === 'hit', 'step 2 reveal hits');

  const r3 = await reveal('gauntlet-core', bearer, undefined, { lat: 41.9200, lng: -85.0200 });
  assert(r3.json.data.result === 'hit' && r3.json.data.finished === true, 'final step finishes');
  assert(r3.json.data.rank === 1, 'first finisher on this hunt gets rank 1');
  assert(r3.json.data.prize_kind === 'grand', 'rank 1 is the grand tier');

  const claims = sqlQuery(
    `SELECT status FROM kwest_claims WHERE hunt_id = (SELECT id FROM kwest_hunts WHERE tenant_id='${TENANT}' AND slug='gauntlet-core') AND user_id = '${uid}'`
  );
  assert(claims.length === 1 && claims[0].status === 'pending', 'grand winner gets a pending claims row, no auto-award');

  const bal = await balanceOf(uid);
  assert(bal === 20, `happy-path user balance is 20 from two step rewards (got ${bal})`);
}

async function testAckEnforcement() {
  console.log('\n-- ack enforcement --');
  const uid = 8003;
  const bearer = token(uid, 'ackcheck@test.com');
  await api('POST', `/api/t/${TENANT}/kwest/gauntlet-core/start`, { body: {}, bearer });
  const r = await reveal('gauntlet-core', bearer, undefined, { lat: 41.9000, lng: -85.0000 });
  assert(r.json.data.blocked === 'ack_required', 'reveal without ack is blocked');
}

async function testGuestAttach() {
  console.log('\n-- guest -> attach flow --');
  const start = await api('POST', `/api/t/${TENANT}/kwest/gauntlet-core/start`, { body: {} });
  const guestToken = start.json.data.guest_token;
  assert(!!guestToken, 'anonymous start mints a guest token');

  await api('POST', `/api/t/${TENANT}/kwest/gauntlet-core/ack`, { body: { guest_token: guestToken } });

  const r1 = await reveal('gauntlet-core', undefined, guestToken, { lat: 41.9000, lng: -85.0000 });
  assert(r1.json.data.result === 'hit', 'guest reveal hits step 1');

  const uid = 8004;
  const bearer = token(uid, 'attacher@test.com');
  const attach = await api('POST', `/api/t/${TENANT}/kwest/attach`, { body: { guest_token: guestToken }, bearer });
  assert(attach.json.data.attached === true, 'attach succeeds');

  const state = await api('GET', `/api/t/${TENANT}/kwest/gauntlet-core/state`, { bearer });
  assert(state.json.data.seq === 2, 'attached account resumes at seq 2 (guest progress migrated)');
}

async function testIdempotentDoubleReveal() {
  console.log('\n-- idempotent concurrent double-reveal --');
  const uid = 8002;
  const bearer = token(uid, 'idempotent@test.com');
  await startAckReveal('gauntlet-core', bearer);

  const [a, b] = await Promise.all([
    reveal('gauntlet-core', bearer, undefined, { lat: 41.9000, lng: -85.0000 }),
    reveal('gauntlet-core', bearer, undefined, { lat: 41.9000, lng: -85.0000 }),
  ]);
  // Whichever request's UPDATE ... WHERE current_seq = ? loses the race sees
  // progress already advanced to step 2 by the winner - re-evaluating the
  // SAME device coords against step 2's (different) target correctly comes
  // back 'miss' rather than a second 'hit'. Either outcome is correct; the
  // one invariant that matters is no double-award, asserted below.
  assert(a.json.data.result === 'hit' || b.json.data.result === 'hit', 'at least one concurrent reveal reports hit');

  const bal = await balanceOf(uid);
  assert(bal === 10, `concurrent double-reveal issues exactly one step reward (got ${bal})`);
}

async function testConcurrentFinishRace() {
  console.log('\n-- concurrent finish race (10 parallel) --');
  const uids = Array.from({ length: 10 }, (_, i) => 9001 + i);

  for (const uid of uids) {
    const bearer = token(uid, `racer${uid}@test.com`);
    await startAckReveal('gauntlet-race', bearer);
    await reveal('gauntlet-race', bearer, undefined, { lat: 41.9000, lng: -85.0000 });
    await reveal('gauntlet-race', bearer, undefined, { lat: 41.9100, lng: -85.0100 });
  }

  const results = await Promise.all(
    uids.map((uid) => reveal('gauntlet-race', token(uid, `racer${uid}@test.com`), undefined, { lat: 41.9200, lng: -85.0200 }))
  );
  const allFinished = results.every((r) => r.json.data.finished === true);
  assert(allFinished, 'all 10 parallel finishers report finished:true');

  const ranks = sqlQuery(
    `SELECT finish_rank FROM kwest_finishes WHERE hunt_id = (SELECT id FROM kwest_hunts WHERE tenant_id='${TENANT}' AND slug='gauntlet-race') AND is_test = 0 ORDER BY finish_rank`
  ).map((r) => r.finish_rank);
  const expected = Array.from({ length: 10 }, (_, i) => i + 1);
  assert(JSON.stringify(ranks) === JSON.stringify(expected), `ranks are unique and gapless 1-10 (got ${JSON.stringify(ranks)})`);

  // Tier awards: rank 1 is the grand tier (KK held for claims review, no
  // auto-award - balance is just the two step rewards). Ranks 2-10 get an
  // immediate rank2_10_kredits award on top of the two step rewards.
  const byRank = sqlQuery(
    `SELECT user_id, finish_rank FROM kwest_finishes WHERE hunt_id = (SELECT id FROM kwest_hunts WHERE tenant_id='${TENANT}' AND slug='gauntlet-race') AND is_test = 0`
  );
  const rank1User = byRank.find((r) => Number(r.finish_rank) === 1).user_id;
  const rank2User = byRank.find((r) => Number(r.finish_rank) === 2).user_id;

  const rank1Bal = await balanceOf(rank1User);
  assert(rank1Bal === 20, `rank 1 (grand) balance is just the two step rewards, 20 (got ${rank1Bal})`);

  const rank2Bal = await balanceOf(rank2User);
  assert(rank2Bal === 70, `rank 2 balance is two step rewards plus the 50-credit tier award, 70 (got ${rank2Bal})`);
}

async function testBudgetCapExhaustion() {
  console.log('\n-- budget cap exhaustion --');
  const uidA = 7001;
  const uidB = 7002;
  const bearerA = token(uidA, 'budgeta@test.com');
  const bearerB = token(uidB, 'budgetb@test.com');

  await startAckReveal('gauntlet-budget', bearerA);
  const ra = await reveal('gauntlet-budget', bearerA, undefined, { lat: 41.9000, lng: -85.0000 });
  assert(ra.json.data.result === 'hit' && ra.json.data.step_reward === 10, 'first award consumes the 15-credit budget down to 5 remaining');

  await startAckReveal('gauntlet-budget', bearerB);
  const rb = await reveal('gauntlet-budget', bearerB, undefined, { lat: 41.9000, lng: -85.0000 });
  assert(rb.json.data.result === 'hit', 'second player still gets a hit (game continues)');
  assert(rb.json.data.step_reward === 0, 'second award is capped to 0 once the budget is exhausted');

  const hunt = sqlQuery(`SELECT kk_spent, kk_budget_cap FROM kwest_hunts WHERE tenant_id='${TENANT}' AND slug='gauntlet-budget'`)[0];
  assert(Number(hunt.kk_spent) <= Number(hunt.kk_budget_cap), `kk_spent (${hunt.kk_spent}) never exceeds kk_budget_cap (${hunt.kk_budget_cap})`);
}

async function testSimCoordRejection() {
  console.log('\n-- sim-coord rejection for non-test callers --');
  // ADMIN_EMAILS in .dev.vars gates is_admin by email allowlist (mirrors
  // middleware/auth.ts), so the test "admin" must use that exact address.
  const uid = 999;
  const bearer = token(uid, 'gottabuylocal@gmail.com', true);
  await startAckReveal('gauntlet-core', bearer);

  const realAdminNoTest = await reveal('gauntlet-core', bearer, undefined, { sim_lat: 41.9000, sim_lng: -85.0000 });
  assert(realAdminNoTest.status === 400, 'admin without is_test flag cannot use sim coords (real location required)');

  sql(`UPDATE kwest_progress SET is_test = 1 WHERE hunt_id = (SELECT id FROM kwest_hunts WHERE tenant_id='${TENANT}' AND slug='gauntlet-core') AND player_key = 'u:${uid}';`);

  const testAdmin = await reveal('gauntlet-core', bearer, undefined, { sim_lat: 41.9000, sim_lng: -85.0000 });
  assert(testAdmin.json.data.result === 'hit', 'admin WITH is_test=1 progress can use sim coords');

  const nonAdminUid = 998;
  const nonAdminBearer = token(nonAdminUid, 'plain@test.com', false);
  await startAckReveal('gauntlet-core', nonAdminBearer);
  const plainUserSim = await reveal('gauntlet-core', nonAdminBearer, undefined, { sim_lat: 41.9000, sim_lng: -85.0000 });
  assert(plainUserSim.status === 400, 'non-admin cannot use sim coords');
}

async function testMinigames() {
  console.log('\n-- mini-games --');
  const uid = 5001;
  const bearer = token(uid, 'minigamer@test.com');
  await startAckReveal('gauntlet-minigame', bearer);

  const r1 = await reveal('gauntlet-minigame', bearer, undefined, { lat: 41.9000, lng: -85.0000 });
  assert(r1.json.data.result === 'hit', 'step 1 hit on the minigame hunt');
  const offer = r1.json.data.minigame_offer;
  assert(!!offer && !!offer.offer_id && !!offer.game && !!offer.tease, `a 100%-chance hunt always includes a minigame offer (got ${JSON.stringify(offer)})`);

  const inputByGame = {
    chest_pick: { chest: 1 },
    compass_stop: { t_ms: 1234 },
    scratch_off: { scratched: true },
  };

  // Wrong input shape for the offered game -> 400.
  const badInput = await api('POST', `/api/t/${TENANT}/kwest/minigame/${offer.offer_id}`, {
    body: { input: { nonsense: true } }, bearer,
  });
  assert(badInput.status === 400, 'invalid input shape for the offered game is rejected');

  // Someone else can't play your offer.
  const otherBearer = token(5002, 'other@test.com');
  const stolen = await api('POST', `/api/t/${TENANT}/kwest/minigame/${offer.offer_id}`, {
    body: { input: inputByGame[offer.game] }, bearer: otherBearer,
  });
  assert(stolen.status === 403, "another player cannot play someone else's offer");

  const played = await api('POST', `/api/t/${TENANT}/kwest/minigame/${offer.offer_id}`, {
    body: { input: inputByGame[offer.game] }, bearer,
  });
  assert(played.json.data.outcome === 'played', 'the rightful owner can play the offer');
  assert(typeof played.json.data.outcome_kredits === 'number', 'a numeric outcome (possibly 0) comes back');

  const replay = await api('POST', `/api/t/${TENANT}/kwest/minigame/${offer.offer_id}`, {
    body: { input: inputByGame[offer.game] }, bearer,
  });
  assert(replay.json.data.outcome === 'already_played', 'replaying the same offer is a no-op, not a second award');

  // A separate expired offer is rejected without ever being played. Forced
  // directly via SQL (mirroring the shape the reveal handler itself would
  // have created) since a real offer's expiry is 30 minutes out.
  const offerId2 = `test-expired-${uid}`;
  sql(`
    INSERT INTO kwest_minigame_plays (offer_id, hunt_id, step_id, tenant_id, player_key, user_id, game, tease_variant, status, expires_at, is_test)
    VALUES ('${offerId2}',
      (SELECT id FROM kwest_hunts WHERE tenant_id='${TENANT}' AND slug='gauntlet-minigame'),
      (SELECT id FROM kwest_steps WHERE hunt_id=(SELECT id FROM kwest_hunts WHERE tenant_id='${TENANT}' AND slug='gauntlet-minigame') AND seq=1),
      '${TENANT}', 'u:${uid}', '${uid}', 'chest_pick', 0, 'offered', unixepoch() - 10, 0);
  `);
  const expired = await api('POST', `/api/t/${TENANT}/kwest/minigame/${offerId2}`, {
    body: { input: { chest: 0 } }, bearer,
  });
  assert(expired.json.data.outcome === 'expired', 'an expired offer is rejected without playing');
}

async function testAdminSuite() {
  console.log('\n-- admin suite --');
  const adminBearer = token(9999, 'gottabuylocal@gmail.com', true);
  const nonAdminBearer = token(9998, 'nonadmin@test.com', false);

  // Non-admin is rejected outright.
  const forbidden = await api('POST', `/api/t/${TENANT}/admin/kwest`, {
    body: { slug: 'should-not-exist', name: 'x', scope: 'location_specific', starts_at: 1, ends_at: 2, grand_prize_description: 'x' },
    bearer: nonAdminBearer,
  });
  assert(forbidden.status === 403, 'non-admin cannot create a hunt');

  // Create + go-live gate.
  const create = await api('POST', `/api/t/${TENANT}/admin/kwest`, {
    body: { slug: 'admin-toy-hunt', name: 'Admin Toy Hunt', scope: 'location_specific', starts_at: 1700000000, ends_at: 1900000000, grand_prize_description: '$100 cash' },
    bearer: adminBearer,
  });
  assert(create.status === 201 && create.json.data.status === 'draft', 'admin creates a hunt in draft status');
  const huntId = create.json.data.id;

  const step1 = await api('POST', `/api/t/${TENANT}/admin/kwest/${huntId}/steps`, {
    body: { clues: [{ type: 'riddle', body: 'Find the old oak' }], target_lat: 41.9000, target_lng: -85.0000, radius_m: 50 },
    bearer: adminBearer,
  });
  const step2 = await api('POST', `/api/t/${TENANT}/admin/kwest/${huntId}/steps`, {
    body: { clues: [{ type: 'riddle', body: 'Find the fountain' }], target_lat: 41.9100, target_lng: -85.0100, radius_m: 50 },
    bearer: adminBearer,
  });
  assert(step1.status === 201 && step2.status === 201, 'two steps created');
  // step1's own create response predates step2 existing, so it reflects
  // is_final at THAT moment (correctly 1, as the only/final step then) -
  // re-list fresh to check the current state after both steps exist.
  const stepsAfterCreate = await api('GET', `/api/t/${TENANT}/admin/kwest/${huntId}/steps`, { bearer: adminBearer });
  const s1 = stepsAfterCreate.json.data.find((s) => s.id === step1.json.data.id);
  const s2 = stepsAfterCreate.json.data.find((s) => s.id === step2.json.data.id);
  assert(s1.is_final === 0 && s2.is_final === 1, 'only the highest-seq step is auto-marked final');

  const blockedLive = await api('POST', `/api/t/${TENANT}/admin/kwest/${huntId}/status`, { body: { status: 'live' }, bearer: adminBearer });
  assert(blockedLive.status === 400, 'go-live is blocked before any step has a field test');

  await api('POST', `/api/t/${TENANT}/admin/kwest/steps/${step1.json.data.id}/field-test`, {
    body: { accuracy_m_observed: 8, fix_seconds: 4, note: 'clear sight line', public_access: true, safe: true }, bearer: adminBearer,
  });
  const stillBlocked = await api('POST', `/api/t/${TENANT}/admin/kwest/${huntId}/status`, { body: { status: 'live' }, bearer: adminBearer });
  assert(stillBlocked.status === 400, 'go-live still blocked with only one of two steps field-tested');

  await api('POST', `/api/t/${TENANT}/admin/kwest/steps/${step2.json.data.id}/field-test`, {
    body: { accuracy_m_observed: 6, fix_seconds: 3, note: 'open field', public_access: true, safe: true }, bearer: adminBearer,
  });
  const wentLive = await api('POST', `/api/t/${TENANT}/admin/kwest/${huntId}/status`, { body: { status: 'live' }, bearer: adminBearer });
  assert(wentLive.status === 200 && wentLive.json.data.status === 'live', 'go-live succeeds once every step has passed a field test');

  // Reorder: swap seq 1 and 2, re-derive final.
  const reordered = await api('POST', `/api/t/${TENANT}/admin/kwest/${huntId}/steps/reorder`, {
    body: { ordered_step_ids: [step2.json.data.id, step1.json.data.id] }, bearer: adminBearer,
  });
  assert(reordered.json.data[0].id === step2.json.data.id && reordered.json.data[0].seq === 1, 'reorder re-sequences steps');
  assert(reordered.json.data[1].is_final === 1, 'is_final follows the new highest seq after reorder');
  // Put it back in the original order for the rest of this test.
  await api('POST', `/api/t/${TENANT}/admin/kwest/${huntId}/steps/reorder`, {
    body: { ordered_step_ids: [step1.json.data.id, step2.json.data.id] }, bearer: adminBearer,
  });

  // Test-run: create/reset, then play the REAL endpoints with sim coords.
  const testRun = await api('POST', `/api/t/${TENANT}/admin/kwest/${huntId}/test-run`, { body: {}, bearer: adminBearer });
  assert(testRun.json.data.reset === true, 'test-run creates/resets the admin is_test progress row');
  await api('POST', `/api/t/${TENANT}/kwest/admin-toy-hunt/ack`, { body: {}, bearer: adminBearer });
  const simHit = await reveal('admin-toy-hunt', adminBearer, undefined, { sim_lat: 41.9000, sim_lng: -85.0000 });
  assert(simHit.json.data.result === 'hit', 'test-run admin can play with sim coords via the real reveal endpoint');

  const health = await api('POST', `/api/t/${TENANT}/admin/kwest/${huntId}/health-check`, { body: {}, bearer: adminBearer });
  assert(health.json.data.ok === true, 'one-tap health check passes (distance 0 <= radius)');

  const dashboard = await api('GET', `/api/t/${TENANT}/admin/kwest/${huntId}/dashboard`, { bearer: adminBearer });
  assert(dashboard.json.data.hunt_status === 'live' && Array.isArray(dashboard.json.data.per_step), 'dashboard returns hunt status and per-step stats');

  // Weather pause blocks reveal for real players (not test-run admins).
  await api('POST', `/api/t/${TENANT}/admin/kwest/${huntId}/weather-pause`, { body: { paused: true }, bearer: adminBearer });
  const realBearer = token(9997, 'realplayer@test.com');
  await startAckReveal('admin-toy-hunt', realBearer);
  const pausedReveal = await reveal('admin-toy-hunt', realBearer, undefined, { lat: 41.9000, lng: -85.0000 });
  assert(pausedReveal.json.data.blocked === 'weather_paused', 'weather pause blocks real reveals');
  await api('POST', `/api/t/${TENANT}/admin/kwest/${huntId}/weather-pause`, { body: { paused: false }, bearer: adminBearer });

  // Delete is blocked once real finishes exist - drive one real finisher to
  // rank 1 first (the grand tier), which also sets up the claims test below.
  const finish1 = await reveal('admin-toy-hunt', realBearer, undefined, { lat: 41.9000, lng: -85.0000 });
  assert(finish1.json.data.result === 'hit', 'real player hits step 1');
  const finish2 = await reveal('admin-toy-hunt', realBearer, undefined, { lat: 41.9100, lng: -85.0100 });
  assert(finish2.json.data.finished === true && finish2.json.data.rank === 1, 'real player finishes rank 1 (grand tier)');

  const deleteBlocked = await api('DELETE', `/api/t/${TENANT}/admin/kwest/${huntId}`, { bearer: adminBearer });
  assert(deleteBlocked.status === 400, 'deleting a hunt with real finishes is blocked');

  // Claims review: pending -> id_verified releases the grand prize exactly once.
  const claims = await api('GET', `/api/t/${TENANT}/admin/kwest/${huntId}/claims`, { bearer: adminBearer });
  assert(claims.json.data.length === 1 && claims.json.data[0].claim_status === 'pending', 'the grand winner has a pending claim');
  const claimId = claims.json.data[0].claim_id;

  await api('PUT', `/api/t/${TENANT}/admin/kwest/${huntId}`, { body: { grand_prize_kredits: 100 }, bearer: adminBearer });
  const verify1 = await api('POST', `/api/t/${TENANT}/admin/kwest/claims/${claimId}`, {
    body: { status: 'id_verified', id_check_note: 'ID verified, DOB confirms 18+' }, bearer: adminBearer,
  });
  assert(verify1.json.data.status === 'id_verified', 'claim transitions to id_verified');
  const balAfterFirst = await balanceOf(9997);
  // Only the non-final step (step 1) pays a step reward (10); the final
  // step's hit is a finish, not a step award, and the grand tier withholds
  // KK until id_verified - so 10 (step) + 100 (grand, just released) = 110.
  assert(balAfterFirst === 110, `grand prize (100) plus the one non-final step reward (10) lands on id_verified (got ${balAfterFirst})`);

  const verify2 = await api('POST', `/api/t/${TENANT}/admin/kwest/claims/${claimId}`, {
    body: { status: 'id_verified' }, bearer: adminBearer,
  });
  assert(verify2.status === 200, 're-confirming the same status is harmless');
  const balAfterSecond = await balanceOf(9997);
  assert(balAfterSecond === 110, 're-verifying the same claim does not re-award the grand prize');

  // Retro publish via the real admin endpoint (not raw SQL this time).
  const publish = await api('POST', `/api/t/${TENANT}/admin/kwest/${huntId}/retro`, { body: { published: true }, bearer: adminBearer });
  assert(publish.json.data.retro_published === true, 'admin retro publish endpoint flips the flag');

  // One-winner DB constraint: only reachable by forcing a second claims row
  // (normal gameplay only ever creates one grand claim per hunt) - a direct
  // test of the partial UNIQUE index backstop, not just app logic.
  sql(`
    INSERT INTO kwest_claims (hunt_id, user_id, tenant_id, finish_rank, status)
    VALUES (${huntId}, '99999999', '${TENANT}', 2, 'pending');
  `);
  const bogusClaim = sqlQuery(`SELECT id FROM kwest_claims WHERE hunt_id = ${huntId} AND user_id = '99999999'`)[0];
  const secondVerify = await api('POST', `/api/t/${TENANT}/admin/kwest/claims/${bogusClaim.id}`, {
    body: { status: 'id_verified' }, bearer: adminBearer,
  });
  assert(secondVerify.status === 400, 'the DB enforces one verified/paid winner per hunt, even if the app tried to allow a second');

  // Successful delete: a fresh hunt with zero finishes deletes cleanly.
  const throwaway = await api('POST', `/api/t/${TENANT}/admin/kwest`, {
    body: { slug: 'admin-throwaway', name: 'Throwaway', scope: 'location_specific', starts_at: 1, ends_at: 2, grand_prize_description: 'x' },
    bearer: adminBearer,
  });
  const deleteOk = await api('DELETE', `/api/t/${TENANT}/admin/kwest/${throwaway.json.data.id}`, { bearer: adminBearer });
  assert(deleteOk.json.data.removed === true, 'a hunt with no finishes deletes cleanly');
}

async function testLifecycleAndRetention() {
  console.log('\n-- lifecycle & retention (simulated clock) --');

  // Internal-secret gate: missing/wrong secret is rejected without doing anything.
  const noSecret = await apiInternal('/api/internal/kwest/lifecycle', null);
  assert(noSecret.status === 401, 'lifecycle endpoint rejects a missing X-Internal-Secret');
  const wrongSecret = await apiInternal('/api/internal/kwest/lifecycle', 'not-the-real-secret');
  assert(wrongSecret.status === 401, 'lifecycle endpoint rejects a wrong X-Internal-Secret');

  const huntRow = (slug) =>
    sqlQuery(`SELECT status, retro_published FROM kwest_hunts WHERE tenant_id='${TENANT}' AND slug='${slug}'`)[0];

  sql(`
-- scheduled -> live: starts_at already in the past.
INSERT INTO kwest_hunts
  (tenant_id, slug, name, narrative, scope, status, starts_at, ends_at, grand_prize_description, rules_version)
VALUES
  ('${TENANT}', 'lifecycle-scheduled', 'Lifecycle Scheduled', '', 'location_specific', 'scheduled',
   unixepoch() - 100, unixepoch() + 2592000, '$1', 1);

-- live -> ended via the SCHEDULED-END branch: ends_at in the past, no rank-20 official_end_at.
INSERT INTO kwest_hunts
  (tenant_id, slug, name, narrative, scope, status, starts_at, ends_at, official_end_at, grand_prize_description, rules_version)
VALUES
  ('${TENANT}', 'lifecycle-ended-time', 'Lifecycle Ended By Time', '', 'location_specific', 'live',
   unixepoch() - 999999, unixepoch() - 100, NULL, '$1', 1);

-- live -> ended via the RANK-20 branch: official_end_at in the past even
-- though the scheduled ends_at is still far in the future - proves
-- COALESCE(official_end_at, ends_at) governs, not ends_at alone.
INSERT INTO kwest_hunts
  (tenant_id, slug, name, narrative, scope, status, starts_at, ends_at, official_end_at, grand_prize_description, rules_version)
VALUES
  ('${TENANT}', 'lifecycle-ended-rank20', 'Lifecycle Ended By Rank20', '', 'location_specific', 'live',
   unixepoch() - 999999, unixepoch() + 999999, unixepoch() - 100, '$1', 1);

-- Negative case: still within both ends_at and official_end_at - must stay live.
INSERT INTO kwest_hunts
  (tenant_id, slug, name, narrative, scope, status, starts_at, ends_at, official_end_at, grand_prize_description, rules_version)
VALUES
  ('${TENANT}', 'lifecycle-notyet', 'Lifecycle Not Yet', '', 'location_specific', 'live',
   unixepoch() - 999999, unixepoch() + 999999, unixepoch() + 999999, '$1', 1);

-- A real (non-test) finish on the rank-20 hunt, to prove display_locked
-- flips to 1 in the SAME sweep that ends the hunt.
INSERT INTO kwest_finishes
  (hunt_id, user_id, tenant_id, finish_rank, finished_at, prize_kind, prize_kredits, display_choice, display_name_snapshot, display_locked, is_test)
VALUES
  ((SELECT id FROM kwest_hunts WHERE tenant_id='${TENANT}' AND slug='lifecycle-ended-rank20'),
   '77777', '${TENANT}', 1, unixepoch() - 200, 'grand', 0, 'anonymous', 'Rank20 Finisher', 0, 0);
`);

  // Lazy path first: a plain hunt-detail read (no cron involved) runs the
  // SAME sweep inline, mirroring deals.ts's lazy-expiry-on-read pattern (dev
  // plan Section 9's "belt-and-suspenders"). The sweep isn't scoped to the
  // one hunt being read, so a single read transitions every due hunt.
  await api('GET', `/api/t/${TENANT}/kwest/lifecycle-scheduled`, {});
  assert(huntRow('lifecycle-scheduled').status === 'live', 'a plain GET /kwest/:slug read lazily flips scheduled -> live, with no cron call at all');
  assert(huntRow('lifecycle-ended-time').status === 'ended', 'the same lazy read also ends other due hunts - the sweep is global, not scoped to the hunt being read');

  const sweep1 = await apiInternal('/api/internal/kwest/lifecycle');
  assert(sweep1.status === 200 && typeof sweep1.json.data.processed === 'number', 'lifecycle sweep returns {data:{processed}}');
  assert(sweep1.json.data.processed === 0, `the cron sweep is idempotent - nothing left to do since the lazy read already caught everything (got ${sweep1.json.data.processed})`);

  assert(huntRow('lifecycle-ended-time').status === 'ended', 'live -> ended at scheduled ends_at when no rank-20 official_end_at is set');
  assert(huntRow('lifecycle-ended-time').retro_published === 1, 'ending a hunt publishes its retrospective in the same sweep');
  assert(huntRow('lifecycle-ended-rank20').status === 'ended', 'live -> ended at official_end_at even though the scheduled ends_at is still far off (rank-20 branch)');
  assert(huntRow('lifecycle-notyet').status === 'live', 'a hunt whose end has not yet arrived (either branch) stays live');

  const finishLock = sqlQuery(
    `SELECT display_locked FROM kwest_finishes WHERE hunt_id = (SELECT id FROM kwest_hunts WHERE tenant_id='${TENANT}' AND slug='lifecycle-ended-rank20') AND user_id = '77777'`
  )[0];
  assert(Number(finishLock.display_locked) === 1, 'display_locked flips to 1 on all finishes in the same sweep that ends the hunt');

  const sweep2 = await apiInternal('/api/internal/kwest/lifecycle');
  assert(sweep2.json.data.processed === 0, 're-running the sweep with nothing due processes 0 (idempotent, no re-transition)');

  // Retention: only reveals whose hunt ended more than 30 days ago get truncated.
  sql(`
INSERT INTO kwest_hunts
  (tenant_id, slug, name, narrative, scope, status, starts_at, ends_at, official_end_at, grand_prize_description, rules_version)
VALUES
  ('${TENANT}', 'retention-old', 'Retention Old', '', 'location_specific', 'ended',
   unixepoch() - 9999999, unixepoch() - 2678400, unixepoch() - 2678400, '$1', 1),
  ('${TENANT}', 'retention-fresh', 'Retention Fresh', '', 'location_specific', 'ended',
   unixepoch() - 999999, unixepoch() - 864000, unixepoch() - 864000, '$1', 1);

INSERT INTO kwest_steps (hunt_id, tenant_id, seq, clues_json, target_lat, target_lng, radius_m, is_final)
VALUES
  ((SELECT id FROM kwest_hunts WHERE tenant_id='${TENANT}' AND slug='retention-old'), '${TENANT}', 1, '[]', 41.9, -85.0, 50, 1),
  ((SELECT id FROM kwest_hunts WHERE tenant_id='${TENANT}' AND slug='retention-fresh'), '${TENANT}', 1, '[]', 41.9, -85.0, 50, 1);

INSERT INTO kwest_reveals (hunt_id, step_id, tenant_id, player_key, result, device_lat, device_lng, distance_m, edge_lat, edge_lng)
VALUES
  ((SELECT id FROM kwest_hunts WHERE tenant_id='${TENANT}' AND slug='retention-old'),
   (SELECT id FROM kwest_steps WHERE hunt_id=(SELECT id FROM kwest_hunts WHERE tenant_id='${TENANT}' AND slug='retention-old')),
   '${TENANT}', 'u:70001', 'hit', 41.9, -85.0, 0, 41.9, -85.0),
  ((SELECT id FROM kwest_hunts WHERE tenant_id='${TENANT}' AND slug='retention-fresh'),
   (SELECT id FROM kwest_steps WHERE hunt_id=(SELECT id FROM kwest_hunts WHERE tenant_id='${TENANT}' AND slug='retention-fresh')),
   '${TENANT}', 'u:70002', 'hit', 41.9, -85.0, 0, 41.9, -85.0);
`);

  const retention1 = await apiInternal('/api/internal/kwest/retention');
  assert(retention1.status === 200 && retention1.json.data.processed === 1, `retention sweep truncates exactly the >30-day-old reveal (got ${retention1.json.data.processed})`);

  const oldReveal = sqlQuery(
    `SELECT device_lat, device_lng, edge_lat, edge_lng, distance_m FROM kwest_reveals WHERE hunt_id = (SELECT id FROM kwest_hunts WHERE tenant_id='${TENANT}' AND slug='retention-old')`
  )[0];
  assert(
    oldReveal.device_lat === null && oldReveal.device_lng === null && oldReveal.edge_lat === null && oldReveal.edge_lng === null,
    'raw coordinates are NULLed on the reveal past the 30-day retention window'
  );
  assert(Number(oldReveal.distance_m) === 0, 'distance_m (the aggregate admins actually use) is left untouched');

  const freshReveal = sqlQuery(
    `SELECT device_lat, device_lng FROM kwest_reveals WHERE hunt_id = (SELECT id FROM kwest_hunts WHERE tenant_id='${TENANT}' AND slug='retention-fresh')`
  )[0];
  assert(freshReveal.device_lat !== null && freshReveal.device_lng !== null, 'a reveal still inside the 30-day window is left alone');

  const retention2 = await apiInternal('/api/internal/kwest/retention');
  assert(retention2.json.data.processed === 0, 're-running retention with nothing newly due processes 0');
}

function testOracleTripwire() {
  console.log('\n-- oracle tripwire --');
  // Admin endpoints legitimately see target coordinates (that's the whole
  // point of hunt authoring) - the tripwire is scoped to PLAYER-facing
  // responses only, per dev plan Section 4.
  const leaks = allResponseBodies.filter((r) => !r.path.includes('/admin/') && r.text.includes('target_'));
  assert(leaks.length === 0, `no player-facing response contains "target_" (${leaks.length} leak(s) found)`);
  if (leaks.length) {
    for (const l of leaks) console.error(`  leak at ${l.path}`);
  }
}

async function testPersonaDisplayChoiceAndRetro() {
  console.log('\n-- persona-aware finish default, display-choice, retro --');

  // Anonymous-persona finisher (persona flag 'a', the default).
  const anonUid = 6001;
  const anonBearer = token(anonUid, 'anon@test.com');
  await startAckReveal('gauntlet-persona', anonBearer);
  const anonFinish = await reveal('gauntlet-persona', anonBearer, undefined, { lat: 41.9000, lng: -85.0000 });
  assert(anonFinish.json.data.finished === true, 'anon-persona player finishes on the single-step hunt');
  assert(anonFinish.json.data.display_prompt.default_choice === 'anonymous', 'no real persona set -> default choice is anonymous');
  assert(anonFinish.json.data.display_prompt.anonymous_name === `Anon ${anonUid}`, 'anonymous_name comes from the stubbed profile');

  const anonSnapshot = sqlQuery(
    `SELECT display_choice, display_name_snapshot FROM kwest_finishes WHERE hunt_id = (SELECT id FROM kwest_hunts WHERE tenant_id='${TENANT}' AND slug='gauntlet-persona') AND user_id='${anonUid}'`
  )[0];
  assert(anonSnapshot.display_choice === 'anonymous' && anonSnapshot.display_name_snapshot === `Anon ${anonUid}`, 'anon finisher snapshot matches the anonymous name');

  // Real-persona finisher (persona flag 'p').
  const realUid = 6002;
  const realBearer = token(realUid, 'real@test.com', false, 'p');
  await startAckReveal('gauntlet-persona', realBearer);
  const realFinish = await reveal('gauntlet-persona', realBearer, undefined, { lat: 41.9000, lng: -85.0000 });
  assert(realFinish.json.data.display_prompt.default_choice === 'real', 'a filled-in personal persona -> default choice is real');
  assert(realFinish.json.data.display_prompt.real_name === `Real Name ${realUid}`, 'real_name comes from the stubbed profile');

  const realSnapshot = sqlQuery(
    `SELECT display_name_snapshot FROM kwest_finishes WHERE hunt_id = (SELECT id FROM kwest_hunts WHERE tenant_id='${TENANT}' AND slug='gauntlet-persona') AND user_id='${realUid}'`
  )[0];
  assert(realSnapshot.display_name_snapshot === `Real Name ${realUid}`, 'real finisher snapshot uses the real name');

  // Editing the choice re-snapshots the name, until display_locked flips.
  const switchToAnon = await api('POST', `/api/t/${TENANT}/kwest/gauntlet-persona/display-choice`, {
    body: { choice: 'anonymous' }, bearer: realBearer,
  });
  assert(switchToAnon.json.data.updated === true && switchToAnon.json.data.display_name === `Anon ${realUid}`, 'switching to anonymous re-snapshots the name');

  sql(`UPDATE kwest_finishes SET display_locked = 1 WHERE hunt_id = (SELECT id FROM kwest_hunts WHERE tenant_id='${TENANT}' AND slug='gauntlet-persona') AND user_id = '${realUid}';`);
  const blockedSwitch = await api('POST', `/api/t/${TENANT}/kwest/gauntlet-persona/display-choice`, {
    body: { choice: 'real' }, bearer: realBearer,
  });
  assert(blockedSwitch.json.data.updated === false && blockedSwitch.json.data.reason === 'locked', 'display choice is frozen once display_locked=1');

  // Retro: unpublished by default, then populated once flipped.
  const beforePublish = await api('GET', `/api/t/${TENANT}/kwest/gauntlet-persona/retro`);
  assert(beforePublish.json.data.published === false, 'retro is unpublished before the lifecycle sweep (increment 5) or admin flip (increment 4)');

  sql(`UPDATE kwest_hunts SET retro_published = 1 WHERE tenant_id='${TENANT}' AND slug='gauntlet-persona';`);
  const afterPublish = await api('GET', `/api/t/${TENANT}/kwest/gauntlet-persona/retro`);
  assert(afterPublish.json.data.published === true, 'retro reports published once the flag is set');
  const names = afterPublish.json.data.winners.map((w) => w.display_name);
  assert(names.includes(`Anon ${anonUid}`) && names.includes(`Anon ${realUid}`), `retro winners list includes both finishers by their frozen snapshots (got ${JSON.stringify(names)})`);
}

async function main() {
  console.log('Seeding gauntlet test hunts...');
  seedAll();
  await resetStubs();

  await testHappyPath();
  await testAckEnforcement();
  await testGuestAttach();
  await testIdempotentDoubleReveal();
  await testConcurrentFinishRace();
  await testBudgetCapExhaustion();
  await testSimCoordRejection();
  await testPersonaDisplayChoiceAndRetro();
  await testMinigames();
  await testAdminSuite();
  await testLifecycleAndRetention();
  testOracleTripwire();

  console.log(`\n${failures === 0 ? 'GAUNTLET GREEN' : `GAUNTLET RED - ${failures} failure(s)`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('Gauntlet crashed:', err);
  process.exit(1);
});
