// pnpm run layout:paint-vectors (EMS, notes/T046-paint-spec.md §3 item 5): the paint vectors of every paint seam file, from the
// TypeScript reference. For each feature (paint-<feature>.ts in translate/src/generate.ts PAINT_ROOT_FILES) it reads the case
// lines a paint package commits in packages/layout/paint-vectors/<feature>/inputs.jsonl, runs each through the translated
// harness's TypeScript source (units mode, "paint:<feature>:<function>" names) and writes <feature>/vectors.json. A feature with
// no inputs gets an empty suite. --check fails when a committed file differs from a fresh run.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { repoPath } from '../paths.ts';

export const PAINT_VECTORS_DIR = 'packages/layout/paint-vectors';

type Generate = { readonly PAINT_ROOT_FILES: readonly string[] };
type Harness = { readonly runUnitsCase: (line: string) => string };

/** The paint features: the paint-<feature>.ts seam files, in PAINT_ROOT_FILES order. */
export function paintFeatures(rootFiles: readonly string[]): string[] {
  return rootFiles.filter((f) => f.startsWith('paint-')).map((f) => f.slice('paint-'.length, -'.ts'.length));
}

/** The vectors file text of one feature from its input lines and the TypeScript results. */
export function vectorsText(feature: string, lines: readonly string[], run: (line: string) => string): string {
  const expected = lines.map((l) => {
    const r = run(l);
    if (!r.startsWith('["ok"')) throw new Error(`paint vector ${l} of ${feature} gives ${r}; register its root in harness.ts paintResult`);
    return r;
  });
  const note = `Written by pnpm run layout:paint-vectors from paint-${feature}.ts through the harness (units mode); native runs must equal expected bit for bit.`;
  return `${JSON.stringify({ note, feature, cases: lines.length, lines, expected }, null, 2)}\n`;
}

async function main(): Promise<void> {
  const gen = (await import(pathToFileURL(repoPath('packages/translate/src/generate.ts')).href)) as Generate;
  const harness = (await import(pathToFileURL(repoPath('packages/translate/harness/harness.ts')).href)) as Harness;
  const check = process.argv.includes('--check');
  const stale: string[] = [];
  for (const feature of paintFeatures(gen.PAINT_ROOT_FILES)) {
    const dir = repoPath(join(PAINT_VECTORS_DIR, feature));
    const inputs = join(dir, 'inputs.jsonl');
    const lines = existsSync(inputs) ? readFileSync(inputs, 'utf8').split('\n').filter((l) => l.length > 0) : [];
    const text = vectorsText(feature, lines, harness.runUnitsCase);
    const out = join(dir, 'vectors.json');
    if (check) {
      if (!existsSync(out) || readFileSync(out, 'utf8') !== text) stale.push(`${PAINT_VECTORS_DIR}/${feature}/vectors.json`);
      continue;
    }
    mkdirSync(dir, { recursive: true });
    writeFileSync(out, text);
    console.log(`layout:paint-vectors: ${feature} ${lines.length} cases`);
  }
  if (stale.length > 0) {
    console.log(`layout:paint-vectors: stale (run pnpm run layout:paint-vectors):\n  ${stale.join('\n  ')}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
