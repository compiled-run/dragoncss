import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { floorRegressions, isFloorFile } from '../../../scripts/land-lib.ts';
import { format, MERGE_DRIVERS, mergeFloorFile, Refuse } from '../../../scripts/floor-merge.ts';
import { repoPath } from '../src/paths.ts';

const temps: string[] = [];
afterAll(() => {
  for (const d of temps) rmSync(d, { recursive: true, force: true });
});
const j = (v: unknown): string => `${JSON.stringify(v, null, 2)}\n`;
const merge = (path: string, o: unknown, a: unknown, b: unknown): unknown => JSON.parse(mergeFloorFile(path, j(o), j(a), j(b)));
const FLOOR = 'packages/dragon/test/seams-floor.json';

describe('the floor merge driver: typical conflicts', () => {
  it('unions two extensions of a sorted name list, sorted (DRAGON_FLOOR_WRITE writes unordered floors sorted)', () => {
    expect(merge(FLOOR, { longhands: ['a', 'c'] }, { longhands: ['a', 'b', 'c'] }, { longhands: ['a', 'c', 'd'] })).toEqual({ longhands: ['a', 'b', 'c', 'd'] });
  });

  it('unions two extensions of an ordered list, keeping each side\'s order', () => {
    expect(merge(FLOOR, { modules: ['z', 'm'] }, { modules: ['z', 'm', 'q'] }, { modules: ['z', 'm', 'b'] })).toEqual({ modules: ['z', 'm', 'q', 'b'] });
    expect(merge(FLOOR, { modules: ['z', 'm'] }, { modules: ['z', 'x', 'm'] }, { modules: ['z', 'm', 'b'] })).toEqual({ modules: ['z', 'x', 'm', 'b'] });
  });

  it('takes the larger of two raised counts and keeps keys either side added (p1-floor and css-escapes shapes)', () => {
    const p1 = 'packages/translate/test/p1-floor.json';
    const o = { p1: { order: ['vectors', 'units'], counts: { vectors: 250, units: 320000 } } };
    const a = { p1: { order: ['vectors', 'units', 'engine'], counts: { vectors: 258, units: 320000, engine: 20258 } } };
    const b = { p1: { order: ['vectors', 'units', 'rt'], counts: { vectors: 255, units: 320010, rt: 55362 } } };
    expect(merge(p1, o, a, b)).toEqual({ p1: { order: ['vectors', 'units', 'engine', 'rt'], counts: { vectors: 258, units: 320010, engine: 20258, rt: 55362 } } });
    const esc = 'packages/parity/test/css-escapes-floor.json';
    expect(Object.keys(merge(esc, { a: 1, c: 2 }, { a: 3, b: 1, c: 2 }, { a: 2, c: 2, d: 5 }) as object)).toEqual(['a', 'b', 'c', 'd']);
    expect(merge(esc, { a: 1, c: 2 }, { a: 3, b: 1, c: 2 }, { a: 2, c: 2, d: 5 })).toEqual({ a: 3, b: 1, c: 2, d: 5 });
  });

  it('merges pins of different cases or targets, and leaves a pin both sides changed differently as a conflict', () => {
    const pins = 'packages/parity/test/glyph-clearance-pins.json';
    const t = (d: number, r: number) => ({ dropped: { edge: d }, rescued: { edge: r } });
    const o = { x: { 'ios@2': t(1, 1) }, y: { 'ios@2': t(2, 0) } };
    const out = mergeFloorFile(pins, format(pins, o), format(pins, { ...o, x: { 'ios@2': t(0, 2) } }), format(pins, { ...o, y: { 'ios@2': t(2, 0), 'ios@3': t(1, 1) } }));
    expect(JSON.parse(out)).toEqual({ x: { 'ios@2': t(0, 2) }, y: { 'ios@2': t(2, 0), 'ios@3': t(1, 1) } });
    expect(out).toBe(`{\n  "x": {"ios@2":{"dropped":{"edge":0},"rescued":{"edge":2}}},\n  "y": {"ios@2":{"dropped":{"edge":2},"rescued":{"edge":0}},"ios@3":{"dropped":{"edge":1},"rescued":{"edge":1}}}\n}\n`);
    // Pins are exact: two different changes of one count are not merged by taking the larger.
    expect(() => mergeFloorFile(pins, format(pins, o), format(pins, { ...o, x: { 'ios@2': t(0, 1) } }), format(pins, { ...o, x: { 'ios@2': t(3, 1) } }))).toThrow(/a pin both sides changed/);
  });

  it('refuses a result in a floor shape the landing driver cannot judge (it could not prove it never lowers)', () => {
    expect(() => merge(FLOOR, { c: { x: 1 } }, { c: { x: 2 } }, { c: { x: 1, y: 1 } })).toThrow(/cannot judge/);
  });

  it('refuses what it cannot merge safely: a removal, a type change, a repeated name, two orders, bad JSON', () => {
    expect(() => merge(FLOOR, { l: ['a', 'b'] }, { l: ['a', 'b', 'c'] }, { l: ['a', 'd'] })).toThrow(/theirs removed \["b"\]/);
    expect(() => merge(FLOOR, { l: ['a'], n: 1 }, { l: ['a', 'b'], n: 1 }, { l: ['a'] })).toThrow(Refuse);
    expect(() => merge(FLOOR, { n: 1 }, { n: 2 }, { n: '3' })).toThrow(/a number on one side, a string on the other/);
    expect(() => merge(FLOOR, { l: ['z', 'm'] }, { l: ['z', 'm', 'q'] }, { l: ['z', 'm', 'q', 'q'] })).toThrow(/repeats a name/);
    expect(() => merge(FLOOR, { l: ['z', 'm', 'a'] }, { l: ['z', 'm', 'a', 'x', 'y'] }, { l: ['z', 'm', 'a', 'y', 'x'] })).toThrow(/order/);
    expect(() => merge(FLOOR, { s: 'a' }, { s: 'b' }, { s: 'c' })).toThrow(/both sides changed/);
    expect(() => mergeFloorFile(FLOOR, '{}', '{', '{}')).toThrow(/ours is not JSON/);
  });

  it('takes a key as one side changed it when the other did not, and writes the floor writers\' format', () => {
    expect(mergeFloorFile(FLOOR, j({ n: 1, l: ['a'] }), j({ n: 2, l: ['a'] }), j({ n: 1, l: ['a'], m: ['b', 'a'] }))).toBe(j({ n: 2, l: ['a'], m: ['b', 'a'] }));
  });
});

// A seeded random floor, and raises of it as DRAGON_FLOOR_WRITE makes them (counts up, names appended or added sorted).
const rng = (seed: number) => () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const raise = (r: () => number, f: Record<string, unknown>): Record<string, unknown> => {
  const out: Record<string, unknown> = JSON.parse(JSON.stringify(f));
  for (const [k, v] of Object.entries(out)) {
    if (typeof v === 'number' && r() < 0.5) out[k] = v + Math.floor(r() * 5);
    if (Array.isArray(v) && r() < 0.5) out[k] = k.startsWith('sorted') ? [...new Set([...v, `n${Math.floor(r() * 30)}`])].sort() : [...new Set([...v, `n${Math.floor(r() * 30)}`])];
  }
  if (r() < 0.3) out[`k${Math.floor(r() * 9)}`] ??= Math.floor(r() * 9);
  return out;
};

describe('the floor merge driver never lowers a floor', () => {
  it('gives, for 2000 random pairs of raises, a result no lower than either side (or a conflict), never below the base', () => {
    const r = rng(7);
    let merged = 0;
    for (let i = 0; i < 2000; i++) {
      const base: Record<string, unknown> = { sortedA: ['a', 'c'], ordered: ['z', 'm'], n: Math.floor(r() * 10), m: 3 };
      const [a, b] = [raise(r, base), raise(r, base)];
      let out: string;
      try {
        out = mergeFloorFile(FLOOR, j(base), j(a), j(b));
      } catch (error) {
        expect(error).toBeInstanceOf(Refuse);
        continue;
      }
      merged++;
      for (const side of [base, a, b]) expect(floorRegressions(FLOOR, j(side), out), JSON.stringify({ base, a, b })).toEqual([]);
    }
    expect(merged).toBeGreaterThan(1900);
  });

  it('refuses rather than lowers: a side that lowered a count, or removed one, is left as a conflict', () => {
    // A three-way merge would take the lowered count (the other side left it alone); the check against both sides refuses it.
    expect(() => merge(FLOOR, { n: 5, m: 1 }, { n: 3, m: 1 }, { n: 5, m: 2 })).toThrow(/would lower a floor: .*n: lowered 5 -> 3/);
    expect(() => merge(FLOOR, { n: 5, k: 1 }, { n: 5 }, { n: 6, k: 1 })).toThrow(/removed/);
  });
});

describe('the floor merge driver in git', () => {
  const dir = mkdtempSync(join(tmpdir(), 'floor-merge-'));
  temps.push(dir);
  const git = (...args: string[]): string =>
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const path = 'packages/x/test/a-floor.json';
  const write = (v: unknown): void => {
    execFileSync('mkdir', ['-p', join(dir, 'packages/x/test')]);
    writeFileSync(join(dir, path), j(v));
  };
  git('init', '-q', '-b', 'master');
  git('config', 'merge.dragon-floor.driver', `node ${repoPath('scripts/floor-merge.ts')} %O %A %B %P`);
  writeFileSync(join(dir, '.gitattributes'), 'packages/*/test/*-floor.json merge=dragon-floor\n');
  write({ names: ['a', 'b'], x: 1, y: 1 });
  git('add', '-A');
  git('commit', '-q', '-m', 'base');
  git('checkout', '-q', '-b', 'one');
  write({ names: ['a', 'b', 'c'], x: 4, y: 1 });
  git('commit', '-qam', 'one');
  git('checkout', '-q', 'master');
  write({ names: ['a', 'b', 'd'], x: 2, y: 3 });
  git('commit', '-qam', 'two');

  it('merges two PRs that raised the same floor, with no conflict, where a text merge conflicts', () => {
    git('merge', '-q', '--no-edit', 'one');
    expect(JSON.parse(readFileSync(join(dir, path), 'utf8'))).toEqual({ names: ['a', 'b', 'c', 'd'], x: 4, y: 3 });
    git('reset', '-q', '--hard', 'HEAD~1');
    expect(() => git('-c', 'merge.dragon-floor.driver=false', 'merge', '-q', '--no-edit', 'one')).toThrow(); // without the driver
    git('merge', '--abort');
  });

  it('leaves a conflict, with markers, on what it refuses', () => {
    git('checkout', '-q', '-b', 'three', 'master~1');
    write({ names: ['a'], x: 1, y: 1 }); // removes "b": never merged by the driver
    git('commit', '-qam', 'three');
    git('checkout', '-q', 'master');
    expect(() => git('merge', '-q', '--no-edit', 'three')).toThrow();
    expect(readFileSync(join(dir, path), 'utf8')).toMatch(/^<<<<<<< ours/m);
    git('merge', '--abort');
  });
});

describe('the floor merge driver is registered', () => {
  it('pnpm setup:git sets exactly the merge drivers the landing driver sets', () => {
    const cmd = (JSON.parse(readFileSync(repoPath('package.json'), 'utf8')) as { scripts: Record<string, string> }).scripts['setup:git']!;
    const sets = [...cmd.matchAll(/git config (\S+) (?:'([^']*)'|(\S+))/g)].map((m) => [m[1], m[2] ?? m[3]]);
    expect(sets).toEqual(MERGE_DRIVERS.map(([k, v]) => [k, v]));
  });

  it('writes every floor and pin file in this tree byte for byte as it is, so a merge changes only what it merges', () => {
    const files = execFileSync('git', ['ls-files', '-z'], { cwd: repoPath('.'), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).split('\0').filter(isFloorFile);
    for (const f of files) {
      const text = readFileSync(repoPath(f), 'utf8');
      expect(format(f, JSON.parse(text)), f).toBe(text);
      expect(mergeFloorFile(f, text, text, text), f).toBe(text);
    }
  });

  it('marks exactly the floor and pin files the landing driver judges (isFloorFile) merge=dragon-floor', () => {
    const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: repoPath('.'), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).split('\0').filter((p) => p !== '');
    const marked = execFileSync('git', ['ls-files', '-z', ':(attr:merge=dragon-floor)'], { cwd: repoPath('.'), encoding: 'utf8' }).split('\0').filter((p) => p !== '');
    expect(marked).toEqual(tracked.filter(isFloorFile));
    expect(marked.length).toBeGreaterThanOrEqual(6);
  });
});
