// Writes inputs.jsonl, the shadow paint-vector cases (paint-shadow.ts through the harness, units mode "paint:shadow:<fn>").
// Deterministic and small (layers of a few hundred pixels): the spread shapes of square and rounded boxes, the supersampled
// coverage and SkRRect type of each shape kind, a blurred coverage on each Skia path (plain, nine-patch rect, nine-patch rrect,
// path blur of an oval), outer and inset layers with one and two shadows, each planted fault on a case it changes, and the device
// layers over a backdrop with the backdrop, composite and encoding they use.
// Run: node scripts/gen-paint-inputs-shadow.ts (a pnpm regen step)
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
  for (const [x, y] of [[1, 1], [2, 3], [5, 6], [8, 6]] as const) out.push(line('shapeCoverage', [l, t, r, b, ...radii, x, y]));
}
const CLIP = [-1000, -1000, 1000, 1000];
out.push(line('blurredCoverage', [2, 2, 8, 6, ...SQUARE, 0, ...CLIP]));
out.push(line('blurredCoverage', [2, 2, 22, 18, ...SQUARE, 1, ...CLIP]));
out.push(line('blurredCoverage', [2, 2, 5, 5, ...SQUARE, 1.5, ...CLIP]));
out.push(line('blurredCoverage', [2, 2, 22, 18, ...ROUND, 1, ...CLIP]));
out.push(line('blurredCoverage', [2, 2, 12, 12, 5, 5, 5, 5, 5, 5, 5, 5, 0.75, ...CLIP]));
out.push(line('blurredCoverage', [2, 2, 12, 12, 5, 5, 5, 5, 5, 5, 5, 5, 2.5, ...CLIP]));
// Rounded sources through Skia's analytic AA: a complex rrect's nine-patch, an oval's and a clipped rrect's path blur.
out.push(line('blurredCoverage', [1, 1, 41, 31, ...MIXED, 1.5, ...CLIP]));
out.push(line('blurredCoverage', [0.5, 1.25, 20.5, 21.25, 10, 10, 10, 10, 10, 10, 10, 10, 1.25, ...CLIP]));
out.push(line('blurredCoverage', [2, 2, 22, 18, ...ROUND, 3, 0, 0, 12, 10]));
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
out.push(line('insetShadowLayer', [2, 2, 26, 20, 1, 1, 1, 1, 5, 3, 5, 3, 4, 2, 4, 2, 1, ...shadow(true, 1, 1, 3, 0.5, 0, 0, 0, 180), 2.625, ...NO]));
out.push(line('insetShadowLayer', [2, 2, 16, 12, 0, 0, 0, 0, ...SQUARE, 2, ...ins, 2, 1, 0, 0]));
// The device layers (*Over): the backdrop fills, the platform composite and its encoding, and layers over a backdrop.
const fill = (l: number, t: number, r: number, b: number, radii: readonly number[], cr: number, cg: number, cb: number, ca: number): number[] => [l, t, r, b, ...radii, cr, cg, cb, ca];
const stage = fill(0, 0, 40, 30, SQUARE, 43, 58, 74, 255);
const tint = fill(2, 2, 14, 10, ROUND, 200, 100, 20, 128);
out.push(line('backdropAt', [0, 5, 5]));
out.push(line('backdropAt', [1, ...stage, 5, 5]));
out.push(line('backdropAt', [2, ...stage, ...tint, 6, 6]));
out.push(line('backdropAt', [2, ...stage, ...tint, 2, 2]));
out.push(line('backdropAt', [1, ...fill(0, 0, 40, 30, SQUARE, 0, 0, 0, 0), 5, 5]));
for (const [s, a, d] of [[0, 0, 255], [0, 128, 200], [40, 90, 17], [128, 128, 255], [255, 255, 0]]) out.push(line('platformOver', [s as number, a as number, d as number]));
out.push(line('encodeOver', [40, 55, 70, 43, 58, 74, 12]));
out.push(line('encodeOver', [0, 0, 0, 255, 255, 255, 255]));
out.push(line('encodeOver', [250, 250, 250, 255, 255, 255, 3]));
out.push(line('encodeOver', [200, 30, 90, 20, 26, 34, 0]));
out.push(line('encodeOver', [43, 58, 74, 43, 58, 74, 0]));
for (const [radii, opaque] of [[SQUARE, 1], [ROUND, 0]] as const) {
  out.push(line('outerShadowLayerOver', [4, 4, 16, 12, ...radii, opaque, 1, ...one, 1, ...NO, 1, ...stage]));
  out.push(line('outerShadowLayerOver', [4, 4, 16, 12, ...radii, opaque, 2, ...two, 2, ...NO, 2, ...stage, ...tint]));
}
out.push(line('outerShadowLayerOver', [4, 4, 16, 12, ...SQUARE, 1, 2, ...two, 2.625, ...NO, 0]));
out.push(line('outerShadowLayerOver', [4, 4, 16, 12, ...SQUARE, 1, 1, ...one, 2, 0, 1, 0, 1, ...stage]));
out.push(line('insetShadowLayerOver', [2, 2, 16, 12, 1, 2, 1, 2, ...SQUARE, 2, ...ins, 2, ...NO, 2, ...stage, ...fill(2, 2, 16, 12, SQUARE, 58, 110, 165, 255)]));
out.push(line('insetShadowLayerOver', [2, 2, 26, 20, 1, 1, 1, 1, 5, 3, 5, 3, 4, 2, 4, 2, 1, ...shadow(true, 1, 1, 3, 0.5, 0, 0, 0, 180), 2.625, ...NO, 1, ...fill(2, 2, 26, 20, [6, 4, 6, 4, 5, 3, 5, 3], 58, 110, 165, 200)]));
out.push(line('insetShadowLayerOver', [2, 2, 16, 12, 0, 0, 0, 0, ...SQUARE, 2, ...ins, 2, 1, 0, 0, 1, ...stage]));
writeFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'packages', 'layout', 'paint-vectors', 'shadow', 'inputs.jsonl'), `${out.join('\n')}\n`);
console.log(`shadow inputs: ${out.length} cases`);
