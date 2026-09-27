// Writes packages/layout/vectors/<case>.json ({platform, measurer, input, output}, format in packages/layout/vectors/README.md)
// for each case that passes both lanes against its committed reference capture. Vectors are regenerated only by this script:
// pnpm run layout:vectors
import { readdirSync, rmSync, writeFileSync } from 'node:fs';
import { measurerFor, NO_ENGINE_FAULTS } from '@dragon/layout';
import { NO_FAULTS } from 'dragon';
import { launchChrome } from '../chrome.ts';
import { committedAuthored, vectorPath } from '../committed.ts';
import { FIXTURES } from '../fixtures.ts';
import { repoPath } from '../paths.ts';
import { REFERENCE_PLATFORM } from '../platform.ts';
import { runFixture } from '../pipeline.ts';

const choice = measurerFor(REFERENCE_PLATFORM);
if (choice.kind !== 'ok') throw new Error(`${choice.code}: ${choice.detail}`);
const key = choice.key;
const dir = repoPath('packages/layout/vectors');
for (const f of readdirSync(dir)) if (f.endsWith('.json')) rmSync(`${dir}/${f}`);
let written = 0;
const browser = await launchChrome();
try {
  for (const spec of FIXTURES) {
    if (spec.kind !== 'layout') continue;
    const outcome = await runFixture(spec, browser, { authored: committedAuthored, faults: NO_FAULTS, engineFaults: NO_ENGINE_FAULTS, profiles: 'enforce' });
    for (const c of outcome.cases) {
      if (c.status !== 'pass' || c.vector === null) {
        console.log(`skipped ${c.id}: ${c.reason}`);
        continue;
      }
      writeFileSync(vectorPath(c.id), `${JSON.stringify({ platform: REFERENCE_PLATFORM, measurer: key, input: c.vector.input, output: c.vector.output }, null, 1)}\n`);
      written++;
    }
  }
} finally {
  await browser.close();
}
console.log(`wrote ${written} vectors to packages/layout/vectors`);
