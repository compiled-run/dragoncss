import { it } from 'vitest';
import { nativePrograms } from 'dragon';
import { casesOf, fixtureInput } from '../src/cases.ts';
import { FIXTURE_GROUPS } from '../src/fixtures.ts';
import { nativeCompile } from '../src/native-host.ts';
import { ccTileIndex, ccTileSize, ccTileStart, ccTileEnd } from '../../layout/src/paint-dither.ts';
import { debugBoxes } from './pnt1-effects.test.ts';
it('debug', () => {
  const spec = FIXTURE_GROUPS.find((g) => g.id === 'effects')!.fixtures.find((f) => f.id === 'opacity-group-outline')!;
  for (const c of casesOf(spec, fixtureInput(spec))) {
    const p = (nativePrograms(nativeCompile(spec, c.environment.direction), c.assignment) as any).programs.uikit;
    const dpr = 2;
    const size = ccTileSize(true, dpr);
    for (const b of debugBoxes(p, c.environment.viewport, dpr)) if (['ga', 'gb', 'gc', 'stage', 'html', 'body'].includes(b.node.id)) console.log(c.id, b.node.id, b.l, b.t, b.r, b.b, 'tiles', ccTileIndex(b.l, size), ccTileIndex(b.r - 1, size), 'rootX', (b.node.facts as any)['background']?.rootX);
    console.log('tile1', ccTileStart(1, size), ccTileEnd(1, size));
  }
});
