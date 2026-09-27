// Stage 2 of docs/api.md §4.1 for ios: resolved CSS to Dragon's layout engine input, with every field set explicitly.
import type {
  AlignContent,
  AlignItems,
  AlignSelf,
  BoxSizing,
  Display,
  FlexBasisValue,
  FlexDirection,
  FlexWrap,
  GapValue,
  JustifyContent,
  LayoutBox,
  LayoutStyle,
  LineHeightValue,
  MarginValue,
  MaxSizeValue,
  PaddingValue,
  SizeValue,
  TextAlign,
  TextLeaf,
  TextWrapMode,
} from '@dragon/layout';
import type { Longhand, TextLonghand } from '../css/properties.ts';
import { INHERITED, LONGHANDS } from '../css/properties.ts';
import type { CssValue } from '../css/stylesheet.ts';
import type { ResolvedElement, ResolvedText, ResolvedValue } from '../analysis/resolve.ts';
import { initialValue, valueToString } from '../analysis/resolve.ts';
import type { CompilerFaults } from '../faults.ts';
import { borderWidthKeywords } from '../ua/chrome-145.generated.ts';

export class LoweringError extends Error {
  readonly nodeId: string;
  readonly property: string;
  constructor(nodeId: string, property: string, message: string) {
    super(message);
    this.nodeId = nodeId;
    this.property = property;
  }
}

type Get = (p: Longhand) => CssValue;

function fail(id: string, p: string, v: CssValue, expected: string): never {
  throw new LoweringError(id, p, `${p}: ${valueToString(v)} on ${id} has no layout mapping (expected ${expected})`);
}

function keyword<T extends string>(id: string, get: Get, p: Longhand, allowed: readonly T[]): T {
  const v = get(p);
  if (v.kind === 'keyword' && (allowed as readonly string[]).includes(v.value)) return v.value as T;
  return fail(id, p, v, allowed.join(' | '));
}

function pxOrPercent(id: string, get: Get, p: Longhand): { readonly kind: 'px' | 'percent'; readonly value: number } | null {
  const v = get(p);
  if (v.kind === 'length' && v.unit === 'px') return { kind: 'px', value: v.value };
  if (v.kind === 'percentage') return { kind: 'percent', value: v.value };
  return null;
}

function size(id: string, get: Get, p: Longhand): SizeValue {
  const v = get(p);
  if (v.kind === 'keyword' && v.value === 'auto') return { kind: 'auto' };
  const lp = pxOrPercent(id, get, p);
  return lp === null ? fail(id, p, v, 'px | % | auto') : lp;
}

function maxSize(id: string, get: Get, p: Longhand): MaxSizeValue {
  const v = get(p);
  if (v.kind === 'keyword' && v.value === 'none') return { kind: 'none' };
  const lp = pxOrPercent(id, get, p);
  return lp === null ? fail(id, p, v, 'px | % | none') : lp;
}

function padding(id: string, get: Get, p: Longhand): PaddingValue {
  const lp = pxOrPercent(id, get, p);
  return lp === null ? fail(id, p, get(p), 'px | %') : lp;
}

function margin(id: string, get: Get, p: Longhand): MarginValue {
  return size(id, get, p);
}

// css-backgrounds-3 §3.3: none/hidden computes to 0. Device-pixel snapping depends on the environment, so the engine applies it.
function borderWidth(id: string, get: Get, side: 'top' | 'right' | 'bottom' | 'left'): { readonly kind: 'px'; readonly value: number } {
  const style = keyword(id, get, `border-${side}-style` as Longhand, ['none', 'hidden', 'solid', 'dotted', 'dashed', 'double', 'groove', 'ridge', 'inset', 'outset']);
  if (style === 'none' || style === 'hidden') return { kind: 'px', value: 0 };
  const p = `border-${side}-width` as Longhand;
  const v = get(p);
  let px: number;
  if (v.kind === 'length' && v.unit === 'px') px = v.value;
  else if (v.kind === 'keyword' && borderWidthKeywords[v.value] !== undefined) px = Number.parseFloat(borderWidthKeywords[v.value] as string);
  else return fail(id, p, v, 'px | thin | medium | thick');
  return { kind: 'px', value: px };
}

function number(id: string, get: Get, p: Longhand): number {
  const v = get(p);
  if (v.kind === 'number') return v.value;
  return fail(id, p, v, '<number>');
}

function flexBasis(id: string, get: Get): FlexBasisValue {
  const v = get('flex-basis');
  if (v.kind === 'keyword' && v.value === 'content') return { kind: 'content' };
  return size(id, get, 'flex-basis');
}

function gap(id: string, get: Get, p: Longhand): GapValue {
  const v = get(p);
  if (v.kind === 'keyword' && v.value === 'normal') return { kind: 'normal' };
  const lp = pxOrPercent(id, get, p);
  return lp === null ? fail(id, p, v, 'px | % | normal') : lp;
}

const ALIGN_ITEMS: readonly AlignItems[] = ['normal', 'stretch', 'flex-start', 'flex-end', 'center', 'baseline', 'start', 'end', 'self-start', 'self-end'];

export function lowerStyle(el: ResolvedElement, faults: CompilerFaults): LayoutStyle {
  return lowerStyleFrom(el.element.address, (p) => (el.props.get(p) as ResolvedValue).value, faults);
}

function lowerStyleFrom(id: string, get: Get, faults: CompilerFaults): LayoutStyle {
  const authoredBoxSizing = keyword<BoxSizing>(id, get, 'box-sizing', ['content-box', 'border-box']);
  const boxSizing: BoxSizing = faults.swapBoxSizing ? (authoredBoxSizing === 'content-box' ? 'border-box' : 'content-box') : authoredBoxSizing;
  return {
    display: keyword<Display>(id, get, 'display', ['block', 'flex', 'none']),
    position: keyword(id, get, 'position', ['static']),
    overflowX: keyword(id, get, 'overflow-x', ['visible']),
    overflowY: keyword(id, get, 'overflow-y', ['visible']),
    direction: keyword(id, get, 'direction', ['ltr', 'rtl']),
    boxSizing,
    width: size(id, get, 'width'),
    height: size(id, get, 'height'),
    minWidth: size(id, get, 'min-width'),
    minHeight: size(id, get, 'min-height'),
    maxWidth: maxSize(id, get, 'max-width'),
    maxHeight: maxSize(id, get, 'max-height'),
    marginTop: margin(id, get, 'margin-top'),
    marginRight: margin(id, get, 'margin-right'),
    marginBottom: margin(id, get, 'margin-bottom'),
    marginLeft: margin(id, get, 'margin-left'),
    paddingTop: padding(id, get, 'padding-top'),
    paddingRight: padding(id, get, 'padding-right'),
    paddingBottom: padding(id, get, 'padding-bottom'),
    paddingLeft: padding(id, get, 'padding-left'),
    borderTopWidth: borderWidth(id, get, 'top'),
    borderRightWidth: borderWidth(id, get, 'right'),
    borderBottomWidth: borderWidth(id, get, 'bottom'),
    borderLeftWidth: borderWidth(id, get, 'left'),
    flexDirection: keyword<FlexDirection>(id, get, 'flex-direction', ['row', 'row-reverse', 'column', 'column-reverse']),
    flexWrap: keyword<FlexWrap>(id, get, 'flex-wrap', ['nowrap', 'wrap', 'wrap-reverse']),
    flexGrow: number(id, get, 'flex-grow'),
    flexShrink: number(id, get, 'flex-shrink'),
    flexBasis: flexBasis(id, get),
    order: number(id, get, 'order'),
    justifyContent: keyword<JustifyContent>(id, get, 'justify-content', [
      'normal', 'flex-start', 'flex-end', 'center', 'space-between', 'space-around', 'space-evenly', 'stretch', 'start', 'end', 'left', 'right',
    ]),
    alignItems: keyword<AlignItems>(id, get, 'align-items', ALIGN_ITEMS),
    alignSelf: keyword<AlignSelf>(id, get, 'align-self', ['auto', ...ALIGN_ITEMS]),
    alignContent: keyword<AlignContent>(id, get, 'align-content', [
      'normal', 'stretch', 'flex-start', 'flex-end', 'center', 'space-between', 'space-around', 'space-evenly', 'baseline', 'start', 'end',
    ]),
    rowGap: gap(id, get, 'row-gap'),
    columnGap: gap(id, get, 'column-gap'),
    textAlign: keyword<TextAlign>(id, get, 'text-align', ['start', 'end', 'left', 'right', 'center', 'justify']),
  };
}

// goal.md principle 3: the text node carries its inherited text styles, so the lowering reads the text node and never its parent.
function lowerText(t: ResolvedText): TextLeaf {
  const id = t.node.address;
  const get = (p: TextLonghand): CssValue => (t.props.get(p) as ResolvedValue).value;
  const family = get('font-family');
  if (family.kind !== 'family' || family.value !== 'Ahem') fail(id, 'font-family', family, 'Ahem (the milestone-1 layout font)');
  const fs = get('font-size');
  if (fs.kind !== 'length' || fs.unit !== 'px') fail(id, 'font-size', fs, 'px');
  const lh = get('line-height');
  let lineHeight: LineHeightValue;
  if (lh.kind === 'keyword' && lh.value === 'normal') lineHeight = { kind: 'normal' };
  else if (lh.kind === 'number') lineHeight = { kind: 'number', value: lh.value };
  else if (lh.kind === 'length' && lh.unit === 'px') lineHeight = { kind: 'px', value: lh.value };
  else return fail(id, 'line-height', lh, 'normal | <number> | px');
  const collapse = get('white-space-collapse');
  if (collapse.kind !== 'keyword' || collapse.value !== 'collapse') fail(id, 'white-space-collapse', collapse, 'collapse');
  const wrap = get('text-wrap-mode');
  if (wrap.kind !== 'keyword' || (wrap.value !== 'wrap' && wrap.value !== 'nowrap')) return fail(id, 'text-wrap-mode', wrap, 'wrap | nowrap');
  return { kind: 'text', id, text: t.text, font: { family: 'Ahem', size: fs.value }, lineHeight, whiteSpaceCollapse: 'collapse', textWrapMode: wrap.value as TextWrapMode };
}

const displayOf = (el: ResolvedElement): string => {
  const v = (el.props.get('display') as ResolvedValue).value;
  return v.kind === 'keyword' ? v.value : '';
};

// CSS2 §9.2.1.1 and css-flexbox-1 §4: an anonymous box inherits the inherited properties of its enclosing box and takes the
// initial value of every other property; it is block-level (a block container, blockified as a flex item).
function anonymousBox(parent: ResolvedElement, id: string, texts: readonly ResolvedText[], faults: CompilerFaults): LayoutBox {
  const values = new Map<Longhand, CssValue>();
  for (const p of LONGHANDS) values.set(p, INHERITED.has(p) ? (parent.props.get(p) as ResolvedValue).value : initialValue(p));
  values.set('display', { kind: 'keyword', value: 'block' });
  return { kind: 'box', id, boxType: 'anonymous', style: lowerStyleFrom(id, (p) => values.get(p) as CssValue, faults), children: texts.map(lowerText) };
}

/**
 * The layout tree of one resolved element. Text beside visible element boxes, or directly in a flex container, is wrapped in
 * anonymous boxes "<element>:anon<k>", one per maximal text sequence; display: none elements generate no box (CSS2 §9.2.4), so
 * beside text they are left out rather than splitting it. The engine never creates boxes.
 */
export function lowerTree(el: ResolvedElement, faults: CompilerFaults): LayoutBox {
  const id = el.element.address;
  const texts = el.children.filter((c): c is ResolvedText => c.kind === 'text');
  const kids = texts.length === 0 ? el.children : el.children.filter((c) => c.kind === 'text' || displayOf(c) !== 'none');
  const wrap = texts.length > 0 && (displayOf(el) === 'flex' || kids.some((c) => c.kind === 'element'));
  const children: (LayoutBox | TextLeaf)[] = [];
  let run: ResolvedText[] = [];
  let anon = 0;
  const flush = (): void => {
    if (run.length > 0) children.push(anonymousBox(el, `${id}:anon${anon++}`, run, faults));
    run = [];
  };
  for (const c of kids) {
    if (c.kind === 'element') {
      flush();
      children.push(lowerTree(c, faults));
    } else if (wrap) run.push(c);
    else children.push(lowerText(c));
  }
  flush();
  return { kind: 'box', id, boxType: 'element', style: lowerStyle(el, faults), children };
}
