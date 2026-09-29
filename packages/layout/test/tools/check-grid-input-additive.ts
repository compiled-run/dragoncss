// GRID G1a migration proof (docs/decisions.md, "Adding engine fields"): the engine input gains the grid and gridItem fields, and
// existing vectors may change only by gaining them, null, on every style. Compares the working tree with a base commit and exits 1
// on any other difference: a changed output, a changed input value, a missing or extra vector, or a non-null new field.
// Run: node packages/layout/test/tools/check-grid-input-additive.ts <base-commit>
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const base = process.argv[2];
if (base === undefined) throw new Error('usage: check-grid-input-additive.ts <base-commit>');
const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const git = (...args: string[]): string => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 1 << 30 });

/** The vectors whose inputs carry LayoutStyle objects: DPR 1 and the DPR sets (their snap vectors hold rects only). */
const VECTOR = /^packages\/layout\/vectors\/(dpr-[0-9.]+\/)?[^/]+\.json$/;
const NEW_FIELDS = ['grid', 'gridItem'] as const;

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
type Vector = { platform: Json; measurer: Json; input: { root: Json }; output: Json };

const problems: string[] = [];
let checked = 0;
let styles = 0;

/** Removes the new fields from every style in a box tree, checking each is present, null and in last place. */
function strip(box: Json, path: string): Json {
  if (box === null || typeof box !== 'object' || Array.isArray(box)) return box;
  const b = box as { [k: string]: Json };
  if (b['kind'] !== 'box') return b;
  const style = b['style'] as { [k: string]: Json };
  const keys = Object.keys(style);
  const tail = keys.slice(keys.length - NEW_FIELDS.length);
  if (tail.join() !== NEW_FIELDS.join()) problems.push(`${path}: style keys end [${tail.join(', ')}], expected [${NEW_FIELDS.join(', ')}]`);
  for (const f of NEW_FIELDS) if (style[f] !== null) problems.push(`${path}: ${f} is ${JSON.stringify(style[f])}, expected null on an existing vector`);
  styles++;
  const kept = Object.fromEntries(Object.entries(style).filter(([k]) => !(NEW_FIELDS as readonly string[]).includes(k)));
  const children = (b['children'] as Json[]).map((c, i) => strip(c, `${path}.children[${i}]`));
  return { ...b, style: kept, children };
}

const before = git('ls-tree', '-r', '--name-only', base, 'packages/layout/vectors').split('\n').filter((f) => VECTOR.test(f));
const after = git('ls-files', 'packages/layout/vectors').split('\n').filter((f) => VECTOR.test(f));
const beforeSet = new Set(before);
for (const f of after) if (!beforeSet.has(f)) problems.push(`${f}: a new vector (this check covers existing vectors only)`);
for (const f of before) {
  const path = join(root, f);
  if (!existsSync(path)) {
    problems.push(`${f}: removed`);
    continue;
  }
  const old = git('show', `${base}:${f}`);
  const now = readFileSync(path, 'utf8');
  const o = JSON.parse(old) as Vector;
  const n = JSON.parse(now) as Vector;
  if (JSON.stringify(n.output) !== JSON.stringify(o.output)) problems.push(`${f}: output changed`);
  if (JSON.stringify(n.platform) !== JSON.stringify(o.platform) || JSON.stringify(n.measurer) !== JSON.stringify(o.measurer)) problems.push(`${f}: platform or measurer changed`);
  const stripped = { ...n, input: { ...n.input, root: strip(n.input.root, `${f} $.input.root`) } };
  // The vector writers use JSON.stringify(v, null, 1) (dpr.ts dprVectorText the same); byte equality after stripping.
  if (`${JSON.stringify(stripped, null, 1)}\n` !== old) problems.push(`${f}: differs from the base beyond the added grid fields`);
  checked++;
}
if (checked === 0) problems.push('no vectors were checked');
if (problems.length > 0) {
  console.log(`check-grid-input-additive: FAIL (${problems.length} problems)\n  ${problems.slice(0, 50).join('\n  ')}`);
  process.exit(1);
}
console.log(`check-grid-input-additive: PASS: ${checked} vectors, ${styles} styles each gained grid: null and gridItem: null; outputs and every other byte unchanged`);
