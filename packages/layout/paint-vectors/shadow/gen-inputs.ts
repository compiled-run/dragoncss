// Writes inputs.jsonl, the shadow paint-vector cases (paint-shadow.ts through the harness, units mode "paint:shadow:<fn>").
// Deterministic and small (layers of a few hundred pixels): the spread shapes of square and rounded boxes, the supersampled
// coverage and SkRRect type of each shape kind, a blurred coverage on each Skia path (plain, nine-patch rect, nine-patch rrect,
// path blur of an oval), and outer and inset layers with one and two shadows, each planted fault on a case it changes.
// Run: node packages/layout/paint-vectors/shadow/gen-inputs.ts
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const view = new DataView(new ArrayBuffer(8));
const bits = (x: number): string => {
  view.setFloat64(0, x);
  return view.getBigUint64(0).toString(16).padStart(16, '0');
};
const line = (name: string, args: readonly number[]): string => JSON.stringify([`paint:shadow:${name}`, ...args.map(bits)]);

const SQUARE = [0, 0, 0, 0, 0, 0, 0, 0];
const ROUND = [3, 3, 3, 3, 3, 3, 3, 3];
const MIXED = [4, 1.5, 0, 2, 2, 1.5, 0, 3];
const NO = [0, 0, 0];
const shadow = (inset: boolean, x: number, y: number, blur: number, spread: number, r: number, g: number, b: number, a: number): number[] => [inset ? 1 : 0, x, y, blur, spread, r, g, b, a];

const out: string[] = [];
for (const radii of [SQUARE, ROUND, MIXED]) {
  for (const spread of [0, 2, -1.5, 13.125]) out.push(line('spreadShape', [10, 10, 30, 22, ...radii, spread, ...NO]));
}
out.push(line('spreadShape', [10, 10, 30, 22, ...ROUND, 4, 1, 0, 0]));
for (const [l, t, r, b, radii] of [[1, 1, 9, 7, SQUARE], [0.5, 0.25, 8.75, 6.5, SQUARE], [1, 1, 9, 7, ROUND], [0, 0, 8, 8, [4, 4, 4, 4, 4, 4, 4, 4]], [1, 1, 11, 7, MIXED]] as const) {
  out.push(line('shapeType', [l, t, r, b, ...radii]));
  for (const [x, y] of [[1, 1], [2, 3], [5, 6], [8, 6]]) out.push(line('shapeCoverage', [l, t, r, b, ...radii, x, y]));
}
const CLIP = [-1000, -1000, 1000, 1000];
out.push(line('blurredCoverage', [2, 2, 8, 6, ...SQUARE, 0, ...CLIP]));
out.push(line('blurredCoverage', [2, 2, 22, 18, ...SQUARE, 1, ...CLIP]));
out.push(line('blurredCoverage', [2, 2, 5, 5, ...SQUARE, 1.5, ...CLIP]));
out.push(line('blurredCoverage', [2, 2, 22, 18, ...ROUND, 1, ...CLIP]));
out.push(line('blurredCoverage', [2, 2, 12, 12, 5, 5, 5, 5, 5, 5, 5, 5, 0.75, ...CLIP]));
out.push(line('blurredCoverage', [2, 2, 12, 12, 5, 5, 5, 5, 5, 5, 5, 5, 2.5, ...CLIP]));
const one = shadow(false, 1, 2, 2, 0, 0, 0, 0, 128);
const two = [...shadow(false, 0, 0, 0, 1, 255, 0, 0, 255), ...shadow(false, -1, 1, 3, 0.5, 20, 40, 200, 77)];
for (const [radii, opaque] of [[SQUARE, 1], [ROUND, 1], [ROUND, 0]] as const) {
  out.push(line('outerShadowLayer', [4, 4, 16, 12, ...radii, opaque, 1, ...one, 1, ...NO]));
  out.push(line('outerShadowLayer', [4, 4, 16, 12, ...radii, opaque, 2, ...two, 2, ...NO]));
}
out.push(line('outerShadowLayer', [4, 4, 16, 12, ...SQUARE, 1, 2, ...two, 2, 1, 0, 0]));
out.push(line('outerShadowLayer', [4, 4, 16, 12, ...SQUARE, 1, 1, ...one, 2, 0, 1, 0]));
out.push(line('outerShadowLayer', [4, 4, 16, 12, ...SQUARE, 1, 1, ...one, 1, 0, 0, 1]));
out.push(line('outerShadowLayer', [4, 4, 16, 12, ...SQUARE, 1, 1, ...shadow(true, 1, 1, 1, 0, 0, 0, 0, 255), 1, ...NO]));
const ins = [...shadow(true, 0, 1, 2, 0, 0, 0, 0, 128), ...shadow(true, 0, 0, 0, 1, 255, 255, 255, 128)];
for (const [borders, radii] of [[[0, 0, 0, 0], SQUARE], [[1, 2, 1, 2], SQUARE], [[1, 1, 1, 1], [2, 2, 2, 2, 2, 2, 2, 2]]] as const) {
  out.push(line('insetShadowLayer', [2, 2, 16, 12, ...borders, ...radii, 2, ...ins, 2, ...NO]));
}
out.push(line('insetShadowLayer', [2, 2, 16, 12, 0, 0, 0, 0, ...SQUARE, 1, ...shadow(true, 0, 0, 0, 20, 10, 20, 30, 255), 1, ...NO]));
out.push(line('insetShadowLayer', [2, 2, 16, 12, 0, 0, 0, 0, ...SQUARE, 2, ...ins, 2, 1, 0, 0]));
writeFileSync(join(dirname(fileURLToPath(import.meta.url)), 'inputs.jsonl'), `${out.join('\n')}\n`);
console.log(`shadow inputs: ${out.length} cases`);
