// Writes packages/layout/vectors/<fixture>.json ({input, output}) for each fixture that passes both lanes against its
// committed Chrome capture. Vectors are regenerated only by this script: pnpm run layout:vectors
import { readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { NO_FAULTS } from 'dragon';
import type { WebCapture } from '../capture.ts';
import { launchChrome } from '../chrome.ts';
import { FIXTURES } from '../fixtures.ts';
import { repoPath } from '../paths.ts';
import { runFixture } from '../pipeline.ts';

const dir = repoPath('packages/layout/vectors');
for (const f of readdirSync(dir)) if (f.endsWith('.json')) rmSync(`${dir}/${f}`);
let written = 0;
const browser = await launchChrome();
try {
  for (const spec of FIXTURES) {
    if (spec.kind !== 'layout') continue;
    const authored = JSON.parse(readFileSync(repoPath(`packages/parity/expected/${spec.id}.web.json`), 'utf8')) as WebCapture;
    const outcome = await runFixture(spec, browser, { authored, faults: NO_FAULTS });
    if (outcome.status !== 'pass' || outcome.vector === null) {
      console.log(`skipped ${spec.id}: ${outcome.reason}`);
      continue;
    }
    writeFileSync(`${dir}/${spec.id}.json`, `${JSON.stringify(outcome.vector, null, 1)}\n`);
    written++;
  }
} finally {
  await browser.close();
}
console.log(`wrote ${written} vectors to packages/layout/vectors`);
