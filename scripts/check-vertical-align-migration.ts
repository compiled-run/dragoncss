// INL2b vertical-align migration (notes/T059J-inl2.md ruling 7): the compiler registers vertical-align (and the sub and sup tags,
// T059J-INL2b-1). This script proves that against BASE the committed outputs differ only by it:
// - Chrome captures (packages/parity/expected*/**/*.web.json): equal once vertical-align is removed from every computed table, and
//   each node's vertical-align is baseline (its initial value; no existing case holds sub or sup);
// - emitted CSS (packages/parity/emitted/*.css and expected-fonts/emitted): equal once the digest header and the declaration
//   vertical-align: baseline are removed;
// - the UA tables (packages/dragon/src/ua/*.generated.ts): every table entry BASE has is equal once vertical-align is removed, and
//   holds vertical-align only at baseline or at the UA value of its tag (sub, super for sub and sup); the CapturedTag union only
//   appends sub and sup, and the only new table keys are those two tags.
// Files new since BASE are not compared. Plants (--plant <name>) corrupt one comparison and must make the check fail.
// Usage: node --conditions=dragon-internal scripts/check-vertical-align-migration.ts [--base <rev>] [--plant <name>]
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
type Obj = { [k: string]: Json };

const ROOT = join(import.meta.dirname, '..');
const PROPERTY = 'vertical-align';
const NEW_TAGS = ['sub', 'sup'] as const;
/** The UA value of vertical-align per tag (Chrome 145 html.css:1355-1363); every other tag computes baseline. */
const UA_VALUE: { readonly [tag: string]: string } = { sub: 'sub', sup: 'super' };
const PLANTS = ['capture-value', 'capture-other', 'emitted-line', 'ua-value', 'ua-other', 'ua-missing'] as const;
type Plant = (typeof PLANTS)[number];

const isObj = (v: Json | undefined): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const base = arg('--base') ?? '919021f19';
const plantArg = arg('--plant');
if (plantArg !== undefined && !(PLANTS as readonly string[]).includes(plantArg)) throw new Error(`unknown plant ${plantArg}; plants: ${PLANTS.join(', ')}`);
const plant = plantArg as Plant | undefined;

// An unknown BASE fails here, rather than reading as "no file at BASE" for every path below.
execFileSync('git', ['-C', ROOT, 'rev-parse', '--verify', '--quiet', `${base}^{commit}`], { stdio: 'ignore' });
const baseFiles = new Set(execFileSync('git', ['-C', ROOT, 'ls-tree', '-r', '--name-only', base], { encoding: 'utf8', maxBuffer: 1 << 28 }).split('\n'));

function walkFiles(dir: string, ext: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walkFiles(p, ext));
    else if (name.endsWith(ext)) out.push(p);
  }
  return out;
}

/** The BASE text of a repository path, or null when BASE has no such file. */
function atBase(path: string): string | null {
  const rel = relative(ROOT, path);
  if (!baseFiles.has(rel)) return null;
  return execFileSync('git', ['-C', ROOT, 'show', `${base}:${rel}`], { encoding: 'utf8', maxBuffer: 1 << 28 });
}

const problems: string[] = [];

// ---------------------------------------------------------------- captures

let captures = 0;
for (const dir of ['packages/parity/expected', 'packages/parity/expected-dpr', 'packages/parity/expected-fonts']) {
  for (const path of walkFiles(join(ROOT, dir), '.web.json')) {
    const was = atBase(path);
    if (was === null) continue;
    const now = JSON.parse(readFileSync(path, 'utf8')) as Obj;
    const before = JSON.parse(was) as Obj;
    const where = relative(ROOT, path);
    const nodes = now['nodes'] as Obj[];
    if (plant === 'capture-value' && captures === 0) for (const n of nodes) if (isObj(n['computed'])) (n['computed'] as Obj)[PROPERTY] = 'middle';
    if (plant === 'capture-other' && captures === 0) for (const n of nodes) if (isObj(n['computed'])) (n['computed'] as Obj)['display'] = 'contents';
    for (const n of nodes) {
      const c = n['computed'];
      if (!isObj(c)) continue;
      if (c[PROPERTY] !== 'baseline') problems.push(`${where}: ${String(n['id'])} ${PROPERTY} is ${JSON.stringify(c[PROPERTY])}, not "baseline"`);
      delete c[PROPERTY];
    }
    if (JSON.stringify(now) !== JSON.stringify(before)) problems.push(`${where}: differs from BASE beyond ${PROPERTY}`);
    captures++;
  }
}

// ---------------------------------------------------------------- emitted CSS

let emitted = 0;
const body = (text: string): string => text.split('\n').filter((l) => !l.startsWith('/* Generated by Dragon from compilation ') && l !== `  ${PROPERTY}: baseline;`).join('\n');
for (const dir of ['packages/parity/emitted', 'packages/parity/expected-fonts/emitted']) {
  for (const path of walkFiles(join(ROOT, dir), '.css')) {
    const was = atBase(path);
    if (was === null) continue;
    let now = readFileSync(path, 'utf8');
    if (plant === 'emitted-line' && emitted === 0) now = `${now}\n  ${PROPERTY}: middle;`;
    if (body(now) !== body(was)) problems.push(`${relative(ROOT, path)}: differs from BASE beyond the digest header and ${PROPERTY}: baseline`);
    emitted++;
  }
}

// ---------------------------------------------------------------- UA tables

const tmp = mkdtempSync(join(tmpdir(), 'va-migration-'));
// The BASE copies of the UA modules are removed however the comparison ends.
process.on('exit', () => rmSync(tmp, { recursive: true, force: true }));
let uaEntries = 0;
/** The tag a UA table key names (a captured tag, an element key such as a[href], or a phrasing key). */
const tagOf = (key: string): string => key.replace(/\[.*$/, '');
for (const path of walkFiles(join(ROOT, 'packages/dragon/src/ua'), '.generated.ts')) {
  const was = atBase(path);
  if (was === null) continue;
  const where = relative(ROOT, path);
  const basePath = join(tmp, `base-${uaEntries}-${relative(join(ROOT, 'packages/dragon/src/ua'), path)}`);
  writeFileSync(basePath, was);
  const before = (await import(pathToFileURL(basePath).href)) as Record<string, Json>;
  const now = (await import(pathToFileURL(path).href)) as Record<string, Json>;
  // The CapturedTag union only appends the new tags.
  const unionOf = (text: string): string => (/export type CapturedTag = ([^;]*);/.exec(text) as RegExpExecArray)[1] as string;
  const nowText = readFileSync(path, 'utf8');
  if (unionOf(nowText) !== `${unionOf(was)} | ${NEW_TAGS.map((t) => JSON.stringify(t)).join(' | ')}`) problems.push(`${where}: CapturedTag is not BASE's with ${NEW_TAGS.join(' and ')} appended`);
  for (const [name, b] of Object.entries(before)) {
    const n = now[name];
    if (n === undefined) {
      problems.push(`${where}: ${name} is gone`);
      continue;
    }
    if (!isObj(b) || !isObj(n)) {
      if (JSON.stringify(b) !== JSON.stringify(n)) problems.push(`${where}: ${name} changed`);
      continue;
    }
    if (plant === 'ua-missing' && name === 'computed') delete n['div'];
    for (const key of Object.keys(n)) if (!(key in b) && !(NEW_TAGS as readonly string[]).includes(key)) problems.push(`${where}: ${name} gains ${key}, which is not a new tag`);
    for (const [key, be] of Object.entries(b)) {
      const ne = n[key];
      if (ne === undefined) {
        problems.push(`${where}: ${name}.${key} is gone`);
        continue;
      }
      uaEntries++;
      // A computed table, a declared or unmodelled table per direction, or a longhand list.
      const strip = (e: Json, check: boolean): Json => {
        if (Array.isArray(e)) return e.filter((x) => x !== PROPERTY);
        if (!isObj(e)) return e;
        const out: Obj = {};
        for (const [k, v] of Object.entries(e)) {
          if (k === PROPERTY) {
            if (check && v !== 'baseline' && v !== UA_VALUE[tagOf(key)]) problems.push(`${where}: ${name}.${key} holds ${PROPERTY}: ${JSON.stringify(v)}, neither baseline nor ${tagOf(key)}'s UA value`);
            continue;
          }
          out[k] = isObj(v) ? strip(v, check) : v;
        }
        return out;
      };
      let neCopy = JSON.parse(JSON.stringify(ne)) as Json;
      if (plant === 'ua-value' && name === 'computed' && key === 'div' && isObj(neCopy)) neCopy[PROPERTY] = 'middle';
      if (plant === 'ua-other' && name === 'computed' && key === 'div' && isObj(neCopy)) neCopy['display'] = 'inline';
      if (JSON.stringify(strip(neCopy, true)) !== JSON.stringify(strip(be, false))) problems.push(`${where}: ${name}.${key} differs from BASE beyond ${PROPERTY}`);
    }
  }
}

// A comparison over nothing proves nothing.
if (captures === 0 || emitted === 0 || uaEntries === 0) problems.push(`nothing compared in some family: ${captures} captures, ${emitted} emitted files, ${uaEntries} UA entries`);
for (const p of problems.slice(0, 30)) console.log(`PROBLEM ${p}`);
console.log(`check-vertical-align-migration${plant === undefined ? '' : ` --plant ${plant}`}: BASE ${base}; ${captures} captures, ${emitted} emitted files, ${uaEntries} UA table entries compared; ${problems.length} problem(s)`);
if (problems.length > 0) process.exitCode = 1;
