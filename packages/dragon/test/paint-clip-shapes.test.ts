// MASK-CLIP clip-path circle(), ellipse() and polygon(): the computed values Chrome 145's getComputedStyle gives (radius and position
// forms, fill rules, lengths computed to px), what Chrome drops, the lowering (one shape write per clipped box), the writer values and
// the geometry the device computes from them, and the emitted native code (the writer, the path clip, the readback and the plant).
import { describe, expect, it } from 'vitest';
import { emitNativeSupport } from 'dragon';
import type { Diagnostic } from '../src/index.ts';
import { createProjectWith, NO_FAULTS, nativePrograms } from '../src/internal.ts';
import { clipShapeOf } from '../src/css/properties/clip-path.ts';
import { parseStylesheet } from '../src/css/stylesheet.ts';
import { applyPlant } from '../src/emit/native-support.ts';
import { CLIP_EMITTER, clipShapeGeometry, clipShapeKind, clipShapeValues } from '../src/emit/paint/clip.ts';
import type { FrontEndResult, SourceRef, Targets, TreeNode } from '../src/types.ts';
import { div, explainOne, inputFor, text } from './helpers.ts';

const SOURCE = { uri: 'dragon-source://test/clip-shapes.css', revision: 'r1', hash: 'sha256:0' };
const NATIVE: Targets = { ios: { minimum: '15.0' }, android: { minSdk: 31 } };
const ALL: Targets = { ios: { minimum: '15.0' }, android: { minSdk: 31 }, web: {} };
const BASE = 'body { margin: 0; font-family: Ahem; font-size: 10px; } .p { position: relative; width: 100px; height: 50px; } .a { width: 40px; height: 20px; } ';

const tree = (r: SourceRef): TreeNode[] => [div(r, 'p', ['p'], [div(r, 'a', ['a'], [div(r, 'b', ['b'])]), div(r, 't', ['t'], [text(r, 't-t', 'XX')])])];
const compileInput = (input: FrontEndResult, targets: Targets = { ios: { minimum: '15.0' }, web: {} }) => createProjectWith({ projectId: 'test', targets }, { faults: NO_FAULTS, profiles: 'derive', direction: 'ltr' }).compile(input);
const compile = (css: string, targets?: Targets) => compileInput(inputFor(BASE + css, tree), targets);
const errors = (c: { diagnostics: readonly Diagnostic[] }): Diagnostic[] => c.diagnostics.filter((d) => d.severity === 'error');
const at = (value: string): string => explainOne(compile(`.a { clip-path: ${value}; }`), 'web', 'a', 'clip-path').value;

function codes(value: string): string[] {
  const css = `.a { clip-path: ${value}; }`;
  const diagnostics: Diagnostic[] = [];
  parseStylesheet(css, { source: SOURCE, start: 0, end: css.length }, { id: 's', owner: 'doc', scope: 'document' }, 0, diagnostics);
  return diagnostics.map((d) => d.code);
}

function programs(css: string) {
  const p = nativePrograms(compileInput(inputFor(BASE + css, tree), NATIVE), []);
  if (p.kind !== 'ready') throw new Error(p.reason);
  return p.programs;
}

describe('clip-path shapes: computed values (Chrome 145 getComputedStyle)', () => {
  // Each pair is what Chrome 145 computes for the value on a 10px font.
  const COMPUTED: readonly (readonly [string, string])[] = [
    ['circle()', 'circle()'], ['circle(10px)', 'circle(10px)'], ['circle(50%)', 'circle(50%)'], ['circle(closest-side)', 'circle()'],
    ['circle(farthest-side)', 'circle(farthest-side)'], ['circle(0)', 'circle(0px)'], ['circle(1e1px)', 'circle(10px)'],
    ['circle(10.123456px)', 'circle(10.1235px)'], ['circle(1in)', 'circle(96px)'], ['circle(1em at 2em 3em)', 'circle(10px at 20px 30px)'],
    ['circle(at left top)', 'circle(at 0% 0%)'], ['circle(at top left)', 'circle(at 0% 0%)'], ['circle(10px at 20px 30%)', 'circle(10px at 20px 30%)'],
    ['circle(at right 10px top 5px)', 'circle(at right 10px top 5px)'], ['circle(at center)', 'circle(at 50% 50%)'], ['circle(at top)', 'circle(at 50% 0%)'],
    ['circle(at left)', 'circle(at 0% 50%)'], ['circle(at 10px)', 'circle(at 10px 50%)'], ['CIRCLE(10PX AT LEFT 5PX)', 'circle(10px at 0% 5px)'],
    ['circle(10px) border-box', 'circle(10px)'], ['border-box circle(1px)', 'circle(1px)'], ['circle(at bottom 10% right 20%)', 'circle(at 80% 90%)'],
    ['circle(at left 10px bottom 5px)', 'circle(at left 10px bottom 5px)'], ['circle(at left 10px top 5px)', 'circle(at 10px 5px)'],
    ['circle(at right 0px top 0px)', 'circle(at 100% 0%)'], ['circle(at right 10% bottom 5px)', 'circle(at left 90% bottom 5px)'],
    ['circle(at bottom 5px right 10px)', 'circle(at right 10px bottom 5px)'], ['circle(at right top)', 'circle(at 100% 0%)'], ['circle(at 10px top)', 'circle(at 10px 0%)'],
    ['circle(at right 10px top 0)', 'circle(at right 10px top 0%)'], ['circle(at left 0px bottom 1px)', 'circle(at left 0% bottom 1px)'],
    ['circle(at 0px 0px)', 'circle(at 0% 0%)'], ['circle(at 0 10px)', 'circle(at 0% 10px)'], ['circle(at right 10px)', 'circle(at 100% 10px)'],
    ['circle(at 10px bottom)', 'circle(at 10px 100%)'], ['circle(at bottom left)', 'circle(at 0% 100%)'], ['circle(at -10px -20%)', 'circle(at -10px -20%)'],
    ['circle(at right 33.3333% top 0)', 'circle(at 66.6667% 0%)'], ['circle(at bottom 2em right 1em)', 'circle(at right 10px bottom 20px)'],
    ['circle(closest-side at center)', 'circle(at 50% 50%)'], ['circle(farthest-side at left)', 'circle(farthest-side at 0% 50%)'],
    ['ellipse()', 'ellipse()'], ['ellipse(10px 20px)', 'ellipse(10px 20px)'], ['ellipse(closest-side closest-side)', 'ellipse()'],
    ['ellipse(closest-side 10px)', 'ellipse(closest-side 10px)'], ['ellipse(10px closest-side at 0 0)', 'ellipse(10px closest-side at 0% 0%)'],
    ['ellipse(closest-side farthest-side at 10% 20%)', 'ellipse(closest-side farthest-side at 10% 20%)'], ['ellipse(0 0)', 'ellipse(0px 0px)'],
    ['ellipse(at right 1em bottom 2em)', 'ellipse(at right 10px bottom 20px)'],
    ['polygon(0 0, 100% 0, 50% 100%)', 'polygon(0px 0px, 100% 0px, 50% 100%)'], ['polygon(evenodd, 0 0, 10px 0, 10px 10px)', 'polygon(evenodd, 0px 0px, 10px 0px, 10px 10px)'],
    ['polygon(nonzero, 0 0, 10px 0, 10px 10px)', 'polygon(0px 0px, 10px 0px, 10px 10px)'], ['polygon(EVENODD, 0 0, 1px 1px)', 'polygon(evenodd, 0px 0px, 1px 1px)'],
    ['polygon(0 0)', 'polygon(0px 0px)'], ['polygon(1em 2em, 3em 4em)', 'polygon(10px 20px, 30px 40px)'], ['polygon(-5px -5px, 10% 0, 0 110%)', 'polygon(-5px -5px, 10% 0px, 0px 110%)'],
    ['polygon(0px 0px,10px 0px,5px 10px) border-box', 'polygon(0px 0px, 10px 0px, 5px 10px)'],
  ];
  it('computes every form as Chrome does', () => {
    for (const [v, want] of COMPUTED) expect(at(v), v).toBe(want);
  });
  it('round-trips every computed value through its shape', () => {
    for (const [v] of COMPUTED) {
      const c = explainOne(compile(`.a { clip-path: ${v}; }`), 'web', 'a', 'clip-path');
      expect(clipShapeOf({ kind: 'other', type: `clip-path-${c.value.slice(0, c.value.indexOf('('))}`, text: c.value }), v).not.toBeNull();
    }
  });
  it('drops what Chrome drops', () => {
    for (const v of ['circle(-1px)', 'circle(10px 20px)', 'circle(closest-corner)', 'circle(at right 10px bottom)', 'circle(at left 10px top)', 'circle(at center top 5px)', 'circle(at top 10px)', 'circle(at 10px 20px 30px)', 'circle(1)', 'ellipse(10px)', 'ellipse(1px 2px 3px)', 'ellipse(closest-corner farthest-corner)', 'polygon()', 'polygon(0 0, 1px)', 'polygon(evenodd 0 0, 1px 1px)', 'polygon(0 0 round 4px, 10px 0, 10px 10px)', 'polygon(bogus, 0 0)', 'polygon(1 0)']) {
      expect(codes(v), v).toEqual(['DRAGON_CSS_INVALID_VALUE']);
    }
  });
});

describe('clip-path shapes: native', () => {
  it('compiles every shape on every target over a box without text', () => {
    for (const v of ['circle(10px)', 'ellipse(farthest-side 25% at right 4px bottom 2px)', 'polygon(evenodd, 0 0, 100% 0, 0 100%, 100% 100%)']) expect(errors(compile(`.a { clip-path: ${v}; }`, ALL)), v).toEqual([]);
  });
  it('writes one shape per clipped box, with px and percentages', () => {
    const p = programs('.a { clip-path: circle(1em at right 4px top 10%); }');
    for (const prog of [p.uikit, p['android-views']]) {
      const a = prog.nodes.find((n) => n.id === 'a');
      expect(a?.writes.filter((w) => w.kind === 'clip-path-shape' || w.kind === 'clip-path-inset').map((w) => w.kind)).toEqual(['clip-path-shape']);
      expect(a?.writes.find((w) => w.kind === 'clip-path-shape')).toEqual(expect.objectContaining({ shape: { kind: 'circle', radius: { value: 10, unit: 'px' }, at: [{ from: 'end', offset: { value: 4, unit: 'px' } }, { from: 'start', offset: { value: 10, unit: '%' } }] }, css: ['clip-path'], key: 'dragonClipPath.shape' }));
      expect(prog.nodes.find((n) => n.id === 'b')?.writes.some((w) => w.kind === 'clip-path-shape')).toBe(false);
    }
  });
});

describe('clip-path shapes: writer values and geometry', () => {
  const circle = { kind: 'circle', radius: { value: 10, unit: 'px' }, at: [{ from: 'end', offset: { value: 4, unit: 'px' } }, { from: 'start', offset: { value: 10, unit: '%' } }] } as const;
  const ellipse = { kind: 'ellipse', radii: ['closest-side', 'farthest-side'], at: null } as const;
  const polygon = { kind: 'polygon', evenodd: true, points: [[{ value: 0, unit: 'px' }, { value: 0, unit: 'px' }], [{ value: 100, unit: '%' }, { value: 2, unit: 'px' }], [{ value: 50, unit: '%' }, { value: 100, unit: '%' }]] } as const;
  it('encodes each shape as the writer takes it', () => {
    expect([clipShapeKind(circle), clipShapeKind(ellipse), clipShapeKind(polygon)]).toEqual([0, 1, 2]);
    expect(clipShapeValues(circle)).toEqual([1, 4, 0, 0, 0, 10, 0, 10, 0]);
    expect(clipShapeValues(ellipse)).toEqual([0, 0, 50, 0, 0, 50, 1, 0, 0, 2, 0, 0]);
    expect(clipShapeValues(polygon)).toEqual([1, 0, 0, 0, 0, 0, 100, 2, 0, 0, 50, 0, 100]);
    expect(() => clipShapeValues({ kind: 'circle', radius: { value: 1, unit: 'em' }, at: null })).toThrow(/not a finite px or % value/);
  });
  it('computes the geometry against the layout size in device px', () => {
    // A circle 10px from the right and 10% down of an 80 x 40 box at DPR 2: its centre is 80 - 8 = 72, 4.
    expect(clipShapeGeometry(0, clipShapeValues(circle), [80, 40], 2)).toEqual([72, 4, 20]);
    // closest-side and farthest-side of a centred ellipse: half the width, and half the height.
    expect(clipShapeGeometry(1, clipShapeValues(ellipse), [80, 40], 2)).toEqual([40, 20, 40, 20]);
    expect(clipShapeGeometry(2, clipShapeValues(polygon), [80, 40], 2)).toEqual([1, 0, 0, 80, 4, 40, 40]);
    // A circle's percentage radius is of the normalized diagonal, sqrt(w² + h²) / sqrt(2); closest-side and farthest-side span all four sides.
    expect(clipShapeGeometry(0, [0, 0, 50, 0, 0, 50, 0, 0, 100], [30, 40], 1)).toEqual([15, 20, 50 / Math.SQRT2]);
    expect(clipShapeGeometry(0, [0, 0, 25, 0, 0, 50, 1, 0, 0], [40, 40], 1)).toEqual([10, 20, 10]);
    expect(clipShapeGeometry(0, [0, 0, 25, 0, 0, 50, 2, 0, 0], [40, 40], 1)).toEqual([10, 20, 30]);
  });
  const w = { kind: 'clip-path-shape', shape: circle } as never;
  it('emits the shape writer on both backends and expects the geometry in points on UIKit and device px on Android', () => {
    expect(CLIP_EMITTER.lines.uikit('v0', {} as never, w)).toEqual(['  dragonSetClipShape(v0, 0, [1.0, 4.0, 0.0, 0.0, 0.0, 10.0, 0.0, 10.0, 0.0])']);
    expect(CLIP_EMITTER.lines['android-views']('v1', {} as never, w)).toEqual(['  dragonSetClipShape(v1, 0, doubleArrayOf(1.0, 4.0, 0.0, 0.0, 0.0, 10.0, 0.0, 10.0, 0.0))']);
    const g = { box: { left: 0, top: 0, right: 80, bottom: 40 }, size: [80, 40] } as never;
    expect(CLIP_EMITTER.applied({} as never, 'android-views', w, 2, g)).toEqual([72, 4, 20]);
    expect(CLIP_EMITTER.applied({} as never, 'uikit', w, 2, g)).toEqual([36, 2, 10]);
    expect(CLIP_EMITTER.applied({} as never, 'uikit', { kind: 'clip-path-shape', shape: polygon } as never, 2, g)).toEqual([1, 0, 0, 40, 2, 20, 20]);
  });
  for (const backend of ['uikit', 'android-views'] as const) {
    const files = emitNativeSupport(backend);
    const ios = backend === 'uikit';
    const clip = files.find((f) => f.path.endsWith(ios ? 'DragonPaintClip.swift' : 'DragonPaintClip.kt'))?.text ?? '';
    const all = files.map((f) => f.text).join('\n');
    it(`${backend}: clips to the shape's path with its fill rule, and reads back the geometry`, () => {
      if (ios) {
        expect(clip).toContain('    let m = (v.layer.mask as? CAShapeLayer) ?? CAShapeLayer()\n');
        expect(clip).toContain("    m.fillRule = v.dragonClipShapeKind == 2 && g[0] == 1 ? .evenOdd : .nonZero\n");
        expect(clip).toContain('out.append(("dragonClipPath.shape", (v.layer.mask as? CAShapeLayer)?.path == nil');
      } else {
        expect(all).toContain('    if (p != null) canvas.clipPath(p)\n');
        expect(clip).toContain('    path.fillType = if (g[0] == 1.0) android.graphics.Path.FillType.EVEN_ODD else android.graphics.Path.FillType.WINDING\n');
        expect(clip).toContain('out.add(Pair("dragonClipPath.shape",');
      }
    });
    it(`${backend}: the clip-path-ignored plant turns the shape writer into a no-op too`, () => {
      const plant = CLIP_EMITTER.plants.find((p) => p.name === 'clip-path-ignored');
      if (plant === undefined) throw new Error('no clip-path-ignored plant');
      const [from, to] = plant.replace[backend];
      expect(applyPlant(files, from, to, plant.name).map((f) => f.text).join('\n')).toContain(ios ? 'public let dragonClipPathPlantIgnored = true' : 'const val DRAGON_CLIP_PATH_PLANT_IGNORED = true');
      const writer = clip.slice(clip.indexOf(ios ? 'public func dragonSetClipShape' : 'fun dragonSetClipShape'));
      expect(writer.split('\n')[1]).toBe(ios ? '  if dragonClipPathPlantIgnored { return }' : '  if (DRAGON_CLIP_PATH_PLANT_IGNORED) return');
    });
  }
});
