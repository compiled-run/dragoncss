// PNT2: transform, transform-origin and will-change in the compiler: the parse and its refusals (PNT2-m, the Android skew rule),
// computed values in px, the tree refusals (containing block, root, display, POSX-f2), the lowering's typed write and facts, the
// native writer lines and support code on both backends, the applied readback, and the two raster plants.
import { describe, expect, it } from 'vitest';
import type { Compiled, FrontEndResult } from '../src/index.ts';
import { createProjectWith, emitNativeSupport, nativePrograms, NO_FAULTS, WEB_CSS_PATH } from '../src/internal.ts';
import { paintWriteLines } from '../src/emit/paint/registry.ts';
import { TRANSFORM_EMITTER } from '../src/emit/paint/transform.ts';
import { inFloatRange, matrixParts, skewDot } from '../src/css/properties/transform.ts';
import { div, inputFor, spanTextOf, text } from './helpers.ts';
import type { TransformOp } from '@dragon/layout';
import { transformFunctionsMatrix } from '@dragon/layout';

const FONT = 'body { margin: 0; font-family: Ahem; font-size: 10px; }';

function compile(css: string, body = (r: Parameters<Parameters<typeof inputFor>[1]>[0]) => [div(r, 'a', ['a'], [text(r, 't', 'XX')])]): { input: FrontEndResult; c: Compiled<'ios' | 'android' | 'web'> } {
  const input = inputFor(`${FONT} ${css}`, body);
  const c = createProjectWith({ projectId: 'test', targets: { ios: { minimum: '15.0' }, android: { minSdk: 31 }, web: {} } }, { faults: NO_FAULTS, profiles: 'derive', direction: 'ltr' }).compile(input);
  return { input, c };
}

const errors = (r: { input: FrontEndResult; c: Compiled<'ios' | 'android' | 'web'> }): string[] => r.c.diagnostics.filter((d) => d.severity === 'error').map((d) => `${d.code} ${JSON.stringify(spanTextOf(r.input, d))} ${d.message}`);

function webRule(r: { c: Compiled<'ios' | 'android' | 'web'> }): string {
  const web = r.c.outputs.web;
  if (web.kind !== 'ready') throw new Error('web output blocked');
  return web.files.find((f) => f.path === WEB_CSS_PATH)?.text ?? '';
}

function node(r: { c: Compiled<'ios' | 'android' | 'web'> }, id: string) {
  const p = nativePrograms(r.c, []);
  if (p.kind !== 'ready') throw new Error(p.reason);
  const n = p.programs.uikit.nodes.find((x) => x.id === id);
  if (n === undefined) throw new Error(`no node ${id}`);
  return { uikit: n, android: p.programs['android-views'].nodes.find((x) => x.id === id) };
}

describe('PNT2: parse', () => {
  it('accepts the 2D functions and writes the computed list in px, with em and rem resolved', () => {
    const r = compile('.a { font-size: 20px; transform: translate(1em, -50%) rotate(0.25turn) scale(1.5) translateY(2rem) matrix(0, 1, -1, 0, 10, 20); }');
    expect(errors(r)).toEqual([]);
    expect(webRule(r)).toContain('transform: translate(20px, -50%) rotate(0.25turn) scale(1.5) translatey(32px) matrix(0, 1, -1, 0, 10, 20);');
  });
  it('writes transform-origin as x y with keywords as percentages, in either keyword order, and drops a zero z', () => {
    for (const [v, want] of [['left', '0% 50%'], ['top', '50% 0%'], ['bottom right', '100% 100%'], ['0 50%', '0px 50%'], ['2em 3px 0', '20px 3px'], ['center', '50% 50%']] as const) {
      const r = compile(`.a { transform-origin: ${v}; }`);
      expect(errors(r), v).toEqual([]);
      expect(webRule(r), v).toContain(`transform-origin: ${want};`);
    }
    // Every element carries the initial origin in the one canonical form.
    expect(webRule(compile(''))).toContain('transform-origin: 50% 50%;');
  });
  it('accepts will-change auto, transform, opacity and lists of them', () => {
    for (const v of ['auto', 'transform', 'opacity', 'transform, opacity']) expect(errors(compile(`.a { will-change: ${v}; }`)), v).toEqual([]);
    expect(webRule(compile('.a { will-change: transform , opacity; }'))).toContain('will-change: transform, opacity;');
  });
  it('refuses a length or number past the float range and an angle past the double range, and blocks the native output on a transform that overflows on the writers', () => {
    for (const [v, at] of [['scale(1e400)', '1e400'], ['translate(1e400px)', '1e400px'], ['translateX(1e400%)', '1e400%'], ['rotate(1e308rad)', '1e308rad'], ['rotate(1e307turn)', '1e307turn'], ['matrix(1, 0, 0, 1, 1e400, 0)', '1e400'], ['translateX(1e100px)', '1e100px'], ['scale(1e39)', '1e39'], ['matrix(1, 0, 0, 1, 4e38, 0)', '4e38']] as const) {
      const e = errors(compile(`.a { transform: ${v}; }`));
      expect(e, v).toHaveLength(1);
      expect(e[0], v).toContain(`DRAGON_UNSUPPORTED_VALUE ${JSON.stringify(at)}`);
      expect(e[0], v).toContain('is out of range');
    }
    expect(errors(compile('.a { transform-origin: 1e400px 0; }'))[0]).toContain('is out of range');
    const r = compile('.a { font-size: 20px; transform: translate(1e38em); }');
    const p = nativePrograms(r.c, []);
    expect(p.kind).toBe('blocked');
    expect(p.kind === 'blocked' ? p.reason : '').toContain('a transform length in em did not compute to px');
    // Float-range values that compose past it on the native writers.
    for (const v of ['scale(1e30) scale(1e30)', 'translateX(1e38px) translateX(1e38px) translateX(1e38px) translateX(1e38px)', 'translateX(1e37%)']) {
      const m = nativePrograms(compile(`.a { transform: ${v}; }`).c, []);
      expect(m.kind === 'blocked' ? m.reason : m.kind, v).toContain('the transform overflows the float range of the native writers');
    }
  });
  it('checks the origin only with a transform or will-change, counts the origin compensation, and keeps a huge angle finite', () => {
    // Without a transform or will-change the origin is never read.
    for (const css of ['.a { transform-origin: 1e38px 0; }', '.a { font-size: 20px; transform-origin: 1e38em 0; }', '.a { transform: none; transform-origin: 1e38px 0; }']) {
      expect(nativePrograms(compile(css).c, []).kind, css).toBe('ready');
    }
    // T(o) · scale(1e20) · T(-o) translates by about 1e40 device px.
    const m = nativePrograms(compile('.a { transform: scale(1e20); transform-origin: 1e20px 0; }').c, []);
    expect(m.kind === 'blocked' ? m.reason : m.kind).toContain('the transform overflows the float range of the native writers');
    // An angle reaches the writers only through sinCosDegrees's range reduction, never as a float.
    const r = compile('.a { transform: rotate(1e300deg); }');
    const f = node(r, 'a').uikit.facts['transform'] as { ops: TransformOp[] };
    const mat = transformFunctionsMatrix(f.ops, 10, 10, { sin: Math.sin, cos: Math.cos });
    expect([mat.a, mat.b, mat.c, mat.d, mat.e, mat.f].every(Number.isFinite)).toBe(true);
  });
  it('rejects a percentage in scale() as the css-transforms-1 grammar does, before the transform parse', () => {
    const e = errors(compile('.a { transform: scale(50%); }'));
    expect(e).toHaveLength(1);
    expect(e[0]).toMatch(/^DRAGON_CSS_INVALID_VALUE /);
  });
  it('inFloatRange holds exactly where Math.fround stays finite', () => {
    const edge = 2 ** 128 - 2 ** 103;
    for (const v of [0, 1, 3.4028234663852886e38, edge * (1 - 2 ** -52), edge, edge * (1 + 2 ** -52), 1e39, Infinity, NaN]) {
      for (const x of [v, -v]) expect(inFloatRange(x), String(x)).toBe(Number.isFinite(Math.fround(x)));
    }
  });
  it('refuses a matrix with a shear too small for the raw dot product of its columns, and keeps every rotation matrix', () => {
    for (const v of ['matrix(1e-200, 0, 1e-200, 1, 0, 0)', 'matrix(1, 1e-200, 1e-200, 1, 0, 0)']) {
      const e = errors(compile(`.a { transform: ${v}; }`));
      expect(e, v).toHaveLength(1);
      expect(e[0], v).toContain('it skews the box');
    }
    for (let deg = 0; deg < 360; deg += 7) {
      const [c, s] = [Math.cos((deg * Math.PI) / 180), Math.sin((deg * Math.PI) / 180)];
      for (const k of [1, 2, 2 ** -100]) expect(skewDot(k * c, k * s, -s, c), `${deg}deg x${k}`).toBe(0);
    }
  });
  it('refuses skew, 3D functions, perspective and a non-zero origin z naming PNT2-m', () => {
    for (const [v, at] of [['skew(10deg)', 'skew(10deg)'], ['translate(1px) skewX(5deg)', 'skewX(5deg)'], ['rotate3d(0, 0, 1, 10deg)', 'rotate3d(0, 0, 1, 10deg)'], ['translateZ(4px)', 'translateZ(4px)'], ['perspective(100px)', 'perspective(100px)'], ['matrix(1, 0.5, 0, 1, 0, 0)', 'matrix(1, 0.5, 0, 1, 0, 0)']] as const) {
      const e = errors(compile(`.a { transform: ${v}; }`));
      expect(e, v).toHaveLength(1);
      expect(e[0], v).toContain(`DRAGON_UNSUPPORTED_VALUE ${JSON.stringify(at)}`);
      expect(e[0], v).toContain('PNT2-m');
    }
    const z = errors(compile('.a { transform-origin: 0 0 5px; }'));
    expect(z[0]).toContain('DRAGON_UNSUPPORTED_VALUE "5px"');
    expect(z[0]).toContain('PNT2-m');
  });
  it('refuses a rotation after a non-uniform scale (a skew Android cannot express), and accepts the forms that stay orthogonal', () => {
    const e = errors(compile('.a { transform: scaleX(2) rotate(30deg); }'));
    expect(e).toHaveLength(1);
    expect(e[0]).toContain('DRAGON_UNSUPPORTED_VALUE "scaleX(2) rotate(30deg)"');
    expect(e[0]).toContain("Android's View transform");
    for (const v of ['rotate(30deg) scaleX(2)', 'scaleX(2) rotate(90deg)', 'scale(2) rotate(30deg)', 'scale(-1) rotate(10deg)', 'scale(2, -2) rotate(10deg)', 'scaleX(2) rotate(-270deg) translate(3px)']) expect(errors(compile(`.a { transform: ${v}; }`)), v).toEqual([]);
  });
  it('refuses viewport units, calculations and refused units inside a function', () => {
    for (const [v, at] of [['translateX(10vw)', '10vw'], ['translate(calc(10px + 5%))', 'calc(10px + 5%)'], ['translateY(2ex)', '2ex']] as const) {
      const e = errors(compile(`.a { transform: ${v}; }`));
      expect(e[0], v).toContain(`DRAGON_UNSUPPORTED_VALUE ${JSON.stringify(at)}`);
    }
  });
  it('refuses will-change features other than transform and opacity', () => {
    expect(errors(compile('.a { will-change: left; }'))[0]).toContain('DRAGON_UNSUPPORTED_VALUE "left"');
    expect(errors(compile('.a { will-change: transform, scroll-position; }'))[0]).toContain('DRAGON_UNSUPPORTED_VALUE "scroll-position"');
  });
  it('parses a var() transform after substitution through the same rules', () => {
    const ok = compile('.a { --t: rotate(45deg) translateX(10%); transform: var(--t); }');
    expect(errors(ok)).toEqual([]);
    expect(webRule(ok)).toContain('transform: rotate(45deg) translatex(10%);');
    expect(errors(compile('.a { --t: skewY(3deg); transform: var(--t); }')).join()).toContain('PNT2-m');
  });
  it('writes matrix() as translate · rotate · scale, exactly at multiples of 90deg', () => {
    expect(matrixParts([0, 1, -1, 0, 10, 20])).toEqual({ tx: 10, ty: 20, deg: 90, sx: 1, sy: 1 });
    expect(matrixParts([-2, 0, 0, 3, 0, 0])).toEqual({ tx: 0, ty: 0, deg: 180, sx: 2, sy: -3 });
    expect(matrixParts([0, 0, 0, 0, 1, 1])).toEqual({ tx: 1, ty: 1, deg: 0, sx: 0, sy: 0 });
    const p = matrixParts([Math.SQRT1_2, Math.SQRT1_2, -Math.SQRT1_2, Math.SQRT1_2, 0, 0]);
    expect(p.deg).toBeCloseTo(45, 12);
    expect(p.sx).toBeCloseTo(1, 15);
  });
});

describe('PNT2: where a transform may sit', () => {
  const abs = (r: Parameters<Parameters<typeof inputFor>[1]>[0]) => [div(r, 'a', ['a'], [div(r, 'm', ['m'], [div(r, 'p', ['p'])])])];
  it('refuses a static transformed element that would become the containing block of an absolutely positioned descendant', () => {
    const e = errors(compile('.a { transform: translate(5px); } .p { position: absolute; }', abs));
    expect(e.join()).toContain('DRAGON_UNSUPPORTED_VALUE "translate(5px)"');
    expect(e.join()).toContain('the containing block of the absolutely positioned p');
    expect(errors(compile('.a { will-change: transform; } .p { position: absolute; }', abs)).join()).toContain('containing block');
    // Positioned already, or a positioned box between: the containing block does not change.
    expect(errors(compile('.a { position: relative; transform: translate(5px); } .p { position: absolute; }', abs))).toEqual([]);
    expect(errors(compile('.a { transform: translate(5px); } .m { position: relative; } .p { position: absolute; }', abs))).toEqual([]);
  });
  it('refuses a transform on html or body', () => {
    expect(errors(compile('body { transform: rotate(1deg); }')).join()).toContain('a transform on <body>');
  });
});

describe('PNT2: lowering and emission', () => {
  const r = compile('.a { width: 40px; height: 20px; transform: translate(-50%, 2px) rotate(-0deg) scaleY(2); transform-origin: 0 50%; will-change: transform; } .b { will-change: opacity; }', (ref) => [div(ref, 'a', ['a'], [text(ref, 't', 'XX')]), div(ref, 'b', ['b'])]);
  it('writes the typed functions and origin (lengths in px or percent, -0 written as 0) and publishes them as facts', () => {
    const n = node(r, 'a');
    const w = n.uikit.writes.find((x) => x.kind === 'transform');
    expect(w).toMatchObject({
      key: 'dragonTransform',
      css: ['transform', 'transform-origin'],
      ops: [
        { fn: 'translate', x: { kind: 'percent', px: 0, percent: -50 }, y: { kind: 'px', px: 2, percent: 0 }, angle: 0, sx: 1, sy: 1 },
        { fn: 'rotate', angle: 0 },
        { fn: 'scaleY', sx: 1, sy: 2 },
      ],
      origin: { x: { kind: 'px', px: 0, percent: 0 }, y: { kind: 'percent', px: 0, percent: 50 } },
    });
    expect(Object.is((w as unknown as { ops: readonly { angle: number }[] }).ops[1]?.angle, -0)).toBe(false);
    expect(n.android?.writes.find((x) => x.kind === 'transform')).toMatchObject({ key: 'dragonTransform', technique: 'native-property' });
    expect(n.uikit.facts['transform']).toEqual({ ops: (w as { ops: unknown }).ops, origin: (w as { origin: unknown }).origin, willChange: ['transform'] });
    const b = node(r, 'b');
    expect(b.uikit.writes.some((x) => x.kind === 'transform')).toBe(false);
    expect(b.uikit.facts['transform']).toMatchObject({ ops: [], willChange: ['opacity'] });
    expect(node(r, 'body').uikit.facts).toEqual({});
  });
  it('calls the view\'s transform writer with engine constructors on both backends', () => {
    const n = node(r, 'a');
    const w = n.uikit.writes.find((x) => x.kind === 'transform');
    if (w === undefined) throw new Error('no transform write');
    expect(paintWriteLines('uikit', 'v1', n.uikit, w)).toEqual([
      '  v1.dragonSetTransform([TransformOp(JsString("translate"), LengthValue(JsString("percent"), 0.0, -50.0), LengthValue(JsString("px"), 2.0, 0.0), 0.0, 1.0, 1.0), TransformOp(JsString("rotate"), LengthValue(JsString("px"), 0.0, 0.0), LengthValue(JsString("px"), 0.0, 0.0), 0.0, 1.0, 1.0), TransformOp(JsString("scaleY"), LengthValue(JsString("px"), 0.0, 0.0), LengthValue(JsString("px"), 0.0, 0.0), 0.0, 1.0, 2.0)], TransformOrigin(LengthValue(JsString("px"), 0.0, 0.0), LengthValue(JsString("percent"), 0.0, 50.0)))',
    ]);
    expect(paintWriteLines('android-views', 'v1', n.uikit, w)[0]).toMatch(/^ {2}v1\.dragonSetTransform\(listOf\(TransformOp\("translate", LengthValue\("percent", 0\.0, -50\.0\)/);
  });
  it('reads back the function list and origin, the same on both backends', () => {
    const n = node(r, 'a');
    const w = n.uikit.writes.find((x) => x.kind === 'transform');
    if (w === undefined || w.kind !== 'transform') throw new Error('no transform write');
    const want = { functions: [['translate', ['percent', 0, -50], ['px', 2, 0], 0, 1, 1], ['rotate', ['px', 0, 0], ['px', 0, 0], 0, 1, 1], ['scaleY', ['px', 0, 0], ['px', 0, 0], 0, 1, 2]], origin: [['px', 0, 0], ['percent', 0, 50]] };
    for (const b of ['uikit', 'android-views'] as const) expect(TRANSFORM_EMITTER.applied({} as never, b, w, 2, {} as never)).toEqual(want);
  });
  it('support code: resolves with paint-transform.ts and the platform sin and cos after every layout; UIKit lifts the transform around frame writes', () => {
    const swift = emitNativeSupport('uikit').map((f) => f.text).join('\n');
    const kotlin = emitNativeSupport('android-views').map((f) => f.text).join('\n');
    expect(swift).toContain('public let dragonTransformTrig = Trig({ Foundation.sin($0) }, { Foundation.cos($0) })');
    expect(swift).toContain('try paintTransform_paintTransformMatrix(JsArray(v.dragonTransformOps), origin, rw, rh, dragonTransformTrig)');
    expect(swift).toContain('try paintTransform_transformAboutPoint(m, w / 2, h / 2)');
    expect(swift).toContain('v.layer.allowsEdgeAntialiasing = true');
    expect(swift).toContain('  dragonAfterLayoutTransform(v, shape, scale)\n');
    expect(swift).toContain('public override var frame: CGRect {');
    expect(kotlin).toContain('val dragonTransformTrig = Trig({ kotlin.math.sin(it) }, { kotlin.math.cos(it) })');
    expect(kotlin).toContain('paintTransform_transformFunctionsMatrix(ArrayList(v.dragonTransformOps), rw, rh, dragonTransformTrig)');
    expect(kotlin).toContain('v.pivotX = (o.x * scale).toFloat()');
    expect(kotlin).toContain('  dragonAfterLayoutTransform(v, shape, scale)\n');
    expect(kotlin).not.toContain('setAnimationMatrix');
  });
  it('each raster plant changes exactly its one line on both backends', () => {
    for (const plant of ['transform-origin-ignored', 'translate-percent-of-parent'] as const) {
      for (const b of ['uikit', 'android-views'] as const) {
        const clean = emitNativeSupport(b);
        const planted = emitNativeSupport(b, plant);
        const changed = planted.filter((f, i) => f.text !== clean[i]?.text).map((f) => f.path);
        expect(changed, `${plant} ${b}`).toEqual([b === 'uikit' ? 'Support/Paint/DragonPaintTransform.swift' : 'kotlin/dev/dragon/views/paint/DragonPaintTransform.kt']);
      }
    }
  });
});
