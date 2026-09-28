// The size of the layout corpus as the FIXTURES registry declares it, counted without compiling: an HTML fixture has one case per
// environment direction, a tree fixture the case count its fixture.json declares in each direction. Count pins in the layout,
// translate and parity tests compare against these, so adding a fixture group changes no literal.
import { readFileSync } from 'node:fs';
import { FIXTURES } from './fixtures.ts';
import { repoPath } from './paths.ts';

/** The DPR-1 layout cases (top-level vectors) the registry declares. */
export function declaredLayoutCaseCount(): number {
  let n = 0;
  for (const spec of FIXTURES) {
    if (spec.kind !== 'layout') continue;
    const perDirection = spec.format === 'tree'
      ? (JSON.parse(readFileSync(repoPath(`packages/parity/fixtures/${spec.id}/fixture.json`), 'utf8')) as { expected: { cases: number } }).expected.cases
      : 1;
    n += perDirection * spec.environments.length;
  }
  return n;
}
