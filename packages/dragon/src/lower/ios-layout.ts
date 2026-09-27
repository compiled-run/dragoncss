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
} from '@dragon/layout';
import type { Longhand } from '../css/properties.ts';
import type { CssValue } from '../css/stylesheet.ts';
import type { ResolvedElement, ResolvedValue } from '../analysis/resolve.ts';
import { valueToString } from '../analysis/resolve.ts';
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
  const id = el.node.id;
  const get: Get = (p) => (el.props.get(p) as ResolvedValue).value;
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

// Inherited text styles are written onto every text node (goal.md principle 3), so the engine needs no inheritance.
function lowerText(parent: ResolvedElement, id: string, text: string): TextLeaf {
  const get: Get = (p) => (parent.props.get(p) as ResolvedValue).value;
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
  return { kind: 'text', id, text, font: { family: 'Ahem', size: fs.value }, lineHeight };
}

export function lowerTree(el: ResolvedElement, faults: CompilerFaults): LayoutBox {
  return {
    kind: 'box',
    id: el.node.id,
    style: lowerStyle(el, faults),
    children: el.children.map((c) => (c.kind === 'element' ? lowerTree(c, faults) : lowerText(el, c.node.id, c.text))),
  };
}
