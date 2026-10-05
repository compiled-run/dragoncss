// The git merge driver for floor and pin files (merge=dragon-floor in .gitattributes, registered by `pnpm setup:git`): a
// structural three-way merge of the JSON, so two PRs that both raise floors stop conflicting. Floors (*-floor.json) take the
// larger of two raised counts and the order-preserving union of two extended lists; pins (glyph-clearance-pins.json) are exact,
// so a pin both sides changed differently is a conflict. Anything it cannot merge safely (a removal, a type change, two
// different edits of one string, an order the two sides disagree on) is left to the person as an ordinary text conflict.
// Run by git as: node scripts/floor-merge.ts %O %A %B %P   (writes the result into %A; exit 1 leaves a conflict)
import { spawnSync } from 'node:child_process';
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { floorRegressions } from './land-lib.ts';

export const FLOOR_MERGE_DRIVER = 'node scripts/floor-merge.ts %O %A %B %P';
// The merge drivers `pnpm setup:git` registers (land.test.ts keeps package.json's command equal to this), which the landing
// driver also sets in the repository it merges in.
export const MERGE_DRIVERS: readonly (readonly [string, string])[] = [
  ['merge.dragon-generated.name', 'keep this side; pnpm regen rebuilds it'],
  ['merge.dragon-generated.driver', 'true'],
  ['merge.dragon-floor.name', 'structural merge of floors and pins (scripts/floor-merge.ts)'],
  ['merge.dragon-floor.driver', FLOOR_MERGE_DRIVER],
];
export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
export class Refuse extends Error {}
const refuse = (at: string, why: string): never => {
  throw new Refuse(`${at || '(top)'}: ${why}`);
};
const isObj = (v: unknown): v is Record<string, Json> => typeof v === 'object' && v !== null && !Array.isArray(v);
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const kind = (v: unknown): string => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);
const sortedNames = (xs: readonly string[]): boolean => xs.every((x, i) => i === 0 || xs[i - 1]! < x);

// Order-preserving union of two extended lists of names: every name of either, each side's order kept; a name the base had
// that a side dropped, a repeated name, or two orders that cannot both hold is refused. Sorted inputs give a sorted result.
export const unionList = (at: string, o: readonly Json[] | undefined, a: readonly Json[], b: readonly Json[]): Json[] => {
  if (![...(o ?? []), ...a, ...b].every((x) => typeof x === 'string')) return refuse(at, 'a list of something other than names');
  const [os, as, bs] = [(o ?? []) as string[], a as string[], b as string[]];
  for (const [side, xs] of [['ours', as], ['theirs', bs]] as const) {
    if (new Set(xs).size !== xs.length) refuse(at, `${side} repeats a name`);
    const gone = os.filter((x) => !xs.includes(x));
    if (gone.length > 0) refuse(at, `${side} removed ${JSON.stringify(gone.slice(0, 3))}`);
  }
  if ([os, as, bs].every((xs) => xs.length < 2 || sortedNames(xs))) return [...new Set([...as, ...bs])].sort();
  const out = [...as];
  let after = -1;
  for (const x of bs) {
    const i = out.indexOf(x);
    if (i >= 0) {
      if (i < after) refuse(at, `the two sides order ${JSON.stringify(x)} differently`);
      after = i;
    } else {
      // After its predecessor in theirs, and after what ours added there, so each side's additions stay together.
      let pos = after + 1;
      while (pos < out.length && !bs.includes(out[pos]!)) pos++;
      out.splice(pos, 0, x);
      after = pos;
    }
  }
  return out;
};

// The three-way merge of one value. `floors` takes the larger of two different numbers; without it (pins) they conflict.
export const mergeJson = (at: string, o: Json | undefined, a: Json, b: Json, floors: boolean): Json => {
  if (same(a, b)) return a;
  if (o !== undefined && same(o, a)) return b;
  if (o !== undefined && same(o, b)) return a;
  if (kind(a) !== kind(b)) return refuse(at, `a ${kind(a)} on one side, a ${kind(b)} on the other`);
  if (typeof a === 'number' && typeof b === 'number') return floors ? Math.max(a, b) : refuse(at, `a pin both sides changed (${a}, ${b})`);
  if (Array.isArray(a) && Array.isArray(b)) return unionList(at, Array.isArray(o) ? o : undefined, a, b);
  if (isObj(a) && isObj(b)) {
    const base = isObj(o) ? o : {};
    const keys = unionList(`${at} keys`, Object.keys(base), Object.keys(a), Object.keys(b)) as string[];
    return Object.fromEntries(keys.map((k) => [k, k in a && k in b ? mergeJson(`${at}.${k}`, base[k], a[k]!, b[k]!, floors) : (k in a ? a[k] : b[k])!]));
  }
  return refuse(at, `both sides changed ${JSON.stringify(o)} differently (${JSON.stringify(a)}, ${JSON.stringify(b)})`);
};

export const isPins = (path: string): boolean => basename(path) === 'glyph-clearance-pins.json';
// Written as the files' writers write them: floors as JSON.stringify(v, null, 2); pins as one compact line per case.
export const format = (path: string, v: Json): string =>
  isPins(path) && isObj(v) ? `{\n${Object.entries(v).map(([k, x]) => `  ${JSON.stringify(k)}: ${JSON.stringify(x)}`).join(',\n')}\n}\n` : `${JSON.stringify(v, null, 2)}\n`;

/** The merged text, or a Refuse naming why it is left as a conflict. A floor result is checked never to fall below either side. */
export const mergeFloorFile = (path: string, base: string, ours: string, theirs: string): string => {
  const parse = (t: string, side: string): Json => {
    try {
      return JSON.parse(t) as Json;
    } catch (error) {
      return refuse('', `${side} is not JSON (${error instanceof Error ? error.message : String(error)})`);
    }
  };
  const o = base.trim() === '' ? undefined : parse(base, 'the base');
  const merged = format(path, mergeJson('', o, parse(ours, 'ours'), parse(theirs, 'theirs'), !isPins(path)));
  if (!isPins(path)) {
    const lower = [...floorRegressions(path, ours, merged), ...floorRegressions(path, theirs, merged)];
    if (lower.length > 0) refuse('', `the merge would lower a floor: ${lower.slice(0, 3).join('; ')}`);
  }
  return merged;
};

// Run as a script (realpaths: /tmp is a symlink on macOS, and a guard that misses would leave git with ours unmerged).
if (process.argv[1] !== undefined && realpathSync(resolve(process.argv[1])) === realpathSync(import.meta.filename)) {
  const [o, a, b, path] = process.argv.slice(2);
  if (o === undefined || a === undefined || b === undefined || path === undefined) {
    console.error('usage: floor-merge.ts %O %A %B %P');
    process.exit(2);
  }
  try {
    writeFileSync(a, mergeFloorFile(path, readFileSync(o, 'utf8'), readFileSync(a, 'utf8'), readFileSync(b, 'utf8')));
    console.error(`floor-merge: merged ${path}`);
  } catch (error) {
    // Left to the person: git's own text merge, with conflict markers, in place of ours.
    console.error(`floor-merge: ${path} left as a conflict: ${error instanceof Error ? error.message : String(error)}`);
    spawnSync('git', ['merge-file', '-L', 'ours', '-L', 'base', '-L', 'theirs', a, o, b], { stdio: 'ignore' });
    process.exit(1);
  }
}
