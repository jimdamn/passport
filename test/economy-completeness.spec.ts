// Fixtures regenerated from production with:
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
// renamed - the test is only as current as the fixtures.
import { describe, it, expect } from 'vitest';
import fixture from './fixtures/kkgame-values.json';
import registry from './fixtures/registry-refs.json';

describe('registry completeness', () => {
  const kkgameIds = fixture[0].results.map((r: any) => r.id as string);
  const registryRefs = registry.map((r: any) => r.source_ref as string);

  it('has a registry row for every kkgame credit-bearing value', () => {
    const refs = new Set(registryRefs);
    const missing = kkgameIds.filter((id) => !refs.has(id));
    expect(missing, `kkgame ids with no economy_values row: ${JSON.stringify(missing)}`).toEqual([]);
  });

  it('has no registry row pointing at a kkgame action or quest that no longer exists', () => {
    const ids = new Set(kkgameIds);
    const orphans = registryRefs.filter((ref) => !ids.has(ref));
    expect(orphans, `economy_values rows with no matching kkgame id: ${JSON.stringify(orphans)}`).toEqual([]);
  });
});
