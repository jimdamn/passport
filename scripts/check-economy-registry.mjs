#!/usr/bin/env node
/**
 * Live check: every credit-bearing value in kkgame has a registry row in
 * krowdkraft-passport's economy_values, and vice versa.
 *
 * Unlike test/economy-completeness.spec.ts, this queries BOTH databases
 * live, at run time, over the network with --remote. It reads no fixture
 * and commits nothing to disk. That is the whole point: it is the only
 * thing in this repo that can actually observe a kkgame action or quest
 * added today with no matching registry row, or a registry row left
 * behind after an action or quest was removed.
 *
 * Requires wrangler auth (already configured in this repo) and network
 * access. Not run automatically by anything yet - see the "on-demand
 * only" note in the header of test/economy-completeness.spec.ts.
 *
 * Usage: npm run check:economy
 */

import { execSync } from 'node:child_process';

function d1(dbName, sql) {
  const out = execSync(
    `npx wrangler d1 execute ${dbName} --remote --json --command="${sql.replace(/"/g, '\\"')}"`,
    { stdio: 'pipe', maxBuffer: 1024 * 1024 * 16 }
  ).toString();
  const parsed = JSON.parse(out);
  return parsed[0]?.results ?? [];
}

function main() {
  console.log('Querying kkgame-db (live, --remote)...');
  const kkgameRows = d1('kkgame-db', 'SELECT id FROM actions UNION ALL SELECT id FROM quests;');
  const kkgameIds = kkgameRows.map((r) => r.id);

  console.log('Querying krowdkraft-passport economy_values (live, --remote)...');
  const registryRows = d1(
    'krowdkraft-passport',
    "SELECT source_ref FROM economy_values WHERE source_kind IN ('kkgame_action','kkgame_quest');"
  );
  const registryRefs = registryRows.map((r) => r.source_ref);

  const idSet = new Set(kkgameIds);
  const refSet = new Set(registryRefs);

  const missing = kkgameIds.filter((id) => !refSet.has(id));
  const orphans = registryRefs.filter((ref) => !idSet.has(ref));

  console.log(`kkgame ids: ${kkgameIds.length}, registry refs: ${registryRefs.length}`);

  let failed = false;

  if (missing.length > 0) {
    failed = true;
    console.error(`FAIL: kkgame ids with no economy_values row: ${JSON.stringify(missing)}`);
  } else {
    console.log('ok: every kkgame id has a registry row');
  }

  if (orphans.length > 0) {
    failed = true;
    console.error(`FAIL: economy_values rows with no matching kkgame id: ${JSON.stringify(orphans)}`);
  } else {
    console.log('ok: every registry row of these two source kinds points at a live kkgame id');
  }

  if (failed) {
    console.error('\nRESULT: registry drift detected against live production.');
    process.exit(1);
  }

  console.log('\nRESULT: registry matches live production, both directions.');
  process.exit(0);
}

main();
