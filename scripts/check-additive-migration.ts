// Proves a migration of committed engine inputs is additive only (docs/decisions.md, "Adding engine fields and CSS longhands"):
// every vector file that existed at the base commit either is unchanged or, with the migration's additions taken out, is
// byte-identical to the base, so every output, every other input and the formatting are unchanged.
// V2a of the value model (notes/T012-v2-spec.md, ruling 1) adds to every LayoutInput under packages/layout/vectors:
// - viewportUnits, equal to { small, large, dynamic } of the input's own viewport;
// - safeArea, all four insets 0;
// - rootFontSize, a positive finite number (the compiler's root font size at text scale 1);
// - on every text leaf font, specifiedSize { kind: "px", value: <size> } and absoluteSize true;
// - on every viewport calculation leaf, size "large" (plain vw, vh, vi, vb, vmin and vmax read the large viewport).
// The calc goldens (packages/layout/vectors/calc) have no generator (T009 kept them by hand), so `--migrate-calc-goldens` inserts
// the neutral keys into them, in the engine's field order; the check then proves the result additive.
// `--plant <name>` alters one file in memory before the check, which must then fail (PLANTS below).
// Run with: node scripts/check-additive-migration.ts <base-commit> [--migrate-calc-goldens] [--plant <name>]
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const base = process.argv[2];
if (base === undefined || base.startsWith('--')) {
  console.error('usage: node scripts/check-additive-migration.ts <base-commit> [--migrate-calc-goldens] [--plant <name>]');
  process.exit(2);
}

const VECTORS = 'packages/layout/vectors';

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** The indent of a JSON file written by JSON.stringify(v, null, indent), from its second line. */
function indentOf(text: string): number {
  const second = text.split('\n')[1] ?? '';
  return second.length - second.trimStart().length;
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** A LayoutInput object: it holds devicePixelRatio and root. */
const isInput = (v: Record<string, unknown>): boolean => 'devicePixelRatio' in v && 'root' in v && 'viewport' in v;
/** A text leaf's font: it holds family and size. */
const isFont = (v: Record<string, unknown>): boolean => 'family' in v && 'size' in v && !('kind' in v);
const isViewportLeaf = (v: Record<string, unknown>): boolean => v['kind'] === 'viewport' && 'axis' in v;

/** Removes the V2a additions from one parsed file, checking each is neutral; returns how many objects it touched. */
function stripV2a(json: unknown, path: string): number {
  let n = 0;
  const bad = (at: string, what: string): never => {
    throw new Error(`${path} ${at}: ${what}`);
  };
  const walk = (v: unknown, at: string): void => {
    if (Array.isArray(v)) {
      v.forEach((x, i) => walk(x, `${at}[${i}]`));
      return;
    }
    if (!isRecord(v)) return;
    if (isInput(v)) {
      const vp = v['viewport'];
      if (!same(v['viewportUnits'], { small: vp, large: vp, dynamic: vp })) bad(at, `viewportUnits is ${JSON.stringify(v['viewportUnits'])}, not the viewport's`);
      if (!same(v['safeArea'], { top: 0, right: 0, bottom: 0, left: 0 })) bad(at, `safeArea is ${JSON.stringify(v['safeArea'])}, not zero`);
      const r = v['rootFontSize'];
      if (typeof r !== 'number' || !Number.isFinite(r) || r <= 0) bad(at, `rootFontSize is ${JSON.stringify(r)}, not a positive number`);
      delete v['viewportUnits'];
      delete v['safeArea'];
      delete v['rootFontSize'];
      n++;
    }
    if (isFont(v)) {
      if (!same(v['specifiedSize'], { kind: 'px', value: v['size'] })) bad(at, `specifiedSize is ${JSON.stringify(v['specifiedSize'])}, not px ${String(v['size'])}`);
      if (v['absoluteSize'] !== true) bad(at, `absoluteSize is ${JSON.stringify(v['absoluteSize'])}, not true`);
      delete v['specifiedSize'];
      delete v['absoluteSize'];
      n++;
    }
    if (isViewportLeaf(v)) {
      if (v['size'] !== 'large') bad(at, `a viewport leaf's size is ${JSON.stringify(v['size'])}, not "large"`);
      delete v['size'];
      n++;
    }
    for (const [k, x] of Object.entries(v)) walk(x, `${at}.${k}`);
  };
  walk(json, '$');
  return n;
}

/** Inserts the neutral V2a keys in the engine's field order, into every object that lacks them. */
function addV2a(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(addV2a);
  if (!isRecord(v)) return v;
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v)) {
    if (k === 'root' && isInput(v) && !('rootFontSize' in v)) {
      const vp = v['viewport'];
      out['viewportUnits'] = { small: vp, large: vp, dynamic: vp };
      out['safeArea'] = { top: 0, right: 0, bottom: 0, left: 0 };
      out['rootFontSize'] = 16;
    }
    out[k] = addV2a(x);
    if (k === 'size' && isFont(v) && !('specifiedSize' in v)) {
      out['specifiedSize'] = { kind: 'px', value: x };
      out['absoluteSize'] = true;
    }
    if (k === 'axis' && isViewportLeaf(v) && !('size' in v)) out['size'] = 'large';
  }
  return out;
}

/** Planted faults, each of which the check must catch: [file suffix, how the text changes]. */
const PLANTS: { readonly [name: string]: readonly [string, (t: string) => string] } = {
  'vector-output': ['vectors/dpr-2/margin-collapse-body.json', (t) => {
    const at = t.lastIndexOf('"height": ');
    const m = /^"height": (\d+)/.exec(t.slice(at)) as RegExpExecArray;
    return `${t.slice(0, at)}"height": ${Number(m[1]) + 1}${t.slice(at + m[0].length)}`;
  }],
  'root-font-size': ['vectors/margin-collapse-body.json', (t) => t.replace(/"rootFontSize": [0-9.]+/, '"rootFontSize": 0')],
  'safe-area': ['vectors/margin-collapse-body.json', (t) => t.replace(/"top": 0,/, '"top": 3,')],
  'font-spec': ['vectors/text-fractional-font-size.json', (t) => t.replace('"absoluteSize": true', '"absoluteSize": false')],
  'viewport-size': ['vectors/values-viewport-units.json', (t) => t.replace('"size": "large"', '"size": "small"')],
  'input-value': ['vectors/margin-collapse-body.json', (t) => t.replace(/"marginTop": \{\n(\s*)"kind": "px",\n(\s*)"value": (\d+)/, (_m, a: string, b: string, n: string) => `"marginTop": {\n${a}"kind": "px",\n${b}"value": ${Number(n) + 1}`)],
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

if (process.argv.includes('--migrate-calc-goldens')) {
  const dir = join(ROOT, VECTORS, 'calc');
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.json'))) {
    const path = join(dir, f);
    const text = readFileSync(path, 'utf8');
    writeFileSync(path, `${JSON.stringify(addV2a(JSON.parse(text)), null, indentOf(text))}\n`);
  }
}

/** Every JSON file under the vectors directory in the working tree, repository-relative. */
function filesNow(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (name.endsWith('.json')) out.push(relative(ROOT, path));
    }
  };
  if (existsSync(join(ROOT, VECTORS))) walk(join(ROOT, VECTORS));
  return out;
}

let failures = 0;
const atBase = git(['ls-tree', '-r', '--name-only', base, '--', VECTORS]).split('\n').filter((f) => f.endsWith('.json'));
const known = new Set(atBase);
const added = filesNow().filter((f) => !known.has(f));
let changed = 0;
let touched = 0;
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
  if (plant !== null && f.endsWith(plant[0]) && !planted) {
    const altered = plant[1](after);
    if (altered === after) throw new Error(`plant ${plantName as string} did not change ${f}`);
    after = altered;
    planted = true;
  }
  if (after === before) continue;
  changed++;
  try {
    const json = JSON.parse(after) as unknown;
    touched += stripV2a(json, f);
    if (`${JSON.stringify(json, null, indentOf(before))}\n` !== before) {
      console.error(`${f}: differs from ${base} beyond the V2a additions`);
      failures++;
    }
  } catch (e) {
    console.error((e as Error).message);
    failures++;
  }
}
if (plant !== null && !planted) throw new Error(`plant ${plantName as string} found no file to alter`);
console.log(`V2a engine inputs: ${atBase.length} vector files at ${base}, ${changed} changed, ${touched} neutral additions removed, every other byte identical; ${added.length} files added`);
if (failures > 0) {
  console.error(`check-additive-migration: ${failures} failures`);
  process.exit(1);
}
