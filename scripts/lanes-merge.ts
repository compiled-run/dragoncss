// The git merge driver for packages/parity/out/lanes.json (merge=dragon-lanes in .gitattributes, registered by `pnpm setup:git`).
// Regen rebuilds the host parts of the file but not the device records, which only a device run writes (on master, by
// device-refresh.yml): so ours is kept, as dragon-generated keeps it, except that each device lane record and each target's dump
// fault rows take the side that changed them since the base. A record both sides changed to different device runs is a
// conflict; the case lists (caseLists) of both sides are kept.
// Run by git as: node scripts/lanes-merge.ts %O %A %B %P   (writes the result into %A; exit 1 leaves ours as a conflict)
import { readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const LANES_MERGE_DRIVER = 'node scripts/lanes-merge.ts %O %A %B %P';

export class Refuse extends Error {}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

// The fields of a device lane record a device run writes; the rest is the configuration regen rewrites.
const RUN_FIELDS = ['state', 'reason', 'run', 'device', 'evidence', 'producedOn'] as const;
const runOf = (r: Obj | undefined): unknown => (r === undefined ? null : Object.fromEntries(RUN_FIELDS.map((k) => [k, r[k] ?? null])));

const parse = (text: string, side: string): Obj => {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch (error) {
    throw new Refuse(`${side} is not JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!isObj(v) || !Array.isArray(v['targets']) || !v['targets'].every((t) => isObj(t) && typeof t['target'] === 'string' && Array.isArray(t['lanes']))) {
    throw new Refuse(`${side} is not { targets: [{ target, lanes }] }`);
  }
  for (const t of v['targets'] as Obj[]) {
    if (!(t['lanes'] as unknown[]).every((l) => isObj(l) && typeof l['lane'] === 'string' && typeof l['where'] === 'string')) throw new Refuse(`${side}: a ${String(t['target'])} lane is not { lane, where }`);
  }
  if (v['caseLists'] !== undefined && !isObj(v['caseLists'])) throw new Refuse(`${side}: caseLists is not an object`);
  return v;
};

const targetOf = (f: Obj, target: string): Obj | undefined => (f['targets'] as Obj[]).find((t) => t['target'] === target);
const laneOf = (t: Obj | undefined, lane: string): Obj | undefined => (t === undefined ? undefined : (t['lanes'] as Obj[]).find((l) => l['lane'] === lane));

/** Three-way pick of one device-written value: the side that changed it, either when both agree, else a conflict. */
const pick = <T>(at: string, o: T, a: T, b: T, key: (x: T) => unknown): T => {
  const [ko, ka, kb] = [key(o), key(a), key(b)];
  // A record regen reset to not run (stale on that side) holds no device run: the other side's run wins, and regen drops it if stale.
  const noRun = (x: T): boolean => isObj(x) && x['state'] === 'not run' && (x['evidence'] ?? null) === null;
  if (noRun(a) && !noRun(b)) return b;
  if (noRun(b) && !noRun(a)) return a;
  if (same(ka, kb) || same(kb, ko)) return a;
  if (same(ka, ko)) return b;
  throw new Refuse(`${at}: both sides hold a different device run`);
};

/** The merged file: ours, with each device lane record and dump fault rows taken from the side that changed them. */
export function mergeLanesFile(base: string, ours: string, theirs: string): string {
  if (base.trim() === '') throw new Refuse('no base (the file was added on both sides)');
  const [o, a, b] = [parse(base, 'the base'), parse(ours, 'ours'), parse(theirs, 'theirs')];
  const targets = (a['targets'] as Obj[]).map((ta) => {
    const name = ta['target'] as string;
    const [to, tb] = [targetOf(o, name), targetOf(b, name)];
    if (tb === undefined) return ta;
    const lanes = (ta['lanes'] as Obj[]).map((la) => {
      if (la['where'] !== 'device') return la;
      const name2 = la['lane'] as string;
      const lb = laneOf(tb, name2);
      if (lb === undefined) return la;
      return pick(`${name} ${name2}`, laneOf(to, name2), la, lb, runOf);
    });
    // A device lane only theirs has (added on their side) keeps its record; regen orders and rebuilds the rest.
    for (const lb of tb['lanes'] as Obj[]) if (lb['where'] === 'device' && laneOf(ta, lb['lane'] as string) === undefined) lanes.push(lb);
    const dumpFaults = pick(`${name} dump faults`, to?.['dumpFaults'] ?? null, ta['dumpFaults'] ?? null, tb['dumpFaults'] ?? null, (x) => x);
    return { ...ta, lanes, dumpFaults };
  });
  // A target only theirs has keeps its records.
  for (const tb of b['targets'] as Obj[]) if (targetOf(a, tb['target'] as string) === undefined) targets.push(tb);
  const lists = { ...((b['caseLists'] as Obj | undefined) ?? {}), ...((a['caseLists'] as Obj | undefined) ?? {}) };
  const merged: Obj = { ...a, targets };
  if (a['caseLists'] !== undefined || b['caseLists'] !== undefined) merged['caseLists'] = Object.fromEntries(Object.keys(lists).sort().map((k) => [k, lists[k]]));
  return `${JSON.stringify(merged, null, 2)}\n`;
}

// Run as a script (realpaths: /tmp is a symlink on macOS, and a guard that misses would leave git with ours unmerged).
if (process.argv[1] !== undefined && realpathSync(resolve(process.argv[1])) === realpathSync(import.meta.filename)) {
  const [o, a, b, path] = process.argv.slice(2);
  if (o === undefined || a === undefined || b === undefined || path === undefined) {
    console.error('usage: lanes-merge.ts %O %A %B %P');
    process.exit(2);
  }
  try {
    const text = mergeLanesFile(readFileSync(o, 'utf8'), readFileSync(a, 'utf8'), readFileSync(b, 'utf8'));
    // %A is replaced whole (temp file, then rename), so it is ours or the merge, never half of one.
    writeFileSync(`${a}.lanes-merge`, text);
    renameSync(`${a}.lanes-merge`, a);
    console.error(`lanes-merge: merged ${path}; pnpm regen rebuilds its host parts`);
  } catch (error) {
    rmSync(`${a}.lanes-merge`, { force: true });
    console.error(`lanes-merge: ${path} left as ours, a conflict: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
