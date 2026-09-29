// V1 of the engine value model (notes/T006-value-model-spec.md): the calc goldens (vectors/calc, one engine vector per (verify)
// point, each proven against Chrome by a values fixture in packages/parity/test/values.test.ts), the planted value-model faults,
// the float primitives, the length helpers and the environment pass.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { EngineFaults, LayoutInput, LayoutRect } from '../src/index.ts';
import { layout, layoutWithFaults, measurerFor, NO_ENGINE_FAULTS, validateLayoutInput, zoomInput } from '../src/index.ts';
import { hasPercent, resolveLength, resolveLengthOrNull, resolveMinLength } from '../src/box.ts';
import { evaluateCalc } from '../src/calc.ts';
import type { LU } from '../src/units.ts';
import { calcToLu, doubleMaxStep, doubleMinStep, floatDiv, floatInvert, floatMul, fromCssPx, pixelsAndPercentAt, pixelsAndPercentPlainOrder, toFloat, viewportUnitBase } from '../src/units.ts';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'vectors', 'calc');
const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
type Golden = { platform: string; measurer: string; input: LayoutInput; output: LayoutRect[] };
const read = (name: string): Golden => JSON.parse(readFileSync(join(dir, `${name}.json`), 'utf8')) as Golden;

function measurer() {
  const m = measurerFor('darwin-arm64');
  if (m.kind !== 'ok') throw new Error(m.code);
  return m.measurer;
}

function run(input: LayoutInput, faults: EngineFaults = NO_ENGINE_FAULTS): LayoutRect[] {
  const r = layoutWithFaults(input, measurer(), faults);
  if (r.kind !== 'ok') throw new Error(r.unsupported.code);
  return [...r.boxes];
}

/** Each (verify) point of the plan (engine-value-model-plan.md §2.2-§2.4) and the golden that pins it. */
const VERIFY_POINTS: readonly { readonly point: string; readonly goldens: readonly string[] }[] = [
  { point: 'float summation order of PixelsAndPercent (§2.2)', goldens: ['sum-order-float-dpr-1', 'sum-order-float-dpr-2.625'] },
  { point: 'constant calc through ComputeLength in double, then a float Length::Fixed (§2.2)', goldens: ['constant-double-dpr-1', 'constant-double-dpr-2.625', 'constant-point-one-px-point-two-em-dpr-2.625'] },
  { point: 'division is a times the float of 1 / b (§2.3)', goldens: ['divide-inverse-dpr-1'] },
  { point: 'PixelsAndPercent order against the plain-percent order (§2.3)', goldens: ['percent-order-dpr-1'] },
  { point: 'R6, the viewport device ceil, and the vmin/vmax flip (§2.2)', goldens: ['viewport-r6-400x300-dpr-2.625', 'viewport-r6-393x851-dpr-2.625', 'viewport-320x568-dpr-2', 'viewport-vmin-vmax-flip-844x390-dpr-3'] },
  { point: 'em inside calc is value * float(specified * z) (finding 2)', goldens: ['em-leaf-fractional-dpr-3'] },
  { point: 'clamp with MIN > MAX: MIN wins (§2.3)', goldens: ['clamp-min-wins-dpr-1'] },
  { point: 'a non-negative range clamps the result to 0 after evaluating, at compute time and at layout (§1.2)', goldens: ['nonneg-clamp-dpr-1'] },
  { point: 'NaN and infinity: clamped pixels and percent, NaN is 0 (§2.3)', goldens: ['nan-infinity-dpr-1'] },
  { point: 'a min length with a percentage against an indefinite basis resolves against 0 (§2.4, measured)', goldens: ['min-height-indefinite-basis-zero-dpr-1'] },
  { point: 'intrinsic contributions evaluate calc padding and margins against 0 (§2.4)', goldens: ['intrinsic-basis-zero-dpr-1'] },
];

describe('calc goldens (vectors/calc)', () => {
  it('every (verify) point has goldens, and every golden pins a point', () => {
    const named = VERIFY_POINTS.flatMap((p) => p.goldens).sort();
    expect(files.map((f) => f.replace(/\.json$/, ''))).toEqual(named);
  });
  for (const f of files) {
    it(`${f}: names its platform and measurer, passes the validator, and the engine reproduces its output exactly`, () => {
      const g = JSON.parse(readFileSync(join(dir, f), 'utf8')) as Golden;
      expect(Object.keys(g)).toEqual(['platform', 'measurer', 'input', 'output']);
      expect([g.platform, g.measurer]).toEqual(['darwin-arm64', 'ahem/darwin-arm64']);
      const v = validateLayoutInput(g.input);
      if (!v.ok) throw new Error(JSON.stringify(v.errors));
      expect(run(v.input)).toEqual(g.output);
    });
  }
});

describe('planted value-model faults change their goldens', () => {
  const cases: readonly [keyof EngineFaults, string][] = [
    ['calcPercentPlainOrder', 'percent-order-dpr-1'],
    ['calcDoubleEval', 'percent-order-dpr-1'],
    ['calcNoNonNegClamp', 'nonneg-clamp-dpr-1'],
    ['calcPercentIndefiniteAsLength', 'min-height-indefinite-basis-zero-dpr-1'],
    ['clampMaxWins', 'clamp-min-wins-dpr-1'],
    ['divideDirect', 'divide-inverse-dpr-1'],
    ['calcLeafUnzoomed', 'em-leaf-fractional-dpr-3'],
    ['viewportUnitsUnceiled', 'viewport-r6-400x300-dpr-2.625'],
  ];
  for (const [fault, golden] of cases) {
    it(`${fault} changes ${golden}`, () => {
      const g = read(golden);
      expect(run(g.input, { ...NO_ENGINE_FAULTS, [fault]: true })).not.toEqual(g.output);
    });
  }
});

describe('float primitives (units.ts)', () => {
  it('PixelsAndPercent evaluates percent / 100 * basis in float, not the plain-percent order', () => {
    const basis = toFloat(fromCssPx(125));
    expect(calcToLu(pixelsAndPercentAt(Math.fround(7.5), Math.fround(41.1), basis), true)).toBe(3767);
    expect(calcToLu(pixelsAndPercentPlainOrder(Math.fround(7.5), Math.fround(41.1), basis), true)).toBe(3768);
  });
  it('a times the float inverse differs from a / b, and 1 / 0 is infinite', () => {
    const m = pixelsAndPercentAt(0, Math.fround(41.1), toFloat(fromCssPx(125)));
    expect(calcToLu(floatMul(m, Math.fround(1 / 3)), true)).toBe(1096);
    expect(calcToLu(floatDiv(m, 3), true)).toBe(1095);
    expect(floatInvert(0)).toBe(Infinity);
  });
  it('R6: viewport units read float(ceil(w * z) / z)', () => {
    expect(viewportUnitBase(300, 2.625)).toBe(Math.fround(788 / 2.625));
    expect(viewportUnitBase(300, 2.625)).not.toBe(300);
    expect(viewportUnitBase(400, 2)).toBe(400);
  });
  it('the double min and max steps keep Blink signed zeros and std::min order', () => {
    expect(Object.is(doubleMinStep(0, -0), -0)).toBe(true);
    expect(Object.is(doubleMaxStep(-0, 0), 0)).toBe(true);
    expect(doubleMinStep(Number.NaN, 1)).toBeNaN();
    expect(calcToLu(Number.NaN, false)).toBe(0);
    expect(calcToLu(-1, true)).toBe(0);
    expect(calcToLu(-1, false)).toBe(-64);
  });
});

describe('length helpers (box.ts) and the environment pass (environment.ts)', () => {
  const pp = (pixels: number, percent: number, explicitPercent: boolean) => ({ kind: 'calc', expr: { kind: 'pixels-and-percent', pixels, percent, explicitPixels: true, explicitPercent }, range: 'non-negative' } as const);
  it('hasPercent is true for a percentage and for a calculation with an explicit percentage, 0% included', () => {
    expect(hasPercent({ kind: 'px', value: 1 })).toBe(false);
    expect(hasPercent({ kind: 'percent', value: 0 })).toBe(true);
    expect(hasPercent(pp(10, 0, true))).toBe(true);
    expect(hasPercent(pp(10, 0, false))).toBe(false);
  });
  it('resolveLengthOrNull: a percentage against an indefinite basis has no value; resolveMinLength resolves it against 0', () => {
    expect(resolveLengthOrNull(pp(10, 5, true), null, NO_ENGINE_FAULTS)).toBeNull();
    expect(resolveLengthOrNull({ kind: 'px', value: 10 }, null, NO_ENGINE_FAULTS)).toBe(640);
    expect(resolveLengthOrNull(pp(10, 5, true), null, { ...NO_ENGINE_FAULTS, calcPercentIndefiniteAsLength: true })).toBe(640);
    expect(resolveMinLength(pp(30, 10, true), null, NO_ENGINE_FAULTS)).toBe(1920);
    expect(resolveMinLength({ kind: 'percent', value: 10 }, null, NO_ENGINE_FAULTS)).toBe(0);
    expect(resolveLength(pp(10, 50, true), 12800 as LU, NO_ENGINE_FAULTS)).toBe(640 + 6400);
  });
  it('evaluateCalc: clamp lets MIN win, and planted clampMaxWins lets MAX win', () => {
    const e = { kind: 'clamp', min: { kind: 'pixels-and-percent', pixels: 200, percent: 0, explicitPixels: true, explicitPercent: false }, value: { kind: 'pixels-and-percent', pixels: 0, percent: 50, explicitPixels: false, explicitPercent: true }, max: { kind: 'number', value: 100 } } as const;
    expect(evaluateCalc(e, 400, NO_ENGINE_FAULTS)).toBe(200);
    expect(evaluateCalc(e, 400, { ...NO_ENGINE_FAULTS, clampMaxWins: true })).toBe(100);
  });
  it('the pass returns an input without calculations itself at DPR 1, and resolves one with calculations', () => {
    const g = read('clamp-min-wins-dpr-1');
    const plain = JSON.parse(readFileSync(join(dir, '..', 'block-border-box.json'), 'utf8')) as Golden;
    expect(zoomInput(plain.input, NO_ENGINE_FAULTS)).toBe(plain.input);
    const resolved = zoomInput(g.input, NO_ENGINE_FAULTS);
    expect(resolved).not.toBe(g.input);
    expect(JSON.stringify(resolved)).not.toContain('"kind":"clamp","min":{"kind":"px"');
    expect(layout(g.input, measurer())).toEqual({ kind: 'ok', boxes: g.output });
  });
});

describe('the validator takes calculation trees (validate.ts calc rule)', () => {
  const base = read('clamp-min-wins-dpr-1').input;
  const withWidth = (width: unknown): unknown => {
    const copy = JSON.parse(JSON.stringify(base)) as { root: { children: { children: { style: Record<string, unknown> }[] }[] } };
    (copy.root.children[0] as { children: { style: Record<string, unknown> }[] }).children[0]!.style['width'] = width;
    return copy;
  };
  it('accepts every node kind and rejects an unknown kind, an empty operand list, a missing key and a non-finite number', () => {
    const ok = { kind: 'calc', range: 'all', expr: { kind: 'sum', terms: [{ kind: 'px', value: 1 }, { kind: 'percent', value: 2 }, { kind: 'viewport', value: 1, axis: 'min' }, { kind: 'em', value: 1, fontSize: { kind: 'px', value: 10 } }, { kind: 'product', terms: [{ kind: 'number', value: 2 }, { kind: 'invert', term: { kind: 'number', value: 3 } }] }, { kind: 'clamp', min: { kind: 'px', value: 0 }, value: { kind: 'min', terms: [{ kind: 'px', value: 1 }] }, max: { kind: 'max', terms: [{ kind: 'px', value: 2 }] } }, { kind: 'pixels-and-percent', pixels: 1, percent: 2, explicitPixels: true, explicitPercent: false }] } };
    expect(validateLayoutInput(withWidth(ok)).ok).toBe(true);
    for (const bad of [
      { kind: 'calc', range: 'all', expr: { kind: 'pow', terms: [] } },
      { kind: 'calc', range: 'all', expr: { kind: 'min', terms: [] } },
      { kind: 'calc', range: 'all', expr: { kind: 'em', value: 1 } },
      { kind: 'calc', range: 'some', expr: { kind: 'px', value: 1 } },
      { kind: 'calc', range: 'all', expr: { kind: 'viewport', value: 1, axis: 'inline' } },
      { kind: 'calc', range: 'all', expr: { kind: 'pixels-and-percent', pixels: 1, percent: 2, explicitPixels: 1, explicitPercent: false } },
    ]) expect(validateLayoutInput(withWidth(bad)).ok, JSON.stringify(bad)).toBe(false);
  });
});
