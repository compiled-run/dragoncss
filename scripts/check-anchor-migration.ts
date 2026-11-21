// Proves the css-anchor-position-1 migration of committed outputs is additive only (docs/decisions.md, "Adding engine fields and
// CSS longhands"): the engine field LayoutStyle.anchor is null on every box that is not anchored, so every file that existed at the
// base commit either is unchanged or differs only by "anchor": null after "gridItem" in each LayoutStyle object; with those keys
// removed it is byte-identical to the base. Every file added since the base belongs to a fixture added since the base.
// - Layout vectors (packages/layout/vectors/**, break-vectors/**, rt-vectors/**) and the translator corpora
//   (packages/translate/corpus*.json): each LayoutStyle object gains "anchor": null.
// - The calc goldens (packages/layout/vectors/calc) and the vectors README example have no generator (T009 kept them by hand), so
//   `--migrate-hand-written` inserts the neutral key after gridItem in each of their LayoutStyle objects; the check then proves it.
// `--plant <name>` alters one file in memory before the check, which must then fail (PLANTS below).
// Run with: node scripts/check-anchor-migration.ts <base-commit> [--migrate-hand-written] [--plant <name>]
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const base = process.argv[2];
if (base === undefined || base.startsWith('--')) {
  console.error('usage: node scripts/check-anchor-migration.ts <base-commit> [--migrate-hand-written] [--plant <name>]');
  process.exit(2);
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
/** A LayoutStyle object: it holds textAlign, boxSizing and gridItem. */
const isLayoutStyle = (v: Record<string, unknown>): boolean => 'textAlign' in v && 'boxSizing' in v && 'gridItem' in v;

/** The indent of a JSON file written by JSON.stringify(v, null, indent), from its second line. */
function indentOf(text: string): number {
  const second = text.split('\n')[1] ?? '';
  return second.length - second.trimStart().length;
}

/** Removes "anchor" from every LayoutStyle object after checking it is null; returns how many it removed. */
function stripAnchor(json: unknown, path: string): number {
  let n = 0;
  const walk = (v: unknown, at: string): void => {
    if (Array.isArray(v)) {
      v.forEach((x, i) => walk(x, `${at}[${i}]`));
      return;
    }
    if (!isRecord(v)) return;
    if (isLayoutStyle(v)) {
      if (!('anchor' in v)) throw new Error(`${path} ${at}: a LayoutStyle without anchor`);
      if (v['anchor'] !== null) throw new Error(`${path} ${at}: anchor is ${JSON.stringify(v['anchor'])}, not null`);
      const keys = Object.keys(v);
      if (keys[keys.indexOf('anchor') - 1] !== 'gridItem') throw new Error(`${path} ${at}: anchor does not follow gridItem`);
      delete v['anchor'];
      n++;
    }
    for (const [k, x] of Object.entries(v)) walk(x, `${at}.${k}`);
  };
  walk(json, '$');
  return n;
}

/** Inserts "anchor": null after gridItem in every LayoutStyle object that lacks it, keeping key order. */
function addAnchor(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(addAnchor);
  if (!isRecord(v)) return v;
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v)) {
    out[k] = addAnchor(x);
    if (k === 'gridItem' && isLayoutStyle(v) && !('anchor' in v)) out['anchor'] = null;
  }
  return out;
}

const ROOTS = ['packages/layout/vectors', 'packages/layout/break-vectors', 'packages/layout/rt-vectors'];
const CORPORA = ['packages/translate/corpus.json', 'packages/translate/corpus-dpr.json'];
/** Files keyed by case: every case of the base keeps its entry exactly; the only new keys are the new fixtures' cases. */
const KEYED = new Set(['packages/layout/rt-vectors/hit/facts.json']);
/**
 * The corpus locks hold counts and sha256 digests of the vector files checked one by one above, so they change with any vector;
 * they are rebuilt by native-gen and checked by the translator tests, not here.
 */
const LOCKS = new Set(CORPORA);

if (process.argv.includes('--migrate-hand-written')) {
  const dir = 'packages/layout/vectors/calc';
  for (const f of readdirSync(join(ROOT, dir)).filter((n) => n.endsWith('.json'))) {
    const path = join(ROOT, dir, f);
    const text = readFileSync(path, 'utf8');
    writeFileSync(path, `${JSON.stringify(addAnchor(JSON.parse(text)), null, indentOf(text))}\n`);
  }
  // The README's example input, the fenced block opened by FENCE.
  const readmePath = join(ROOT, 'packages/layout/vectors/README.md');
  const readme = readFileSync(readmePath, 'utf8');
  const FENCE = '```json vector-input\n';
  const open = readme.indexOf(FENCE);
  const close = readme.indexOf('\n```', open + FENCE.length);
  if (open < 0 || close < 0) throw new Error('the vectors README has no vector-input example');
  const example = readme.slice(open + FENCE.length, close);
  const migrated = JSON.stringify(addAnchor(JSON.parse(example)), null, indentOf(`${example}\n`));
  writeFileSync(readmePath, readme.slice(0, open + FENCE.length) + migrated + readme.slice(close));
}

const PLANTS: { readonly [name: string]: readonly [string, (t: string) => string] } = {
  'vector-output': ['layout/vectors/dpr-2/margin-collapse-body.json', (t) => t.replace(/"height": (\d+)/, (_m, n: string) => `"height": ${Number(n) + 1}`)],
  'anchor-value': ['layout/vectors/dpr-2/margin-collapse-body.json', (t) => t.replace('"anchor": null', '"anchor": { "anchor": null, "options": [], "order": "normal" }')],
  'anchor-missing': ['layout/vectors/dpr-2/margin-collapse-body.json', (t) => t.replace(/,\n\s*"anchor": null/, '')],
};
const plantAt = process.argv.indexOf('--plant');
const plantName = plantAt < 0 ? null : process.argv[plantAt + 1];
if (plantName !== null && (plantName === undefined || PLANTS[plantName] === undefined)) {
  console.error(`--plant takes one of: ${Object.keys(PLANTS).join(', ')}`);
  process.exit(2);
}
const plant = plantName === null ? null : (PLANTS[plantName] as (typeof PLANTS)[string]);
let planted = false;

const git = (args: readonly string[]): string => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 30 });

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

const fixtureIds = (names: readonly string[]): Set<string> => new Set(names.filter((n) => n.endsWith('.html')).map((n) => basename(n, '.html')));
const fixturesAtBase = fixtureIds(git(['ls-tree', '--name-only', `${base}:packages/parity/fixtures`]).split('\n'));
const newFixtures = [...fixtureIds(readdirSync(join(ROOT, 'packages/parity/fixtures')))].filter((id) => !fixturesAtBase.has(id));
const ofNewFixture = (path: string): boolean => newFixtures.some((id) => basename(path).startsWith(`${id}.`) || basename(path).startsWith(`${id}-rtl.`));

let failures = 0;
const atBase = [...git(['ls-tree', '-r', '--name-only', base, '--', ...ROOTS]).split('\n').filter((f) => f.endsWith('.json')), ...CORPORA];
const known = new Set(atBase);
const added = ROOTS.flatMap(filesNow).filter((f) => !known.has(f));
const stray = added.filter((f) => !ofNewFixture(f));
for (const f of stray) console.error(`${f}: added since ${base}, but no fixture added since then owns it`);
failures += stray.length;
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
  if (plant !== null && f.endsWith(plant[0])) {
    after = plant[1](after);
    planted = true;
  }
  if (after === before || LOCKS.has(f)) continue;
  changed++;
  if (KEYED.has(f)) {
    const was = JSON.parse(before) as Record<string, unknown>;
    const now = JSON.parse(after) as Record<string, unknown>;
    // { cases, refused }: each a map from case id to its facts or its refusal.
    for (const part of [...new Set([...Object.keys(was), ...Object.keys(now)])]) {
      const a = isRecord(was[part]) ? (was[part] as Record<string, unknown>) : {};
      const b = isRecord(now[part]) ? (now[part] as Record<string, unknown>) : {};
      for (const [k, v] of Object.entries(a)) if (JSON.stringify(b[k]) !== JSON.stringify(v)) { console.error(`${f}: ${part}.${k} changed`); failures++; }
      for (const k of Object.keys(b)) if (!(k in a) && !newFixtures.some((id) => k === id || k === `${id}-rtl`)) { console.error(`${f}: ${part}.${k} is new but belongs to no new fixture`); failures++; }
    }
    continue;
  }
  try {
    const json = JSON.parse(after) as unknown;
    removed += stripAnchor(json, f);
    const text = `${JSON.stringify(json, null, indentOf(before))}\n`;
    if (text !== before) {
      console.error(`${f}: differs from ${base} by more than "anchor": null`);
      failures++;
    }
  } catch (e) {
    console.error((e as Error).message);
    failures++;
  }
}
if (plant !== null && !planted) {
  console.error(`plant ${plantName}: its file is not among the checked files`);
  process.exit(2);
}
console.log(`check-anchor-migration: ${changed} changed file(s), ${removed} "anchor": null removed, ${added.length} new file(s) of new fixtures, ${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
