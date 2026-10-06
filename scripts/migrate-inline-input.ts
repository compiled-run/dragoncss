// INL1a R5 input migration (notes/T044-inl-spec.md): writes the two new required LayoutInput fields into hand-written engine inputs,
// which no generator rewrites (packages/layout/vectors/calc/*.json and the example in packages/layout/vectors/README.md). Every box
// gains strut after style, the font and line-height of its first text leaf when its children are text and null otherwise (the
// compiler's strutOf), and every style gains verticalAlign baseline after aspectRatio (input.ts LayoutStyle order). Nothing else changes, so the outputs stay
// byte-identical. Usage: node scripts/migrate-inline-input.ts [--check]; --check exits 1 if any file would change.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
type Obj = { [k: string]: Json };

const ROOT = join(import.meta.dirname, '..');
const CALC = join(ROOT, 'packages/layout/vectors/calc');
const README = join(ROOT, 'packages/layout/vectors/README.md');

const isObj = (v: Json | undefined): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

/** A copy of o with key inserted after `after` (which must exist); an object that already has key is returned unchanged. */
function insertAfter(o: Obj, after: string, key: string, value: Json): Obj {
  if (Object.hasOwn(o, key)) return o;
  if (!Object.hasOwn(o, after)) throw new Error(`no ${after} to insert ${key} after`);
  const out: Obj = {};
  for (const [k, v] of Object.entries(o)) {
    out[k] = v;
    if (k === after) out[key] = value;
  }
  return out;
}

function migrateStyle(style: Json | undefined): Json {
  if (!isObj(style)) throw new Error('a box without a style object');
  return insertAfter(style, 'aspectRatio', 'verticalAlign', { kind: 'keyword', value: 'baseline' });
}

function migrateBox(box: Obj): Obj {
  if (box['kind'] !== 'box') throw new Error(`expected a box, got ${String(box['kind'])}`);
  const children = box['children'];
  if (!Array.isArray(children)) throw new Error(`box ${String(box['id'])} has no children array`);
  const kids = children.map((c) => {
    if (!isObj(c)) throw new Error(`box ${String(box['id'])} has a child that is not an object`);
    if (c['kind'] === 'box') return migrateBox(c);
    if (c['kind'] === 'replaced') return { ...c, style: migrateStyle(c['style']) };
    if (c['kind'] !== 'text') throw new Error(`box ${String(box['id'])} has a child of kind ${String(c['kind'])}, which no pre-INL1a input holds`);
    return c;
  });
  const first = kids.find((c) => c['kind'] === 'text');
  if (first !== undefined && (!isObj(first['font']) || !isObj(first['lineHeight']))) throw new Error(`box ${String(box['id'])}: its first text leaf has no font or line-height object`);
  const strut: Json = first === undefined ? null : { font: first['font'] as Json, lineHeight: first['lineHeight'] as Json };
  const withStyle: Obj = { ...box, style: migrateStyle(box['style']), children: kids };
  return insertAfter(withStyle, 'style', 'strut', strut);
}

function migrateInput(input: Json | undefined): Json {
  if (!isObj(input) || !isObj(input['root'])) throw new Error('an input without a root box');
  return { ...input, root: migrateBox(input['root']) };
}

/** A copy of j without the keys the migration adds, to prove it changed nothing else. */
function withoutAdded(j: Json): Json {
  if (Array.isArray(j)) return j.map(withoutAdded);
  if (!isObj(j)) return j;
  const out: Obj = {};
  for (const [k, v] of Object.entries(j)) if (k !== 'strut' && k !== 'verticalAlign') out[k] = withoutAdded(v);
  return out;
}

/**
 * The migrated input, after proving that the migration only added strut and verticalAlign, and that the text is already written
 * the way this script writes it (so no number spelling or layout changes on the way through).
 */
function migrateChecked(what: string, text: string, canonical: string, input: Json): Json {
  if (text !== canonical) throw new Error(`${what}: not in the JSON.stringify(_, null, 1) form this script writes`);
  const migrated = migrateInput(input);
  if (JSON.stringify(withoutAdded(migrated)) !== JSON.stringify(withoutAdded(input))) throw new Error(`${what}: the migration changed more than strut and verticalAlign`);
  return migrated;
}

const args = process.argv.slice(2);
if (args.length > 1 || (args.length === 1 && args[0] !== '--check')) throw new Error(`usage: node scripts/migrate-inline-input.ts [--check] (got ${args.join(' ')})`);
const check = args.length === 1;
// Every file is migrated in memory first, so a refusal leaves no file half-migrated.
const writes: { readonly path: string; readonly text: string; readonly what: string }[] = [];
for (const name of readdirSync(CALC).filter((f) => f.endsWith('.json')).sort()) {
  const path = join(CALC, name);
  const before = readFileSync(path, 'utf8');
  const vector = JSON.parse(before) as Json;
  if (!isObj(vector)) throw new Error(`${name}: not a vector object`);
  const after = `${JSON.stringify({ ...vector, input: migrateChecked(name, before, `${JSON.stringify(vector, null, 1)}\n`, vector['input'] ?? null) }, null, 1)}\n`;
  if (after !== before) writes.push({ path, text: after, what: name });
}
const readme = readFileSync(README, 'utf8');
const block = /```json vector-input\n([\s\S]*?)\n```/.exec(readme);
if (block === null) throw new Error('README.md has no vector-input block');
const example = block[1] as string;
const migrated = JSON.stringify(migrateChecked('README.md', example, JSON.stringify(JSON.parse(example), null, 1), JSON.parse(example) as Json), null, 1);
if (migrated !== example) {
  const at = block.index + '```json vector-input\n'.length;
  writes.push({ path: README, text: readme.slice(0, at) + migrated + readme.slice(at + example.length), what: 'the README.md example input' });
}
const changed = writes.length;
for (const w of writes) {
  if (!check) writeFileSync(w.path, w.text);
  console.log(`${check ? 'would migrate' : 'migrated'} ${w.what}`);
}
console.log(`migrate-inline-input: ${changed} file(s) ${check ? 'to migrate' : 'migrated'}`);
if (check && changed > 0) process.exit(1);
