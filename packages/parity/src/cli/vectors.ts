// Writes packages/layout/vectors/<fixture>.json ({input, output}) for each fixture that passes against its committed
// Chrome capture. Vectors are regenerated only by this script: pnpm run layout:vectors
import { readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import type { WebCapture } from '../capture.ts';
import { FIXTURES } from '../fixtures.ts';
import { repoPath } from '../paths.ts';
import { runFixture } from '../pipeline.ts';

const dir = repoPath('packages/layout/vectors');
for (const f of readdirSync(dir)) if (f.endsWith('.json')) rmSync(`${dir}/${f}`);
let written = 0;
for (const spec of FIXTURES) {
  if (spec.kind !== 'layout') continue;
  const capture = JSON.parse(readFileSync(repoPath(`packages/parity/expected/${spec.id}.web.json`), 'utf8')) as WebCapture;
  const outcome = runFixture(spec, capture);
  if (outcome.status !== 'pass' || outcome.vector === null) {
    console.log(`skipped ${spec.id}: ${outcome.reason}`);
    continue;
  }
  writeFileSync(`${dir}/${spec.id}.json`, `${JSON.stringify(outcome.vector, null, 1)}\n`);
  written++;
}
console.log(`wrote ${written} vectors to packages/layout/vectors`);
