// IMPORTANT: this is an offline self-consistency check of two COMMITTED
// fixture files, both captured from production at the same moment. It
// CANNOT detect production drift - if a kkgame action or quest is added
// (or removed) after these fixtures were generated, this test keeps
// reading the frozen snapshot and keeps passing regardless. Nothing in
// this repo runs it automatically against live data.
//
// The only thing that actually checks live production, at run time, in
// both directions, is `npm run check:economy`
// (scripts/check-economy-registry.mjs). That script is what protects
// against a future award being added with no registry row. Until someone
// schedules it (cron, CI step, pre-deploy gate), it is on-demand only -
// run it manually whenever a kkgame action or quest changes.
//
// Fixtures here were generated from production with:
//
//   mkdir -p test/fixtures
//   npx wrangler d1 execute kkgame-db --remote --json --command \
//     "SELECT id FROM actions UNION ALL SELECT id FROM quests;" > test/fixtures/kkgame-values.json
//   npx wrangler d1 execute krowdkraft-passport --remote --json --command \
//     "SELECT source_ref FROM economy_values WHERE source_kind IN ('kkgame_action','kkgame_quest');" \
//     | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);process.stdout.write(JSON.stringify(j[0].results,null,2)+'\n')})" \
//     > test/fixtures/registry-refs.json
//
// Regenerate both whenever a kkgame action or quest is added, removed, or
// renamed, so this fixture-consistency check keeps matching the shape of
// production it was taken from. Regenerating the fixtures right after a
// mismatch is exactly the blind spot the check:economy script exists to
// close - this test alone would never have noticed the mismatch in the
// first place.
import { describe, it, expect } from 'vitest';
import fixture from './fixtures/kkgame-values.json';
import registry from './fixtures/registry-refs.json';

describe('fixture self-consistency (offline, not a production check)', () => {
  const kkgameIds = fixture[0].results.map((r: any) => r.id as string);
  const registryRefs = registry.map((r: any) => r.source_ref as string);

  it('the committed kkgame-values fixture agrees with the committed registry-refs fixture (forward direction)', () => {
    const refs = new Set(registryRefs);
    const missing = kkgameIds.filter((id) => !refs.has(id));
    expect(missing, `kkgame ids with no matching entry in registry-refs.json: ${JSON.stringify(missing)}`).toEqual([]);
  });

  it('the committed registry-refs fixture agrees with the committed kkgame-values fixture (reverse direction)', () => {
    const ids = new Set(kkgameIds);
    const orphans = registryRefs.filter((ref) => !ids.has(ref));
    expect(orphans, `registry-refs.json entries with no matching id in kkgame-values.json: ${JSON.stringify(orphans)}`).toEqual([]);
  });
});
