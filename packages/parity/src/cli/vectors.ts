// Writes packages/layout/vectors/<case>.json ({platform, measurer, input, output}, format in packages/layout/vectors/README.md)
// for each case that passes both lanes against its committed reference capture; a shaped case (text-latin-run.ts) writes its vector
// with the shape transcript to packages/layout/vectors/text-latin/dpr-1/ instead. Vectors are regenerated only by this script:
// pnpm run layout:vectors
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { measurerFor, NO_ENGINE_FAULTS } from '@dragon/layout';
import { NO_FAULTS } from 'dragon';
import { launchChrome } from '../chrome.ts';
import { committedAuthored, vectorPath } from '../committed.ts';
import { FIXTURES } from '../fixtures.ts';
import { repoPath } from '../paths.ts';
import { REFERENCE_PLATFORM } from '../platform.ts';
import { runFixture } from '../pipeline.ts';
import { isShapedInput, textLatinVector, textLatinVectorDir, textLatinVectorPath, textLatinVectorText } from '../text-latin-run.ts';

const choice = measurerFor(REFERENCE_PLATFORM);
if (choice.kind !== 'ok') throw new Error(`${choice.code}: ${choice.detail}`);
const key = choice.key;
const dir = repoPath('packages/layout/vectors');
for (const f of readdirSync(dir)) if (f.endsWith('.json')) rmSync(`${dir}/${f}`);
const shapedDir = textLatinVectorDir(1);
mkdirSync(shapedDir, { recursive: true });
for (const f of readdirSync(shapedDir)) if (f.endsWith('.json')) rmSync(`${shapedDir}/${f}`);
let written = 0;
let shaped = 0;
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
      if (isShapedInput(c.vector.input)) {
        writeFileSync(textLatinVectorPath(c.id, 1), textLatinVectorText(textLatinVector(c.vector.input)));
        shaped++;
        continue;
      }
      writeFileSync(vectorPath(c.id), `${JSON.stringify({ platform: REFERENCE_PLATFORM, measurer: key, input: c.vector.input, output: c.vector.output }, null, 1)}\n`);
      written++;
    }
  }
} finally {
  await browser.close();
}
console.log(`wrote ${written} vectors to packages/layout/vectors and ${shaped} shaped vectors to packages/layout/vectors/text-latin/dpr-1`);
