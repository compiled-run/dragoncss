// The one pixel-snap rule (docs/research/native-strategy.md section 3.3): engine LU are 1/64 device px, every edge is snapped from
// its absolute position with snapEdge(lu) = floor((lu + 32) / 64), sizes come from the snapped edges, and results stay numbers.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { LayoutRect, LU, SnappedRect } from '../src/index.ts';
import { snapEdges, snapRect } from '../src/index.ts';
import { snapEdge } from '../src/units.ts';

const vectors = join(dirname(fileURLToPath(import.meta.url)), '..', 'vectors');
const r = (id: string, parent: string | null, x: number, y: number, width: number, height: number): LayoutRect => ({ id, parent, x: x as LU, y: y as LU, width: width as LU, height: height as LU });

describe('snapEdge', () => {
  it('rounds to the nearest device px with halves toward +infinity (Blink LayoutUnit::Round), for negatives too', () => {
    expect([0, 31, 32, 33, 63, 64, 95, 96, -31, -32, -33, -64, -96, -97].map((v) => snapEdge(v as LU))).toEqual([0, 0, 1, 1, 1, 1, 1, 2, 0, 0, -1, -1, -1, -2]);
  });
  it('a truncating division (the planted fault snap-truncating-division) differs on negative edges, so the snap suite can see it', () => {
    const trunc = (v: number): number => Math.trunc((v + 32) / 64);
    // Truncation even gives -0 for -33, which the bit-exact comparison also sees.
    expect([-33, -97, -1000].map((v) => [snapEdge(v as LU), trunc(v)])).toEqual([[-1, -0], [-2, -1], [-16, -15]]);
  });
  it('keeps int32 extremes exact in a double', () => {
    expect(snapEdge(2147483647 as LU)).toBe(33554432);
    expect(snapEdge(-2147483648 as LU)).toBe(-33554432);
  });
});

describe('snapRect and snapEdges', () => {
  it('snaps edges, not sizes: a 64 LU box at x 32 spans device px 1 to 2, and one at x 31 spans 0 to 1', () => {
    expect(snapRect(r('a', null, 32, 0, 64, 32))).toEqual({ id: 'a', left: 1, top: 0, right: 2, bottom: 1, width: 1, height: 1 });
    expect(snapRect(r('a', null, 31, 31, 64, 33))).toEqual({ id: 'a', left: 0, top: 0, right: 1, bottom: 1, width: 1, height: 1 });
    // Two 48 LU boxes side by side: widths 1 and 0 device px, but no gap and no overlap.
    const [a, b] = snapEdges([r('p', null, 0, 0, 96, 10), r('a', 'p', 0, 0, 48, 10), r('b', 'p', 48, 0, 48, 10)]).slice(1) as [SnappedRect, SnappedRect];
    expect([a.right, b.left, a.width, b.width]).toEqual([1, 1, 1, 1]);
  });
  it('edges are absolute: a child at 16 LU inside a parent at 16 LU snaps from 32 LU', () => {
    const out = snapEdges([r('p', null, 16, 16, 128, 128), r('c', 'p', 16, 16, 16, 16)]);
    expect(out.map((x) => [x.id, x.left, x.top, x.right, x.bottom])).toEqual([['p', 0, 0, 2, 2], ['c', 1, 1, 1, 1]]);
  });
  it('right and bottom use the saturating add, so an edge past int32 stays at INT_MAX', () => {
    const out = snapRect(r('s', null, 2147483600, 0, 1000, 0));
    expect([out.right, out.width]).toEqual([snapEdge(2147483647 as LU), snapEdge(2147483647 as LU) - snapEdge(2147483600 as LU)]);
  });
  it('results are numbers in result order', () => {
    const out = snapEdges([r('p', null, 0, 0, 640, 640), r('b', 'p', 64, 64, 64, 64), r('a', 'p', 0, 0, 1, 1)]);
    expect(out.map((x) => x.id)).toEqual(['p', 'b', 'a']);
    for (const x of out) for (const v of [x.left, x.top, x.right, x.bottom, x.width, x.height]) expect(typeof v).toBe('number');
  });
});

describe('snap vectors (vectors/dpr-<N>/snap, written by pnpm run layout:dpr-vectors)', () => {
  for (const dpr of [2, 3, 2.625]) {
    it(`DPR ${dpr}: every snap vector is the DPR vector output and its snapEdges, 271 cases`, () => {
      const dir = join(vectors, `dpr-${dpr}`, 'snap');
      const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
      expect(files.length).toBe(271);
      for (const f of files) {
        const v = JSON.parse(readFileSync(join(dir, f), 'utf8')) as { platform: string; devicePixelRatio: number; input: LayoutRect[]; output: SnappedRect[] };
        expect([Object.keys(v), v.platform, v.devicePixelRatio], f).toEqual([['platform', 'devicePixelRatio', 'input', 'output'], 'darwin-arm64', dpr]);
        const vector = JSON.parse(readFileSync(join(vectors, `dpr-${dpr}`, f), 'utf8')) as { output: LayoutRect[] };
        expect(v.input, f).toEqual(vector.output);
        expect(snapEdges(v.input), f).toEqual(v.output);
      }
    });
  }
});
