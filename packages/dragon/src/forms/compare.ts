// Compares the forms reference functions with the Chrome 145 captures under packages/dragon/test/forms/chrome-145.
// Every length is a LayoutUnit integer (1/64 CSS px); a comparison passes only on equality (0 LU).
import { usedAppearance } from './appearance.ts';
import type { AuthorControlStyle, Control, UsedAppearance } from './appearance.ts';
import { buttonContentModel, buttonContentShift } from './button-inner.ts';
import { NO_FORM_FAULTS } from './faults.ts';
import type { FormFaults } from './faults.ts';
import { divLU, thumbLeft } from './range-geometry.ts';
import { rangeRatio, rangeValue } from './range-value.ts';
import type { RangeAttributes } from './range-value.ts';

/** [x, y, width, height] in LU. */
export type Rect = readonly [number, number, number, number];
export type Box = { readonly border: Rect; readonly content: Rect };
export type Direction = 'ltr' | 'rtl';

/** [min, max, step, value attribute, Chrome input.value, String(Chrome valueAsNumber)]; null is an absent attribute. */
export type RangeValueRow = readonly [string | null, string | null, string | null, string | null, string, string];
export type RangeValueCapture = { readonly chrome: string; readonly rows: readonly RangeValueRow[] };

export type RangeGeometryCase = {
  readonly id: string;
  readonly direction: Direction;
  /** The author CSS of the input, thumb and track (declarations only). */
  readonly css: { readonly input: string; readonly thumb: string; readonly track: string };
  readonly attrs: RangeAttributes;
  readonly value: string;
  readonly boxes: { readonly input: Box; readonly container: Box; readonly track: Box; readonly thumb: Box };
};
export type RangeGeometryCapture = { readonly chrome: string; readonly cases: readonly RangeGeometryCase[] };

export type ButtonChildren = 'text' | 'element' | 'both';
export type ButtonCase = {
  readonly id: string;
  readonly direction: Direction;
  readonly css: string;
  readonly children: ButtonChildren;
  readonly computed: {
    readonly display: string;
    readonly textAlign: string;
    readonly flexDirection: string;
    readonly justifyContent: string;
    readonly alignItems: string;
    /** top, right, bottom, left in LU. */
    readonly padding: readonly [number, number, number, number];
    readonly border: readonly [number, number, number, number];
  };
  readonly rects: { readonly button: Rect; readonly text: Rect | null; readonly element: Rect | null };
};
export type ButtonCapture = { readonly chrome: string; readonly cases: readonly ButtonCase[] };

/** 'appearance-none' is none on the input and, for a range, on its thumb; 'input-none-thumb-auto' is a range whose thumb keeps auto. */
export type DevolveSet = 'none' | 'background-color' | 'border' | 'appearance-none' | 'input-none-thumb-auto';
export type DevolvePoint = { readonly name: string; readonly x: number; readonly y: number; readonly control: string; readonly twin: string };
export type DevolveCase = { readonly control: Control; readonly set: DevolveSet; readonly css: string; readonly thumbCss: string; readonly points: readonly DevolvePoint[]; readonly result: UsedAppearance };
export type DevolveCapture = { readonly chrome: string; readonly devicePixelRatio: number; readonly cases: readonly DevolveCase[] };

export type Captures = {
  readonly rangeValue: RangeValueCapture;
  readonly rangeGeometry: RangeGeometryCapture;
  readonly button: ButtonCapture;
  readonly devolve: DevolveCapture;
};

export type Mismatch = { readonly check: CheckName; readonly subject: string; readonly detail: string };
export type CheckName = 'range-value' | 'range-geometry' | 'button-inner' | 'appearance';
export type Comparison = { readonly counts: Readonly<Record<CheckName, number>>; readonly mismatches: readonly Mismatch[] };

export function authorStyleOf(set: DevolveSet): AuthorControlStyle {
  return {
    appearance: set === 'appearance-none' || set === 'input-none-thumb-auto' ? 'none' : 'auto',
    background: set === 'background-color',
    border: set === 'border',
    thumbAppearance: set === 'appearance-none' ? 'none' : 'auto',
  };
}

const attrText = (a: RangeAttributes): string =>
  (['min', 'max', 'step', 'value'] as const)
    .filter((k) => a[k] !== null)
    .map((k) => `${k}=${JSON.stringify(a[k])}`)
    .join(' ') || '(no attributes)';

/** The inline offset of a line of the given width under text-align, in LU. */
function textAlignOffset(textAlign: string, direction: Direction, available: number, width: number): number {
  const free = available - width;
  const side =
    textAlign === 'center' || textAlign === '-webkit-center'
      ? 'center'
      : textAlign === 'left' || textAlign === '-webkit-left'
        ? 'left'
        : textAlign === 'right' || textAlign === '-webkit-right'
          ? 'right'
          : (textAlign === 'end') === (direction === 'ltr')
            ? 'right'
            : 'left';
  if (side === 'left') return 0;
  if (side === 'right') return free;
  return divLU(free, 2);
}

type Item = { readonly kind: 'text' | 'element'; readonly w: number; readonly h: number };

/**
 * Where the button's children land, from the button's box, its computed style and the children's own sizes. The fixture children
 * are one line of Ahem text and a fixed-size display:block element, so a block button stacks them and a flex button places them
 * on one line; the button rule under test is the content model and the block centring shift.
 */
export function expectedButtonChildren(c: ButtonCase): { text: Rect | null; element: Rect | null } {
  const [bx, by, bw, bh] = c.rects.button;
  const [pt, pr, pb, pl] = c.computed.padding;
  const [bt, br, bb, bl] = c.computed.border;
  const content = { x: bx + bl + pl, y: by + bt + pt, w: bw - bl - pl - pr - br, h: bh - bt - pt - pb - bb };
  const items: Item[] = [];
  if (c.rects.text !== null) items.push({ kind: 'text', w: c.rects.text[2], h: c.rects.text[3] });
  if (c.rects.element !== null) items.push({ kind: 'element', w: c.rects.element[2], h: c.rects.element[3] });
  const out: { text: Rect | null; element: Rect | null } = { text: null, element: null };
  const rtl = c.direction === 'rtl';

  if (buttonContentModel(c.computed.display).kind === 'block-centred') {
    let y = content.y + buttonContentShift(content.h, items.reduce((s, i) => s + i.h, 0));
    for (const i of items) {
      const x =
        i.kind === 'text' ? content.x + textAlignOffset(c.computed.textAlign, c.direction, content.w, i.w) : rtl ? content.x + content.w - i.w : content.x;
      out[i.kind] = [x, y, i.w, i.h];
      y += i.h;
    }
    return out;
  }

  const row = c.computed.flexDirection === 'row';
  if (!row && c.computed.flexDirection !== 'column') throw new Error(`flex-direction ${c.computed.flexDirection} is outside the matrix`);
  const mainSize = row ? content.w : content.h;
  const crossSize = row ? content.h : content.w;
  const mains = items.map((i) => (row ? i.w : i.h));
  const free = mainSize - mains.reduce((s, m) => s + m, 0);
  const jc = c.computed.justifyContent;
  let start = 0;
  let gap = 0;
  if (jc === 'center') start = divLU(free, 2);
  else if (jc === 'flex-end' || jc === 'end') start = free;
  else if (jc === 'space-between') gap = items.length > 1 && free > 0 ? divLU(free, items.length - 1) : 0;
  else if (jc !== 'normal' && jc !== 'flex-start' && jc !== 'start') throw new Error(`justify-content ${jc} is outside the matrix`);
  const ai = c.computed.alignItems;
  let pos = start;
  items.forEach((i, k) => {
    const m = mains[k] as number;
    const cross = row ? i.h : i.w;
    const stretched = ai === 'normal' || ai === 'stretch';
    let crossPos = 0;
    if (ai === 'center') crossPos = divLU(crossSize - cross, 2);
    else if (ai === 'flex-end' || ai === 'end') crossPos = crossSize - cross;
    else if (!stretched && ai !== 'flex-start' && ai !== 'start') throw new Error(`align-items ${ai} is outside the matrix`);
    if (row) {
      const x = rtl ? content.x + content.w - pos - m : content.x + pos;
      out[i.kind] = [x, content.y + crossPos, i.w, i.h];
    } else {
      // A stretched anonymous item holding the text spans the cross size; the line inside it follows text-align.
      const x =
        stretched && i.kind === 'text'
          ? content.x + textAlignOffset(c.computed.textAlign, c.direction, content.w, i.w)
          : rtl
            ? content.x + content.w - crossPos - i.w
            : content.x + crossPos;
      out[i.kind] = [x, content.y + pos, i.w, i.h];
    }
    pos += m + gap;
  });
  return out;
}

const rectText = (r: Rect | null): string => (r === null ? 'none' : `[${r.map((v) => v / 64).join(', ')}]px`);
const sameRect = (a: Rect | null, b: Rect | null): boolean => (a === null || b === null ? a === b : a.every((v, k) => v === b[k]));

export function compareForms(captures: Captures, faults: FormFaults = NO_FORM_FAULTS): Comparison {
  const counts: Record<CheckName, number> = { 'range-value': 0, 'range-geometry': 0, 'button-inner': 0, appearance: 0 };
  const mismatches: Mismatch[] = [];
  const expect = (check: CheckName, ok: boolean, subject: string, detail: () => string): void => {
    counts[check]++;
    if (!ok) mismatches.push({ check, subject, detail: detail() });
  };

  for (const [min, max, step, value, chrome, asNumber] of captures.rangeValue.rows) {
    const attrs = { min, max, step, value };
    const ours = rangeValue(attrs, faults);
    expect('range-value', ours === chrome && String(Number(ours)) === asNumber, attrText(attrs), () => `${JSON.stringify(ours)} != Chrome ${JSON.stringify(chrome)} (valueAsNumber ${asNumber})`);
  }

  for (const g of captures.rangeGeometry.cases) {
    const ours = rangeValue(g.attrs, faults);
    expect('range-value', ours === g.value, `${g.id} ${attrText(g.attrs)}`, () => `${JSON.stringify(ours)} != Chrome ${JSON.stringify(g.value)}`);
    const track = g.boxes.track.content;
    const thumb = g.boxes.thumb.border;
    const x = thumbLeft({ contentLeft: track[0], contentWidth: track[2] }, thumb[2], rangeRatio(g.attrs, faults), g.direction, faults);
    expect('range-geometry', x === thumb[0], `${g.id} thumb x`, () => `${x / 64}px != Chrome ${thumb[0] / 64}px (${g.direction}, track content ${rectText(track)}, thumb ${rectText(thumb)})`);
    expect('range-geometry', thumb[1] === track[1], `${g.id} thumb y`, () => `track content top ${track[1] / 64}px != Chrome thumb top ${thumb[1] / 64}px`);
  }

  for (const b of captures.button.cases) {
    const ours = expectedButtonChildren(b);
    for (const k of ['text', 'element'] as const) {
      if (b.rects[k] === null) continue;
      expect('button-inner', sameRect(ours[k], b.rects[k]), `${b.id} ${k}`, () => `${rectText(ours[k])} != Chrome ${rectText(b.rects[k])} (${b.direction}; ${b.css})`);
    }
  }

  for (const d of captures.devolve.cases) {
    const ours = usedAppearance(d.control, authorStyleOf(d.set), faults);
    expect('appearance', ours === d.result, `${d.control} ${d.set}`, () => `${ours} != Chrome ${d.result}`);
  }

  return { counts, mismatches };
}
