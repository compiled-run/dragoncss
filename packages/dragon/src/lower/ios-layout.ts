// Stage 2 of docs/api.md §4.1 for ios: resolved CSS to Dragon's layout engine input, with every field set explicitly.
import type {
  ControlBox,
  AlignContent,
  AspectRatioValue,
  AlignItems,
  AlignSelf,
  BorderWidthValue,
  BoxSizing,
  Display,
  FlexBasisValue,
  FlexDirection,
  FlexWrap,
  FontSpec,
  GapValue,
  InlineChild,
  InsetValue,
  JustifyContent,
  LayoutBox,
  LayoutStyle,
  ObjectFit,
  ObjectPositionValue,
  ReplacedLeaf,
  LengthCalc,
  LineHeightValue,
  LineStrut,
  MarginValue,
  Overflow,
  MaxSizeValue,
  PaddingValue,
  Position,
  SizeValue,
  TextAlign,
  TextLeaf,
  TextWrapMode,
} from '@dragon/layout';
import type { Longhand, TextLonghand } from '../css/properties.ts';
import { INHERITED, LONGHANDS } from '../css/properties.ts';
import type { CssValue } from '../css/stylesheet.ts';
import { exactLayoutRatio, MATH_VALUE_FUNCTIONS } from '../css/values.ts';
import type { ResolvedElement, ResolvedText, ResolvedValue } from '../analysis/resolve.ts';
import { initialValue, isInitialByProvenance, valueToString } from '../analysis/resolve.ts';
import type { CompilerFaults } from '../faults.ts';
import type { MathFonts } from '../css/math.ts';
import { fontUnitsIn, lowerLengthCalc, mathContextFor, parseMath } from '../css/math.ts';
import type { UaDataset } from '../ua/datasets.ts';
import { isControlTag } from '../analysis/elements/controls.ts';
import { DEFAULT_OBJECT_SIZE, isReplacedTag } from '../analysis/elements/replaced.ts';
import type { ImageNaturals } from '../images/compile.ts';
import type { GridContainer } from './grid-layout.ts';
import { ANONYMOUS_GRID_ITEM, GridLoweringError, lowerGridContainer, lowerGridItem } from './grid-layout.ts';

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
/** Whether a longhand holds its initial value by provenance (analysis/resolve.ts isInitialByProvenance). */
type IsInitial = (p: Longhand) => boolean;

function fail(id: string, p: string, v: CssValue, expected: string): never {
  throw new LoweringError(id, p, `${p}: ${valueToString(v)} on ${id} has no layout mapping (expected ${expected})`);
}

function keyword<T extends string>(id: string, get: Get, p: Longhand, allowed: readonly T[]): T {
  const v = get(p);
  if (v.kind === 'keyword' && (allowed as readonly string[]).includes(v.value)) return v.value as T;
  return fail(id, p, v, allowed.join(' | '));
}

/** What the lowering of one element reads besides its values: its font sizes for em and rem, and the compiler faults. */
type Lowering = { readonly em: number | null; readonly rem: number | null; readonly faults: CompilerFaults };

const VIEWPORT_AXIS: { readonly [unit: string]: 'width' | 'height' | 'min' | 'max' } = { vw: 'width', vi: 'width', vh: 'height', vb: 'height', vmin: 'min', vmax: 'max' };

/**
 * A length for the engine (css-values-4 §5-§6, §10): px, a percentage, or a LengthCalc for a viewport unit or a math function,
 * which the engine resolves in its environment (packages/layout/src/environment.ts). Null for any other value.
 */
function lengthPercentage(id: string, get: Get, p: Longhand, range: LengthCalc['range'], l: Lowering): Px | Percent | LengthCalc | null {
  const v = get(p);
  if (v.kind === 'length' && v.unit === 'px') return { kind: 'px', value: v.value };
  if (v.kind === 'percentage') return { kind: 'percent', value: v.value };
  if (v.kind === 'length' && VIEWPORT_AXIS[v.unit] !== undefined) return { kind: 'calc', expr: { kind: 'viewport', value: v.value, axis: VIEWPORT_AXIS[v.unit] as 'width', size: 'large' }, range };
  if (v.kind !== 'other' || !MATH_VALUE_FUNCTIONS.has(v.type.replace('()', ''))) return null;
  const context = mathContextFor(p);
  const parsed = 'refused' in context ? null : parseMath(v.text, context);
  if (parsed === null || !parsed.ok) return fail(id, p, v, `a calculation V1 supports${parsed === null ? '' : ` (${parsed.reason})`}`);
  const needs = fontUnitsIn(parsed.node);
  if ((needs.em && l.em === null) || (needs.rem && l.rem === null)) return fail(id, p, v, 'em and rem in a calculation on an element whose font sizes are px');
  const fonts: MathFonts = { em: l.em === null ? 0 : l.em, rem: l.rem === null ? 0 : l.rem };
  return lowerLengthCalc(parsed.node, fonts, range, l.faults);
}

type Px = { readonly kind: 'px'; readonly value: number };
type Percent = { readonly kind: 'percent'; readonly value: number };

function size(id: string, get: Get, p: Longhand, l: Lowering, range: LengthCalc['range'] = 'non-negative'): SizeValue {
  const v = get(p);
  if (v.kind === 'keyword' && v.value === 'auto') return { kind: 'auto' };
  const lp = lengthPercentage(id, get, p, range, l);
  return lp === null ? fail(id, p, v, 'px | % | a viewport length | a calculation | auto') : lp;
}

function maxSize(id: string, get: Get, p: Longhand, l: Lowering): MaxSizeValue {
  const v = get(p);
  if (v.kind === 'keyword' && v.value === 'none') return { kind: 'none' };
  const lp = lengthPercentage(id, get, p, 'non-negative', l);
  return lp === null ? fail(id, p, v, 'px | % | a viewport length | a calculation | none') : lp;
}

function padding(id: string, get: Get, p: Longhand, l: Lowering): PaddingValue {
  const lp = lengthPercentage(id, get, p, 'non-negative', l);
  return lp === null ? fail(id, p, get(p), 'px | % | a viewport length | a calculation') : lp;
}

function margin(id: string, get: Get, p: Longhand, l: Lowering): MarginValue {
  return size(id, get, p, l, 'all');
}

// CSS2 §9.3.2: box offsets are px, a percentage or auto.
function inset(id: string, get: Get, p: Longhand, l: Lowering): InsetValue {
  return size(id, get, p, l, 'all');
}

// css-backgrounds-3 §3.3: none/hidden computes to 0. Device-pixel snapping depends on the environment, so the engine applies it.
// R5 (DPR Chrome deviation initial-line-width-unzoomed, D1): Blink stores the initial width 3 in zoomed px, unzoomed, so a width
// that is initial by provenance (no width declared, or a shorthand that omits it) lowers to device px, with its value from the UA
// dataset's medium keyword. An authored thin, medium, thick or px width stays CSS px.
function borderWidth(id: string, get: Get, isInitial: IsInitial, side: 'top' | 'right' | 'bottom' | 'left', ua: UaDataset, l: Lowering): BorderWidthValue {
  const style = keyword(id, get, `border-${side}-style` as Longhand, ['none', 'hidden', 'solid', 'dotted', 'dashed', 'double', 'groove', 'ridge', 'inset', 'outset']);
  if (style === 'none' || style === 'hidden') return { kind: 'px', value: 0 };
  const p = `border-${side}-width` as Longhand;
  const v = get(p);
  let px: number;
  const calc = v.kind === 'other' || (v.kind === 'length' && VIEWPORT_AXIS[v.unit] !== undefined) ? lengthPercentage(id, get, p, 'non-negative', l) : null;
  if (calc !== null && calc.kind === 'calc') return calc;
  if (v.kind === 'length' && v.unit === 'px') px = v.value;
  else if (v.kind === 'keyword' && ua.borderWidthKeywords[v.value] !== undefined) px = Number.parseFloat(ua.borderWidthKeywords[v.value] as string);
  else return fail(id, p, v, 'px | thin | medium | thick');
  if (isInitial(p)) {
    if (v.kind !== 'keyword' || v.value !== 'medium') return fail(id, p, v, 'the initial value medium');
    return { kind: 'device-px', value: px };
  }
  return { kind: 'px', value: px };
}

function number(id: string, get: Get, p: Longhand): number {
  const v = get(p);
  if (v.kind === 'number') return v.value;
  return fail(id, p, v, '<number>');
}

function flexBasis(id: string, get: Get, l: Lowering): FlexBasisValue {
  const v = get('flex-basis');
  if (v.kind === 'keyword' && v.value === 'content') return { kind: 'content' };
  return size(id, get, 'flex-basis', l);
}

function gap(id: string, get: Get, p: Longhand, l: Lowering): GapValue {
  const v = get(p);
  if (v.kind === 'keyword' && v.value === 'normal') return { kind: 'normal' };
  const lp = lengthPercentage(id, get, p, 'non-negative', l);
  return lp === null ? fail(id, p, v, 'px | % | a viewport length | a calculation | normal') : lp;
}

// css-sizing-4 §5.1: the engine takes Blink's layout ratio as raw LayoutUnits (analysis/computed-checks.ts refuses the rest).
function aspectRatio(id: string, get: Get): AspectRatioValue {
  const v = get('aspect-ratio');
  if (v.kind === 'keyword' && v.value === 'auto') return { kind: 'auto' };
  if (v.kind !== 'ratio') return fail(id, 'aspect-ratio', v, 'auto | <ratio> | auto && <ratio>');
  const raw = exactLayoutRatio(v.width, v.height);
  if (raw === 'degenerate') return { kind: 'auto' };
  if (raw === null) return fail(id, 'aspect-ratio', v, 'a ratio whose parts are whole multiples of 1/64, or equal');
  return { kind: v.auto ? 'auto-ratio' : 'ratio', width: raw.width, height: raw.height };
}

const ALIGN_ITEMS: readonly AlignItems[] = ['normal', 'stretch', 'flex-start', 'flex-end', 'center', 'baseline', 'start', 'end', 'self-start', 'self-end'];

/** The px value of a computed font-size, or null. */
function fontPx(v: CssValue): number | null {
  return v.kind === 'length' && v.unit === 'px' ? v.value : null;
}

/**
 * The root element's specified font size in px at text scale 1: the engine input's rootFontSize, which rem leaves read (V2 of
 * the value model). A host scales it for the device text size (docs/decisions.md, Device text size).
 */
export function rootFontSizeOf(root: ResolvedElement): number {
  const px = fontPx((root.props.get('font-size') as ResolvedValue).value);
  if (px === null) throw new LoweringError(root.element.address, 'font-size', `font-size on the root ${root.element.address} did not compute to px`);
  return px;
}

export function lowerStyle(el: ResolvedElement, faults: CompilerFaults, ua: UaDataset, rootFontSize: number | null = null): LayoutStyle {
  const id = el.element.address;
  const get: Get = (p) => (el.props.get(p) as ResolvedValue).value;
  const fonts = { em: fontPx(get('font-size')), rem: rootFontSize };
  return lowerStyleFrom(id, get, (p) => isInitialByProvenance(el.props.get(p) as ResolvedValue, p), faults, ua, fonts);
}

const keywordOf = (v: CssValue): string => (v.kind === 'keyword' ? v.value : '');

// css-lists-3 §3: a list item without a marker is a block (Blink LayoutListItem is a LayoutBlockFlow); computed-checks.ts refuses the rest.
function displayOfStyle(id: string, get: Get): Display {
  const v = get('display');
  if (v.kind === 'keyword' && v.value === 'list-item') return 'block';
  return keyword<Display>(id, get, 'display', ['block', 'flex', 'grid', 'inline']);
}

/**
 * css-overflow-3 §3.3 viewport propagation, resolved by the compiler so the engine never sees tags. source is the address of the
 * element whose overflow the viewport takes: html when either axis is not visible, otherwise html's first body child when either
 * of its axes is not visible, otherwise none (the viewport is auto). That element uses visible. direction is the viewport's: body's,
 * or html's with no body (Chrome propagates it from body). Planted fault propagationFromBody takes body's whenever it has one.
 */
export type ViewportOverflow = { readonly source: string | null; readonly overflowX: Overflow; readonly overflowY: Overflow; readonly direction: 'ltr' | 'rtl' };

const OVERFLOW_VALUES: readonly Overflow[] = ['visible', 'hidden', 'clip', 'auto', 'scroll'];

export function viewportOverflow(root: ResolvedElement, faults: CompilerFaults): ViewportOverflow {
  const axes = (el: ResolvedElement): [Overflow, Overflow] => [
    keyword<Overflow>(el.element.address, (p) => (el.props.get(p) as ResolvedValue).value, 'overflow-x', OVERFLOW_VALUES),
    keyword<Overflow>(el.element.address, (p) => (el.props.get(p) as ResolvedValue).value, 'overflow-y', OVERFLOW_VALUES),
  ];
  const visible = (a: [Overflow, Overflow]): boolean => a[0] === 'visible' && a[1] === 'visible';
  const body = root.element.tag === 'html' ? root.children.find((c): c is ResolvedElement => c.kind === 'element' && c.element.tag === 'body') : undefined;
  const dirOf = (el: ResolvedElement): 'ltr' | 'rtl' => keyword<'ltr' | 'rtl'>(el.element.address, (p) => (el.props.get(p) as ResolvedValue).value, 'direction', ['ltr', 'rtl']);
  const direction = dirOf(body === undefined ? root : body);
  const own = axes(root);
  const bodyAxes = body === undefined ? null : axes(body);
  const fromBody = body !== undefined && bodyAxes !== null && !visible(bodyAxes) && (visible(own) || faults.propagationFromBody);
  // §3.3: visible on the viewport is auto and clip is hidden.
  const used = (v: Overflow): Overflow => (v === 'visible' ? 'auto' : v === 'clip' ? 'hidden' : v);
  if (fromBody && body !== undefined && bodyAxes !== null) return { source: body.element.address, overflowX: used(bodyAxes[0]), overflowY: used(bodyAxes[1]), direction };
  if (!visible(own)) return { source: root.element.address, overflowX: used(own[0]), overflowY: used(own[1]), direction };
  return { source: null, overflowX: 'auto', overflowY: 'auto', direction };
}

// css-align-3 §4.2: first baseline is baseline; last baseline has no layout mapping.
function alignKeyword<T extends string>(id: string, get: Get, p: Longhand, allowed: readonly T[]): T {
  const v = get(p);
  if (v.kind === 'keyword' && v.value === 'first baseline') return 'baseline' as T;
  return keyword(id, get, p, allowed);
}

function lowerStyleFrom(id: string, get: Get, isInitial: IsInitial, faults: CompilerFaults, ua: UaDataset, fonts: { readonly em: number | null; readonly rem: number | null }): LayoutStyle {
  const l: Lowering = { em: fonts.em, rem: fonts.rem, faults };
  const authoredBoxSizing = keyword<BoxSizing>(id, get, 'box-sizing', ['content-box', 'border-box']);
  const boxSizing: BoxSizing = faults.swapBoxSizing ? (authoredBoxSizing === 'content-box' ? 'border-box' : 'content-box') : authoredBoxSizing;
  return {
    display: displayOfStyle(id, get),
    position: keyword<Position>(id, get, 'position', ['static', 'relative', 'absolute']),
    top: inset(id, get, 'top', l),
    right: inset(id, get, 'right', l),
    bottom: inset(id, get, 'bottom', l),
    left: inset(id, get, 'left', l),
    overflowX: keyword<Overflow>(id, get, 'overflow-x', OVERFLOW_VALUES),
    overflowY: keyword<Overflow>(id, get, 'overflow-y', OVERFLOW_VALUES),
    direction: keyword(id, get, 'direction', ['ltr', 'rtl']),
    boxSizing,
    width: size(id, get, 'width', l),
    height: size(id, get, 'height', l),
    minWidth: size(id, get, 'min-width', l),
    minHeight: size(id, get, 'min-height', l),
    maxWidth: maxSize(id, get, 'max-width', l),
    maxHeight: maxSize(id, get, 'max-height', l),
    marginTop: margin(id, get, 'margin-top', l),
    marginRight: margin(id, get, 'margin-right', l),
    marginBottom: margin(id, get, 'margin-bottom', l),
    marginLeft: margin(id, get, 'margin-left', l),
    paddingTop: padding(id, get, 'padding-top', l),
    paddingRight: padding(id, get, 'padding-right', l),
    paddingBottom: padding(id, get, 'padding-bottom', l),
    paddingLeft: padding(id, get, 'padding-left', l),
    borderTopWidth: borderWidth(id, get, isInitial, 'top', ua, l),
    borderRightWidth: borderWidth(id, get, isInitial, 'right', ua, l),
    borderBottomWidth: borderWidth(id, get, isInitial, 'bottom', ua, l),
    borderLeftWidth: borderWidth(id, get, isInitial, 'left', ua, l),
    flexDirection: keyword<FlexDirection>(id, get, 'flex-direction', ['row', 'row-reverse', 'column', 'column-reverse']),
    flexWrap: keyword<FlexWrap>(id, get, 'flex-wrap', ['nowrap', 'wrap', 'wrap-reverse']),
    flexGrow: number(id, get, 'flex-grow'),
    flexShrink: number(id, get, 'flex-shrink'),
    flexBasis: flexBasis(id, get, l),
    order: number(id, get, 'order'),
    justifyContent: keyword<JustifyContent>(id, get, 'justify-content', [
      'normal', 'flex-start', 'flex-end', 'center', 'space-between', 'space-around', 'space-evenly', 'stretch', 'start', 'end', 'left', 'right',
    ]),
    alignItems: alignKeyword<AlignItems>(id, get, 'align-items', ALIGN_ITEMS),
    alignSelf: alignKeyword<AlignSelf>(id, get, 'align-self', ['auto', ...ALIGN_ITEMS]),
    alignContent: alignKeyword<AlignContent>(id, get, 'align-content', [
      'normal', 'stretch', 'flex-start', 'flex-end', 'center', 'space-between', 'space-around', 'space-evenly', 'baseline', 'start', 'end',
    ]),
    rowGap: gap(id, get, 'row-gap', l),
    columnGap: gap(id, get, 'column-gap', l),
    textAlign: keyword<TextAlign>(id, get, 'text-align', ['start', 'end', 'left', 'right', 'center', 'justify']),
    aspectRatio: aspectRatio(id, get),
    // CSS2 §10.8.1: vertical-align is not a Dragon longhand; every box takes its initial value, which only inline boxes read.
    verticalAlign: { kind: 'keyword', value: 'baseline' },
    grid: null,
    gridItem: null,
  };
}

/** Runs a grid lowering step, reporting its refusal as a LoweringError on the element. */
function gridStep<T>(id: string, step: () => T): T {
  try {
    return step();
  } catch (e) {
    if (e instanceof GridLoweringError) throw new LoweringError(id, e.property, `${e.message} (on ${id})`);
    throw e;
  }
}

const AHEM_EXPECTED = 'Ahem (the milestone-1 layout font)';

/** The lowering's font refusal for a text node, or null: the analysis reports it for every case before any lowering (T005 rec 3). */
export function textFontProblem(t: ResolvedText): string | null {
  const family = (t.props.get('font-family') as ResolvedValue).value;
  if (family.kind === 'family' && family.value === 'Ahem') return null;
  return `font-family: ${valueToString(family)} on ${t.node.address} has no layout mapping (expected ${AHEM_EXPECTED})`;
}

/** A font and line-height as the engine reads them (input.ts FontSpec, LineHeightValue), from resolved font-size and line-height. */
function lowerFont(id: string, get: (p: TextLonghand) => CssValue): { readonly font: FontSpec; readonly lineHeight: LineHeightValue } {
  const family = get('font-family');
  if (family.kind !== 'family' || family.value !== 'Ahem') fail(id, 'font-family', family, AHEM_EXPECTED);
  const fs = get('font-size');
  if (fs.kind !== 'length' || fs.unit !== 'px') fail(id, 'font-size', fs, 'px');
  const lh = get('line-height');
  let lineHeight: LineHeightValue;
  if (lh.kind === 'keyword' && lh.value === 'normal') lineHeight = { kind: 'normal' };
  else if (lh.kind === 'number') lineHeight = { kind: 'number', value: lh.value };
  else if (lh.kind === 'length' && lh.unit === 'px') lineHeight = { kind: 'px', value: lh.value };
  else return fail(id, 'line-height', lh, 'normal | <number> | px');
  return { font: { family: 'Ahem', size: fs.value, specifiedSize: { kind: 'px', value: fs.value }, absoluteSize: true }, lineHeight };
}

// goal.md principle 3: the text node carries its inherited text styles, so the lowering reads the text node and never its parent.
function lowerText(t: ResolvedText): TextLeaf {
  const id = t.node.address;
  const get = (p: TextLonghand): CssValue => (t.props.get(p) as ResolvedValue).value;
  const family = get('font-family');
  if (textFontProblem(t) !== null) fail(id, 'font-family', family, AHEM_EXPECTED);
  const { font, lineHeight } = lowerFont(id, get);
  const collapse = get('white-space-collapse');
  if (collapse.kind !== 'keyword' || collapse.value !== 'collapse') fail(id, 'white-space-collapse', collapse, 'collapse');
  const wrap = get('text-wrap-mode');
  if (wrap.kind !== 'keyword' || (wrap.value !== 'wrap' && wrap.value !== 'nowrap')) return fail(id, 'text-wrap-mode', wrap, 'wrap | nowrap');
  return { kind: 'text', id, text: t.text, font, lineHeight, whiteSpaceCollapse: 'collapse', textWrapMode: wrap.value as TextWrapMode };
}

/**
 * CSS2 §10.8.1: the strut of a block container with inline content, its own font and line-height; an anonymous box's are its
 * parent's (inherited). The text leaves inherit the same values, so the strut equals their font until inline boxes change it.
 */
function strutOf(el: ResolvedElement, hasInline: boolean): LineStrut | null {
  if (!hasInline) return null;
  return lowerFont(el.element.address, (p) => (el.props.get(p) as ResolvedValue).value);
}

const displayOf = (el: ResolvedElement): string => {
  const v = (el.props.get('display') as ResolvedValue).value;
  return v.kind === 'keyword' ? v.value : '';
};

/**
 * C5: a text leaf carries its inherited text-align and direction (goal.md principle 3), while the engine reads both from the block
 * container that holds the text (css-text-3 §7.1, css-writing-modes-4 §2.1). Without inline elements they must be equal.
 */
export function assertTextCarriesContainer(container: LayoutStyle, containerId: string, t: ResolvedText): void {
  const align = keywordOf((t.props.get('text-align') as ResolvedValue).value);
  const direction = keywordOf((t.props.get('direction') as ResolvedValue).value);
  if (align !== container.textAlign || direction !== container.direction) {
    throw new Error(`${t.node.address} carries text-align ${align} and direction ${direction}, but its block container ${containerId} has ${container.textAlign} and ${container.direction}`);
  }
}

/** CSS2 §9.2.2: inline-level content: text, and an element whose box is an inline box (display: inline, <br> included). */
// A replaced element (REPL-a) is laid out as its own leaf beside the inline content, never inside a line (atomic inlines are INL2).
const isInlineLevel = (c: ResolvedElement | ResolvedText): boolean => c.kind === 'text' || (displayOf(c) === 'inline' && !isReplacedTag(c.element.tag));

/** propagated is the element whose overflow the viewport took (viewportOverflow), which uses visible. */
type Lowerer = { readonly faults: CompilerFaults; readonly ua: UaDataset; readonly rootFontSize: number | null; readonly images: ImageNaturals; readonly propagated: string | null };

/**
 * One piece of inline content (CSS2 §9.2.2): a text leaf, a <br> as a LineBreak, or an inline box with its own font and
 * line-height (the strut it adds to every line it is on, §10.8.1). A block-level box inside an inline box (block-in-inline) is
 * refused. Text in an inline box is laid out with its block container's text-align and direction, so only the container's text
 * carries them (C5).
 */
function lowerInline(c: ResolvedElement | ResolvedText, l: Lowerer): InlineChild {
  if (c.kind === 'text') return lowerText(c);
  const id = c.element.address;
  const own = lowerFont(id, (p) => (c.props.get(p) as ResolvedValue).value);
  if (c.element.tag === 'br') {
    if (l.faults.brAsSpace) return { kind: 'text', id, text: ' ', font: own.font, lineHeight: own.lineHeight, whiteSpaceCollapse: 'collapse', textWrapMode: 'wrap' };
    return { kind: 'br', id, font: own.font, lineHeight: own.lineHeight };
  }
  const kids = c.children.filter((k) => k.kind === 'text' || displayOf(k) !== 'none');
  const block = kids.find((k) => !isInlineLevel(k));
  if (block !== undefined && block.kind === 'element') {
    throw new LoweringError(block.element.address, 'display', `block-level <${block.element.tag}> ${block.element.address} inside inline box ${id} (CSS2 §9.2.1.1 block-in-inline) is not laid out`);
  }
  return { kind: 'inline', id, style: lowerStyle(c, l.faults, l.ua, l.rootFontSize), font: own.font, lineHeight: own.lineHeight, children: kids.map((k) => lowerInline(k, l)) };
}

// CSS2 §9.2.1.1 and css-flexbox-1 §4: an anonymous box inherits the inherited properties of its enclosing box and takes the
// initial value of every other property; it is block-level (a block container, blockified as a flex item). It holds a maximal run
// of inline-level content: text, inline boxes and <br>s.
function anonymousBox(parent: ResolvedElement, id: string, items: readonly (ResolvedElement | ResolvedText)[], l: Lowerer): LayoutBox {
  // Every length an anonymous box takes is an initial value, never a calculation, so it reads no font size.
  const values = new Map<Longhand, CssValue>();
  for (const p of LONGHANDS) values.set(p, INHERITED.has(p) ? (parent.props.get(p) as ResolvedValue).value : initialValue(p, l.ua));
  values.set('display', { kind: 'keyword', value: 'block' });
  // Every non-inherited property of an anonymous box is its initial value.
  const style = lowerStyleFrom(id, (p) => values.get(p) as CssValue, (p) => !INHERITED.has(p), l.faults, l.ua, { em: null, rem: null });
  for (const t of items) if (t.kind === 'text') assertTextCarriesContainer(style, id, t);
  return { kind: 'box', id, boxType: 'anonymous', style, strut: strutOf(parent, items.length > 0), children: items.map((c) => lowerInline(c, l)) };
}

/**
 * The layout tree of a document. display: none subtrees generate no boxes (CSS2 §9.2.4), so they are omitted wherever they occur
 * (C4) and a display: none root has no layout tree.
 */
export function lowerTree(root: ResolvedElement, faults: CompilerFaults, ua: UaDataset, images: ImageNaturals): LayoutBox {
  if (displayOf(root) === 'none') throw new LoweringError(root.element.address, 'display', `display: none on the root element ${root.element.address} leaves no layout tree`);
  if (isReplacedTag(root.element.tag)) throw new LoweringError(root.element.address, 'display', `the root element ${root.element.address} is a replaced element`);
  if (isControlTag(root.element.tag)) throw new LoweringError(root.element.address, 'display', `the root element ${root.element.address} is a form control`);
  // The engine input's rootFontSize (V2) needs the root's font size in px, so a root whose font-size did not compute to px is refused here.
  const box = lowerBox(root, { faults, ua, rootFontSize: rootFontSizeOf(root), images, propagated: viewportOverflow(root, faults).source }, null);
  if (box.kind !== 'box') throw new LoweringError(root.element.address, 'display', `the root element ${root.element.address} lowered to a control box`);
  return box;
}

const OBJECT_FITS: readonly ObjectFit[] = ['fill', 'contain', 'cover', 'none', 'scale-down'];

/**
 * A replaced element (REPL-a) as a leaf: its box style, natural size, default object size, object-fit and object-position. Its
 * overflow clip (the UA's img and iframe rule) clips only its own content, so the engine takes it as visible; its children are
 * fallback content, which a replaced element never renders.
 */
function lowerReplaced(el: ResolvedElement, faults: CompilerFaults, ua: UaDataset, rootFontSize: number | null, images: ImageNaturals, gridParent: GridContainer | null): ReplacedLeaf {
  const id = el.element.address;
  const raw: Get = (p) => (el.props.get(p) as ResolvedValue).value;
  const get: Get = (p) => {
    const v = raw(p);
    return (p === 'overflow-x' || p === 'overflow-y') && v.kind === 'keyword' && v.value === 'clip' ? { kind: 'keyword', value: 'visible' } : v;
  };
  const own = lowerStyleFrom(id, get, (p) => isInitialByProvenance(el.props.get(p) as ResolvedValue, p), faults, ua, { em: fontPx(raw('font-size')), rem: rootFontSize });
  // css-grid-2 §5: a replaced element establishes no grid container; display: grid on one is not modelled.
  if (own.display === 'grid') throw new LoweringError(id, 'display', `display: grid on the replaced element ${id} is not supported`);
  // css-grid-2 §8: an in-flow replaced child of a grid container is a grid item and carries its placement.
  const gridItem = gridParent !== null && own.position !== 'absolute' ? gridStep(id, () => lowerGridItem(gridParent, raw)) : null;
  const style: LayoutStyle = gridItem === null ? own : { ...own, gridItem };
  let natural: ReplacedLeaf['natural'] = { kind: 'none' };
  if (el.element.tag === 'img') {
    const src = el.element.attributes.get('src');
    const size = src === undefined ? undefined : images.get(src);
    if (size === undefined) throw new LoweringError(id, 'src', `<img> ${id} has no image the build read`);
    natural = { kind: 'image', width: size.width, height: size.height };
  }
  const position = raw('object-position');
  if (position.kind !== 'position') return fail(id, 'object-position', position, '<position>');
  const axis = (o: { readonly unit: 'px' | '%'; readonly value: number }): ObjectPositionValue => (o.unit === 'px' ? { kind: 'px', value: o.value } : { kind: 'percent', value: o.value });
  return {
    kind: 'replaced',
    id,
    style,
    natural,
    defaultWidth: DEFAULT_OBJECT_SIZE.width,
    defaultHeight: DEFAULT_OBJECT_SIZE.height,
    objectFit: keyword<ObjectFit>(id, raw, 'object-fit', OBJECT_FITS),
    objectPositionX: axis(position.x),
    objectPositionY: axis(position.y),
  };
}

/**
 * The layout tree of one resolved element that generates a box. Inline-level content (text, inline boxes, <br>s) beside block-level
 * boxes, or directly in a flex or grid container, is wrapped in anonymous boxes "<element>:anon<k>", one per maximal run; display:
 * none children are omitted, so they never split a run. The engine never creates boxes. A flex or grid item is blockified
 * (css-display-3 §2.7), so an inline-level element in one is lowered as a box, never an inline box.
 */
function lowerBox(el: ResolvedElement, l: Lowerer, gridParent: GridContainer | null): LayoutBox | ControlBox {
  const id = el.element.address;
  const kids = el.children.filter((c) => c.kind === 'text' || displayOf(c) !== 'none');
  const get: Get = (p) => (el.props.get(p) as ResolvedValue).value;
  const lowered = lowerStyle(el, l.faults, l.ua, l.rootFontSize);
  // css-overflow-3 §3.3: the element the viewport took its overflow from uses visible.
  const own: LayoutStyle = id === l.propagated ? { ...lowered, overflowX: 'visible', overflowY: 'visible' } : lowered;
  // css-grid-2 §7 and §8: a grid container carries its tracks; each in-flow child of one carries its placement.
  const grid = own.display === 'grid' ? gridStep(id, () => lowerGridContainer(get)) : null;
  const gridItem = gridParent !== null && own.position !== 'absolute' ? gridStep(id, () => lowerGridItem(gridParent, get)) : null;
  const style: LayoutStyle = grid === null && gridItem === null ? own : { ...own, grid: grid === null ? null : grid.style, gridItem };
  const container = displayOf(el) === 'flex' || displayOf(el) === 'grid';
  const inline = kids.filter(isInlineLevel);
  const wrap = inline.length > 0 && (container || inline.length !== kids.length);
  const children: (LayoutBox | ControlBox | ReplacedLeaf | InlineChild)[] = [];
  let run: (ResolvedElement | ResolvedText)[] = [];
  let anon = 0;
  const flush = (): void => {
    if (run.length > 0) {
      const box = anonymousBox(el, `${id}:anon${anon++}`, run, l);
      children.push(grid === null ? box : { ...box, style: { ...box.style, gridItem: ANONYMOUS_GRID_ITEM } });
    }
    run = [];
  };
  for (const c of kids) {
    if (!isInlineLevel(c)) {
      flush();
      children.push(isReplacedTag((c as ResolvedElement).element.tag) ? lowerReplaced(c as ResolvedElement, l.faults, l.ua, l.rootFontSize, l.images, grid) : lowerBox(c as ResolvedElement, l, grid));
    } else if (wrap) {
      if (l.faults.inlineWrapperPerElement && c.kind === 'element') flush();
      run.push(c);
      if (l.faults.inlineWrapperPerElement && c.kind === 'element') flush();
    }
    else {
      if (c.kind === 'text') assertTextCarriesContainer(style, id, c);
      children.push(lowerInline(c, l));
    }
  }
  flush();
  // A line strut only when the box holds inline content: a replaced leaf is a box of its own, not a line (REPL-a with INL1a).
  const strut = strutOf(el, children.some((c) => c.kind !== 'box' && c.kind !== 'control' && c.kind !== 'replaced'));
  // FORM-a: a block button centres its contents (Blink AlignBlockContent); a flex button is the plain flex container it is.
  if (isControlTag(el.element.tag) && style.display === 'block') return { kind: 'control', id, boxType: 'element', style, control: { kind: 'button-block' }, strut, children };
  return { kind: 'box', id, boxType: 'element', style, strut, children };
}
