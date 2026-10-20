// MQ-R1: the band suite's vectors (packages/layout/rt-vectors/band/cases.json). Run with: pnpm run parity:band-vectors
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { BAND_VECTORS_PATH, bandVectorsJson } from '../band-vectors.ts';
import { repoPath } from '../paths.ts';

const path = repoPath(BAND_VECTORS_PATH);
mkdirSync(dirname(path), { recursive: true });
const text = bandVectorsJson();
writeFileSync(path, text);
const cases = (JSON.parse(text) as { cases: { sizes: unknown[] }[] }).cases;
console.log(`parity:band-vectors: ${cases.length} band tables, ${cases.reduce((n, c) => n + c.sizes.length, 0)} sizes into ${BAND_VECTORS_PATH}`);
