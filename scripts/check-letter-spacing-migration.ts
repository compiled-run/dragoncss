// TXT2-b TextLeaf migrations (notes/T149-txt2-spec.md R6, V4): every text leaf gains letterSpacing (then wordSpacing), and the
// compiler registers letter-spacing (then word-spacing). This script proves that against BASE the committed outputs differ only by
// the chosen property (--property, letter-spacing by default):
// - engine inputs (packages/layout/vectors/**/*.json): equal once the key is removed, and every text leaf holds px 0;
// - the environment pass (zoomInput) keeps px 0 on every resolved text leaf of every vector input;
// - Chrome captures (packages/parity/expected*/**/*.web.json): equal once the computed property is removed, each at its neutral value;
// - emitted CSS (packages/parity/emitted/*.css): equal once the declaration at its neutral value and the digest header are removed.
// Files new since BASE are not compared. Plants (--plant <name>) corrupt one comparison and must make the check fail.
// --write migrates the hand-written inputs no generator rewrites (vectors/calc/*.json and the vectors README example).
// Usage: node --conditions=dragon-internal scripts/check-letter-spacing-migration.ts [--property letter-spacing|word-spacing]
//        [--base <rev>] [--write] [--plant <name>]
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { NO_ENGINE_FAULTS } from '../packages/layout/src/block.ts';
import type { LayoutInput } from '../packages/layout/src/input.ts';
import { zoomInput } from '../packages/layout/src/layout.ts';

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
type Obj = { [k: string]: Json };

const ROOT = join(import.meta.dirname, '..');
/**
 * Per migration: the TextLeaf key, the key --write inserts it after, the BASE before it, and the neutral computed value Chrome
 * reports (letter-spacing 0 computes to normal, word-spacing normal to 0px, as Chrome 145 serializes them).
 */
const SPECS = {
  'letter-spacing': { key: 'letterSpacing', after: 'textWrapMode', base: 'af67457777', computed: 'normal', emitted: ['normal'] },
  'word-spacing': { key: 'wordSpacing', after: 'letterSpacing', base: '318068844a', computed: '0px', emitted: ['normal', '0px'] },
} as const;
/** The neutral engine value: px 0 (normal). */
const NEUTRAL = JSON.stringify({ kind: 'px', value: 0 });
const isNeutral = (v: Json | undefined): boolean => JSON.stringify(v) === NEUTRAL;
const PLANTS = ['vector-value', 'vector-missing', 'resolved-dropped', 'capture-value', 'capture-other', 'emitted-line'] as const;
type Plant = (typeof PLANTS)[number];

const isObj = (v: Json | undefined): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const propertyArg = arg('--property') ?? 'letter-spacing';
if (!Object.hasOwn(SPECS, propertyArg)) throw new Error(`unknown property ${propertyArg}; properties: ${Object.keys(SPECS).join(', ')}`);
const property = propertyArg as keyof typeof SPECS;
const spec = SPECS[property];
const KEYS = [spec.key] as const;
const PROPERTIES = [property] as const;
const base = arg('--base') ?? spec.base;
const plantArg = arg('--plant');
if (plantArg !== undefined && !(PLANTS as readonly string[]).includes(plantArg)) throw new Error(`unknown plant ${plantArg}; plants: ${PLANTS.join(', ')}`);
const plant = plantArg as Plant | undefined;

function walkFiles(dir: string, ext: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walkFiles(p, ext));
    else if (name.endsWith(ext)) out.push(p);
  }
  return out;
}

// An unknown BASE fails here, rather than reading as "no file at BASE" for every path below.
execFileSync('git', ['-C', ROOT, 'rev-parse', '--verify', '--quiet', `${base}^{commit}`], { stdio: 'ignore' });
const baseFiles = new Set(execFileSync('git', ['-C', ROOT, 'ls-tree', '-r', '--name-only', base], { encoding: 'utf8', maxBuffer: 1 << 28 }).split('\n'));

/** The BASE text of a repository path, or null when BASE has no such file. */
function atBase(path: string): string | null {
  const rel = relative(ROOT, path);
  if (!baseFiles.has(rel)) return null;
  return execFileSync('git', ['-C', ROOT, 'show', `${base}:${rel}`], { encoding: 'utf8', maxBuffer: 1 << 28 });
}

/** j without the migration key; problems collects every text leaf without it at px 0. */
function withoutKeys(j: Json, where: string, problems: string[]): Json {
  if (Array.isArray(j)) return j.map((x) => withoutKeys(x, where, problems));
  if (!isObj(j)) return j;
  if (j['kind'] === 'text') for (const k of KEYS) if (!isNeutral(j[k])) problems.push(`${where}: text leaf ${String(j['id'])} has ${k} ${JSON.stringify(j[k])}, not ${NEUTRAL}`);
  const out: Obj = {};
  for (const [k, v] of Object.entries(j)) if (!(KEYS as readonly string[]).includes(k)) out[k] = withoutKeys(v, where, problems);
  return out;
}

/** Every text leaf of a resolved input, by walking boxes and inline boxes. */
function resolvedLeaves(j: Json, out: Obj[]): Obj[] {
  if (Array.isArray(j)) for (const x of j) resolvedLeaves(x, out);
  else if (isObj(j)) {
    if (j['kind'] === 'text') out.push(j);
    for (const v of Object.values(j)) resolvedLeaves(v, out);
  }
  return out;
}

// ---------------------------------------------------------------- --write: the hand-written inputs

function insertKeys(j: Json): Json {
  if (Array.isArray(j)) return j.map(insertKeys);
  if (!isObj(j)) return j;
  const out: Obj = {};
  for (const [k, v] of Object.entries(j)) {
    out[k] = insertKeys(v);
    if (j['kind'] === 'text' && k === spec.after && !Object.hasOwn(j, spec.key)) out[spec.key] = { kind: 'px', value: 0 };
  }
  return out;
}

if (process.argv.includes('--write')) {
  let n = 0;
  for (const path of walkFiles(join(ROOT, 'packages/layout/vectors/calc'), '.json')) {
    const before = readFileSync(path, 'utf8');
    const v = JSON.parse(before) as Json;
    if (`${JSON.stringify(v, null, 1)}\n` !== before) throw new Error(`${path}: not in the JSON.stringify(_, null, 1) form this script writes`);
    const after = `${JSON.stringify(insertKeys(v), null, 1)}\n`;
    if (after !== before) {
      writeFileSync(path, after);
      n++;
    }
  }
  const readmePath = join(ROOT, 'packages/layout/vectors/README.md');
  const readme = readFileSync(readmePath, 'utf8');
  const block = /```json vector-input\n([\s\S]*?)\n```/.exec(readme);
  if (block === null) throw new Error('README.md has no vector-input block');
  const example = block[1] as string;
  const migrated = JSON.stringify(insertKeys(JSON.parse(example) as Json), null, 1);
  if (migrated !== example) {
    const at = block.index + '```json vector-input\n'.length;
    writeFileSync(readmePath, readme.slice(0, at) + migrated + readme.slice(at + example.length));
    n++;
  }
  console.log(`check-letter-spacing-migration --property ${property}: migrated ${n} hand-written file(s)`);
  process.exit(0);
}

// ---------------------------------------------------------------- the check

const problems: string[] = [];
let vectors = 0;
let resolved = 0;
let vectorPlanted = false;
for (const path of walkFiles(join(ROOT, 'packages/layout/vectors'), '.json')) {
  const now = JSON.parse(readFileSync(path, 'utf8')) as Json;
  if (!isObj(now) || !isObj(now['input'])) continue;
  // Only vectors BASE has are migrations; new vectors (the text-spacing group) carry other values.
  const was = atBase(path);
  if (was === null) continue;
  const where = relative(ROOT, path);
  const leaves = resolvedLeaves(now['input'], []);
  // A vector plant corrupts the first compared vector that has a text leaf.
  const first = leaves[0];
  if (first !== undefined && !vectorPlanted && (plant === 'vector-value' || plant === 'vector-missing')) {
    if (plant === 'vector-value') first[spec.key] = { kind: 'px', value: 1 };
    else delete first[spec.key];
    vectorPlanted = true;
  }
  // Every leaf holds px 0 (withoutKeys reports any other value, or a missing key).
  const stripped = withoutKeys(now, where, problems);
  // The environment pass keeps px 0 on every resolved leaf.
  if (leaves.length > 0) {
    const z = zoomInput(now['input'] as unknown as LayoutInput, NO_ENGINE_FAULTS) as unknown as Json;
    const zl = resolvedLeaves(z, []);
    if (plant === 'resolved-dropped' && resolved === 0) for (const t of zl) delete t[spec.key];
    for (const t of zl) for (const k of KEYS) if (!isNeutral(t[k])) problems.push(`${where}: the environment pass gives ${String(t['id'])} ${k} ${JSON.stringify(t[k])}`);
    resolved++;
  }
  vectors++;
  if (JSON.stringify(stripped) !== JSON.stringify(withoutKeys(JSON.parse(was) as Json, `${where}@base`, []))) problems.push(`${where}: differs from BASE beyond ${spec.key}`);
}

let captures = 0;
for (const dir of ['packages/parity/expected', 'packages/parity/expected-dpr', 'packages/parity/expected-fonts']) {
  for (const path of walkFiles(join(ROOT, dir), '.web.json')) {
    const was = atBase(path);
    if (was === null) continue;
    const now = JSON.parse(readFileSync(path, 'utf8')) as Obj;
    const before = JSON.parse(was) as Obj;
    const where = relative(ROOT, path);
    const nodes = now['nodes'] as Obj[];
    if (plant === 'capture-value' && captures === 0) for (const n of nodes) if (isObj(n['computed'])) (n['computed'] as Obj)[property] = '1px';
    if (plant === 'capture-other' && captures === 0) for (const n of nodes) if (isObj(n['computed'])) (n['computed'] as Obj)['display'] = 'contents';
    for (const n of nodes) {
      const c = n['computed'];
      if (!isObj(c)) continue;
      for (const p of PROPERTIES) {
        if (c[p] !== spec.computed) problems.push(`${where}: ${String(n['id'])} ${p} is ${JSON.stringify(c[p])}, not "${spec.computed}"`);
        delete c[p];
      }
    }
    if (JSON.stringify(now) !== JSON.stringify(before)) problems.push(`${where}: differs from BASE beyond the computed ${property}`);
    captures++;
  }
}

let emitted = 0;
const dropped = new Set(PROPERTIES.flatMap((p) => spec.emitted.map((v) => `  ${p}: ${v};`)));
const body = (text: string): string => text.split('\n').filter((l) => !l.startsWith('/* Generated by Dragon from compilation ') && !dropped.has(l)).join('\n');
for (const dir of ['packages/parity/emitted', 'packages/parity/expected-fonts/emitted']) {
  for (const path of walkFiles(join(ROOT, dir), '.css')) {
    const was = atBase(path);
    if (was === null) continue;
    let now = readFileSync(path, 'utf8');
    if (plant === 'emitted-line' && emitted === 0) now = now.replace(`  ${property}: ${spec.emitted[0]};`, `  ${property}: 1px;`).replace(`  ${property}: ${spec.emitted[spec.emitted.length - 1]};`, `  ${property}: 1px;`);
    if (body(now) !== body(was)) problems.push(`${relative(ROOT, path)}: differs from BASE beyond the digest header and ${property} at its neutral value`);
    emitted++;
  }
}

// A comparison over nothing proves nothing.
if (vectors === 0 || resolved === 0 || captures === 0 || emitted === 0) problems.push(`nothing compared in some family: ${vectors} vectors, ${resolved} resolved, ${captures} captures, ${emitted} emitted files`);
for (const p of problems.slice(0, 30)) console.log(`PROBLEM ${p}`);
console.log(`check-letter-spacing-migration --property ${property}${plant === undefined ? '' : ` --plant ${plant}`}: BASE ${base}; ${vectors} vectors (${resolved} resolved through the environment pass), ${captures} captures, ${emitted} emitted files compared; ${problems.length} problem(s)`);
if (problems.length > 0) process.exitCode = 1;
