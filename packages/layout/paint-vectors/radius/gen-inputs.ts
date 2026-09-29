// Writes inputs.jsonl, the radius paint-vector cases (paint-radius.ts through the harness, units mode "paint:radius:<fn>").
// Deterministic: a fixed grid of boxes, borders, radius lengths and device pixel ratios, plus the edge cases of the clamp and
// the inner radii, each with the planted faults off and on. Run: node packages/layout/paint-vectors/radius/gen-inputs.ts
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const view = new DataView(new ArrayBuffer(8));
const bits = (x: number): string => {
  view.setFloat64(0, x);
  return view.getBigUint64(0).toString(16).padStart(16, '0');
};
const line = (name: string, args: readonly number[]): string => JSON.stringify([`paint:radius:${name}`, ...args.map(bits)]);

type Len = readonly [0 | 1, number];
const px = (v: number): Len => [0, v];
const pct = (v: number): Len => [1, v];
const flat = (ls: readonly Len[]): number[] => ls.flatMap((l) => [l[0], l[1]]);

const DPRS = [1, 2, 3, 2.625];
const FAULTS: readonly (readonly [number, number])[] = [[0, 0], [1, 0], [0, 1]];
/** Eight lengths: horizontal then vertical, top-left first. */
const RADII: readonly (readonly Len[])[] = [
  [px(0), px(0), px(0), px(0), px(0), px(0), px(0), px(0)],
  [px(10), px(10), px(10), px(10), px(10), px(10), px(10), px(10)],
  [px(8), px(16), px(0), px(5.6), px(8), px(16), px(0), px(5.6)],
  [pct(50), pct(50), pct(50), pct(50), pct(50), pct(50), pct(50), pct(50)],
  [px(999), px(999), px(999), px(999), px(999), px(999), px(999), px(999)],
  [px(10), px(20), px(30), px(40), px(5), px(6), px(5), px(6)],
  [pct(33.333), px(12), pct(10), px(0.5), px(20), pct(25), px(7), pct(80)],
  [px(60), px(60), px(0), px(0), px(40), px(40), px(0), px(0)],
  [px(1e-7), px(4), px(4), px(4), px(4), px(4), px(4), px(4)],
];
/** Snapped border boxes (left, top, right, bottom) and border widths (top, right, bottom, left), in device px. */
const BOXES: readonly (readonly [number, number, number, number, readonly number[]])[] = [
  [0, 0, 100, 50, [0, 0, 0, 0]],
  [3, 7, 83, 87, [2, 2, 2, 2]],
  [10, 20, 45, 200, [6, 1, 3, 12]],
  [0, 0, 79, 79, [5, 5, 5, 5]],
  [5, 5, 6, 30, [0, 0, 0, 0]],
];

const out: string[] = [];
for (const r of RADII) {
  for (const [l, t, rr, b, borders] of BOXES) {
    for (const dpr of DPRS) {
      for (const f of FAULTS) out.push(line('roundedShape', [l, t, rr, b, ...borders, ...flat(r), dpr, ...f]));
      out.push(line('resolveCornerRadii', [...flat(r), rr - l, b - t, dpr]));
    }
  }
}
for (const len of [px(0), px(7.5), px(0.35 * 16), pct(50), pct(33.333), pct(0.1)]) {
  for (const axis of [0, 1, 79, 78.75, 1050]) for (const dpr of DPRS) out.push(line('radiusComponent', [...len, axis, dpr]));
}
const RAW: readonly (readonly number[])[] = [
  [10, 10, 10, 10, 10, 10, 10, 10],
  [60, 60, 0, 0, 40, 40, 0, 0],
  [80, 30, 30, 80, 20, 20, 20, 20],
  [0, 50, 0, 50, 50, 0, 50, 0],
  [1e-7, 1, 2, 3, 4, 5, 6, 7],
];
for (const radii of RAW) {
  for (const [w, h] of [[100, 50], [79, 79], [1, 30], [0, 0]]) {
    out.push(line('radiiRenderable', [...radii, w as number, h as number]));
    out.push(line('hasRoundedCorner', radii));
    for (const f of FAULTS) {
      out.push(line('constrainCornerRadii', [...radii, w as number, h as number, ...f]));
      for (const borders of [[0, 0, 0, 0], [2, 3, 4, 5], [30, 30, 30, 30]]) out.push(line('innerCornerRadii', [...radii, ...borders, w as number, h as number, ...f]));
    }
  }
}
writeFileSync(join(dirname(fileURLToPath(import.meta.url)), 'inputs.jsonl'), `${out.join('\n')}\n`);
console.log(`radius inputs: ${out.length} cases`);
