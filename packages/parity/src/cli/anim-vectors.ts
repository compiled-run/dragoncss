// T065 3b: the animator suite's vectors (packages/layout/rt-vectors/animator/cases.json), one record per frame case: its tables,
// every assignment's engine input resolved for its environment, and its frame script as animator steps. The translate corpus runs
// them on the TypeScript harness for the expected results, and Swift and Kotlin must equal them. No browser.
// Run with: pnpm run parity:anim-vectors
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { animCasesOf, animFixtures, ANIMATOR_VECTORS_PATH, animatorVectorsJson } from '../anim-cases.ts';
import { repoPath } from '../paths.ts';

const cases = animFixtures().flatMap(animCasesOf);
const path = repoPath(ANIMATOR_VECTORS_PATH);
mkdirSync(dirname(path), { recursive: true });
writeFileSync(path, animatorVectorsJson(cases));
console.log(`parity:anim-vectors: ${cases.length} frame cases into ${ANIMATOR_VECTORS_PATH}`);
