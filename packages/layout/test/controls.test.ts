// FORM-a: the engine lays out Chrome 145's UA shadow structure of input[type=range] and the button content model, compared with
// FORM-0's CDP boxes (packages/dragon/test/forms/chrome-145) at 0 LU. The compiler's expansion is spelled out here from the
// captured UA shadow rules (forms/ua-shadow.generated.ts): input flex, container flex 1 1 0% min-inline-size 0 border-box,
// track block flex 1 1 0% min-inline-size 0 align-self center border-box, thumb block border-box.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { LayoutBox, LayoutRect, LayoutStyle, TextLeaf } from '../src/index.ts';
import { absoluteRects, ahemMeasurer, buttonContentShift, fromRaw, layout, sliderIntrinsicInlineSize, sliderThumbInlineOffset, sliderThumbLeft, SLIDER_DEFAULT_TRACK_LENGTH } from '../src/index.ts';
import type { LU } from '../src/units.ts';
import { anon, box, pct, px, text } from './helpers.ts';

type Rect = readonly [number, number, number, number];
type Box = { readonly border: Rect; readonly content: Rect };
type Attr = string | null;
type RangeCase = {
  readonly id: string;
  readonly direction: 'ltr' | 'rtl';
  readonly css: { readonly input: string; readonly thumb: string; readonly track: string };
  readonly attrs: { readonly min: Attr; readonly max: Attr; readonly step: Attr; readonly value: Attr };
  readonly value: string;
  readonly boxes: { readonly input: Box; readonly container: Box; readonly track: Box; readonly thumb: Box };
};
type ButtonCase = {
  readonly id: string;
  readonly direction: 'ltr' | 'rtl';
  readonly css: string;
  readonly children: 'text' | 'element' | 'both';
  readonly rects: { readonly button: Rect; readonly text: Rect | null; readonly element: Rect | null };
};

const DATA = new URL('../../dragon/test/forms/chrome-145/', import.meta.url);
const RANGE = (JSON.parse(readFileSync(new URL('range-geometry.json', DATA), 'utf8')) as { cases: RangeCase[] }).cases;
const BUTTON = (JSON.parse(readFileSync(new URL('button.json', DATA), 'utf8')) as { cases: ButtonCase[] }).cases;
/**
 * forms/ua-shadow.generated.ts RANGE_THEME_THUMB: the size LayoutTheme gives a themed thumb, whatever its author size. The thumb
 * is themed unless both the input and the thumb are appearance:none (FORM-0 ruling F3).
 */
const THEME_THUMB = { width: 16, height: 16 };

function declarations(css: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const d of css.split(';')) {
    if (d === '') continue;
    const k = d.indexOf(':');
    out.set(d.slice(0, k).trim(), d.slice(k + 1).trim());
  }
  return out;
}

const pxOf = (v: string): number => {
  if (!v.endsWith('px') && v !== '0') throw new Error(`length ${v} is outside the matrix`);
  return Number.parseFloat(v);
};

/** The box declarations the matrices use: width, height, min-height, box-sizing, padding and border shorthands. */
function boxStyle(d: Map<string, string>): Partial<LayoutStyle> {
  const s: { -readonly [K in keyof LayoutStyle]?: LayoutStyle[K] } = {};
  for (const [k, v] of d) {
    if (k === 'width') s.width = px(pxOf(v));
    else if (k === 'height') s.height = px(pxOf(v));
    else if (k === 'min-height') s.minHeight = px(pxOf(v));
    else if (k === 'box-sizing') s.boxSizing = v === 'border-box' ? 'border-box' : 'content-box';
    else if (k === 'padding') {
      const p = v.split(' ').map(pxOf);
      const [t, r = t, b = t, l = r] = p as [number, number?, number?, number?];
      Object.assign(s, { paddingTop: px(t), paddingRight: px(r), paddingBottom: px(b), paddingLeft: px(l) });
    } else if (k === 'border') {
      const w = v === '0' ? 0 : pxOf(v.split(' ')[0] as string);
      Object.assign(s, { borderTopWidth: px(w), borderRightWidth: px(w), borderBottomWidth: px(w), borderLeftWidth: px(w) });
    } else if (k !== 'appearance' && k !== 'display' && k !== 'text-align' && k !== 'align-content' && k !== 'justify-content' && k !== 'align-items' && k !== 'flex-direction') {
      throw new Error(`declaration ${k} is outside the matrix`);
    }
  }
  return s;
}

const ZERO_EDGES: Partial<LayoutStyle> = { paddingTop: px(0), paddingRight: px(0), paddingBottom: px(0), paddingLeft: px(0) };

/**
 * The ratio from Chrome's sanitised value in doubles. The compiler derives it in Blink's Decimal (forms/range-value.ts); that path
 * goes through the same engine function in scripts/capture-form-data.ts --check.
 */
function ratioOf(c: RangeCase): number {
  const num = (v: Attr, d: number): number => (v === null || Number.isNaN(Number(v)) ? d : Number(v));
  const min = num(c.attrs.min, 0);
  const max = Math.max(min, num(c.attrs.max, 100));
  return max === min ? 0 : (Number(c.value) - min) / (max - min);
}

/** The range input expanded as the compiler will write it, inside a 400px root; the input's default width is the track length. */
function rangeTree(c: RangeCase): LayoutBox {
  const input = declarations(c.css.input);
  const thumb = declarations(c.css.thumb);
  const dir = { direction: c.direction };
  const inputStyle = boxStyle(input);
  if (input.has('box-sizing') && !input.has('width')) throw new Error('a border-box range of auto width is outside the matrix');
  // layout_box.cc SliderIntrinsicInlineSize: an auto-width range's content inline size (the root shrink-wraps nothing here).
  const width = inputStyle.width ?? px(sliderIntrinsicInlineSize(1) / 64);
  const themed = (input.get('appearance') ?? 'auto') === 'auto' || (thumb.get('appearance') ?? 'auto') === 'auto';
  const thumbStyle = themed ? { width: px(THEME_THUMB.width), height: px(THEME_THUMB.height) } : boxStyle(thumb);
  return box('root', { ...dir, width: px(400) }, [
    box('input', { ...dir, ...ZERO_EDGES, ...inputStyle, width, display: 'flex', flexDirection: 'row' }, [
      box('container', { ...dir, display: 'flex', flexGrow: 1, flexShrink: 1, flexBasis: pct(0), minWidth: px(0), boxSizing: 'border-box' }, [
        box('track', { ...dir, flexGrow: 1, flexShrink: 1, flexBasis: pct(0), minWidth: px(0), alignSelf: 'center', boxSizing: 'border-box', ...boxStyle(declarations(c.css.track)) }, [
          box('thumb', { ...dir, boxSizing: 'border-box', ...thumbStyle }),
        ]),
      ]),
    ]),
  ]);
}

/** The engine's border boxes, relative to the subject's border-box origin, as [x, y, width, height] LU. */
function relative(abs: Map<string, LayoutRect>, origin: string, id: string): Rect {
  const o = abs.get(origin);
  const r = abs.get(id);
  if (o === undefined || r === undefined) throw new Error(`${id} has no box`);
  return [r.x - o.x, r.y - o.y, r.width, r.height];
}
const relativeTo = (r: Rect, o: Rect): Rect => [r[0] - o[0], r[1] - o[1], r[2], r[3]];

function layoutRects(root: LayoutBox): Map<string, LayoutRect> {
  const r = layout({ viewport: { width: 400, height: 300 }, devicePixelRatio: 1, root }, ahemMeasurer);
  if (r.kind !== 'ok') throw new Error(`layout refused: ${JSON.stringify(r.unsupported)}`);
  return absoluteRects(r.boxes);
}

/** A px length of the matrix (padding and border widths are always px here). */
function pxValue(v: LayoutStyle['paddingTop'] | LayoutStyle['borderTopWidth']): number {
  if (v.kind !== 'px') throw new Error(`length ${v.kind} is outside the matrix`);
  return v.value;
}

describe('FORM-a range: the UA shadow structure laid out by the engine', () => {
  it('the default track length is 129 px at every zoom the lanes use (layout_box.cc:296)', () => {
    expect(SLIDER_DEFAULT_TRACK_LENGTH).toBe(129);
    expect([1, 2, 3, 2.625].map((z) => sliderIntrinsicInlineSize(z))).toEqual([8256, 16512, 24768, 21672]);
    const auto = RANGE.filter((c) => !declarations(c.css.input).has('width'));
    expect(auto.length).toBeGreaterThan(0);
    for (const c of auto) expect(c.boxes.input.content[2], c.id).toBe(sliderIntrinsicInlineSize(1));
  });

  it('input, container, track and thumb boxes equal Chrome on every case, ltr and rtl', () => {
    let compared = 0;
    const misses: string[] = [];
    for (const c of RANGE) {
      const abs = layoutRects(rangeTree(c));
      const origin = c.boxes.input.border;
      const track = abs.get('track') as LayoutRect;
      const thumb = abs.get('thumb') as LayoutRect;
      const ts = (((rangeTree(c).children[0] as LayoutBox).children[0] as LayoutBox).children[0] as LayoutBox).style;
      const startInset = (pxValue(ts.borderLeftWidth) + pxValue(ts.paddingLeft)) * 64;
      const trackContentLeft = fromRaw(track.x + startInset);
      const trackContentWidth = fromRaw(track.width - startInset - (pxValue(ts.borderRightWidth) + pxValue(ts.paddingRight)) * 64);
      // The engine's static thumb position is the ratio-0 placement; the slider offset then moves it (AdjustSliderThumbInlineOffset).
      const ratio = ratioOf(c);
      const staticLeft = sliderThumbLeft(trackContentLeft, trackContentWidth, thumb.width as LU, 0, c.direction);
      const finalLeft = sliderThumbLeft(trackContentLeft, trackContentWidth, thumb.width as LU, ratio, c.direction);
      const ours: Record<string, Rect> = {
        input: relative(abs, 'input', 'input'),
        container: relative(abs, 'input', 'container'),
        track: relative(abs, 'input', 'track'),
        thumb: [finalLeft - (abs.get('input') as LayoutRect).x, thumb.y - (abs.get('input') as LayoutRect).y, thumb.width, thumb.height],
      };
      for (const k of ['input', 'container', 'track', 'thumb'] as const) {
        compared++;
        const want = relativeTo(c.boxes[k].border, origin);
        if (ours[k]?.join() !== want.join()) misses.push(`${c.id} ${c.direction} ${k}: engine [${ours[k]?.map((v) => v / 64).join(', ')}] != Chrome [${want.map((v) => v / 64).join(', ')}] (${JSON.stringify(c.css)})`);
      }
      compared++;
      if (thumb.x !== staticLeft) misses.push(`${c.id} thumb static x ${thumb.x / 64} != ratio-0 placement ${staticLeft / 64}`);
    }
    expect(misses).toEqual([]);
    expect(compared).toBe(RANGE.length * 5);
  });

  it('the thumb offset truncates toward zero and goes negative when the thumb is wider than the track', () => {
    expect(sliderThumbInlineOffset(0.37, fromRaw(8256), fromRaw(1024))).toBe(2675);
    expect(sliderThumbInlineOffset(0.5, fromRaw(640), fromRaw(1024))).toBe(-192);
    expect(sliderThumbInlineOffset(1 / 3, fromRaw(1000), fromRaw(0))).toBe(333);
    expect(sliderThumbLeft(fromRaw(0), fromRaw(1000), fromRaw(100), 0.25, 'rtl')).toBe(675);
  });
});

/** The button laid out as the compiler will write it: blockified in the capture's flex row, UA box edges unless the case sets them. */
function buttonTree(c: ButtonCase): LayoutBox {
  const d = declarations(c.css);
  const dir = { direction: c.direction };
  const flex = d.get('display') === 'flex';
  const textLeaf = (): TextLeaf => text('text', 'XXX');
  const element = (): LayoutBox => box('element', { ...dir, width: px(20), height: px(8) });
  const textItem = (): LayoutBox | TextLeaf => (flex || c.children === 'both' ? anon('text-box', { ...dir, textAlign: 'center' }, [textLeaf()]) : textLeaf());
  const kids: (LayoutBox | TextLeaf)[] = c.children === 'text' ? [textItem()] : c.children === 'element' ? [element()] : [textItem(), element()];
  const textAlign = (d.get('text-align') ?? 'center') as LayoutStyle['textAlign'];
  const s: Partial<LayoutStyle> = {
    ...dir,
    boxSizing: 'border-box',
    width: px(120),
    paddingTop: px(1), paddingRight: px(6), paddingBottom: px(1), paddingLeft: px(6),
    borderTopWidth: px(2), borderRightWidth: px(2), borderBottomWidth: px(2), borderLeftWidth: px(2),
    ...boxStyle(d),
    textAlign,
    display: flex ? 'flex' : 'block',
    flexDirection: (d.get('flex-direction') ?? 'row') as LayoutStyle['flexDirection'],
    justifyContent: (d.get('justify-content') ?? 'normal') as LayoutStyle['justifyContent'],
    alignItems: (d.get('align-items') ?? 'normal') as LayoutStyle['alignItems'],
  };
  // The anonymous text box inherits the button's text-align.
  const withAlign = kids.map((k) => (k.kind === 'box' && k.boxType === 'anonymous' ? { ...k, style: { ...k.style, textAlign } } : k));
  return box('root', { ...dir, width: px(400) }, [box('p', { ...dir, display: 'flex', alignItems: 'flex-start' }, [box('button', s, withAlign)])]);
}

describe('FORM-a button: the content model laid out by the engine', () => {
  it('child boxes equal Chrome on every case: block buttons centre their contents safely, flex buttons are plain flex containers', () => {
    let compared = 0;
    const misses: string[] = [];
    for (const c of BUTTON) {
      const abs = layoutRects(buttonTree(c));
      const button = abs.get('button') as LayoutRect;
      const flex = declarations(c.css).get('display') === 'flex';
      const leafId = flex || c.children === 'both' ? 'text-box' : 'text';
      let shift = 0;
      if (!flex) {
        // AlignBlockContent: the content box less the in-flow contents, which the engine stacks from the content box top.
        const st = ((buttonTree(c).children[0] as LayoutBox).children[0] as LayoutBox).style;
        const ids = c.children === 'text' ? ['text'] : c.children === 'element' ? ['element'] : ['text-box', 'element'];
        const contents = ids.reduce((sum, id) => sum + (abs.get(id) as LayoutRect).height, 0);
        shift = buttonContentShift(fromRaw(button.height - (pxValue(st.borderTopWidth) + pxValue(st.paddingTop) + pxValue(st.borderBottomWidth) + pxValue(st.paddingBottom)) * 64), fromRaw(contents));
      }
      compared++;
      const wantButton: Rect = [0, 0, c.rects.button[2], c.rects.button[3]];
      const ourButton = relative(abs, 'button', 'button');
      if (ourButton.join() !== wantButton.join()) misses.push(`${c.id} button size ${ourButton[2] / 64}x${ourButton[3] / 64} != Chrome ${c.rects.button[2] / 64}x${c.rects.button[3] / 64} (${c.css})`);
      for (const k of ['text', 'element'] as const) {
        const want = c.rects[k];
        if (want === null) continue;
        compared++;
        const r = relative(abs, 'button', k === 'text' ? 'text' : 'element');
        const ours: Rect = [r[0], r[1] + shift, r[2], r[3]];
        const w = relativeTo(want, c.rects.button);
        if (ours.join() !== w.join()) misses.push(`${c.id} ${c.direction} ${k}: engine [${ours.map((v) => v / 64).join(', ')}] != Chrome [${w.map((v) => v / 64).join(', ')}] (${c.css}; ${c.children}; via ${leafId})`);
      }
    }
    expect(misses).toEqual([]);
    expect(compared).toBe(BUTTON.length + BUTTON.reduce((n, c) => n + (c.rects.text === null ? 0 : 1) + (c.rects.element === null ? 0 : 1), 0));
  });

  it('the block centring shift clamps at zero and truncates its half (block_layout_algorithm_utils.cc:194-201)', () => {
    expect(buttonContentShift(fromRaw(3843), fromRaw(640))).toBe(1601);
    expect(buttonContentShift(fromRaw(640), fromRaw(1152))).toBe(0);
    expect(buttonContentShift(fromRaw(641), fromRaw(640))).toBe(0);
  });
});

