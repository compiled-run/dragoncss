// The shadow painter's pixel buffers are Uint8Array, translated to one unboxed byte per element (JsBytes: Kotlin ByteArray, Swift
// [UInt8]), so a large shadow layer draws within a small JVM heap; its pixels equal TypeScript's bit for bit on both targets, and
// the translated Uint8Array stores and reads behave as JavaScript's.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runUnitsCase } from '../harness/harness.ts';
import { committedFiles, runTarget } from '../src/check.ts';
import type { Corpus, Suite } from '../src/corpus.ts';
import { digestsOf, split } from '../src/corpus.ts';
import { allPass, blockedRun, buildKotlin, isBlocked, kotlinExec, kotlinTool, requireNative, runSuites } from '../src/native.ts';
import { checkSubset } from '../src/subset.ts';

/** Below Android's default app heap (192 MB on the phones that failed); before Uint8Array buffers these layers needed 256 MB to over 2 GB. */
const HEAP = '-Xmx128m';

const view = new DataView(new ArrayBuffer(8));
const bits = (x: number): string => {
  view.setFloat64(0, x);
  return view.getBigUint64(0).toString(16).padStart(16, '0');
};
const line = (name: string, args: readonly number[]): string => JSON.stringify([name, ...args.map(bits)]);
const shadow = (inset: boolean, x: number, y: number, blur: number, spread: number, a: number): number[] => [inset ? 1 : 0, x, y, blur, spread, 0, 0, 0, a];
const radii = (r: number): number[] => [r, r, r, r, r, r, r, r];
const NO = [0, 0, 0];
const white = (r: number, b: number): number[] => [1, 0, 0, r, b, ...radii(0), 255, 255, 255, 255];

/** 1100 x 500 device px boxes on each Skia path (rrect nine-patch, rect nine-patch, path blur, inset), and one of 2400 x 1800. */
const LAYERS = [
  line('paint:shadow:outerShadowLayerOver', [40, 40, 1140, 540, ...radii(12), 1, 1, ...shadow(false, 0, 16, 32, 8, 102), 1, ...NO, ...white(1300, 700)]),
  line('paint:shadow:outerShadowLayerOver', [40, 40, 1140, 540, ...radii(0), 1, 1, ...shadow(false, 4, 8, 24, 6, 128), 1, ...NO, ...white(1300, 700)]),
  line('paint:shadow:outerShadowLayerOver', [40, 40, 1140, 540, 200, 30, 0, 90, 120, 30, 0, 200, 0, 1, ...shadow(false, 0, 10, 20, 4, 128), 1, ...NO, ...white(1300, 700)]),
  line('paint:shadow:insetShadowLayerOver', [40, 40, 1140, 540, 2, 2, 2, 2, ...radii(10), 1, ...shadow(true, 6, 6, 20, 4, 160), 1, ...NO, 1, 40, 40, 1140, 540, ...radii(12), 58, 110, 165, 255]),
  line('paint:shadow:outerShadowLayerOver', [40, 40, 2440, 1840, ...radii(24), 1, 1, ...shadow(false, 0, 16, 40, 8, 102), 1, ...NO, ...white(2600, 2000)]),
];

/** new Uint8Array(n), then b[i] = v: wrapped stores, ignored stores at non-integer or out-of-range indexes, and bad lengths. */
const STORES: string[] = [];
for (const v of [0, 7, 255, 256, 513, -1, -256, 1.5, -1.5, 255.9, -0, Number.NaN, Infinity, -Infinity, 1e20, -1e20, 2 ** 53 + 2]) STORES.push(line('bytes:store', [3, 1, v]));
for (const i of [0, 2, 3, -1, 1.5, -0, Number.NaN, Infinity]) STORES.push(line('bytes:store', [3, i, 200]));
for (const n of [0, 2.7, Number.NaN, -1, -0.5, Infinity]) STORES.push(line('bytes:store', [n, 0, 9]));

function corpus(): Corpus {
  const suites: Suite[] = [
    { name: 'paint-heap', mode: 'units', lines: LAYERS, expected: LAYERS.map(runUnitsCase) },
    { name: 'bytes-store', mode: 'units', lines: STORES, expected: STORES.map(runUnitsCase) },
  ];
  const d = digestsOf(suites);
  return { suites, vectors: [], engineSplit: split([]), digest: d.digest, digests: d.digests };
}

describe('translated Uint8Array pixel buffers', () => {
  it('the subset takes new Uint8Array(n), length, reads and plain stores, and refuses the rest with file and line', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dragon-bytes-'));
    const file = join(dir, 'bytes.ts');
    writeFileSync(file, [
      'export function ok(n: number): number { const b = new Uint8Array(n); b[0] = 300; return readAt(b, 0) + b.length; }',
      'function readAt(b: Uint8Array, i: number): number { const v = b[i]; return v === undefined ? -1 : v; }',
      'export function narrowed(b: Uint8Array): number { b[0] = 1; return b[0]; }',
      'export function compound(b: Uint8Array): void { b[0] += 1; }',
      'export function arrayStore(a: number[]): void { a[0] = 1; }',
      'export function fromList(): Uint8Array { return new Uint8Array([1, 2]); }',
      'export function iterate(b: Uint8Array): number { let s = 0; for (const x of b) s += x; return s; }',
      '',
    ].join('\n'));
    try {
      const v = checkSubset([file]);
      const text = v.map((x) => `${x.line}: ${x.message}`).join('\n');
      expect(v.filter((x) => x.line <= 2), text).toEqual([]);
      for (const [l, what] of [[3, 'narrowed by a store'], [4, 'assignment target is outside the subset'], [5, 'element assignment on Uint8Array only'], [6, 'outside the subset'], [7, 'for...of over arrays']] as const) {
        expect(v.some((x) => x.line === l && x.message.includes(what)), `${l}: ${what}\n${text}`).toBe(true);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('the layers are non-empty, and the Uint8Array cases include wraps, ignored stores and a RangeError', () => {
    for (const l of LAYERS) expect(runUnitsCase(l).startsWith('["ok",[')).toBe(true);
    const r = STORES.map(runUnitsCase);
    expect(r[3]).toBe(runUnitsCase(line('bytes:store', [3, 1, 0])));
    expect(r).toContain('["threw"]');
  });

  it(`large shadow layers draw in a ${HEAP.slice(4)} Kotlin heap, equal to TypeScript bit for bit`, () => {
    const tool = kotlinTool();
    const c = corpus();
    if (tool === null) {
      blockedRun('kotlin', 'no JDK 17+ or kotlinc', 'install JDK 17 and kotlinc (docs/decisions.md, Native lanes, milestone 2)', requireNative());
      return;
    }
    const b = buildKotlin(tool, committedFiles('kotlin'));
    const suites = runSuites(c, kotlinExec(tool, b.jar, HEAP), 'test-paint-heap-kotlin');
    expect(suites.map((s) => `${s.name} ${s.pass}/${s.total} ${s.cause ?? ''}`)).toEqual(c.suites.map((s) => `${s.name} ${s.lines.length}/${s.lines.length} `));
    expect(allPass(suites)).toBe(true);
  }, 1_200_000);

  it('the same layers and Uint8Array cases equal TypeScript bit for bit in Swift', () => {
    const c = corpus();
    const r = runTarget('swift', c, committedFiles('swift'), 'test-paint-heap-swift');
    if (isBlocked(r)) return;
    expect(r.suites.map((s) => `${s.name} ${s.pass}/${s.total}`)).toEqual(c.suites.map((s) => `${s.name} ${s.lines.length}/${s.lines.length}`));
    expect(r.status).toBe('pass');
  }, 1_200_000);
});
