// The layout case count the fixture registry declares, independent of case enumeration: one case per environment of an HTML
// fixture, and a tree fixture's hand-declared case count (fixture.json "expected.cases") per environment.
import type { FixtureSpec } from '../src/fixtures.ts';
import { environmentsOf, FIXTURE_GROUPS, FIXTURES } from '../src/fixtures.ts';
import { readTreeExpectation } from '../src/tree-fixture.ts';

export function declaredLayoutCases(fixtures: readonly FixtureSpec[] = FIXTURES): number {
  let n = 0;
  for (const spec of fixtures) {
    if (spec.kind !== 'layout') continue;
    const declared = spec.format === 'tree' ? readTreeExpectation(spec.id)?.cases : 1;
    if (declared === undefined) throw new Error(`${spec.id} declares no case count`);
    n += declared * environmentsOf(spec).length;
  }
  return n;
}

/** The frozen milestone-1 group: 261 cases, pinned so the derived totals can never shrink below it. */
export const MILESTONE_1_CASES = 261;
export const milestone1Fixtures = (): readonly FixtureSpec[] => (FIXTURE_GROUPS.find((g) => g.id === 'milestone-1') as { fixtures: readonly FixtureSpec[] }).fixtures;
