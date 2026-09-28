// The size of the layout corpus as the FIXTURES registry declares it, counted without compiling: an HTML fixture has one case per
// environment direction, a tree fixture the case count its fixture.json declares in each direction. Count pins in the parity tests
// compare against these, so adding a fixture group changes no literal.
import type { FixtureSpec } from './fixtures.ts';
import { environmentsOf, FIXTURE_GROUPS, FIXTURES } from './fixtures.ts';
import { readTreeExpectation } from './tree-fixture.ts';

/** The layout cases of the frozen milestone-1 fixture group (seams.test.ts pins its specs); the corpus never shrinks below it. */
export const MILESTONE_1_LAYOUT_CASES = 261;

/** The DPR-1 layout cases (top-level vectors) the given fixtures declare, by default the whole registry. */
export function declaredLayoutCaseCount(fixtures: readonly FixtureSpec[] = FIXTURES): number {
  let n = 0;
  for (const spec of fixtures) {
    if (spec.kind !== 'layout') continue;
    const perDirection = spec.format === 'tree' ? readTreeExpectation(spec.id)?.cases : 1;
    if (perDirection === undefined) throw new Error(`${spec.id} declares no case count (fixture.json "expected.cases")`);
    n += perDirection * environmentsOf(spec).length;
  }
  return n;
}

/** The fixtures of one registry group. */
export function groupFixtures(id: string): readonly FixtureSpec[] {
  const group = FIXTURE_GROUPS.find((g) => g.id === id);
  if (group === undefined) throw new Error(`no fixture group ${id}`);
  return group.fixtures;
}
