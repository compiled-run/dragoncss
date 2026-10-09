// FORM-a: layout() lays out Chrome 145's UA shadow structure of input[type=range] and the button content model, with the control
// boxes (input.ts ControlBox) moving the thumb and centring block buttons, compared with FORM-0's CDP boxes
// (packages/dragon/test/forms/chrome-145) at 0 LU. The compiler's expansion is spelled out here from the captured UA shadow rules
// (forms/ua-shadow.generated.ts): input flex, container flex 1 1 0% min-inline-size 0 border-box, track block flex 1 1 0%
// min-inline-size 0 align-self center border-box, thumb block border-box.
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { ControlBox, LayoutBox, LayoutInput, LayoutRect, LayoutResult, LayoutStyle, TextLeaf, TextMeasurer } from '../src/index.ts';
import type { LU } from '../src/units.ts';
import { absoluteRects, ahemMeasurer, buttonContentShift, fromRaw, layout, sliderIntrinsicInlineSize, sliderThumbInlineOffset, sliderThumbShift, SLIDER_DEFAULT_TRACK_LENGTH, validateLayoutInput } from '../src/index.ts';
import { anon, box, control, neutralEnvironment, pct, px, span, text } from './helpers.ts';

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

/**
 * The range input expanded as the compiler will write it: a flex item of a row flex container that holds it at its content
 * width, as Chrome's inline-block shrink-to-fit does, so an auto width comes from the engine's 129 px default.
 */
function rangeTree(c: RangeCase): LayoutBox {
  const input = declarations(c.css.input);
  const thumb = declarations(c.css.thumb);
  const dir = { direction: c.direction };
  const inputStyle = boxStyle(input);
  if (input.has('box-sizing') && !input.has('width')) throw new Error('a border-box range of auto width is outside the matrix');
  const themed = (input.get('appearance') ?? 'auto') === 'auto' || (thumb.get('appearance') ?? 'auto') === 'auto';
  const thumbStyle = themed ? { width: px(THEME_THUMB.width), height: px(THEME_THUMB.height) } : boxStyle(thumb);
  const thumbBox = control('thumb', { kind: 'slider-thumb', ratio: ratioOf(c) }, { ...dir, boxSizing: 'border-box', ...thumbStyle });
  const track: LayoutBox = { ...box('track', { ...dir, flexGrow: 1, flexShrink: 1, flexBasis: pct(0), minWidth: px(0), alignSelf: 'center', boxSizing: 'border-box', ...boxStyle(declarations(c.css.track)) }), children: [thumbBox] };
  const container = box('container', { ...dir, display: 'flex', flexGrow: 1, flexShrink: 1, flexBasis: pct(0), minWidth: px(0), boxSizing: 'border-box' }, [track]);
  const range = control('input', { kind: 'range', defaultInlineSize: SLIDER_DEFAULT_TRACK_LENGTH }, { ...dir, ...ZERO_EDGES, ...inputStyle, display: 'flex', flexDirection: 'row' }, [container]);
  return { ...box('root', { ...dir, width: px(400), display: 'flex', alignItems: 'flex-start' }), children: [range] };
}

/** The engine's border boxes, relative to the subject's border-box origin, as [x, y, width, height] LU. */
function relative(abs: Map<string, LayoutRect>, origin: string, id: string): Rect {
  const o = abs.get(origin);
  const r = abs.get(id);
  if (o === undefined || r === undefined) throw new Error(`${id} has no box`);
  return [r.x - o.x, r.y - o.y, r.width, r.height];
}
const relativeTo = (r: Rect, o: Rect): Rect => [r[0] - o[0], r[1] - o[1], r[2], r[3]];

type Layout = (input: LayoutInput, measurer: TextMeasurer) => LayoutResult;

function layoutRects(root: LayoutBox, run: Layout = layout, devicePixelRatio = 1): Map<string, LayoutRect> {
  const input: LayoutInput = { viewport: { width: 400, height: 300 }, ...neutralEnvironment({ width: 400, height: 300 }), devicePixelRatio, root };
  const valid = validateLayoutInput(input);
  if (!valid.ok) throw new Error(`invalid input: ${JSON.stringify(valid.errors)}`);
  const r = run(input, ahemMeasurer);
  if (r.kind !== 'ok') throw new Error(`layout refused: ${JSON.stringify(r.unsupported)}`);
  return absoluteRects(r.boxes);
}

/** Every range case's input, container, track and thumb border box from layout(), against Chrome's; the misses and the count. */
function rangeMisses(run: Layout): { readonly misses: string[]; readonly compared: number } {
  let compared = 0;
  const misses: string[] = [];
  for (const c of RANGE) {
    const abs = layoutRects(rangeTree(c), run);
    for (const k of ['input', 'container', 'track', 'thumb'] as const) {
      compared++;
      const ours = relative(abs, 'input', k);
      const want = relativeTo(c.boxes[k].border, c.boxes.input.border);
      if (ours.join() !== want.join()) misses.push(`${c.id} ${c.direction} ${k}: engine [${ours.map((v) => v / 64).join(', ')}] != Chrome [${want.map((v) => v / 64).join(', ')}] (${JSON.stringify(c.css)})`);
    }
  }
  return { misses, compared };
}

/** The engine with one planted controls.ts function: a fresh module graph in which layout() calls the planted version. */
async function plantedLayout(plant: Record<string, unknown>): Promise<Layout> {
  vi.resetModules();
  vi.doMock('../src/controls.ts', async (original) => ({ ...(await original<typeof import('../src/controls.ts')>()), ...plant }));
  try {
    return (await import('../src/index.ts')).layout;
  } finally {
    vi.doUnmock('../src/controls.ts');
    vi.resetModules();
  }
}

describe('FORM-a range: the UA shadow structure laid out by the engine', () => {
  it('the default track length is 129 px at every zoom the lanes use (the auto-width range boxes Chrome gives)', () => {
    expect(SLIDER_DEFAULT_TRACK_LENGTH).toBe(129);
    expect([1, 2, 3, 2.625].map((z) => sliderIntrinsicInlineSize(z))).toEqual([8256, 16512, 24768, 21672]);
    const auto = RANGE.filter((c) => !declarations(c.css.input).has('width'));
    expect(auto.length).toBeGreaterThan(0);
    for (const c of auto) expect(c.boxes.input.content[2], c.id).toBe(sliderIntrinsicInlineSize(1));
  });

  it('layout() gives the input, container, track and thumb boxes Chrome gives on every case, ltr and rtl', () => {
    const r = rangeMisses(layout);
    expect(r.misses).toEqual([]);
    expect(r.compared).toBe(RANGE.length * 4);
  });

  it('an auto-width range is its zoomed default track length wide at every lane DPR', () => {
    const c = RANGE.find((k) => k.css.input === 'appearance:none' && k.css.track === '' && k.direction === 'ltr') as RangeCase;
    for (const dpr of [1, 2, 3, 2.625]) {
      const input = layoutRects(rangeTree(c), layout, dpr).get('input') as LayoutRect;
      expect(input.width, `DPR ${dpr}`).toBe(sliderIntrinsicInlineSize(dpr));
    }
  });

  it('a planted thumb that is not mirrored in rtl misses Chrome', async () => {
    const planted = await plantedLayout({ sliderThumbShift: (ratio: number, w: LU, t: LU) => sliderThumbInlineOffset(ratio, w, t) });
    const r = rangeMisses(planted);
    expect(r.misses.length).toBeGreaterThan(0);
    expect(r.misses.every((m) => m.includes(' rtl thumb: '))).toBe(true);
  });

  it('the thumb offset truncates toward zero, goes negative when the thumb is wider than the track, and runs leftward in rtl', () => {
    expect(sliderThumbInlineOffset(0.37, fromRaw(8256), fromRaw(1024))).toBe(2675);
    expect(sliderThumbInlineOffset(0.5, fromRaw(640), fromRaw(1024))).toBe(-192);
    expect(sliderThumbInlineOffset(1 / 3, fromRaw(1000), fromRaw(0))).toBe(333);
    expect(sliderThumbShift(0.25, fromRaw(1000), fromRaw(100), 'rtl')).toBe(-225);
    expect(sliderThumbShift(0.25, fromRaw(1000), fromRaw(100), 'ltr')).toBe(225);
  });
});

/**
 * The button laid out as the compiler will write it: blockified in the capture's flex row, UA box edges unless the case sets them;
 * a block button is a button-block control box, a flex button a plain box.
 */
function buttonTree(c: ButtonCase): LayoutBox {
  const d = declarations(c.css);
  const dir = { direction: c.direction };
  const flex = d.get('display') === 'flex';
  const textLeaf = (): TextLeaf => text('text', 'XXX');
  const element = (): LayoutBox => box('element', { ...dir, width: px(20), height: px(8) });
  const textItem = (): LayoutBox | TextLeaf => (flex || c.children === 'both' ? anon('button:anon0', { ...dir, textAlign: 'center' }, [textLeaf()]) : textLeaf());
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
  const button: LayoutBox | ControlBox = flex ? box('button', s, withAlign) : control('button', { kind: 'button-block' }, s, withAlign);
  return box('root', { ...dir, width: px(400) }, [{ ...box('p', { ...dir, display: 'flex', alignItems: 'flex-start' }), children: [button] }]);
}

/** Every button case's button size and child rects from layout(), against Chrome's; the misses and the count. */
function buttonMisses(run: Layout): { readonly misses: string[]; readonly compared: number } {
  let compared = 0;
  const misses: string[] = [];
  for (const c of BUTTON) {
    const abs = layoutRects(buttonTree(c), run);
    compared++;
    const wantButton: Rect = [0, 0, c.rects.button[2], c.rects.button[3]];
    const ourButton = relative(abs, 'button', 'button');
    if (ourButton.join() !== wantButton.join()) misses.push(`${c.id} button size ${ourButton[2] / 64}x${ourButton[3] / 64} != Chrome ${c.rects.button[2] / 64}x${c.rects.button[3] / 64} (${c.css})`);
    for (const k of ['text', 'element'] as const) {
      const want = c.rects[k];
      if (want === null) continue;
      compared++;
      const ours = relative(abs, 'button', k);
      const w = relativeTo(want, c.rects.button);
      if (ours.join() !== w.join()) misses.push(`${c.id} ${c.direction} ${k}: engine [${ours.map((v) => v / 64).join(', ')}] != Chrome [${w.map((v) => v / 64).join(', ')}] (${c.css}; ${c.children})`);
    }
  }
  return { misses, compared };
}

describe('FORM-a button: the content model laid out by the engine', () => {
  it('layout() gives the child boxes Chrome gives on every case: block buttons centre their contents safely, flex buttons are plain flex containers', () => {
    const r = buttonMisses(layout);
    expect(r.misses).toEqual([]);
    expect(r.compared).toBe(BUTTON.length + BUTTON.reduce((n, c) => n + (c.rects.text === null ? 0 : 1) + (c.rects.element === null ? 0 : 1), 0));
  });

  it('a planted unsafe centring (no clamp at 0) misses Chrome', async () => {
    const planted = await plantedLayout({ buttonContentShift: (content: LU, contents: LU) => Math.trunc((content - contents) / 2) as LU });
    const r = buttonMisses(planted);
    expect(r.misses.length).toBeGreaterThan(0);
  });

  it('the block centring shift clamps at zero and truncates its half (block_layout_algorithm_utils.cc:194-201)', () => {
    expect(buttonContentShift(fromRaw(3843), fromRaw(640))).toBe(1601);
    expect(buttonContentShift(fromRaw(640), fromRaw(1152))).toBe(0);
    expect(buttonContentShift(fromRaw(641), fromRaw(640))).toBe(0);
  });
});

type ContextCase = {
  readonly id: string;
  readonly direction: 'ltr' | 'rtl';
  readonly wrapper: string;
  readonly before: string | null;
  readonly css: string;
  readonly children: 'text' | 'element';
  readonly childCss: string;
  readonly computed: { readonly boxSizing: string; readonly padding: readonly number[]; readonly border: readonly number[] };
  readonly rects: { readonly wrapper: Rect; readonly before: Rect | null; readonly button: Rect; readonly text: Rect | null; readonly element: Rect | null };
};
const CONTEXTS = (JSON.parse(readFileSync(new URL('button-contexts.json', DATA), 'utf8')) as { cases: ContextCase[] }).cases;

/** The declarations the context cases use, as engine style (margins take auto; padding and border come from the computed values). */
function contextStyle(css: string): Partial<LayoutStyle> {
  const s: { -readonly [K in keyof LayoutStyle]?: LayoutStyle[K] } = {};
  const margin = (v: string): LayoutStyle['marginTop'] => (v === 'auto' ? { kind: 'auto' } : px(pxOf(v)));
  for (const [k, v] of declarations(css)) {
    if (k === 'width') s.width = px(pxOf(v));
    else if (k === 'height') s.height = px(pxOf(v));
    else if (k === 'min-height') s.minHeight = px(pxOf(v));
    else if (k === 'flex-shrink') s.flexShrink = Number(v);
    else if (k === 'display') s.display = v === 'flex' ? 'flex' : 'block';
    else if (k === 'flex-direction') s.flexDirection = v === 'column' ? 'column' : 'row';
    else if (k === 'align-items') s.alignItems = v as LayoutStyle['alignItems'];
    else if (k === 'margin') {
      const [t, r = t] = v.split(' ') as [string, string?];
      Object.assign(s, { marginTop: margin(t), marginBottom: margin(t), marginLeft: margin(r as string), marginRight: margin(r as string) });
    } else if (k === 'margin-top') s.marginTop = margin(v);
    else if (k === 'margin-bottom') s.marginBottom = margin(v);
    else if (k === 'margin-left') s.marginLeft = margin(v);
    else if (k === 'margin-right') s.marginRight = margin(v);
    else if (k !== 'padding' && k !== 'border') throw new Error(`declaration ${k} is outside the context cases`);
  }
  return s;
}

/** A context case as the compiler will write it: the bordered wrapper, an optional sibling before the button, the block button. */
function contextTree(c: ContextCase): LayoutBox {
  const dir = { direction: c.direction };
  const edge = (v: readonly number[], side: 'padding' | 'border'): Partial<LayoutStyle> => {
    const [t, r, b, l] = v.map((x) => px(x / 64)) as [ReturnType<typeof px>, ReturnType<typeof px>, ReturnType<typeof px>, ReturnType<typeof px>];
    return side === 'padding' ? { paddingTop: t, paddingRight: r, paddingBottom: b, paddingLeft: l } : { borderTopWidth: t, borderRightWidth: r, borderBottomWidth: b, borderLeftWidth: l };
  };
  const kid = c.children === 'text' ? text('text', 'XXX') : box('element', { ...dir, width: px(20), height: px(8), ...contextStyle(c.childCss) });
  const button = control('button', { kind: 'button-block' }, {
    ...dir,
    boxSizing: c.computed.boxSizing === 'border-box' ? 'border-box' : 'content-box',
    textAlign: 'center',
    ...edge(c.computed.padding, 'padding'),
    ...edge(c.computed.border, 'border'),
    ...contextStyle(c.css),
  }, [kid]);
  const before = c.before === null ? [] : [box('before', { ...dir, ...contextStyle(c.before) })];
  const wrapper: LayoutBox = { ...box('w', { ...dir, marginBottom: px(4), ...edge([64, 64, 64, 64], 'border'), ...contextStyle(c.wrapper) }), children: [...before, button] };
  return box('root', { ...dir, width: px(400) }, [wrapper]);
}

describe('FORM-a button contexts: a block button in block flow and in a short column flex container, against Chrome', () => {
  it('layout() gives the wrapper height and the sibling, button, text and element boxes Chrome gives, ltr and rtl', () => {
    const misses: string[] = [];
    let compared = 0;
    for (const c of CONTEXTS) {
      const abs = layoutRects(contextTree(c));
      const w = abs.get('w') as LayoutRect;
      compared++;
      if (w.height !== c.rects.wrapper[3]) misses.push(`${c.id} ${c.direction} wrapper height ${w.height / 64} != Chrome ${c.rects.wrapper[3] / 64}`);
      for (const k of ['before', 'button', 'text', 'element'] as const) {
        const want = c.rects[k];
        if (want === null) continue;
        compared++;
        const ours = relative(abs, 'w', k);
        const r = relativeTo(want, c.rects.wrapper);
        if (ours.join() !== r.join()) misses.push(`${c.id} ${c.direction} ${k}: engine [${ours.map((v) => v / 64).join(', ')}] != Chrome [${r.map((v) => v / 64).join(', ')}] (${c.wrapper} | ${c.css} | ${c.childCss})`);
      }
    }
    expect(misses).toEqual([]);
    expect(CONTEXTS.length).toBe(28);
    expect(compared).toBe(CONTEXTS.reduce((n, c) => n + 2 + (c.before === null ? 0 : 1) + (c.rects.text === null ? 0 : 1) + (c.rects.element === null ? 0 : 1), 0));
  });

  it('a short column flex container shrinks a button to its content size, not its specified height (css-flexbox-1 §4.5)', () => {
    const c = CONTEXTS.find((k) => k.css.includes('padding:4px') && k.direction === 'ltr') as ContextCase;
    expect(c.rects.button[3]).toBeLessThan(50 * 64);
    expect(c.rects.button[3]).toBeGreaterThan(20 * 64);
    expect((layoutRects(contextTree(c)).get('button') as LayoutRect).height).toBe(c.rects.button[3]);
  });
});

describe('FORM-a control boxes: what the engine and the validator refuse', () => {
  const thumb = control('thumb', { kind: 'slider-thumb', ratio: 0.5 }, { width: px(10), height: px(10) });
  const range = (style: Partial<LayoutStyle>, kids: (LayoutBox | ControlBox)[]): LayoutInput => ({
    viewport: { width: 400, height: 300 },
    ...neutralEnvironment({ width: 400, height: 300 }),
    devicePixelRatio: 1,
    root: { ...box('root', {}), children: [control('input', { kind: 'range', defaultInlineSize: 129 }, { display: 'flex', ...style }, kids)] },
  });
  const codes = (input: LayoutInput): string[] => {
    const v = validateLayoutInput(input);
    return v.ok ? [] : v.errors.map((e) => `${e.path} ${e.message}`);
  };

  it('the validator takes a range with its thumb and refuses a bad display, ratio, position or aspect-ratio', () => {
    const track = (t: ControlBox): LayoutBox => ({ ...box('track', {}), children: [t] });
    expect(codes(range({}, [track(thumb)]))).toEqual([]);
    expect(codes(range({ display: 'block' }, [track(thumb)]))).toEqual(['$.root.children[0].style.display a range control is a flex container']);
    expect(codes(range({}, [track({ ...thumb, control: { kind: 'slider-thumb', ratio: 1.5 } })]))).toEqual(['$.root.children[0].children[0].children[0].control.ratio a slider thumb ratio is at most 1']);
    expect(codes(range({ position: 'absolute' }, [track(thumb)]))).toEqual(['$.root.children[0].style.position an absolutely positioned form control is not supported']);
    expect(codes(range({ aspectRatio: { kind: 'ratio', width: 64, height: 64 } }, [track(thumb)]))).toEqual(['$.root.children[0].style.aspectRatio a form control takes no aspect-ratio']);
    expect(codes(range({}, [track({ ...thumb, style: { ...thumb.style, position: 'absolute' } })]))).toContain('$.root.children[0].children[0].children[0].style.position an absolutely positioned box inside a form control is not supported');
    // A thumb moves only in block flow: a thumb in a flex track, or directly in the range's flex box, is refused.
    expect(codes(range({}, [{ ...box('track', { display: 'flex' }), children: [thumb] }]))).toEqual(['$.root.children[0].children[0].children[0].control a slider thumb is a block-flow child: its parent is a block container']);
    expect(codes(range({}, [thumb]))).toEqual(['$.root.children[0].children[0].control a slider thumb is a block-flow child: its parent is a block container']);
    const button = control('b', { kind: 'button-block' }, { display: 'flex' });
    expect(codes({ ...range({}, []), root: { ...box('root', {}), children: [button] } })).toEqual(['$.root.children[0].style.display a block button control is a block container']);
  });

  it('a control holds inline content with a strut as a box does, and is laid out as a block-flow or flex child (FORM-a with INL1a)', () => {
    const env = { viewport: { width: 400, height: 300 }, ...neutralEnvironment({ width: 400, height: 300 }), devicePixelRatio: 1 };
    const button = control('b', { kind: 'button-block' }, { height: px(40) }, [text('b:text0', 'XX '), span('s', [text('s:text0', 'Y')])]);
    for (const display of ['block', 'flex'] as const) {
      const input: LayoutInput = { ...env, root: box('root', { display }, [button, box('after', { height: px(5) })]) };
      expect(codes(input), display).toEqual([]);
      const r = layout(input, ahemMeasurer);
      if (r.kind !== 'ok') throw new Error(`${display}: ${JSON.stringify(r)}`);
      const ids = [...absoluteRects(r.boxes).keys()];
      expect(ids, display).toEqual(expect.arrayContaining(['b', 's', 'b:text0', 's:text0', 'after']));
    }
    // CSS2 §10.8.1: inline content needs its container's strut, in a control too.
    expect(codes({ ...env, root: box('root', {}, [{ ...button, strut: null }]) })).toContain('$.root.children[0].strut a box with inline content has a strut');
  });

  it('the engine throws on a block button control with display flex, which the validator rejects', () => {
    const input: LayoutInput = { viewport: { width: 400, height: 300 }, ...neutralEnvironment({ width: 400, height: 300 }), devicePixelRatio: 1, root: { ...box('root', {}), children: [control('b', { kind: 'button-block' }, { display: 'flex' })] } };
    expect(() => layout(input, ahemMeasurer)).toThrow('validateLayoutInput rejects this input');
  });

  it('the engine refuses an absolutely positioned control, or an absolutely positioned box inside one', () => {
    const abspos = layout(range({ position: 'absolute' }, []), ahemMeasurer);
    expect(abspos.kind === 'unsupported' ? abspos.unsupported.code : 'ok').toBe('control-out-of-flow');
    const inside = layout(range({}, [{ ...box('track', { position: 'relative' }), children: [{ ...thumb, style: { ...thumb.style, position: 'absolute' } }] }]), ahemMeasurer);
    expect(inside.kind === 'unsupported' ? inside.unsupported.code : 'ok').toBe('control-out-of-flow');
  });
});
