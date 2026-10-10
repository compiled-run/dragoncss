// BG2-a2 (notes/T074-bg2-spec.md): the typed reading of gradients and layer lists; the refusals, at parse time for every target
// and in the element check for the native targets only (an angle off the measured grid and a corner, R3; tiling, R8; a translucent
// stack, R6; a clipped colour; a rounded box Chrome paints into a bleed-avoidance layer; a gradient in a transformed subtree,
// R13); em, rem and absolute lengths folded to px (R7); and the slope the compiler folds from the measured libm table (R3) and the
// layer it rasters in (R4).
import { parse } from 'css-tree';
import type { CssNode } from 'css-tree';
import { describe, expect, it } from 'vitest';
import type { BoxWidths, ElementLayer, LayerGeometrySpec } from '../src/analysis/paint-values/gradient.ts';
import { colourClipRefusal, commaItems, elementLayers, GRADIENT_VALUES, gradient, imageItem, linearSlope, obscuresOf, position, positionAxisItem, repeatItem, tilingRefusal, transformsSubtree, translucencyRefusal, valueItems } from '../src/analysis/paint-values/gradient.ts';
import type { Diagnostic } from '../src/types.ts';
import type { CssValue } from '../src/css/values.ts';
import { emitNativeSupport, SUPPORT_PLANTS } from '../src/emit/native-support.ts';
import { GRADIENT_EMITTER, slopeBits } from '../src/emit/paint/gradient.ts';
import { paintWriteLines } from '../src/emit/paint/registry.ts';
import { createProjectWith, nativePrograms, NO_FAULTS } from '../src/internal.ts';
import { TANF_DIFFS } from '../src/paint-data/libm-darwin-arm64.generated.ts';
import type { Targets } from '../src/types.ts';
import { div, explainOne, inputFor } from './helpers.ts';

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
  it('reads a position in one to four values, with offsets from the right or bottom edge (R7)', () => {
    expect(ok(position(tokens('top'), 'p'))).toEqual({ x: { unit: 'percent', value: 50 }, y: { unit: 'percent', value: 0 } });
    expect(ok(position(tokens('center left'), 'p'))).toEqual({ x: { unit: 'percent', value: 0 }, y: { unit: 'percent', value: 50 } });
    expect(ok(position(tokens('left 10px top 5%'), 'p'))).toEqual({ x: { unit: 'px', value: 10 }, y: { unit: 'percent', value: 5 } });
    expect(ok(position(tokens('right 10px top'), 'p'))).toEqual({ x: { unit: 'end-px', value: 10 }, y: { unit: 'percent', value: 0 } });
    expect(ok(position(tokens('left bottom 20%'), 'p'))).toEqual({ x: { unit: 'percent', value: 0 }, y: { unit: 'end-percent', value: 20 } });
    expect(ok(positionAxisItem(tokens('right 5px'), 'x'))).toEqual({ unit: 'end-px', value: 5 });
    expect(ok(positionAxisItem(tokens('bottom 25%'), 'y'))).toEqual({ unit: 'end-percent', value: 25 });
    expect(reason(positionAxisItem(tokens('top 5px'), 'x'))).toContain('takes no offset on the x axis');
  });
  it('accepts negative stops and space and round at parse time; the native check refuses space and round (BG2-t)', () => {
    expect(ok(gradient(fn('linear-gradient(red -5px, blue)'))).stops[0]).toEqual({ color: { kind: 'rgba', value: { r: 255, g: 0, b: 0, alpha: 255 } }, unit: 'px', value: -5 });
    expect(ok(repeatItem(tokens('space round')))).toEqual({ x: 'space', y: 'round' });
    // An absolute unit reads as px times its ratio (Chrome keeps it as written in a gradient's computed value).
    expect(ok(gradient(fn('linear-gradient(red 0.1in, blue 12pt)'))).stops.map((s) => [s.unit, s.value])).toEqual([['px', 0.1 * 96], ['px', 12 * (96 / 72)]]);
  });
  it('refuses what Dragon does not draw on any target, naming the package that lifts it', () => {
    expect(reason(imageItem(tokens('url(a.png)')))).toContain('BG2-u');
    expect(reason(imageItem(tokens('conic-gradient(red, blue)')))).toContain('BG2-c');
    expect(reason(imageItem(tokens('linear-gradient(in oklab, red, blue)')))).toContain('BG2b');
    expect(reason(imageItem(tokens('linear-gradient(red, 30%, blue)')))).toContain('BG2b');
    expect(reason(imageItem(tokens('linear-gradient(red 2vw, blue)')))).toContain('CALC-p');
    expect(reason(imageItem(tokens('linear-gradient(red calc(5px + 1%), blue)')))).toContain('CALC-p');
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
    // R7: a content box with padding is drawn (the device reads the padding); space and round always tile (BG2-t).
    expect(tilingRefusal(geometry({ origin: 'content-box', clip: 'content-box' }), widths({ padding: [1, 0, 0, 0] }))).toBe(null);
    expect(tilingRefusal(geometry({ repeatX: 'space' }), widths({}))).toContain('BG2-t');
    expect(tilingRefusal(geometry({ repeatY: 'round' }), widths({}))).toContain('BG2-t');
    // 100% from the right edge is the start edge; 0 from it is not.
    expect(tilingRefusal(geometry({ positionX: { unit: 'end-percent', value: 100 } }), widths({}))).toBe(null);
    expect(tilingRefusal(geometry({ positionX: { unit: 'end-px', value: 0 } }), widths({}))).toContain('position');
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
  it('refuses a colour clipped inside a border that shows the backdrop, which the native background colour would fill', () => {
    const grey = { r: 192, g: 192, b: 192, alpha: 255 };
    const layer = (clip: LayerGeometrySpec['clip']): ElementLayer => ({ image: { kind: 'none' }, geometry: geometry({ clip }) });
    const all = [true, true, true, true];
    expect(colourClipRefusal([layer('border-box')], grey, widths({ borders: [4, 4, 4, 4] }))).toBe(null);
    expect(colourClipRefusal([layer('padding-box')], grey, widths({ borders: [4, 4, 4, 4], obscures: all }))).toBe(null);
    expect(colourClipRefusal([layer('padding-box')], grey, widths({}))).toBe(null);
    expect(colourClipRefusal([layer('padding-box')], { ...grey, alpha: 0 }, widths({ borders: [4, 4, 4, 4] }))).toBe(null);
    expect(colourClipRefusal([layer('padding-box')], grey, widths({ borders: [4, 0, 4, 4], obscures: [true, false, false, true] }))).toBe(
      "the background colour is clipped to the padding-box, and the bottom border (not opaque solid) shows what is behind the box outside that clip, but Dragon's native background colour fills the border box (BG2c)",
    );
    expect(colourClipRefusal([layer('content-box')], grey, widths({ borders: [1, 1, 1, 1] }))).toContain('the top, right, bottom, left borders');
    // A content-box clip also leaves the padding to the backdrop.
    expect(colourClipRefusal([layer('content-box')], grey, widths({ padding: [0, 2, 0, 0] }))).toContain('the right padding shows');
    expect(colourClipRefusal([layer('padding-box')], grey, widths({ padding: [0, 2, 0, 0] }))).toBe(null);
  });
  it('reports the colour clip refusal at background-clip, with or without a gradient layer', () => {
    const run = (rule: string) => {
      const css = `body { margin: 0; } .a { width: 40px; height: 20px; ${rule} }`;
      const c = createProjectWith({ projectId: 'test', targets: { ios: { minimum: '15.0' } } }, { faults: NO_FAULTS, profiles: 'derive', direction: 'ltr' }).compile(inputFor(css, (r) => [div(r, 'a', ['a'])]));
      return c.diagnostics.filter((d) => d.message.startsWith('background-clip on ')).map((d) => css.slice(d.origin.kind === 'authored' ? d.origin.span.start : 0, d.origin.kind === 'authored' ? d.origin.span.end : 0));
    };
    expect(run('border: 4px double #111; background-color: #c0c0c0; background-clip: padding-box;')).toEqual(['padding-box']);
    expect(run('border: 4px dashed #111; background: linear-gradient(#fa0, #05a) padding-box #c0c0c0;')).toEqual(['linear-gradient(#fa0, #05a) padding-box #c0c0c0']);
    expect(run('border: 4px solid #111; background: linear-gradient(#fa0, #05a) padding-box #c0c0c0;')).toEqual([]);
    expect(run('border: 4px double #111; background: linear-gradient(#fa0, #05a) #c0c0c0;')).toEqual([]);
  });
  it('takes Blink BorderEdge::ObscuresBackground per side', () => {
    const opaque = { r: 1, g: 2, b: 3, alpha: 255 };
    expect(['solid', 'none', 'double', 'dotted', 'dashed', 'hidden'].map((s) => obscuresOf(s, opaque))).toEqual(['always', 'always', 'double', 'never', 'never', 'never']);
    expect(obscuresOf('solid', { ...opaque, alpha: 254 })).toBe('never');
  });
  it('splits a value into its comma items', () => {
    expect(commaItems(tokens('a b, c')).map((i) => i.length)).toEqual([2, 1]);
  });
  it('reads a resolved layer value back into items, and throws (css-tree) on text that does not parse', () => {
    expect(valueItems({ kind: 'other', type: 'list', text: 'linear-gradient(red, blue), none' }).map((i) => i.length)).toEqual([1, 1]);
    expect(() => valueItems({ kind: 'other', type: 'list', text: 'red; blue' })).toThrow('Unexpected input');
  });
});

describe('the native element check (R3, R6, R8) and the targets each refusal blocks', () => {
  const compile = (rule: string, targets: Targets = { ios: { minimum: '15.0' }, android: { minSdk: 31 }, web: {} }) => {
    const css = `body { margin: 0; } .a { width: 40px; height: 20px; ${rule} }`;
    const c = createProjectWith({ projectId: 'test', targets }, { faults: NO_FAULTS, profiles: 'derive', direction: 'ltr' }).compile(inputFor(css, (r) => [div(r, 'a', ['a'])]));
    return c.diagnostics.filter((d) => d.severity === 'error').map((d) => `${d.code} ${d.target ?? 'all'} ${d.message.replace(/^background-image on a: /, '')}`);
  };
  it('compiles an opaque angled stack on the grid for every target', () => {
    expect(compile('background: linear-gradient(110deg, red, blue);')).toEqual([]);
    expect(compile('background: linear-gradient(12.34deg, red, blue), red;')).toEqual([]);
  });
  it('R4: refuses on ios and android a gradient box under will-change: transform or opacity, which rasters in its own layer', () => {
    for (const wc of ['transform', 'opacity']) {
      const out = compile(`will-change: ${wc}; background: linear-gradient(110deg, red, blue);`);
      expect(out.filter((m) => m.includes('composited layer')).map((m) => m.split(' ').slice(0, 2).join(' ')), wc).toEqual(['DRAGON_UNSUPPORTED_VALUE android', 'DRAGON_UNSUPPORTED_VALUE ios']);
      expect(compile(`will-change: ${wc}; background: linear-gradient(110deg, red, blue);`, { web: {} }), wc).toEqual([]);
    }
    // An ancestor's layer holds its descendants' gradients.
    const css = 'body { margin: 0; } .p { will-change: transform; } .a { width: 40px; height: 20px; background: linear-gradient(110deg, red, blue); }';
    const c = createProjectWith({ projectId: 'test', targets: { ios: { minimum: '15.0' }, android: { minSdk: 31 } } }, { faults: NO_FAULTS, profiles: 'derive', direction: 'ltr' }).compile(inputFor(css, (r) => [div(r, 'p', ['p'], [div(r, 'a', ['a'])])]));
    expect(c.diagnostics.filter((d) => d.message.includes('composited layer of p')).map((d) => d.target).sort()).toEqual(['android', 'ios']);
    expect(compile('will-change: auto; background: linear-gradient(110deg, red, blue);')).toEqual([]);
    // OVFL-B: a scroll container scrolls its contents in its own layer; overflow: hidden is not user-scrollable.
    for (const o of ['auto', 'scroll']) expect(compile(`overflow: ${o}; background: linear-gradient(110deg, red, blue);`).filter((m) => m.includes('composited layer')).length, o).toBe(2);
    expect(compile('overflow: hidden; background: linear-gradient(110deg, red, blue);').filter((m) => m.includes('composited layer'))).toEqual([]);
    // The overflow the viewport takes (css-overflow-3 §3.3: html's, else a body's) scrolls the root scroller R4 models.
    const layered = (page: string): string[] => {
      const out = createProjectWith({ projectId: 'test', targets: { ios: { minimum: '15.0' }, android: { minSdk: 31 } } }, { faults: NO_FAULTS, profiles: 'derive', direction: 'ltr' }).compile(inputFor(`${page} .a { width: 40px; height: 20px; background: linear-gradient(110deg, red, blue); }`, (r) => [div(r, 'a', ['a'])]));
      return out.diagnostics.filter((d) => d.message.includes('composited layer')).map((d) => `${d.target} ${/composited layer of (\S+)/.exec(d.message)?.[1] ?? ''}`).sort();
    };
    expect(layered('html { overflow-y: scroll; } body { margin: 0; }')).toEqual([]);
    expect(layered('body { margin: 0; overflow: auto; }')).toEqual([]);
    expect(layered('html { overflow: auto; } body { margin: 0; overflow: scroll; }').map((m) => m.split(' ')[0])).toEqual(['android', 'ios']);
  });
  it('refuses on ios and android an animation or transition of a colour a gradient box rasters (BG2c)', () => {
    const run = (css: string, targets: Targets = { ios: { minimum: '15.0' }, android: { minSdk: 31 }, web: {} }): string[] => {
      const c = createProjectWith({ projectId: 'test', targets }, { faults: NO_FAULTS, profiles: 'derive', direction: 'ltr' }).compile(inputFor(`body { margin: 0; } ${css}`, (r) => [div(r, 'a', ['a']), div(r, 'b', ['b'])]));
      return c.diagnostics.filter((d) => d.message.includes('the native animator changes it')).map((d) => `${d.target} ${d.message.split(':')[0]}`).sort();
    };
    const gradient = '.a { width: 40px; height: 20px; background: linear-gradient(110deg, red, blue) white; }';
    expect(run(`@keyframes s { from { background-color: red; } to { background-color: blue; } } ${gradient} .a { animation: s 1s infinite; }`)).toEqual(['android an animation of background-color on a', 'ios an animation of background-color on a']);
    // Another box's animation, a colour the raster does not hold, a transition no state starts (animations.test.ts has one a
    // state starts) and the web target are not refused.
    expect(run(`${gradient} .a { transition: color 1s; }`)).toEqual([]);
    expect(run(`@keyframes s { from { background-color: red; } to { background-color: blue; } } ${gradient} .b { height: 10px; animation: s 1s infinite; }`)).toEqual([]);
    expect(run(`@keyframes f { from { opacity: 0; } to { opacity: 1; } } ${gradient} .a { animation: f 1s infinite; }`)).toEqual([]);
    expect(run(`${gradient} .a { transition: background-color 1s; }`, { web: {} })).toEqual([]);
  });
  it('refuses an angle off the 0.01deg grid and a corner on ios and android only (BG2b)', () => {
    const off = compile('background: linear-gradient(1rad, red, blue);');
    expect(off.map((m) => m.split(' ').slice(0, 2).join(' '))).toEqual(['DRAGON_UNSUPPORTED_VALUE android', 'DRAGON_UNSUPPORTED_VALUE ios']);
    expect(off[1]).toContain('off the 0.01deg grid');
    expect(off[1]).toContain('BG2b');
    const corner = compile('background: linear-gradient(to top right, red, blue);');
    expect(corner.map((m) => m.split(' ').slice(0, 2).join(' '))).toEqual(['DRAGON_UNSUPPORTED_VALUE android', 'DRAGON_UNSUPPORTED_VALUE ios']);
    expect(corner[1]).toContain('atan2');
  });
  it('refuses tiling and a translucent stack on ios and android only', () => {
    expect(compile('background: linear-gradient(red, blue) 0 0 / 10px 10px, white;')[0]).toContain('BG2-t');
    expect(compile('background: linear-gradient(red, blue) space, white;')[0]).toContain('BG2-t');
    expect(compile('background: linear-gradient(red, transparent);')[0]).toContain('BG2c');
    expect(compile('background: linear-gradient(red, transparent);', { web: {} })).toEqual([]);
  });
  it('refuses a translucent stack under opacity too: opacity is not a longhand until PNT1, which isolates the box', () => {
    expect(compile('background: linear-gradient(red, transparent); opacity: 0.5;')[0]).toContain('opacity is not supported');
  });
  it('refuses a padding-box or content-box clip on a rounded box on ios and android (the raster takes the rounded border box only)', () => {
    expect(compile('border-radius: 6px; padding: 2px; background: linear-gradient(red, blue) padding-box white;')[0]).toContain('inner rounded box');
    expect(compile('border-radius: 6px; background: repeating-linear-gradient(red, blue 4px);')).toEqual([]);
    expect(compile('border-radius: 6px; padding: 2px; background: linear-gradient(red, blue) padding-box white;', { web: {} })).toEqual([]);
  });
  it('refuses a rounded box whose background Chrome paints into a bleed-avoidance layer, on ios and android only (BG2c)', () => {
    const refused = (rule: string): string[] => compile(rule).filter((m) => m.includes('bleed-avoidance layer')).map((m) => m.split(' ').slice(0, 2).join(' '));
    const both = ['DRAGON_UNPROVEN_CONTEXT android', 'DRAGON_UNPROVEN_CONTEXT ios'];
    // No painted border: a background colour, or more than one layer (a gradient never occludes the layers beneath it).
    expect(refused('border-radius: 6px; background: linear-gradient(red, blue) white;')).toEqual(both);
    expect(refused('border-radius: 50%; background: radial-gradient(red, transparent), repeating-radial-gradient(red, blue 4px);')).toEqual(both);
    expect(refused('border-top-left-radius: 0 4px; background: linear-gradient(red, blue) white;')).toEqual(both);
    expect(refused('border-radius: 6px; background: linear-gradient(red, blue);')).toEqual([]);
    expect(refused('background: linear-gradient(red, blue) white, linear-gradient(red, blue);')).toEqual([]);
    // A painted border: every side must obscure the background edge (opaque, and not hidden, dotted or dashed).
    expect(refused('border-radius: 6px; border: 2px solid #123; background: radial-gradient(red, transparent), linear-gradient(red, blue) white;')).toEqual([]);
    expect(refused('border-radius: 6px; border: 4px double #123; background: linear-gradient(red, blue) white;')).toEqual([]);
    // (A dashed or dotted side on a rounded box is PNT1b's refusal, and a repeating layer under a border that shows is BG2-t's.)
    expect(refused('border-radius: 6px; border: 2px solid rgba(0, 0, 0, 0.5); background: linear-gradient(red, blue) no-repeat white;')).toEqual(both);
    expect(refused('border-radius: 6px; border-bottom: 2px solid #123; color: rgba(0, 0, 0, 0.5); background: linear-gradient(red, blue) no-repeat;')).toEqual(both);
    expect(refused('border-radius: 6px; border-bottom: 2px solid #123; background: linear-gradient(red, blue) no-repeat;')).toEqual([]);
    expect(compile('border-radius: 6px; background: linear-gradient(red, blue) white;', { web: {} })).toEqual([]);
  });
  it('R13 (BG2-x): refuses every gradient in a subtree whose transform is not the identity, on the native targets', () => {
    const v = (value: CssValue) => ({ value, origin: { kind: 'synthetic' }, span: null, declaration: null, declared: null, losing: [] });
    const at = (address: string) => ({ address, tag: 'div', node: { origin: { kind: 'synthetic' } } });
    // Every resolved element carries every longhand; the R4 check reads will-change and overflow.
    const auto = ['will-change', v({ kind: 'keyword', value: 'auto' } as CssValue)] as const;
    const visible = (p: 'overflow-x' | 'overflow-y') => [p, v({ kind: 'keyword', value: 'visible' } as CssValue)] as const;
    const layered = (image: string) => [['background-image', v({ kind: 'other', text: image } as CssValue)], ['background-position-x', v({ kind: 'percentage', value: 0 } as CssValue)], ['background-position-y', v({ kind: 'percentage', value: 0 } as CssValue)], ['background-size', v({ kind: 'keyword', value: 'auto' } as CssValue)], ['background-repeat', v({ kind: 'keyword', value: 'repeat' } as CssValue)], ['background-origin', v({ kind: 'keyword', value: 'padding-box' } as CssValue)], ['background-clip', v({ kind: 'keyword', value: 'border-box' } as CssValue)], auto, visible('overflow-x'), visible('overflow-y')] as const;
    const leaf = { kind: 'element', element: at('t/g'), props: new Map(layered('linear-gradient(red,blue)')), children: [] };
    const plain = { kind: 'element', element: at('t/p'), props: new Map(layered('none')), children: [] };
    const tree = (transform: CssValue | null) => ({ kind: 'element', element: at('t'), props: new Map(transform === null ? [auto, visible('overflow-x'), visible('overflow-y')] : [auto, visible('overflow-x'), visible('overflow-y'), ['transform', v(transform)]]), children: [{ kind: 'element', element: at('t/m'), props: new Map([auto, visible('overflow-x'), visible('overflow-y')]), children: [leaf, plain] }] });
    const run = (transform: CssValue | null): string[] => {
      const out: Diagnostic[] = [];
      const check = GRADIENT_VALUES.check;
      if (check === null) throw new Error("the gradient module has no element check");
      check(tree(transform) as never, ['ios', 'android', 'web'], out, new Set(), null);
      return out.map((d) => `${d.code} ${d.target} ${d.message.includes('BG2-x') && d.message.startsWith('background-image on t/g:') ? 'BG2-x' : d.message}`);
    };
    expect(run({ kind: 'other', text: 'translateX(-18%) rotate(8deg)' } as CssValue)).toEqual(['DRAGON_UNPROVEN_CONTEXT ios BG2-x', 'DRAGON_UNPROVEN_CONTEXT android BG2-x']);
    expect(run({ kind: 'keyword', value: 'none' } as CssValue)).toEqual([]);
    expect(run(null)).toEqual([]);
    expect(transformsSubtree({ props: new Map([['rotate', v({ kind: 'other', text: '8deg' } as CssValue)]]) } as never)).toBe(true);
    expect(transformsSubtree({ props: new Map([['scale', v({ kind: 'keyword', value: 'none' } as CssValue)]]) } as never)).toBe(false);
  });
  it('refuses an em or rem a layer longhand keeps unfolded (no font size at compile time) on every target, instead of crashing', () => {
    // font-size: larger now resolves against a known parent size (computed.ts), so a viewport size is the unknown one.
    for (const rule of ['font-size: 5vw; background: linear-gradient(red 1em, blue);', 'font-size: 5vw; background: linear-gradient(red, blue); background-position-x: 1em;', 'font-size: 5vw; background: radial-gradient(circle 2em, red, blue);']) {
      const out = compile(rule);
      expect(out.map((m) => m.split(' ').slice(0, 2).join(' ')), rule).toEqual(['DRAGON_UNSUPPORTED_VALUE android', 'DRAGON_UNSUPPORTED_VALUE ios', 'DRAGON_UNSUPPORTED_VALUE web']);
      expect(out[0], rule).toContain('font size Dragon does not know at compile time');
    }
    expect(compile('font-size: 10px; background: linear-gradient(red 1em, blue);', { web: {} })).toEqual([]);
  });
  it('folds em and rem to px at computed-value time, and absolute lengths in positions and sizes, as Chrome 145 computes them (R7)', () => {
    const css = 'html { font-size: 20px; } body { margin: 0; } .a { width: 40px; height: 20px; font-size: 10px; background: radial-gradient(circle 2em at 1rem 0.5in, red 1em, blue) right 1em top 1rem / 2em auto no-repeat white; }';
    const c = createProjectWith({ projectId: 'test', targets: { web: {} } }, { faults: NO_FAULTS, profiles: 'derive', direction: 'ltr' }).compile(inputFor(css, (r) => [div(r, 'a', ['a'])]));
    expect(c.diagnostics.filter((d) => d.severity === 'error').map((d) => d.message)).toEqual([]);
    // A gradient keeps an absolute length as written, as Chrome 145 serializes it (0.5in), and reads it as px times its ratio.
    expect(explainOne(c, 'web', 'a', 'background-image').value).toBe('radial-gradient(circle 20px at 20px 0.5in,red 10px,blue)');
    expect(explainOne(c, 'web', 'a', 'background-position-x').value).toBe('right 10px');
    expect(explainOne(c, 'web', 'a', 'background-position-y').value).toBe('top 20px');
    expect(explainOne(c, 'web', 'a', 'background-size').value).toBe('20px auto');
  });
});

describe('R3: the linear slope from the measured table', () => {
  const view = new DataView(new ArrayBuffer(4));
  const bits = (f: number): number => {
    view.setFloat32(0, f);
    return view.getUint32(0);
  };
  const input = (deg: number): number => Math.fround(Math.fround(90 - Math.fround(deg)) * Math.fround(Math.fround(Math.PI) / 180));
  const table = new Map(TANF_DIFFS.map(([x, y]) => [x, y]));
  it('takes a table entry where the host differs from fdlibm, and fdlibm elsewhere, on every whole degree', () => {
    let fromTable = 0;
    for (let d = 0; d < 360; d++) {
      const s = linearSlope(d);
      if (d % 90 === 0) {
        expect(s, String(d)).toBe(0);
        continue;
      }
      const x = input(d);
      const hit = table.get(bits(x));
      if (hit !== undefined) {
        fromTable++;
        view.setUint32(0, hit);
        expect(s, String(d)).toBe(view.getFloat32(0));
        expect(s, String(d)).not.toBe(Math.fround(Math.tan(x)));
      } else expect(s, String(d)).toBe(Math.fround(Math.tan(x)));
    }
    // The spec's M1 whole degrees where the host's tanf is not fdlibm's include 5, 35, 145, 175 and 354.
    expect(fromTable).toBeGreaterThan(15);
    for (const d of [5, 35, 145, 175, 354]) expect(linearSlope(d), String(d)).not.toBe(Math.fround(Math.tan(input(d))));
  });
  it('normalises the angle as EndPointsFromAngle does (fmodf, then + 360) and is null off the 0.01deg grid', () => {
    expect(linearSlope(470)).toBe(linearSlope(110));
    expect(linearSlope(-250)).toBe(linearSlope(110));
    expect(linearSlope(12.34)).not.toBe(null);
    expect(linearSlope(12.345)).toBe(null);
    expect(linearSlope(180 / Math.PI)).toBe(null);
  });
  it('the libmTableIgnored plant takes fdlibm everywhere, which differs on the table\'s angles', () => {
    expect(linearSlope(35, { libmTableIgnored: true })).toBe(Math.fround(Math.tan(input(35))));
    expect(linearSlope(35, { libmTableIgnored: true })).not.toBe(linearSlope(35));
  });
});

describe('the gradient module: lowering and emission (BG2-a3)', () => {
  const css = 'body { margin: 0; font-family: Ahem; font-size: 10px; color: #0a8; } .a { width: 40px; height: 20px; border: 2px solid #123; padding: 3px; background: radial-gradient(circle at 25% 75%, currentcolor 0 3px, transparent 4px), linear-gradient(35deg, #2f4f66, #a57c5b) padding-box padding-box #fff; }';
  const compile = () => createProjectWith({ projectId: 'test', targets: { ios: { minimum: '15.0' }, android: { minSdk: 31 } } }, { faults: NO_FAULTS, profiles: 'derive', direction: 'ltr' }).compile(inputFor(css, (r) => [div(r, 'a', ['a'])]));
  it('lowers a box\'s gradient layers into one write, top first, with currentcolor resolved, the slope folded and the root layer origin', () => {
    const c = compile();
    expect(c.diagnostics.map((d) => `${d.code} ${d.target ?? ''} ${d.message}`)).toEqual([]);
    const p = nativePrograms(c, []);
    if (p.kind !== 'ready') throw new Error(p.reason);
    const w = p.programs.uikit.nodes.find((n) => n.id === 'a')?.writes.find((x) => x.kind === 'background-layers');
    expect(w).toMatchObject({ key: 'dragonBackgroundLayers', technique: 'dragon-owned-paint', color: { r: 255, g: 255, b: 255, alpha: 255 }, colorClip: 'padding-box', obscures: ['always', 'always', 'always', 'always'], layerOrigin: [0, 0] });
    if (w === undefined || w.kind !== 'background-layers') throw new Error('no write');
    expect(w.layers.map((l) => [l.gradient.radial, l.geometry.clip])).toEqual([[true, 'border-box'], [false, 'padding-box']]);
    expect(w.layers[0]?.gradient.stops[0]?.color).toEqual({ r: 0, g: 0xaa, b: 0x88, alpha: 255 });
    // 35deg is a table angle: the slope is the capture host's tanf, not fdlibm's.
    expect(w.layers[1]?.gradient.slope).toBe(linearSlope(35));
    expect(w.layers[1]?.gradient.slope).not.toBe(linearSlope(35, { libmTableIgnored: true }));
    const swift = paintWriteLines('uikit', 'v', p.programs.uikit.nodes.find((n) => n.id === 'a') as never, w);
    expect(swift[0]).toBe('  dragonSetBackgroundLayers(v, DragonGradientLayers(color: StopColor(255.0, 255.0, 255.0, 255.0), colorClip: "padding-box", obscures: ["always", "always", "always", "always"], layers: [');
    expect(swift.join('\n')).toContain(`JsString("angle"), 35.0, ${linearSlope(35)}, JsString("none")`);
    expect(swift.at(-1)).toBe('  ], lastIsBottom: true, layerX: 0.0, layerY: 0.0))');
    const kotlin = paintWriteLines('android-views', 'v', p.programs['android-views'].nodes.find((n) => n.id === 'a') as never, w);
    expect(kotlin.join('\n')).toContain('jsArrayOf<CssStop>(CssStop(StopColor(0.0, 170.0, 136.0, 255.0), "px", 0.0)');
    expect(GRADIENT_EMITTER.applied({} as never, 'uikit', w as never, 2, {} as never)).toEqual({ layers: 2, kinds: ['radial', 'linear'], slopes: ['00000000', slopeBits(linearSlope(35) as number)], origin: [0, 0], modelled: true });
  });
  it('turns off the fast bottom layer of a rounded box that shrinks its background for bleed avoidance (all sides obscure)', () => {
    const lower = (rule: string) => {
      const c = createProjectWith({ projectId: 'test', targets: { ios: { minimum: '15.0' }, android: { minSdk: 31 } } }, { faults: NO_FAULTS, profiles: 'derive', direction: 'ltr' }).compile(inputFor(`body { margin: 0; } .a { width: 40px; height: 20px; ${rule} }`, (r) => [div(r, 'a', ['a'])]));
      expect(c.diagnostics.filter((d) => d.severity === 'error').map((d) => d.message)).toEqual([]);
      const p = nativePrograms(c, []);
      if (p.kind !== 'ready') throw new Error(p.reason);
      return p.programs.uikit.nodes.find((n) => n.id === 'a')?.writes.find((x) => x.kind === 'background-layers') as { lastIsBottom: boolean } | undefined;
    };
    expect(lower('border-radius: 6px; border: 2px solid #123; background: linear-gradient(red, blue) white;')?.lastIsBottom).toBe(false);
    expect(lower('border: 2px solid #123; background: linear-gradient(red, blue) white;')?.lastIsBottom).toBe(true);
    expect(lower('border-radius: 6px; background: linear-gradient(red, blue);')?.lastIsBottom).toBe(true);
  });
  it('registers the writer, the after-layout raster, the background-layers stage, the readback and the two plants; uploads never convert', () => {
    for (const [b, ext] of [['uikit', 'swift'], ['android-views', 'kt']] as const) {
      const files = emitNativeSupport(b);
      const stages = files.find((f) => f.path.endsWith(`DragonPaintStages.${ext}`))?.text ?? '';
      expect(stages).toContain(b === 'uikit' ? '  // background-layers\n  dragonPaintGradientStage(v, ctx, shape)' : '  // background-layers\n  dragonPaintGradientStage(v, canvas, shape)');
      expect(stages).toContain('dragonAfterLayoutGradient(v, shape, scale)');
      expect(stages).toContain('dragonAppliedGradient(v)');
      // The paddings the raster takes resolve as the engine resolves them: an abspos box against its containing block's padding box.
      const tree = files.map((f) => f.text).join('\n');
      expect(tree).toContain(b === 'uikit' ? 'let pad = try box_resolvePadding(zs, try paddingBasis(id))' : 'val pad = box_resolvePadding(zs, paddingBasis(id))');
      expect(tree).toContain(b === 'uikit' ? 'if z.position.description != "absolute"' : 'if (z.position != "absolute")');
      const own = files.find((f) => f.path.endsWith(`DragonPaintGradient.${ext}`))?.text ?? '';
      expect(own).toContain('paintGradient_planBackground(paint, faults)');
      if (b === 'uikit') expect(own).toContain('public let dragonGradientPlantAlpha = CGImageAlphaInfo.premultipliedLast');
      else {
        expect(own).toContain('bitmap.copyPixelsFromBuffer(ByteBuffer.wrap(bytes))');
        expect(own).toContain('canvas.drawBitmap(b, (r.left - shape.edges[0] + DRAGON_GRADIENT_PLANT_DEVICE_PX).toFloat(), (top - shape.edges[1]).toFloat(), null)');
      }
      // A tall box rasters in strips of bounded size, and a plan the checks should have refused fails instead of drawing nothing.
      expect(own).toContain(b === 'uikit' ? 'let rows = max(1, dragonGradientStripBytes / (w * 4))' : 'val rows = maxOf(1, DRAGON_GRADIENT_STRIP_BYTES / (w * 4))');
      expect(own).toContain(b === 'uikit' ? 'if !plan.modelled { fatalError(' : 'if (!plan.modelled) throw IllegalStateException(');
      // A box's own percentage paddings, which its children's content width takes, resolve against its padding basis too.
      expect(tree).toContain(b === 'uikit' ? 'let pad = try box_resolvePadding(z.style, try paddingBasis(id))' : 'val cb = absoluteBasis(id) ?: if (parent != null) contentWidth(parent) else units_fromCssPx(zoomed.viewport.width)');
      // RTL: the root scroller's layer starts at a whole device px, the ceiling of the overflow's left edge.
      expect(tree).toContain(b === 'uikit' ? 'rootX = (rootX / lu).rounded(.up) * lu + 0' : 'rootX = kotlin.math.ceil(rootX / lu) * lu + 0.0');
    }
    expect(SUPPORT_PLANTS).toContain('gradient-offset-1');
    expect(SUPPORT_PLANTS).toContain('gradient-unpremultiplied-upload');
  });
});
