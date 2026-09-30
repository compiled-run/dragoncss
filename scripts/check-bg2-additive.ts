// node --conditions=dragon-internal scripts/check-bg2-additive.ts <base-ref> [--plant <name>]
// BG2 made the eight background layer longhands real longhands (docs/decisions.md, "New CSS longhands are real longhands"): every
// capture gains their computed values and every emitted rule their declarations. This proves the change additive only, against the
// committed outputs at <base-ref>:
// - captures (packages/parity/expected/**, expected-dpr/**): every computed object holds the eight keys, each at its initial
//   value (Chrome 145's computed serialization) unless the case is one of BG2's; with them removed, the file equals the base file
//   with them removed (the background fixtures captured them as computedExtra before, at the end);
// - emitted CSS (packages/parity/emitted/**): every rule gains the eight declarations right after background-color, at their
//   initial values; with them removed and the digest header relaxed, the file equals the base file;
// - every other committed output a fixture writes (layout vectors, break captures, pixel captures) is unchanged;
// - a file added since the base belongs to a BG2 fixture, and a file removed since the base is a failure.
// Exit 1 on any difference. --plant proves the checker catches: capture-value, capture-missing, emitted-value, emitted-extra,
// stray-file.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { repoPath } from '../packages/parity/src/paths.ts';

const NEW_LONGHANDS: readonly (readonly [string, string])[] = [
  ['background-image', 'none'],
  ['background-position-x', '0%'],
  ['background-position-y', '0%'],
  ['background-size', 'auto'],
  ['background-repeat', 'repeat'],
  ['background-attachment', 'scroll'],
  ['background-origin', 'padding-box'],
  ['background-clip', 'border-box'],
];
const NEW_FIXTURES = ['gradient-linear', 'gradient-radial', 'bg-layers', 'gradient-fractional', 'calib-gradient-ramps'];
/** The background shorthand fixtures spell out initial components (left top, 0% 0% / auto, ...): their emitted rules keep the
 * authored form, and their captures prove each computes to the initial value, so only the declarations' presence is checked. */
const SPELLED_OUT = ['background-shorthand-colors', 'background-shorthand-cascade', 'background-important'];
const ROOTS = ['packages/parity/expected', 'packages/parity/expected-dpr', 'packages/parity/emitted', 'packages/layout/vectors', 'packages/layout/break-vectors', 'packages/parity/expected-breaks', 'packages/parity/expected-pixels'];

const args = process.argv.slice(2);
const base = args[0];
if (base === undefined || base.startsWith('--')) throw new Error('usage: check-bg2-additive.ts <base-ref> [--plant <name>]');
const plant = args.includes('--plant') ? (args[args.indexOf('--plant') + 1] ?? '') : null;
const PLANTS = ['capture-value', 'capture-missing', 'emitted-value', 'emitted-extra', 'stray-file'];
if (plant !== null && !PLANTS.includes(plant)) throw new Error(`--plant takes one of ${PLANTS.join(', ')}`);

const git = (...a: string[]): string => execFileSync('git', a, { cwd: repoPath('.'), encoding: 'utf8', maxBuffer: 1 << 30 });
const listed = (ref: string | null, root: string): Set<string> => new Set((ref === null ? git('ls-files', '--cached', '--others', '--exclude-standard', '--', root) : git('ls-tree', '-r', '--name-only', ref, '--', root)).split('\n').filter((l) => l.length > 0).filter((p) => ref !== null || existsSync(repoPath(p))));
const baseText = (path: string): string => git('show', `${base}:${path}`);
const headText = (path: string): string => readFileSync(repoPath(path), 'utf8');

/** Whether a path belongs to one of BG2's fixtures (its cases are <fixture>, <fixture>-rtl). */
const isNew = (path: string): boolean => NEW_FIXTURES.some((f) => new RegExp(`/${f}(-rtl)?(\\.|/|$)`).test(path));

const problems: string[] = [];
let captures = 0;
let computedObjects = 0;
let emitted = 0;
let rules = 0;
let unchanged = 0;
let added = 0;

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

/** A capture with the eight keys removed from every computed object, and its computed objects. */
function stripCapture(text: string): { stripped: string; computed: { [k: string]: string }[] } {
  const j = JSON.parse(text) as { nodes: { computed: { [k: string]: string } | null }[] };
  const computed: { [k: string]: string }[] = [];
  for (const n of j.nodes) {
    if (n.computed === null) continue;
    computed.push({ ...n.computed });
    for (const [k] of NEW_LONGHANDS) delete n.computed[k];
  }
  return { stripped: JSON.stringify(j), computed };
}

function checkCapture(path: string): void {
  captures++;
  let head = headText(path);
  if (plant === 'capture-value' && captures === 1) head = head.replace('"background-size": "auto"', '"background-size": "cover"');
  if (plant === 'capture-missing' && captures === 1) head = head.replace(/\n\s*"background-clip": "border-box",?/, '');
  const h = stripCapture(head);
  const b = stripCapture(baseText(path));
  if (h.stripped !== b.stripped) problems.push(`${path}: differs from ${base} beyond the eight background layer keys`);
  for (const c of h.computed) {
    computedObjects++;
    for (const [k, initial] of NEW_LONGHANDS) {
      if (!(k in c)) problems.push(`${path}: a computed object has no ${k}`);
      else if (c[k] !== initial) problems.push(`${path}: ${k} is "${c[k]}", not its initial "${initial}"`);
    }
  }
}

/** An emitted file with the eight declarations removed and the digest header relaxed; problems for a rule without them. */
function stripEmitted(text: string, path: string, check: boolean): string {
  const lines = text.split('\n');
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i] as string;
    if (i === 0) {
      out.push(l.replace(/compilation [0-9a-f]+/, 'compilation <digest>'));
      continue;
    }
    out.push(l);
    if (!check || !l.startsWith('  background-color: ')) continue;
    rules++;
    const spelled = SPELLED_OUT.some((f) => path.endsWith(`/${f}.css`) || path.endsWith(`/${f}-rtl.css`));
    for (const [k, initial] of NEW_LONGHANDS) {
      const next = lines[i + 1];
      if (spelled ? !(next ?? '').startsWith(`  ${k}: `) : next !== `  ${k}: ${initial};`) {
        problems.push(`${path}: after background-color, expected "  ${k}: ${initial};", found ${JSON.stringify(next)}`);
        break;
      }
      i++;
    }
  }
  return out.join('\n');
}

function checkEmitted(path: string): void {
  emitted++;
  let head = headText(path);
  if (plant === 'emitted-value' && emitted === 1) head = head.replace('  background-repeat: repeat;', '  background-repeat: no-repeat;');
  if (plant === 'emitted-extra' && emitted === 1) head = head.replace('  background-clip: border-box;\n', '  background-clip: border-box;\n  background-blend-mode: normal;\n');
  const h = stripEmitted(head, path, true);
  const b = stripEmitted(baseText(path), path, false);
  if (h !== b) problems.push(`${path}: differs from ${base} beyond the eight background layer declarations and the digest`);
}

for (const root of ROOTS) {
  const before = listed(base, root);
  const now = listed(null, root);
  if (plant === 'stray-file' && root === 'packages/parity/expected') now.add('packages/parity/expected/darwin-arm64/stray.web.json');
  for (const p of before) if (!now.has(p)) problems.push(`${p}: removed since ${base}`);
  for (const p of now) {
    if (!before.has(p)) {
      if (!isNew(p) && !p.endsWith('manifest.json')) problems.push(`${p}: added since ${base}, but belongs to no BG2 fixture`);
      else added++;
      continue;
    }
    if (isNew(p)) continue;
    if ((root === 'packages/parity/expected' || root === 'packages/parity/expected-dpr') && p.endsWith('.json')) checkCapture(p);
    else if (root === 'packages/parity/emitted') checkEmitted(p);
    else if (p.endsWith('manifest.json')) {
      // A pixel or break manifest may only gain entries: every base line is still there, in order.
      const b = baseText(p).split('\n');
      const h = headText(p).split('\n');
      let at = 0;
      for (const l of b) {
        const found = h.indexOf(l, at);
        if (found < 0) {
          problems.push(`${p}: the base line ${JSON.stringify(l.slice(0, 120))} is gone`);
          break;
        }
        at = found + 1;
      }
    } else if (baseText(p) !== headText(p)) problems.push(`${p}: changed since ${base}`);
    else unchanged++;
  }
}

console.log(`check-bg2-additive ${base}${plant === null ? '' : ` --plant ${plant}`}: ${captures} captures (${computedObjects} computed objects, ${computedObjects * NEW_LONGHANDS.length} keys), ${emitted} emitted files (${rules} rules), ${unchanged} other files unchanged, ${added} files added by BG2 fixtures; ${problems.length} problem(s)`);
for (const p of problems.slice(0, 40)) console.log(`  ${p}`);
if (problems.length > 40) console.log(`  ... ${problems.length - 40} more`);
process.exitCode = problems.length === 0 ? 0 : 1;
