// GEN-c (notes/T151-gen-spec.md R14): outside list markers in the engine, against the GEN-P probe's Chrome 145.0.7632.6 boxes
// (docs/research/gen-spike/probe/family6-alignment.json; ul padding-inline-start 50px, width 300px, 16px Ahem).
import { describe, expect, it } from 'vitest';
import { absoluteRects, ahemMeasurer, layout, validateLayoutInput } from '../src/index.ts';
import type { Direction, LayoutBox, LayoutRect, LayoutStyle, LineHeightValue, ListMarker } from '../src/index.ts';
import { symbolMarginStartPx, symbolWidthPx } from '../src/marker.ts';
import { ahemFont, box, neutralEnvironment, px, text } from './helpers.ts';

const VIEWPORT = { width: 400, height: 300 };

function run(root: LayoutBox, dpr = 1): Map<string, LayoutRect> {
  const input = { viewport: VIEWPORT, devicePixelRatio: dpr, ...neutralEnvironment(VIEWPORT), root };
  const valid = validateLayoutInput(input);
  if (!valid.ok) throw new Error(JSON.stringify(valid.errors));
  const r = layout(input, ahemMeasurer);
  if (r.kind !== 'ok') throw new Error(r.unsupported.code);
  return absoluteRects(r.boxes);
}

/** A rect in CSS px: [x, y, width, height], from LU in device px. */
function css(m: Map<string, LayoutRect>, id: string, dpr = 1): readonly number[] {
  const r = m.get(id);
  if (r === undefined) throw new Error(`no ${id}`);
  return [r.x, r.y, r.width, r.height].map((v) => v / 64 / dpr);
}

const disc = (li: string, size = 16, lineHeight: LineHeightValue = { kind: 'normal' }): ListMarker => ({ id: `${li}::marker`, kind: 'symbol', symbol: 'disc', text: null, font: ahemFont(size), lineHeight });
const decimal = (li: string, value: string): ListMarker => ({ id: `${li}::marker`, kind: 'text', symbol: null, text: value, font: ahemFont(16), lineHeight: { kind: 'normal' } });

function li(id: string, marker: ListMarker, children: LayoutBox['children'] = [], style: Partial<LayoutStyle> = {}, dir: Direction = 'ltr'): LayoutBox {
  const b = box(id, { ...style, direction: dir }, children as LayoutBox[], children.some((c) => c.kind === 'text' || c.kind === 'inline') ? { font: marker.font, lineHeight: marker.lineHeight } : null);
  return { ...b, marker };
}

/** html > body > ul (padding-inline-start 50px, width 300px) holding the items, in a direction. */
function page(items: LayoutBox[], dir: Direction = 'ltr'): LayoutBox {
  const pad = dir === 'ltr' ? { paddingLeft: px(50) } : { paddingRight: px(50) };
  return box('html', { direction: dir }, [box('body', { direction: dir }, [box('u', { ...pad, width: px(300), direction: dir }, items)])]);
}

const t16 = (id: string, value: string) => text(id, value, { font: ahemFont(16) });

describe('the symbol formulas (list_marker.cc WidthOfSymbol and InlineMarginsForOutside)', () => {
  it('16px Ahem (ascent 13): width 6, start margin -16; 32px (ascent 26): width 11, margin -25; 1px (ascent 1): width 2', () => {
    expect([symbolWidthPx(13, 16), symbolMarginStartPx(13)]).toEqual([6, -16]);
    expect([symbolWidthPx(26, 32), symbolMarginStartPx(26)]).toEqual([11, -25]);
    expect(symbolWidthPx(1, 1)).toBe(2);
    expect(symbolWidthPx(0, 0)).toBe(0);
  });
});

describe('marker placement (family6-alignment)', () => {
  it('an item with text: the disc at x 34 beside its first line; a text marker "1. " at x 2', () => {
    const m = run(page([li('a', disc('a'), [t16('a:text0', 'c')]), li('b', decimal('b', '1. '), [t16('b:text0', 'd')])]));
    expect(css(m, 'a::marker')).toEqual([34, 0, 6, 16]);
    expect(css(m, 'b::marker')).toEqual([2, 16, 48, 16]);
    expect(css(m, 'b')).toEqual([50, 16, 300, 16]);
  });

  it('nested-block: the marker aligns with the text two padded blocks down (y 13)', () => {
    const deep = box('deep', { paddingTop: px(3) }, [t16('deep:text0', 'xx')]);
    const m = run(page([li('a', disc('a'), [box('inner', { paddingTop: px(10) }, [deep])])]));
    expect(css(m, 'a::marker')).toEqual([34, 13, 6, 16]);
    expect(css(m, 'a')).toEqual([50, 0, 300, 29]);
  });

  it('line-height 40px: the marker box is 40 tall at y 0', () => {
    const lh: LineHeightValue = { kind: 'px', value: 40 };
    const m = run(page([li('a', disc('a', 16, lh), [text('a:text0', 'c', { font: ahemFont(16), lineHeight: lh })])]));
    expect(css(m, 'a::marker')).toEqual([34, 0, 6, 40]);
  });

  it('push-down: a 32px marker over 10px block content moves the content down 18px; over 10px inline content nothing moves', () => {
    const inline = li('a', disc('a', 32), [{ kind: 'inline', id: 's', style: { ...box('x', {}).style, display: 'inline' }, font: ahemFont(10), lineHeight: { kind: 'normal' }, children: [text('s:text0', 'c', { font: ahemFont(10) })] }]);
    const block = li('b', disc('b', 32), [box('d', {}, [text('d:text0', 'e', { font: ahemFont(10) })])]);
    const m = run(page([inline, block]));
    expect(css(m, 'a::marker')).toEqual([25, 0, 11, 32]);
    expect(css(m, 'a')).toEqual([50, 0, 300, 32]);
    expect(css(m, 'b::marker')).toEqual([25, 32, 11, 32]);
    expect(css(m, 'd')).toEqual([50, 50, 300, 10]);
    expect(css(m, 'b')).toEqual([50, 32, 300, 28]);
  });

  it('empty-item: an item with no children is one marker line tall, its marker at the content top', () => {
    const m = run(page([li('a', disc('a')), li('b', disc('b'), [], { paddingTop: px(5) })]));
    expect(css(m, 'a')).toEqual([50, 0, 300, 16]);
    expect(css(m, 'a::marker')).toEqual([34, 0, 6, 16]);
    expect(css(m, 'b')).toEqual([50, 16, 300, 21]);
    expect(css(m, 'b::marker')).toEqual([34, 21, 6, 16]);
  });

  it('no-line-boxes: content without a baseline puts the marker at the border-box top and grows the item to hold it', () => {
    const m = run(page([li('a', disc('a'), [box('d1', { height: px(10) })]), li('b', disc('b'), [box('d2', { height: px(4) })], { paddingTop: px(5) })]));
    expect(css(m, 'a')).toEqual([50, 0, 300, 16]);
    expect(css(m, 'a::marker')).toEqual([34, 0, 6, 16]);
    expect(css(m, 'b')).toEqual([50, 16, 300, 16]);
    expect(css(m, 'b::marker')).toEqual([34, 16, 6, 16]);
    expect(css(m, 'd2')).toEqual([50, 21, 300, 4]);
  });

  it('border-left: the offset is from the border box (marker x 34 with a 7px border and 3px padding)', () => {
    const style: Partial<LayoutStyle> = { borderLeftWidth: px(7), borderRightWidth: px(7), paddingLeft: px(3) };
    const m = run(page([li('a', disc('a'), [t16('a:text0', 'c')], style)]));
    expect(css(m, 'a::marker')).toEqual([34, 0, 6, 16]);
  });

  it('rtl: the symbol mirrors past the border-box end (x 360; 32px: x 364)', () => {
    const m = run(page([li('a', disc('a'), [t16('a:text0', 'c')], {}, 'rtl'), li('b', disc('b', 32), [box('d', { direction: 'rtl' }, [text('d:text0', 'e', { font: ahemFont(10) })])], {}, 'rtl')], 'rtl'));
    expect(css(m, 'a::marker')).toEqual([360, 0, 6, 16]);
    expect(css(m, 'b::marker')).toEqual([364, 16, 11, 32]);
  });

  it('DPR 2 and 2.625: the ascent rounds in device px, and the paddings stay device px', () => {
    const items = (): LayoutBox[] => [li('a', disc('a'), [t16('a:text0', 'c')])];
    expect(css(run(page(items()), 2), 'a::marker', 2)).toEqual([37.5, 0, 5.5, 16]);
    const r = css(run(page(items()), 2.625), 'a::marker', 2.625);
    expect(r.map((v) => Math.round(v * 2.625 * 64))).toEqual([101.25 * 64, 0, 13 * 64, 42 * 64]);
  });
});
