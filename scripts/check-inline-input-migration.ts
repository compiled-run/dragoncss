// Proves the INL1a R5 input migration of committed engine inputs is additive only (docs/decisions.md, "Adding engine fields and
// CSS longhands"): every layout vector that existed at the base commit either is unchanged or differs only by the two new keys,
// each at its neutral value, and no vector was added or deleted.
// - Every LayoutStyle object gains verticalAlign { kind: "keyword", value: "baseline" } (the compiler writes baseline; vertical-align
//   is not a Dragon longhand, so no capture or emitted CSS changes).
// - Every LayoutBox gains strut: null when its children are boxes (or it has none), and otherwise the font and line-height of its
//   first text leaf, which every leaf of the container shares (validate.ts leaf-font), so the strut adds no new metrics.
// With those keys removed each file is byte-identical to the base, so inputs, outputs and formatting are unchanged.
// `--plant <name>` alters one file in memory before the check, which must then fail (PLANTS below).
// Run with: node scripts/check-inline-input-migration.ts <base-commit> [--plant <name>]
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const ROOTS = ['packages/layout/vectors', 'packages/layout/break-vectors'];
const base = process.argv[2];
if (base === undefined || base.startsWith('--')) {
  console.error('usage: node scripts/check-inline-input-migration.ts <base-commit> [--plant <name>]');
  process.exit(2);
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** The indent of a JSON file written by JSON.stringify(v, null, indent), from its second line. */
function indentOf(text: string): number {
  const second = text.split('\n')[1] ?? '';
  return second.length - second.trimStart().length;
}

/** A LayoutStyle object: it holds textAlign and boxSizing. */
const isLayoutStyle = (v: Record<string, unknown>): boolean => 'textAlign' in v && 'boxSizing' in v;
const BASELINE = { kind: 'keyword', value: 'baseline' };

/** The strut the migration writes for a box: its first text leaf's font and line-height, or null when it holds no text. */
function neutralStrut(box: Record<string, unknown>): unknown {
  const kids = Array.isArray(box['children']) ? box['children'] : [];
  const first = kids.find((c) => isRecord(c) && c['kind'] === 'text') as Record<string, unknown> | undefined;
  return first === undefined ? null : { font: first['font'], lineHeight: first['lineHeight'] };
}

/** Removes verticalAlign from every LayoutStyle and strut from every LayoutBox after checking each is neutral; returns the count. */
function strip(json: unknown, path: string): number {
  let n = 0;
  const walk = (v: unknown, at: string): void => {
    if (Array.isArray(v)) {
      v.forEach((x, i) => walk(x, `${at}[${i}]`));
      return;
    }
    if (!isRecord(v)) return;
    if (isLayoutStyle(v)) {
      if (!('verticalAlign' in v)) throw new Error(`${path} ${at}: a LayoutStyle without verticalAlign`);
      if (!same(v['verticalAlign'], BASELINE)) throw new Error(`${path} ${at}: verticalAlign is ${JSON.stringify(v['verticalAlign'])}, not baseline`);
      delete v['verticalAlign'];
      n++;
    }
    if (v['kind'] === 'box' && 'boxType' in v) {
      if (!('strut' in v)) throw new Error(`${path} ${at}: a LayoutBox without strut`);
      if (!same(v['strut'], neutralStrut(v))) throw new Error(`${path} ${at}: strut is ${JSON.stringify(v['strut'])}, not ${JSON.stringify(neutralStrut(v))}`);
      delete v['strut'];
      n++;
    }
    if (v['kind'] === 'inline' || v['kind'] === 'br') throw new Error(`${path} ${at}: an ${String(v['kind'])} node, which no migrated input holds`);
    for (const [k, x] of Object.entries(v)) walk(x, `${at}.${k}`);
  };
  walk(json, '$');
  return n;
}

/** Planted faults, each of which the check must catch: [file suffix, how the text changes]. */
const PLANTS: { readonly [name: string]: readonly [string, (t: string) => string] } = {
  'vector-output': ['layout/vectors/dpr-2/margin-collapse-body.json', (t) => t.replace(/"height": (\d+)/, (_m, n: string) => `"height": ${Number(n) + 1}`)],
  'vertical-align': ['layout/vectors/text-wrap-spaces.json', (t) => t.replace('"value": "baseline"', '"value": "middle"')],
  'strut-font': ['layout/vectors/text-wrap-spaces.json', (t) => t.replace(/("strut": \{\s*"font": \{\s*"family": "Ahem",\s*"size": )(\d+)/, (_m, pre: string, n: string) => `${pre}${Number(n) + 1}`)],
  'strut-on-block': ['layout/vectors/margin-collapse-body.json', (t) => t.replace('"strut": null', '"strut": {"font": {}, "lineHeight": {"kind": "normal"}}')],
  'missing-strut': ['layout/vectors/margin-collapse-body.json', (t) => t.replace(/\n *"strut": null,/, '')],
  'stray-file': ['', (t) => t],
};

const plantAt = process.argv.indexOf('--plant');
const plantName = plantAt < 0 ? null : process.argv[plantAt + 1];
if (plantName !== null && (plantName === undefined || PLANTS[plantName] === undefined)) {
  console.error(`--plant takes one of: ${Object.keys(PLANTS).join(', ')}`);
  process.exit(2);
}
const plant = plantName === null ? null : (PLANTS[plantName] as (typeof PLANTS)[string]);
let planted = false;

function git(args: readonly string[]): string {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 30 });
}

/** Every .json file under a root in the working tree, repository-relative. */
function filesNow(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (name.endsWith('.json')) out.push(relative(ROOT, path));
    }
  };
  if (existsSync(join(ROOT, root))) walk(join(ROOT, root));
  return out;
}

let failures = 0;
const atBase = git(['ls-tree', '-r', '--name-only', base, '--', ...ROOTS]).split('\n').filter((f) => f.endsWith('.json'));
const known = new Set(atBase);
const added = ROOTS.flatMap(filesNow).filter((f) => !known.has(f));
if (plant !== null && plant[0] === '') {
  added.push('packages/layout/vectors/not-a-migrated-vector.json');
  planted = true;
}
for (const f of added) console.error(`${f}: added since ${base}; the migration adds no vector`);
failures += added.length;
let changed = 0;
let removed = 0;
for (const f of atBase) {
  const before = git(['show', `${base}:${f}`]);
  let after: string;
  try {
    after = readFileSync(join(ROOT, f), 'utf8');
  } catch {
    console.error(`${f}: deleted since ${base}`);
    failures++;
    continue;
  }
  if (plant !== null && plant[0] !== '' && f.endsWith(plant[0]) && !planted) {
    const altered = plant[1](after);
    if (altered === after) throw new Error(`plant ${plantName as string} did not change ${f}`);
    after = altered;
    planted = true;
  }
  if (after === before) continue;
  changed++;
  try {
    const json = JSON.parse(after) as unknown;
    removed += strip(json, f);
    if (`${JSON.stringify(json, null, indentOf(before))}\n` !== before) {
      console.error(`${f}: differs from ${base} beyond the strut and verticalAlign additions`);
      failures++;
    }
  } catch (e) {
    console.error((e as Error).message);
    failures++;
  }
}
console.log(`INL1a strut and verticalAlign engine fields: ${atBase.length} files at ${base}, ${changed} changed, ${removed} neutral additions, every other byte identical; ${added.length} files added`);
if (plant !== null && !planted) throw new Error(`plant ${plantName as string} found no file to alter`);
if (failures > 0) {
  console.error(`check-inline-input-migration: ${failures} failures`);
  process.exit(1);
}
