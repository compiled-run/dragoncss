// Proves a migration of committed outputs is additive only (docs/decisions.md, "Adding engine fields and CSS longhands"): every
// file that existed at the base commit either is unchanged or differs only by the new keys, each at its neutral value.
// - Layout vectors (packages/layout/vectors/**, break-vectors/**): each LayoutStyle object gains aspectRatio { kind: "auto" };
//   with those keys removed the file is byte-identical to the base, so inputs, outputs and formatting are unchanged.
// - The calc goldens (packages/layout/vectors/calc) have no generator (T009 kept them by hand), so `--migrate-calc-goldens`
//   inserts the neutral key after textAlign in each of their LayoutStyle objects; the check then proves the result additive.
// Run with: node scripts/check-additive-migration.ts <base-commit> [--migrate-calc-goldens]
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const base = process.argv[2];
if (base === undefined) {
  console.error('usage: node scripts/check-additive-migration.ts <base-commit>');
  process.exit(2);
}

/** A migration: which committed files it covers, and how to remove its additions from one parsed file. */
type Migration = {
  readonly name: string;
  readonly roots: readonly string[];
  /** Removes the added keys in place and returns how many it removed; throws on an added key that is not neutral. */
  readonly strip: (json: unknown, path: string) => number;
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Every LayoutStyle object (it holds textAlign) must carry aspectRatio { kind: "auto" }; removes it and counts. */
function stripAspectRatio(json: unknown, path: string): number {
  let n = 0;
  const walk = (v: unknown, at: string): void => {
    if (Array.isArray(v)) {
      v.forEach((x, i) => walk(x, `${at}[${i}]`));
      return;
    }
    if (!isRecord(v)) return;
    if ('textAlign' in v && 'boxSizing' in v) {
      const ar = v['aspectRatio'];
      if (!isRecord(ar) || ar['kind'] !== 'auto' || Object.keys(ar).length !== 1) throw new Error(`${path} ${at}: aspectRatio is ${JSON.stringify(ar)}, not { kind: "auto" }`);
      delete v['aspectRatio'];
      n++;
    }
    for (const [k, x] of Object.entries(v)) walk(x, `${at}.${k}`);
  };
  walk(json, '$');
  return n;
}

const MIGRATIONS: readonly Migration[] = [
  { name: 'aspectRatio engine field (T050)', roots: ['packages/layout/vectors', 'packages/layout/break-vectors'], strip: stripAspectRatio },
];

function git(args: readonly string[]): string {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 30 });
}

/** The indent of a JSON file written by JSON.stringify(v, null, indent), from its second line. */
function indentOf(text: string): number {
  const second = text.split('\n')[1] ?? '';
  return second.length - second.trimStart().length;
}

/** Inserts aspectRatio { kind: "auto" } after textAlign in every LayoutStyle object that lacks it, keeping key order. */
function addAspectRatio(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(addAspectRatio);
  if (!isRecord(v)) return v;
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v)) {
    out[k] = addAspectRatio(x);
    if (k === 'textAlign' && 'boxSizing' in v && !('aspectRatio' in v)) out['aspectRatio'] = { kind: 'auto' };
  }
  return out;
}

if (process.argv.includes('--migrate-calc-goldens')) {
  const dir = 'packages/layout/vectors/calc';
  for (const f of readdirSync(join(ROOT, dir)).filter((n) => n.endsWith('.json'))) {
    const path = join(ROOT, dir, f);
    const text = readFileSync(path, 'utf8');
    writeFileSync(path, `${JSON.stringify(addAspectRatio(JSON.parse(text)), null, indentOf(text))}\n`);
  }
}

let failures = 0;
for (const m of MIGRATIONS) {
  const files = git(['ls-tree', '-r', '--name-only', base, '--', ...m.roots]).split('\n').filter((f) => f.endsWith('.json'));
  let changed = 0;
  let removed = 0;
  for (const f of files) {
    const before = git(['show', `${base}:${f}`]);
    let after: string;
    try {
      after = readFileSync(join(ROOT, f), 'utf8');
    } catch {
      console.error(`${f}: deleted since ${base}`);
      failures++;
      continue;
    }
    if (after === before) continue;
    changed++;
    try {
      const json = JSON.parse(after) as unknown;
      removed += m.strip(json, f);
      const back = `${JSON.stringify(json, null, indentOf(before))}\n`;
      if (back !== before) {
        console.error(`${f}: differs from ${base} beyond the ${m.name} keys`);
        failures++;
      }
    } catch (e) {
      console.error((e as Error).message);
      failures++;
    }
  }
  console.log(`${m.name}: ${files.length} files at ${base}, ${changed} changed, ${removed} neutral keys added, every other byte identical`);
}
if (failures > 0) {
  console.error(`check-additive-migration: ${failures} failures`);
  process.exit(1);
}
