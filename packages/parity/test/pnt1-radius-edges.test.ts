// PNT1 radius sampling: an edge scanline that comes near another box's rounded arc is dropped whole, since that arc's
// antialiasing decides its colours. radius-clip's f6 overflows its clipping box c6 and its right edge falls on the bottom-left
// arc of c7's nested n7 at every DPR (found on the android 2.625 device run: Chrome saw n7's arc 5 px along the scanline).
import { describe, expect, it } from 'vitest';
import { nativePrograms } from 'dragon';
import { casesOf, fixtureInput } from '../src/cases.ts';
import { DPRS } from '../src/dpr.ts';
import { FIXTURE_GROUPS } from '../src/fixtures.ts';
import { nativeCompile } from '../src/native-host.ts';
import { casePoints } from '../src/pixel-reference.ts';

describe('radius sampling: edge scanlines near another box\'s arc', () => {
  const spec = FIXTURE_GROUPS.flatMap((g) => g.fixtures).find((f) => f.id === 'radius-clip');
  it('drops the scanline of f6\'s right edge and keeps its left edge at every DPR, in both directions', () => {
    if (spec === undefined) throw new Error('no radius-clip fixture');
    for (const c of casesOf(spec, fixtureInput(spec))) {
      const p = nativePrograms(nativeCompile(spec, c.environment.direction), c.assignment);
      if (p.kind !== 'ready') throw new Error(p.reason);
      for (const dpr of DPRS) {
        const rules = new Set(casePoints(p.programs.uikit, c.environment.viewport, dpr).map((q) => q.rule));
        const [dropped, kept] = c.environment.direction === 'rtl' ? ['edge:f6:left', 'edge:f6:right'] : ['edge:f6:right', 'edge:f6:left'];
        expect(rules.has(dropped), `${c.id}@${dpr} ${dropped}`).toBe(false);
        expect(rules.has(kept), `${c.id}@${dpr} ${kept}`).toBe(true);
      }
    }
  });
});
