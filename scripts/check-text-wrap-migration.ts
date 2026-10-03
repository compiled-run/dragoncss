// TXT2-a TextLeaf migration (notes/T149J-txt2.md): every text leaf gains overflowWrap and wordBreak, and the compiler registers
// overflow-wrap, word-break and letter-spacing. This script proves that against BASE the committed outputs differ only by them:
// - engine inputs (packages/layout/vectors/**/*.json): equal once the two keys are removed, and every text leaf holds both at 'normal';
// - the environment pass (zoomInput) keeps both keys on every resolved text leaf of every vector input;
// - Chrome captures (packages/parity/expected*/**/*.web.json): equal once the three computed properties are removed, each 'normal';
// - emitted CSS (packages/parity/emitted/*.css): equal once the three declarations at normal and the digest header are removed.
// Files new since BASE are not compared. Plants (--plant <name>) corrupt one comparison and must make the check fail.
// --write migrates the hand-written inputs no generator rewrites (vectors/calc/*.json and the vectors README example).
// Usage: node --conditions=dragon-internal scripts/check-text-wrap-migration.ts [--base <rev>] [--write] [--plant <name>]
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { NO_ENGINE_FAULTS } from '../packages/layout/src/block.ts';
import type { LayoutInput } from '../packages/layout/src/input.ts';
import { zoomInput } from '../packages/layout/src/layout.ts';

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
type Obj = { [k: string]: Json };

const ROOT = join(import.meta.dirname, '..');
const KEYS = ['overflowWrap', 'wordBreak'] as const;
const PROPERTIES = ['overflow-wrap', 'word-break', 'letter-spacing'] as const;
const PLANTS = ['vector-value', 'vector-missing', 'resolved-dropped', 'capture-value', 'capture-other', 'emitted-line'] as const;
type Plant = (typeof PLANTS)[number];

const isObj = (v: Json | undefined): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const base = arg('--base') ?? '08df24673';
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

/** j without the migration keys; problems collects every text leaf without both at 'normal'. */
function withoutKeys(j: Json, where: string, problems: string[]): Json {
  if (Array.isArray(j)) return j.map((x) => withoutKeys(x, where, problems));
  if (!isObj(j)) return j;
  if (j['kind'] === 'text') for (const k of KEYS) if (j[k] !== 'normal') problems.push(`${where}: text leaf ${String(j['id'])} has ${k} ${JSON.stringify(j[k])}, not "normal"`);
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
    if (j['kind'] === 'text' && k === 'textWrapMode') {
      if (!Object.hasOwn(j, 'overflowWrap')) out['overflowWrap'] = 'normal';
      if (!Object.hasOwn(j, 'wordBreak')) out['wordBreak'] = 'normal';
    }
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
  console.log(`check-text-wrap-migration: migrated ${n} hand-written file(s)`);
  process.exit(0);
}

// ---------------------------------------------------------------- the check

const problems: string[] = [];
let vectors = 0;
let resolved = 0;
for (const path of walkFiles(join(ROOT, 'packages/layout/vectors'), '.json')) {
  const now = JSON.parse(readFileSync(path, 'utf8')) as Json;
  if (!isObj(now) || !isObj(now['input'])) continue;
  // Only vectors BASE has are migrations; new vectors (the text-wrap-break group) carry other values.
  const was = atBase(path);
  if (was === null) continue;
  const where = relative(ROOT, path);
  if (plant === 'vector-value' && vectors === 0) resolvedLeaves(now['input'], []).forEach((t, i) => i === 0 && (t['overflowWrap'] = 'anywhere'));
  if (plant === 'vector-missing' && vectors === 0) resolvedLeaves(now['input'], []).forEach((t, i) => i === 0 && delete t['wordBreak']);
  const leaves = resolvedLeaves(now['input'], []);
  // Every leaf holds both keys at "normal" (withoutKeys reports any other value, or a missing key).
  const stripped = withoutKeys(now, where, problems);
  // The environment pass keeps both keys on every resolved leaf.
  if (leaves.length > 0) {
    const z = zoomInput(now['input'] as unknown as LayoutInput, NO_ENGINE_FAULTS) as unknown as Json;
    const zl = resolvedLeaves(z, []);
    if (plant === 'resolved-dropped' && resolved === 0) for (const t of zl) delete t['overflowWrap'];
    for (const t of zl) for (const k of KEYS) if (t[k] !== 'normal') problems.push(`${where}: the environment pass gives ${String(t['id'])} ${k} ${JSON.stringify(t[k])}`);
    resolved++;
  }
  vectors++;
  if (JSON.stringify(stripped) !== JSON.stringify(withoutKeys(JSON.parse(was) as Json, `${where}@base`, []))) problems.push(`${where}: differs from BASE beyond overflowWrap and wordBreak`);
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
    if (plant === 'capture-value' && captures === 0) for (const n of nodes) if (isObj(n['computed'])) (n['computed'] as Obj)['letter-spacing'] = '1px';
    if (plant === 'capture-other' && captures === 0) for (const n of nodes) if (isObj(n['computed'])) (n['computed'] as Obj)['display'] = 'contents';
    for (const n of nodes) {
      const c = n['computed'];
      if (!isObj(c)) continue;
      for (const p of PROPERTIES) {
        if (c[p] !== 'normal') problems.push(`${where}: ${String(n['id'])} ${p} is ${JSON.stringify(c[p])}, not "normal"`);
        delete c[p];
      }
    }
    if (JSON.stringify(now) !== JSON.stringify(before)) problems.push(`${where}: differs from BASE beyond the three computed properties`);
    captures++;
  }
}

let emitted = 0;
const dropped = new Set(PROPERTIES.map((p) => `  ${p}: normal;`));
const body = (text: string): string => text.split('\n').filter((l) => !l.startsWith('/* Generated by Dragon from compilation ') && !dropped.has(l)).join('\n');
for (const dir of ['packages/parity/emitted', 'packages/parity/expected-fonts/emitted']) {
  for (const path of walkFiles(join(ROOT, dir), '.css')) {
    const was = atBase(path);
    if (was === null) continue;
    let now = readFileSync(path, 'utf8');
    if (plant === 'emitted-line' && emitted === 0) now = now.replace('  overflow-wrap: normal;', '  overflow-wrap: anywhere;');
    if (body(now) !== body(was)) problems.push(`${relative(ROOT, path)}: differs from BASE beyond the digest header and the three declarations at normal`);
    emitted++;
  }
}

// A comparison over nothing proves nothing.
if (vectors === 0 || resolved === 0 || captures === 0 || emitted === 0) problems.push(`nothing compared in some family: ${vectors} vectors, ${resolved} resolved, ${captures} captures, ${emitted} emitted files`);
for (const p of problems.slice(0, 30)) console.log(`PROBLEM ${p}`);
console.log(`check-text-wrap-migration${plant === undefined ? '' : ` --plant ${plant}`}: BASE ${base}; ${vectors} vectors (${resolved} resolved through the environment pass), ${captures} captures, ${emitted} emitted files compared; ${problems.length} problem(s)`);
if (problems.length > 0) process.exitCode = 1;
