// Writes inputs.jsonl, the radius paint-vector cases (paint-radius.ts through the harness, units mode "paint:radius:<fn>").
// Deterministic: each radius set on a plain and a bordered box at two device pixel ratios, the component, clamp and inner-radius
// edge cases, and each planted fault on the cases that exercise it. Run: node scripts/gen-paint-inputs-radius.ts (a pnpm regen step)
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

const RAW: readonly (readonly number[])[] = [
  [10, 10, 10, 10, 10, 10, 10, 10],
  [60, 60, 0, 0, 40, 40, 0, 0],
  [80, 30, 30, 80, 20, 20, 20, 20],
  [0, 50, 0, 50, 50, 0, 50, 0],
  [1e-7, 1, 2, 3, 4, 5, 6, 7],
];

const out: string[] = [];
// Every radius set on two boxes (one bordered) at DPR 1 and 2.625 with no fault; each fault on the sets that exercise it.
RADII.forEach((r, i) => {
  const pick = (k: number): (typeof BOXES)[number] => {
    const box = BOXES[k];
    if (box === undefined) throw new Error(`no box ${k}`);
    return box;
  };
  for (const [l, t, rr, b, borders] of [pick(i % BOXES.length), pick(3)]) {
    for (const dpr of [1, 2.625]) out.push(line('roundedShape', [l, t, rr, b, rr - l, b - t, ...borders, ...flat(r), dpr, 0, 0]));
    // A fractional layout box snapped to these edges: percentages resolve against the layout size.
    out.push(line('roundedShape', [l, t, rr, b, rr - l + 0.25, b - t + 0.25, ...borders, ...flat(r), 2.625, 0, 0]));
  }
  out.push(line('resolveCornerRadii', [...flat(r), 79, 33.25, DPRS[i % DPRS.length] as number]));
});
for (const f of FAULTS.slice(1)) {
  for (const r of [RADII[4], RADII[1]] as const) {
    const [l, t, rr, b, borders] = BOXES[1] as (typeof BOXES)[number];
    out.push(line('roundedShape', [l, t, rr, b, rr - l, b - t, ...borders, ...flat(r as readonly Len[]), 2, ...f]));
  }
}
for (const len of [px(0), px(7.5), px(0.35 * 16), pct(50), pct(33.333), pct(0.1)]) {
  for (const [axis, dpr] of [[79, 2.625], [1050, 3]] as const) out.push(line('radiusComponent', [...len, axis, dpr]));
}
for (const radii of RAW) {
  out.push(line('hasRoundedCorner', radii));
  for (const [w, h] of [[100, 50], [1, 30]] as const) {
    out.push(line('radiiRenderable', [...radii, w, h]));
    out.push(line('constrainCornerRadii', [...radii, w, h, 0, 0]));
    out.push(line('innerCornerRadii', [...radii, 2, 3, 4, 5, w, h, 0, 0]));
  }
}
out.push(line('constrainCornerRadii', [...(RAW[1] as number[]), 100, 50, 1, 0]));
out.push(line('innerCornerRadii', [...(RAW[0] as number[]), 2, 3, 4, 5, 100, 50, 0, 1]));
out.push(line('innerCornerRadii', [...(RAW[2] as number[]), 30, 30, 30, 30, 100, 50, 0, 0]));
writeFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'packages', 'layout', 'paint-vectors', 'radius', 'inputs.jsonl'), `${out.join('\n')}\n`);
console.log(`radius inputs: ${out.length} cases`);
