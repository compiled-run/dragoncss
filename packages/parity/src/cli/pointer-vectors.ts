// Writes packages/layout/rt-vectors/pointer/cases.json (MQ-R2): every input device set with Chromium's Java rule's readings.
// Needs a JDK (JAVA_HOME, as the device lanes' Android tools do). Run: pnpm run parity:pointer-vectors
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { repoPath } from '../paths.ts';
import { POINTER_VECTORS_PATH, pointerVectorsJson } from '../pointer-vectors.ts';

const javaHome = process.env['JAVA_HOME'];
if (javaHome === undefined || javaHome === '') {
  console.error('parity:pointer-vectors needs JAVA_HOME (a JDK with javac)');
  process.exit(2);
}
const path = repoPath(POINTER_VECTORS_PATH);
mkdirSync(dirname(path), { recursive: true });
writeFileSync(path, pointerVectorsJson(javaHome));
console.log(`wrote ${POINTER_VECTORS_PATH}`);
