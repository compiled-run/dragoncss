// BG2 (notes/T046-paint-spec.md §5.4): the typed reading of gradients and layer lists, the build-time refusals (tiling and
// translucency), the lowering of a box's layers into one write, and its emission as the gradient module's public writer.
import { parse } from 'css-tree';
import type { CssNode } from 'css-tree';
import { describe, expect, it } from 'vitest';
import type { BoxWidths, ElementLayer, LayerGeometrySpec } from '../src/analysis/paint-values/gradient.ts';
import { commaItems, elementLayers, gradient, imageItem, obscuresOf, position, tilingRefusal, translucencyRefusal } from '../src/analysis/paint-values/gradient.ts';
import type { CssValue } from '../src/css/values.ts';
import { emitNativeSupport, SUPPORT_PLANTS } from '../src/emit/native-support.ts';
import { paintWriteLines } from '../src/emit/paint/registry.ts';
import { createProjectWith, nativePrograms, NO_FAULTS } from '../src/internal.ts';
import { div, inputFor } from './helpers.ts';

const tokens = (text: string): CssNode[] => ((parse(text, { context: 'value' }) as unknown as { children: { toArray(): CssNode[] } }).children.toArray().filter((n) => n.type !== 'WhiteSpace'));
const fn = (text: string): CssNode => tokens(text)[0] as CssNode;
const ok = <T>(i: { ok: true; value: T } | { ok: false }): T => {
  if (!i.ok) throw new Error('refused');
  return i.value;
};
const reason = (i: { ok: boolean; refusal?: { reason: string } }): string => (i.ok ? '' : (i.refusal?.reason ?? ''));

describe('gradient syntax (css-images-3 §3)', () => {
  it('reads a linear gradient\'s direction as Blink stores it: default, degrees (from any angle unit) or a side or corner', () => {
    expect(ok(gradient(fn('linear-gradient(red, blue)'))).direction).toBe('default');
    expect(ok(gradient(fn('linear-gradient(0.25turn, red, blue)')))).toMatchObject({ direction: 'angle', angleDeg: 90 });
    expect(ok(gradient(fn('linear-gradient(150grad, red, blue)'))).angleDeg).toBe(150 * (360 / 400));
    expect(ok(gradient(fn('linear-gradient(1rad, red, blue)'))).angleDeg).toBe(1 * (180 / Math.PI));
    expect(ok(gradient(fn('linear-gradient(0, red, blue)')))).toMatchObject({ direction: 'angle', angleDeg: 0 });
    expect(ok(gradient(fn('linear-gradient(to top right, red, blue)')))).toMatchObject({ direction: 'side', sideX: 'right', sideY: 'top' });
    expect(ok(gradient(fn('linear-gradient(to left, red, blue)')))).toMatchObject({ direction: 'side', sideX: 'left', sideY: 'none' });
  });
  it('reads colour stops with zero, one or two positions in px and percentages, and currentcolor', () => {
    const g = ok(gradient(fn('repeating-linear-gradient(currentcolor, #343b47 0 8%, transparent 12px)')));
    expect(g.repeating).toBe(true);
    expect(g.stops).toEqual([
      { color: { kind: 'currentcolor' }, unit: 'auto', value: 0 },
      { color: { kind: 'rgba', value: { r: 0x34, g: 0x3b, b: 0x47, alpha: 255 } }, unit: 'px', value: 0 },
      { color: { kind: 'rgba', value: { r: 0x34, g: 0x3b, b: 0x47, alpha: 255 } }, unit: 'percent', value: 8 },
      { color: { kind: 'rgba', value: { r: 0, g: 0, b: 0, alpha: 0 } }, unit: 'px', value: 12 },
    ]);
  });
  it('reads a radial gradient\'s shape, size and centre', () => {
    expect(ok(gradient(fn('radial-gradient(red, blue)')))).toMatchObject({ radial: true, circle: false, extent: 'farthest-corner', centerX: { unit: 'percent', value: 50 } });
    expect(ok(gradient(fn('radial-gradient(circle closest-side at 20px 30%, red, blue)')))).toMatchObject({ circle: true, extent: 'closest-side', centerX: { unit: 'px', value: 20 }, centerY: { unit: 'percent', value: 30 } });
    expect(ok(gradient(fn('radial-gradient(14px, red, blue)')))).toMatchObject({ circle: true, extent: 'explicit', radiusX: { unit: 'px', value: 14 } });
    expect(ok(gradient(fn('radial-gradient(40% 12px at right bottom, red, blue)')))).toMatchObject({ circle: false, extent: 'explicit', radiusX: { unit: 'percent', value: 40 }, radiusY: { unit: 'px', value: 12 }, centerX: { unit: 'percent', value: 100 }, centerY: { unit: 'percent', value: 100 } });
  });
  it('reads a position in one to four values; an offset from the right or bottom is refused (BG2c)', () => {
    expect(ok(position(tokens('top'), 'p'))).toEqual({ x: { unit: 'percent', value: 50 }, y: { unit: 'percent', value: 0 } });
    expect(ok(position(tokens('center left'), 'p'))).toEqual({ x: { unit: 'percent', value: 0 }, y: { unit: 'percent', value: 50 } });
    expect(ok(position(tokens('left 10px top 5%'), 'p'))).toEqual({ x: { unit: 'px', value: 10 }, y: { unit: 'percent', value: 5 } });
    expect(reason(position(tokens('right 10px top'), 'p'))).toContain('BG2c');
  });
  it('refuses what Dragon does not draw, naming the package that lifts it', () => {
    expect(reason(imageItem(tokens('url(a.png)')))).toContain('REPL');
    expect(reason(imageItem(tokens('conic-gradient(red, blue)')))).toContain('BG2b');
    expect(reason(imageItem(tokens('linear-gradient(in oklab, red, blue)')))).toContain('BG2b');
    expect(reason(imageItem(tokens('linear-gradient(red, 30%, blue)')))).toContain('BG2b');
    expect(reason(imageItem(tokens('linear-gradient(red 2em, blue)')))).toContain('BG2c');
    expect(reason(imageItem(tokens('linear-gradient(red -5px, blue)')))).toContain('BG2c');
    expect(reason(imageItem(tokens('image-set("a.png" 1x)')))).toContain('BG2b');
  });
});

const geometry = (o: Partial<LayerGeometrySpec>): LayerGeometrySpec => ({ sizeKind: 'length', sizeX: { unit: 'auto', value: 0 }, sizeY: { unit: 'auto', value: 0 }, positionX: { unit: 'percent', value: 0 }, positionY: { unit: 'percent', value: 0 }, repeatX: 'repeat', repeatY: 'repeat', origin: 'padding-box', clip: 'border-box', ...o });
const widths = (o: Partial<BoxWidths>): BoxWidths => ({ borders: [0, 0, 0, 0], padding: [0, 0, 0, 0], obscures: [false, false, false, false], ...o });

describe('layers (css-backgrounds-3 §2.2) and the build-time refusals', () => {
  it('takes the layer count from background-image and repeats shorter lists', () => {
    const values: Record<string, CssValue> = {
      'background-image': { kind: 'other', type: 'list', text: 'linear-gradient(red,blue), none, radial-gradient(red,blue)' },
      'background-position-x': { kind: 'other', type: 'list', text: '10px, 50%' },
      'background-position-y': { kind: 'percentage', value: 0 },
      'background-size': { kind: 'keyword', value: 'auto' },
      'background-repeat': { kind: 'other', type: 'list', text: 'no-repeat, repeat-x' },
      'background-attachment': { kind: 'keyword', value: 'scroll' },
      'background-origin': { kind: 'keyword', value: 'padding-box' },
      'background-clip': { kind: 'keyword', value: 'border-box' },
    };
    const layers = elementLayers((p) => values[p] as CssValue);
    expect(layers.map((l) => l.image.kind)).toEqual(['gradient', 'none', 'gradient']);
    expect(layers.map((l) => l.geometry.positionX)).toEqual([{ unit: 'px', value: 10 }, { unit: 'percent', value: 50 }, { unit: 'px', value: 10 }]);
    expect(layers.map((l) => [l.geometry.repeatX, l.geometry.repeatY])).toEqual([['no-repeat', 'no-repeat'], ['repeat', 'no-repeat'], ['no-repeat', 'no-repeat']]);
  });
  it('refuses a repeating axis that would tile: a size, a position, or a clip box outside the origin box', () => {
    expect(tilingRefusal(geometry({}), widths({}))).toBe(null);
    expect(tilingRefusal(geometry({ sizeX: { unit: 'px', value: 20 } }), widths({}))).toContain('size');
    expect(tilingRefusal(geometry({ sizeX: { unit: 'px', value: 20 }, repeatX: 'no-repeat' }), widths({}))).toBe(null);
    expect(tilingRefusal(geometry({ positionY: { unit: 'percent', value: 50 } }), widths({}))).toContain('position');
    expect(tilingRefusal(geometry({}), widths({ borders: [0, 2, 0, 0] }))).toContain('background-clip (border-box)');
    // An opaque solid border hides the background under it: the dest stops at the padding box and one tile covers it.
    expect(tilingRefusal(geometry({}), widths({ borders: [0, 2, 0, 0], obscures: [true, true, true, true] }))).toBe(null);
    expect(tilingRefusal(geometry({ origin: 'border-box' }), widths({ borders: [3, 3, 3, 3] }))).toBe(null);
    expect(tilingRefusal(geometry({ origin: 'content-box', clip: 'content-box' }), widths({ padding: [1, 0, 0, 0] }))).toContain('content-box');
  });
  it('refuses a stack that is not opaque wherever a gradient layer paints', () => {
    const red = { r: 255, g: 0, b: 0, alpha: 255 };
    const clear = { r: 0, g: 0, b: 0, alpha: 0 };
    const layer = (text: string, g: Partial<LayerGeometrySpec> = {}): ElementLayer => ({ image: ok(imageItem(tokens(text))), geometry: geometry(g) });
    expect(translucencyRefusal([layer('linear-gradient(red, blue)')], clear, red, widths({}))).toBe(null);
    expect(translucencyRefusal([layer('linear-gradient(red, transparent)')], clear, red, widths({}))).toContain('BG2c');
    expect(translucencyRefusal([layer('linear-gradient(red, transparent)')], red, red, widths({}))).toBe(null);
    expect(translucencyRefusal([layer('linear-gradient(red, transparent)'), layer('linear-gradient(red, blue)')], clear, red, widths({}))).toBe(null);
    expect(translucencyRefusal([layer('linear-gradient(red, blue)', { repeatX: 'no-repeat' })], clear, red, widths({}))).toContain('BG2c');
    expect(translucencyRefusal([layer('linear-gradient(red, transparent)'), layer('linear-gradient(red, blue)', { clip: 'padding-box' })], clear, red, widths({ borders: [1, 1, 1, 1] }))).toContain('BG2c');
  });
  it('takes Blink BorderEdge::ObscuresBackground per side', () => {
    const opaque = { r: 1, g: 2, b: 3, alpha: 255 };
    expect(['solid', 'none', 'double', 'dotted', 'dashed', 'hidden'].map((s) => obscuresOf(s, opaque))).toEqual(['always', 'always', 'double', 'never', 'never', 'never']);
    expect(obscuresOf('solid', { ...opaque, alpha: 254 })).toBe('never');
  });
  it('splits a value into its comma items', () => {
    expect(commaItems(tokens('a b, c')).map((i) => i.length)).toEqual([2, 1]);
  });
});

describe('the gradient module: lowering and emission', () => {
  const css = 'body { margin: 0; font-family: Ahem; font-size: 10px; color: #0a8; } .a { width: 40px; height: 20px; border: 2px solid #123; background: radial-gradient(circle at 25% 75%, currentcolor 0 3px, transparent 4px), linear-gradient(to right, #2f4f66, #a57c5b) padding-box #fff; }';
  const compile = () => createProjectWith({ projectId: 'test', targets: { ios: { minimum: '15.0' }, android: { minSdk: 31 } } }, { faults: NO_FAULTS, profiles: 'derive', direction: 'ltr' }).compile(inputFor(css, (r) => [div(r, 'a', ['a'])]));
  it('lowers a box\'s gradient layers into one write, top first, with currentcolor resolved and the colour clip of the bottom layer', () => {
    const c = compile();
    expect(c.diagnostics.map((d) => `${d.code} ${d.target ?? ''} ${d.message}`)).toEqual([]);
    const p = nativePrograms(c, []);
    if (p.kind !== 'ready') throw new Error(p.reason);
    const w = p.programs.uikit.nodes.find((n) => n.id === 'a')?.writes.find((x) => x.kind === 'background-layers');
    expect(w).toMatchObject({ key: 'dragonBackgroundLayers', technique: 'dragon-owned-paint', color: { r: 255, g: 255, b: 255, alpha: 255 }, colorClip: 'padding-box', obscures: ['always', 'always', 'always', 'always'] });
    if (w === undefined || w.kind !== 'background-layers') throw new Error('no write');
    expect(w.layers.map((l) => [l.gradient.radial, l.geometry.clip])).toEqual([[true, 'border-box'], [false, 'padding-box']]);
    expect(w.layers[0]?.gradient.stops[0]?.color).toEqual({ r: 0, g: 0xaa, b: 0x88, alpha: 255 });
    const swift = paintWriteLines('uikit', 'v', p.programs.uikit.nodes.find((n) => n.id === 'a') as never, w);
    expect(swift[0]).toBe('  dragonSetBackgroundLayers(v, DragonGradientLayers(color: StopColor(255.0, 255.0, 255.0, 255.0), colorClip: "padding-box", obscures: ["always", "always", "always", "always"], layers: [');
    expect(swift.join('\n')).toContain('GradientImage(true, false, JsString("default")');
    const kotlin = paintWriteLines('android-views', 'v', p.programs['android-views'].nodes.find((n) => n.id === 'a') as never, w);
    expect(kotlin.join('\n')).toContain('jsArrayOf<CssStop>(CssStop(StopColor(0.0, 170.0, 136.0, 255.0), "px", 0.0)');
  });
  it('registers the writer, the after-layout raster, the background-layers stage, the readback and the gradient-offset-1 plant', () => {
    for (const [b, ext] of [['uikit', 'swift'], ['android-views', 'kt']] as const) {
      const files = emitNativeSupport(b);
      const stages = files.find((f) => f.path.endsWith(`DragonPaintStages.${ext}`))?.text ?? '';
      expect(stages).toContain(b === 'uikit' ? '  // background-layers\n  dragonPaintGradientStage(v, ctx, shape)' : '  // background-layers\n  dragonPaintGradientStage(v, canvas, shape)');
      expect(stages).toContain('dragonAfterLayoutGradient(v, shape, scale)');
      expect(stages).toContain('dragonAppliedGradient(v)');
      const own = files.find((f) => f.path.endsWith(`DragonPaintGradient.${ext}`))?.text ?? '';
      expect(own).toContain('dragonSetBackgroundLayers');
      expect(own).toContain('paintGradient_planBackground(paint, faults)');
    }
    expect(SUPPORT_PLANTS).toContain('gradient-offset-1');
  });
});
