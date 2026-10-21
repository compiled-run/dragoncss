// T154 slice 2a: the select suite's vectors (packages/layout/rt-vectors/select/cases.json), one record per selection document: its
// engine input compiled for native, its facts, and the points and drags packages/parity select-model.test.ts drives Chrome at. The
// translate corpus runs them on the TypeScript harness for the expected results, and Swift and Kotlin must equal them. No browser.
// Run with: pnpm run parity:select-vectors
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { repoPath } from '../paths.ts';
import { SELECT_DOCS, SELECT_VECTORS_PATH, selectVectorsJson } from '../select-cases.ts';

const path = repoPath(SELECT_VECTORS_PATH);
mkdirSync(dirname(path), { recursive: true });
writeFileSync(path, selectVectorsJson());
console.log(`parity:select-vectors: ${SELECT_DOCS.length} selection documents into ${SELECT_VECTORS_PATH}`);
