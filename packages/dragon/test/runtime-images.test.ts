// REPL-r1: the compile's checks of an img whose src the app sets at run time (images/runtime.ts): the input field, the build-time
// layout at the devices and each band's edge widths, the selectors that test its src, and its alt text. The parity fixtures
// replaced-runtime-* and reject-runtime-src-* prove the accepted and refused shapes against Chrome.
import { describe, expect, it } from 'vitest';
import type { LayoutInput } from '@dragon/layout';
import { absoluteRects, layout, measurerFor, REFERENCE_PLATFORM } from '@dragon/layout';
import type { Band } from '../src/media/band.ts';
import { bandEdgeWidths } from '../src/images/runtime.ts';
import type { RuntimeImageLayout } from '../src/images/runtime.ts';
import { createProjectWith, NO_FAULTS, nativeLayoutProjection } from '../src/internal.ts';
import { nodeLit, StateEmitError } from '../src/emit/runtime/state.ts';
import type { ProgramNode } from '../src/lower/native-program.ts';
import type { AttributeBinding, ElementNode, Origin, SourceRef, TreeNode } from '../src/types.ts';
import { always, div, DOC, inputFor, staticClass, text } from './helpers.ts';

const m = measurerFor(REFERENCE_PLATFORM);
if (m.kind !== 'ok') throw new Error(m.detail);
const engine = (input: LayoutInput) => {
  const r = layout(input, m.measurer);
  return r.kind === 'ok' ? { kind: 'ok' as const, rects: absoluteRects(r.boxes) } : { kind: 'refused' as const, ...r.unsupported };
};
const DEVICES: RuntimeImageLayout = { devices: [{ width: 400, height: 300, dpr: 1, layout: engine }] };

const img = (ref: SourceRef, id: string, classes: string[], runtimeSrc: unknown, attrs: Record<string, string> = {}, tag = 'img'): ElementNode => {
  const origin: Origin = { kind: 'authored', span: { source: ref, start: 0, end: 0 } };
  const attributes: AttributeBinding[] = Object.entries(attrs).map(([name, value]) => ({ name, value: [{ when: always, value }], origin }));
  return { kind: 'element', id, tag, classes: classes.map((name) => staticClass({ owner: DOC, sheet: 's', name }, origin)), attributes, children: [], origin, ...(runtimeSrc === undefined ? {} : { runtimeSrc }) } as unknown as ElementNode;
};
const compile = (css: string, body: (r: SourceRef) => TreeNode[], runtimeImageLayout: RuntimeImageLayout | null = DEVICES) =>
  createProjectWith({ projectId: 'test', targets: { ios: { minimum: '15.0' }, web: {} } }, { faults: NO_FAULTS, profiles: 'derive', direction: 'ltr', foldViewport: { width: 400, height: 300 }, ...(runtimeImageLayout === null ? {} : { runtimeImageLayout }) }).compile(inputFor(css, body));
const refusals = (c: ReturnType<typeof compile>, code: string): string[] => c.diagnostics.filter((d) => d.code === code).map((d) => d.message);
const SIZED = 'img { display: block; width: 100px; height: 50px; }';

describe('REPL-r1 input: runtimeSrc', () => {
  it('is accepted on an img with no src binding, and is DRAGON_CONFIG_INVALID anywhere else', () => {
    expect(compile(SIZED, (r) => [div(r, 'c', [], [img(r, 'a', [], { absent: false }, { alt: '' })])]).ok).toBe(true);
    const bad = (n: (r: SourceRef) => ElementNode): string[] => refusals(compile(SIZED, (r) => [div(r, 'c', [], [n(r)])]), 'DRAGON_CONFIG_INVALID');
    expect(bad((r) => img(r, 'a', [], { absent: false }, {}, 'div'))).toEqual(['App/a: runtimeSrc is only for an img, not a div']);
    expect(bad((r) => img(r, 'a', [], { absent: false }, { src: 'data:,' }))).toEqual(['App/a: runtimeSrc cannot be given with a src binding']);
    expect(bad((r) => img(r, 'a', [], { absent: 'yes' }))).toEqual(['App/a: runtimeSrc must be exactly { absent: boolean }']);
    expect(bad((r) => img(r, 'a', [], { absent: true, extra: 1 }))).toEqual(['App/a: runtimeSrc must be exactly { absent: boolean }']);
  });

  it('notes the fallback box Chrome draws on a load error, once per img', () => {
    const c = compile(SIZED, (r) => [div(r, 'c', [], [img(r, 'a', [], { absent: false }, { alt: '', width: '400', height: '300' }), img(r, 'b', [], { absent: false }, { alt: 'A lamp' })])]);
    expect(refusals(c, 'DRAGON_RUNTIME_IMAGE_FALLBACK')).toEqual([
      '<img> a: on a load error, an empty src or a src removed at run time, Chrome draws a 400x300 box (its width and height attributes) with a broken-image icon; the native output keeps the laid-out box and draws the no-image outline',
      '<img> b: on a load error, an empty src or a src removed at run time, Chrome draws its alt text "A lamp"; the native output keeps the laid-out box and draws the no-image outline',
    ]);
  });

  it('refuses a missing src that would show alt text or a title, and accepts one with alt=""', () => {
    const one = (attrs: Record<string, string>): string[] => refusals(compile(SIZED, (r) => [div(r, 'c', [], [img(r, 'a', [], { absent: true }, attrs)])]), 'DRAGON_RUNTIME_IMAGE_SIZE');
    expect(one({ alt: '' })).toEqual([]);
    expect(one({})).toEqual([]);
    expect(one({ alt: 'A lamp' })).toEqual(['<img> a has a src set at run time that may be missing, and a missing src shows its alt text (Chrome lays the text out in place of the image): give it alt=""']);
    expect(one({ title: 'A lamp' })).toEqual(['<img> a has a src set at run time that may be missing, and a missing src shows its title (Chrome lays the text out in place of the image): give it alt=""']);
    // An img whose src is never missing keeps its alt text: Chrome shows it only on a load error, which the fallback note names.
    expect(refusals(compile(SIZED, (r) => [div(r, 'c', [], [img(r, 'a', [], { absent: false }, { alt: 'A lamp' })])]), 'DRAGON_RUNTIME_IMAGE_SIZE')).toEqual([]);
  });
});

describe('REPL-r1 layout: the build lays the img out without its image', () => {
  it('refuses every runtimeSrc img when the compile has no build-time layout', () => {
    expect(refusals(compile(SIZED, (r) => [div(r, 'c', [], [img(r, 'a', [], { absent: false })])], null), 'DRAGON_RUNTIME_IMAGE_SIZE')).toEqual(['<img> a has a src set at run time, and this compile lays nothing out at build time, so nothing proves its box does not follow its image']);
  });

  it('refuses a read the devices reach, naming the engine\'s fix', () => {
    expect(refusals(compile('img { display: block; max-width: 100%; }', (r) => [div(r, 'c', [], [img(r, 'a', [], { absent: false })])]), 'DRAGON_RUNTIME_IMAGE_SIZE')).toEqual(["<img> a has a src set at run time, and its used size reads the image's natural ratio, since its height is auto: give it a CSS aspect-ratio, or a width and a height"]);
  });

  it('also lays each band out at its edge widths, so a read only a band the devices miss reaches is refused (Q3)', () => {
    const css = `${SIZED} .c { display: flex; width: 150px; } @media (min-width: 500px) { .c img { width: 200px; height: 100px; } }`;
    expect(refusals(compile(css, (r) => [div(r, 'c', ['c'], [img(r, 'a', [], { absent: false })])]), 'DRAGON_RUNTIME_IMAGE_SIZE')).toEqual(["<img> a has a src set at run time, and its content size as a flex item (its automatic minimum size or flex base size) reads the image's natural ratio: give it a min-width (a min-height in a column flex container)"]);
    // Without the band's rule the flex item shrinks nothing, since 100px fits: accepted.
    expect(refusals(compile(`${SIZED} .c { display: flex; width: 150px; } .c img { min-width: 0; }`, (r) => [div(r, 'c', ['c'], [img(r, 'a', [], { absent: false })])]), 'DRAGON_RUNTIME_IMAGE_SIZE')).toEqual([]);
  });

  it('takes the smallest and largest whole px of each band width, the widest device for a band with no maximum', () => {
    const iv = (lo: number, loInclusive: boolean, hi: number, hiInclusive: boolean) => ({ lo, loInclusive, hi, hiInclusive, nominalLo: lo, nominalHi: hi });
    const band = (...width: ReturnType<typeof iv>[]): Band => ({ index: 0, truth: [], width, height: [iv(0, true, Infinity, false)], condition: 'all' });
    const devices = [{ width: 402, height: 778, dpr: 3, layout: engine }, { width: 411, height: 818, dpr: 2.625, layout: engine }];
    expect(bandEdgeWidths(band(iv(0, true, 699.984375, true)), devices)).toEqual([0, 699]);
    expect(bandEdgeWidths(band(iv(400, false, Infinity, false)), devices)).toEqual([401, 411]);
    expect(bandEdgeWidths(band(iv(700, true, Infinity, false)), devices)).toEqual([700]);
    expect(bandEdgeWidths(band(iv(10.5, true, 10.75, true)), devices)).toEqual([]);
  });
});

describe('REPL-r2a: an img whose height follows its image', () => {
  const ENV = { viewport: { width: 400, height: 300 }, devicePixelRatio: 1, direction: 'ltr', rootFont: 'ua-default' } as const;
  const lowered = (c: ReturnType<typeof compile>): string => JSON.stringify(nativeLayoutProjection(c, ENV, []));
  it('accepts a 100% wide img with an auto height, and lowers it as following its image at 0 by 0', () => {
    const c = compile('img { display: block; width: 100%; max-height: 320px; } p { margin: 0; }', (r) => [div(r, 'c', [], [img(r, 'a', [], { absent: false }), div(r, 'p', [])])]);
    expect(refusals(c, 'DRAGON_RUNTIME_IMAGE_SIZE')).toEqual([]);
    expect(lowered(c)).toContain('"natural":{"kind":"followed","width":0,"height":0}');
  });
  it('refuses it when its image moves a box inline: an abspos box whose width follows its containing block\'s height', () => {
    const css = 'img { display: block; width: 100%; } .c { position: relative; } .ab { position: absolute; top: 0; bottom: 0; left: 0; aspect-ratio: 1 / 1; }';
    const got = refusals(compile(css, (r) => [div(r, 'c', ['c'], [img(r, 'a', [], { absent: false }), div(r, 'ab', ['ab'])])]), 'DRAGON_RUNTIME_IMAGE_SIZE');
    expect(got.length).toBeGreaterThan(0);
    expect(got.every((m) => m.startsWith('<img> a has a src set at run time, and its image changes the inline size or position of ab '))).toBe(true);
  });
  it('refuses it in a grid that sizes its columns again after its rows (Blink is_sizing_dependent_on_block_size)', () => {
    const css = 'img { display: block; width: 100%; } .g { display: grid; grid-template-columns: 100px auto; height: 200px; } .p { height: 50%; width: 10px; }';
    // The img's track is fixed, so only the second pass, which re-measures .p against its row, could reach it.
    const got = refusals(compile(css, (r) => [div(r, 'g', ['g'], [div(r, 'c', [], [img(r, 'a', [], { absent: false })]), div(r, 'p', ['p'], [])])]), 'DRAGON_RUNTIME_IMAGE_SIZE');
    expect(got).toContain("<img> a has a src set at run time, and grid g sizes its columns again after its rows, which a's image sizes, so its image could change a column's width");
  });
  it('refuses it beside a box sized by anchor-size()', () => {
    const css = 'img { display: block; width: 100%; anchor-name: --i; } .c { position: relative; } .x { position: absolute; position-anchor: --i; top: 0; left: 0; width: anchor-size(width); height: 10px; }';
    const got = refusals(compile(css, (r) => [div(r, 'c', ['c'], [img(r, 'a', [], { absent: false }), div(r, 'x', ['x'])])]), 'DRAGON_RUNTIME_IMAGE_SIZE');
    expect(got).toContain("<img> a has a src set at run time, and x is sized by anchor-size(), whose anchor's width the image could change: only block sizes may follow the image");
  });
  it('is never laid out by Dragon\'s state or interaction machines: a state program refuses its node, so no hit table holds it at 0 by 0', () => {
    const write = { kind: 'runtime-image', follows: true, fit: 'cover', position: [{ kind: 'percent', value: 50 }, { kind: 'percent', value: 50 }], layer: false, pixelated: false, absent: null };
    const n = { id: 'a', kind: 'box', parent: null, writes: [write] } as unknown as ProgramNode;
    expect(() => nodeLit('swift', n)).toThrow(StateEmitError);
    expect(() => nodeLit('kotlin', n)).toThrow(/a: a runtime-image write in a state program is not supported yet/);
  });
});

describe('REPL-r1 selectors: a selector that tests the src of a runtimeSrc img is refused', () => {
  const body = (r: SourceRef): TreeNode[] => [div(r, 'c', ['c'], [img(r, 'a', ['ph'], { absent: true }, { alt: '' }), div(r, 'n', ['n'])])];
  for (const sel of ['img[src]', 'img:not([src])', '[src^="https:"]', '.c > [src] + .n', '.c:has(img[src])', 'img[src]:hover', '.c:hover img[src]']) {
    it(`refuses ${sel}`, () => {
      const c = compile(`${SIZED} ${sel} { margin-left: 3px; }`, body);
      expect(refusals(c, 'DRAGON_RUNTIME_IMAGE_SIZE').length, sel).toBe(1);
      expect(c.ok).toBe(false);
    });
  }
  it('accepts selectors that match it by its tag or class, or test src on another element', () => {
    expect(refusals(compile(`${SIZED} .c img, .ph, div[src] { margin-left: 3px; }`, body), 'DRAGON_RUNTIME_IMAGE_SIZE')).toEqual([]);
  });
});

