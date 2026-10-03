// PNT2: the committed input lines of the transform paint vectors (packages/layout/paint-vectors/transform/inputs.jsonl), generated
// here so the trig table of every line is exactly the sin and cos the TypeScript reference asks for. paint-transform.test.ts checks
// the committed file against this generator; write it with
//   node packages/layout/test/paint-transform-cases.ts > packages/layout/paint-vectors/transform/inputs.jsonl
import { pathToFileURL } from 'node:url';
import type { TransformOrigin } from '../src/paint-transform.ts';
import { paintTransformMatrix, transformFunctionsMatrix } from '../src/paint-transform.ts';
import type { LengthValue, Matrix2D, TransformOp, Trig } from '../src/rt-interpolate.ts';
import { lengthPercent, lengthPx, rotateOp, scaleOp, translateOp, ZERO_PX } from '../src/rt-interpolate.ts';

const view = new DataView(new ArrayBuffer(8));
/** The IEEE 754 bit pattern of a double, as the harness reads arguments. */
export function bits(x: number): string {
  view.setFloat64(0, x);
  return view.getBigUint64(0).toString(16).padStart(16, '0');
}

const len = (l: LengthValue): unknown[] => [l.kind, bits(l.px), bits(l.percent)];
const opJson = (o: TransformOp): unknown[] => [o.fn, len(o.x), len(o.y), bits(o.angle), bits(o.sx), bits(o.sy)];
const originJson = (o: TransformOrigin): unknown[] => [len(o.x), len(o.y)];
const matrixJson = (m: Matrix2D): unknown[] => [m.full, bits(m.a), bits(m.b), bits(m.c), bits(m.d), bits(m.e), bits(m.f)];

/** Math.sin and Math.cos, recording every argument the reference asks for. */
function recordingTrig(): { trig: Trig; table: () => unknown[] } {
  const seen = new Map<string, number>();
  const trig: Trig = {
    sin: (r) => {
      seen.set(bits(r), r);
      return Math.sin(r);
    },
    cos: (r) => {
      seen.set(bits(r), r);
      return Math.cos(r);
    },
  };
  return { trig, table: () => [...seen.values()].map((r) => [bits(r), bits(Math.sin(r)), bits(Math.cos(r))]) };
}

const calc = (px: number, percent: number): LengthValue => ({ kind: 'calc', px: Math.fround(px), percent: Math.fround(percent) });
const tx = (x: LengthValue): TransformOp => translateOp('translateX', x, ZERO_PX);
const ty = (y: LengthValue): TransformOp => translateOp('translateY', ZERO_PX, y);
const t = (x: LengthValue, y: LengthValue): TransformOp => translateOp('translate', x, y);
const r = (deg: number): TransformOp => rotateOp(deg);
const s = (x: number, y: number): TransformOp => scaleOp('scale', x, y);

/** The transform lists: every function kind, the exact multiples of 45deg and their neighbours, the demo's lists and compositions. */
export const OP_LISTS: readonly (readonly TransformOp[])[] = [
  [],
  [t(lengthPx(10), lengthPx(-7.25))],
  [t(lengthPercent(-50), lengthPercent(-50))],
  [tx(lengthPercent(100))],
  [tx(lengthPercent(-18)), r(8)],
  [r(28), tx(lengthPercent(22))],
  [r(142), tx(lengthPercent(34))],
  [ty(lengthPx(3.5))],
  [ty(calc(4, 25))],
  [s(1.08, 1.08)],
  [scaleOp('scaleX', 0.5, 1)],
  [scaleOp('scaleY', 1, -1)],
  [s(0, 0)],
  [s(2, 0.5), t(lengthPx(5), lengthPercent(10))],
  ...[0, 1, 30, 44.999, 45, 90, 135, 180, 225, 270, 315, 360, 720, -45, -90, -30, 12.5, -33.75, 405.5, 1e8, -1e8].map((d) => [r(d)]),
  [r(30), r(15)],
  [r(90), s(2, 1), tx(lengthPx(12))],
  [s(1.5, 1.5), r(-60), t(lengthPercent(10), lengthPx(-4))],
];

export const ORIGINS: readonly TransformOrigin[] = [
  { x: lengthPercent(50), y: lengthPercent(50) },
  { x: lengthPx(0), y: lengthPercent(50) },
  { x: lengthPercent(100), y: lengthPx(0) },
  { x: lengthPx(-12.5), y: lengthPx(40) },
  { x: calc(3, 20), y: lengthPercent(33.3333) },
];

export const BOXES: readonly (readonly [number, number])[] = [[100, 40], [33.34375, 17.015625], [0, 0], [375, 812.5]];

/**
 * Every input line, in a fixed order: each origin at two box sizes; each list's functions at one box size and its paint matrix at
 * one (box, origin) pair, both chosen round robin; the platform steps (about a point, a mapped corner) on every fourth list.
 */
export function transformInputLines(): string[] {
  const out: string[] = [];
  ORIGINS.forEach((o, i) => {
    for (const k of [i, i + 1]) {
      const [w, h] = BOXES[k % BOXES.length] as readonly [number, number];
      out.push(JSON.stringify(['paint:transform:resolveTransformOrigin', originJson(o), bits(w), bits(h)]));
    }
  });
  OP_LISTS.forEach((ops, i) => {
    const [w, h] = BOXES[i % BOXES.length] as readonly [number, number];
    const fr = recordingTrig();
    transformFunctionsMatrix(ops, w, h, fr.trig);
    out.push(JSON.stringify(['paint:transform:transformFunctionsMatrix', ops.map(opJson), bits(w), bits(h), fr.table()]));
    const [pw, ph] = BOXES[(i + 1) % BOXES.length] as readonly [number, number];
    const o = ORIGINS[i % ORIGINS.length] as TransformOrigin;
    const pr = recordingTrig();
    const m = paintTransformMatrix(ops, o, pw, ph, pr.trig);
    out.push(JSON.stringify(['paint:transform:paintTransformMatrix', ops.map(opJson), originJson(o), bits(pw), bits(ph), pr.table()]));
    if (i % 4 === 0) {
      out.push(JSON.stringify(['paint:transform:transformAboutPoint', matrixJson(m), bits(pw / 2), bits(ph / 2)]));
      out.push(JSON.stringify(['paint:transform:mapPoint', matrixJson(m), bits(pw), bits(ph)]));
    }
  });
  return out;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) process.stdout.write(`${transformInputLines().join('\n')}\n`);
