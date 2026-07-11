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
 * non-test callers.
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

async function api(method, path, { body, bearer } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (bearer) headers['Authorization'] = `Bearer ${bearer}`;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
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

function huntInsert(slug, name, budgetCap) {
  return `
INSERT INTO kwest_hunts
  (tenant_id, slug, name, narrative, scope, status, starts_at, ends_at,
   grand_prize_kredits, grand_prize_description, rank2_10_kredits, rank11_20_kredits,
   step_reward_default, minigame_offer_bp, kk_budget_cap, kk_spent, rules_version)
VALUES
  ('${TENANT}', '${slug}', '${name}', 'Test narrative', 'location_specific', 'live',
   unixepoch() - 3600, unixepoch() + 2592000,
   100, '$100 cash', 50, 10, 10, 0, ${budgetCap}, 0, 1);
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

function seedAll() {
  const cleanup = `
DELETE FROM kwest_reveals WHERE hunt_id IN (SELECT id FROM kwest_hunts WHERE tenant_id='${TENANT}' AND slug IN ('gauntlet-core','gauntlet-race','gauntlet-budget','gauntlet-persona'));
DELETE FROM kwest_finishes WHERE hunt_id IN (SELECT id FROM kwest_hunts WHERE tenant_id='${TENANT}' AND slug IN ('gauntlet-core','gauntlet-race','gauntlet-budget','gauntlet-persona'));
DELETE FROM kwest_claims WHERE hunt_id IN (SELECT id FROM kwest_hunts WHERE tenant_id='${TENANT}' AND slug IN ('gauntlet-core','gauntlet-race','gauntlet-budget','gauntlet-persona'));
DELETE FROM kwest_acknowledgements WHERE hunt_id IN (SELECT id FROM kwest_hunts WHERE tenant_id='${TENANT}' AND slug IN ('gauntlet-core','gauntlet-race','gauntlet-budget','gauntlet-persona'));
DELETE FROM kwest_progress WHERE hunt_id IN (SELECT id FROM kwest_hunts WHERE tenant_id='${TENANT}' AND slug IN ('gauntlet-core','gauntlet-race','gauntlet-budget','gauntlet-persona'));
DELETE FROM kwest_minigame_plays WHERE hunt_id IN (SELECT id FROM kwest_hunts WHERE tenant_id='${TENANT}' AND slug IN ('gauntlet-core','gauntlet-race','gauntlet-budget','gauntlet-persona'));
DELETE FROM kwest_steps WHERE hunt_id IN (SELECT id FROM kwest_hunts WHERE tenant_id='${TENANT}' AND slug IN ('gauntlet-core','gauntlet-race','gauntlet-budget','gauntlet-persona'));
DELETE FROM kwest_hunts WHERE tenant_id='${TENANT}' AND slug IN ('gauntlet-core','gauntlet-race','gauntlet-budget','gauntlet-persona');
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
  sql(cleanup + core + race + budget + persona);
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

function testOracleTripwire() {
  console.log('\n-- oracle tripwire --');
  const leaks = allResponseBodies.filter((r) => r.text.includes('target_'));
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
  testOracleTripwire();

  console.log(`\n${failures === 0 ? 'GAUNTLET GREEN' : `GAUNTLET RED - ${failures} failure(s)`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('Gauntlet crashed:', err);
  process.exit(1);
});
