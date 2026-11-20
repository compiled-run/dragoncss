// Stage 2 of docs/api.md §4.1 for ios: resolved CSS to Dragon's layout engine input, with every field set explicitly.
import type { ListStyleType } from '../css/counter-styles.ts';
import type {
  ControlBox,
  AlignContent,
  AspectRatioValue,
  AlignItems,
  AlignSelf,
  BorderWidthValue,
  BlockSizeValue,
  BoxSizing,
  Display,
  FlexBasisValue,
  FlexDirection,
  FlexWrap,
  CalcExpr,
  Float,
  FontSpec,
  GapValue,
  InlineChild,
  InlineSizeValue,
  InsetValue,
  JustifyContent,
  LayoutBox,
  LayoutStyle,
  MulticolStyle,
  ObjectFit,
  ObjectPositionValue,
  ReplacedLeaf,
  LengthCalc,
  LineHeightValue,
  LineStrut,
  ListMarker,
  MarginValue,
  Overflow,
  MaxBlockSizeValue,
  MaxInlineSizeValue,
  MaxSizeValue,
  PaddingValue,
  Position,
  SizeValue,
  TextAlign,
  TextIndentValue,
  TextBoxTrim,
  TextOverflow,
  TextWrapStyle,
  TextLeaf,
  TextWrapMode,
  OverflowWrap,
  WordBreak,
  VerticalAlignKeyword,
  VerticalAlignValue,
  WhiteSpaceCollapse,
} from '@dragon/layout';
import type { Longhand, TextLonghand } from '../css/properties.ts';
import { INHERITED, LONGHANDS } from '../css/properties.ts';
import type { CssValue } from '../css/stylesheet.ts';
import { exactLayoutRatio, MATH_VALUE_FUNCTIONS } from '../css/values.ts';
import { FONT_METRIC_LAYOUT_UNITS } from '../css/units.ts';
import type { ResolvedElement, ResolvedText, ResolvedValue } from '../analysis/resolve.ts';
import { initialValue, isInitialByProvenance, valueToString } from '../analysis/resolve.ts';
import { lineClampOf } from '../analysis/line-clamp.ts';
import type { ListItemMarker } from '../analysis/markers.ts';
import { listItemMarkers } from '../analysis/markers.ts';
import { holdsLength, ZOOM_SCALED, zoomChain, zoomProduct } from '../analysis/zoom.ts';
import type { CompilerFaults } from '../faults.ts';
import type { MathFonts } from '../css/math.ts';
import { fontUnitsIn, lowerLengthCalc, lowerMathNode, mathContextFor, mathHasViewport, parseMath } from '../css/math.ts';
import type { UaDataset } from '../ua/datasets.ts';
import { isControlTag } from '../analysis/elements/controls.ts';
import { rangePartOf } from '../analysis/resolve.ts';
import { rangeRatio } from '../forms/range-value.ts';
import { RANGE_NONE_THUMB } from '../forms/ua-shadow.generated.ts';
import { DEFAULT_OBJECT_SIZE, isReplacedTag } from '../analysis/elements/replaced.ts';
import { appliedContainment } from '../analysis/containment.ts';
import { INTRINSIC_AUTO_TYPE } from '../css/properties/containment.ts';
import type { Containment } from '../css/properties/containment.ts';
import { videoLoads } from '../videos/compile.ts';
import type { ImageNaturals } from '../images/compile.ts';
import type { GridContainer } from './grid-layout.ts';
import { ANONYMOUS_GRID_ITEM, GridLoweringError, lowerGridContainer, lowerGridItem, lowerOutOfFlowGridItem } from './grid-layout.ts';
import { isBlockInInline } from '../analysis/block-in-inline.ts';

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

/**
 * CSS2 §9.5 float. inline-start and inline-end take their physical side from the element's own direction: they reach the engine
 * only on flex and grid items, which do not float, since the compiler refuses them in block flow (computed-checks.ts checkFloats).
 */
function floatOf(id: string, get: Get): Float {
  const v = get('float');
  const d = get('direction');
  const rtl = d.kind === 'keyword' && d.value === 'rtl';
  if (v.kind === 'keyword' && v.value === 'inline-start') return rtl ? 'right' : 'left';
  if (v.kind === 'keyword' && v.value === 'inline-end') return rtl ? 'left' : 'right';
  return keyword<Float>(id, get, 'float', ['none', 'left', 'right']);
}

/**
 * What the lowering of one element reads besides its values: its font sizes for em and rem, its primary font (lowerFont, read
 * lazily by an ex, ch or cap length; null where none is lowered), whether it lays out under a zoom, and the compiler faults.
 */
type Lowering = { readonly em: number | null; readonly emSize: CalcExpr | null; readonly rem: number | null; readonly font: (() => FontSpec) | null; readonly zoomed: boolean; readonly faults: CompilerFaults };
type StyleFonts = { readonly em: number | null; readonly emSize?: CalcExpr | null; readonly rem: number | null; readonly font?: () => FontSpec };

const VIEWPORT_AXIS: { readonly [unit: string]: 'width' | 'height' | 'min' | 'max' } = { vw: 'width', vi: 'width', vh: 'height', vb: 'height', vmin: 'min', vmax: 'max' };

/**
 * ZOOM (analysis/zoom.ts): the values of an element under the zooms of its chain. Its lengths stay CSS px at zoom 1, which the
 * engine multiplies by the effective zoom in float as Blink does (layout input.ts LayoutStyle.zoom). Analysis refuses a calculation
 * holding a length in a ZOOM_SCALED longhand on native, so the lowering refuses it too; one of percentages and numbers alone zooms as itself.
 */
function zoomedGet<P extends Longhand>(id: string, get: (p: P) => CssValue, zoom: readonly number[]): (p: P) => CssValue {
  if (zoom.length === 0) return get;
  return (p) => {
    const v = get(p);
    if (ZOOM_SCALED.has(p) && v.kind === 'other' && MATH_VALUE_FUNCTIONS.has(v.type.replace('()', '')) && holdsLength(v)) throw new LoweringError(id, p, `${p}: ${valueToString(v)} on ${id} is a calculation at zoom ${zoomProduct(zoom)}, which native does not zoom yet (ZOOM)`);
    return v;
  };
}

/**
 * A length for the engine (css-values-4 §5-§6, §10): px, a percentage, or a LengthCalc for a viewport unit or a math function,
 * which the engine resolves in its environment (packages/layout/src/environment.ts). Null for any other value.
 */
function lengthPercentage(id: string, get: Get, p: Longhand, range: LengthCalc['range'], l: Lowering): Px | Percent | LengthCalc | null {
  const v = get(p);
  if (v.kind === 'length' && v.unit === 'px') return { kind: 'px', value: v.value };
  if (v.kind === 'percentage') return { kind: 'percent', value: v.value };
  if (v.kind === 'length' && VIEWPORT_AXIS[v.unit] !== undefined) return { kind: 'calc', expr: { kind: 'viewport', value: v.value, axis: VIEWPORT_AXIS[v.unit] as 'width', size: 'large' }, range };
  // CALC-2: an em under a font size that follows the viewport stays an em leaf over that size, which the engine resolves.
  if (v.kind === 'length' && v.unit === 'em' && l.emSize !== null) return { kind: 'calc', expr: { kind: 'em', value: v.value, fontSize: l.emSize }, range };
  // css-values-4 §6.1.1: ex, ch and cap read the element's own primary font, which the engine measures at the device's zoom
  // (environment.ts fontMetricPxAt). The parse admits them only in non-inherited layout lengths (css/units.ts unitRefusalIn).
  if (v.kind === 'length' && FONT_METRIC_LAYOUT_UNITS.has(v.unit)) {
    if (l.font === null) return fail(id, p, v, 'an ex, ch or cap length only on an element whose font is lowered');
    // Under zoom Chrome scales the font the metric is read from; native zooms no font-metric length yet (ZOOM).
    if (l.zoomed) return fail(id, p, v, 'an ex, ch or cap length at zoom 1');
    const font = l.font();
    // Only Ahem's metrics at a px size are proven against Chrome (fixture font-units-ahem); a real face or a size that follows
    // the viewport is refused natively until a Chrome case proves it.
    if (font.family !== AHEM_FACE || font.specifiedSize.kind !== 'px') return fail(id, p, v, 'an ex, ch or cap length over Ahem at a px font size');
    if (l.faults.fontMetricAsEm) return { kind: 'calc', expr: { kind: 'em', value: v.value, fontSize: font.specifiedSize }, range };
    return { kind: 'calc', expr: { kind: 'font-metric', value: v.value, metric: v.unit as 'ex' | 'ch' | 'cap', font }, range };
  }
  if (v.kind !== 'other' || !MATH_VALUE_FUNCTIONS.has(v.type.replace('()', ''))) return null;
  const context = mathContextFor(p);
  const parsed = 'refused' in context ? null : parseMath(v.text, context);
  if (parsed === null || !parsed.ok) return fail(id, p, v, `a calculation V1 supports${parsed === null ? '' : ` (${parsed.reason})`}`);
  const needs = fontUnitsIn(parsed.node);
  if ((needs.em && l.em === null && l.emSize === null) || (needs.rem && l.rem === null)) return fail(id, p, v, 'em and rem in a calculation on an element whose font sizes are px');
  const fonts: MathFonts = { em: l.em === null ? 0 : l.em, rem: l.rem === null ? 0 : l.rem, ...(l.emSize === null ? {} : { emSize: l.emSize }) };
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

// css-sizing-3 §3.2 and css-sizing-4 §3.1: width, min-width and max-width also take min-content, max-content, fit-content and
// stretch; the engine reads them on a block-level box in block flow and refuses them elsewhere.
const INTRINSIC_SIZE_KEYWORDS = ['min-content', 'max-content', 'fit-content', 'stretch'] as const;

function inlineSize(id: string, get: Get, p: Longhand, l: Lowering): InlineSizeValue {
  const v = get(p);
  if (v.kind === 'keyword' && (INTRINSIC_SIZE_KEYWORDS as readonly string[]).includes(v.value)) return { kind: v.value as (typeof INTRINSIC_SIZE_KEYWORDS)[number] };
  return size(id, get, p, l);
}

function maxInlineSize(id: string, get: Get, p: Longhand, l: Lowering): MaxInlineSizeValue {
  const v = get(p);
  if (v.kind === 'keyword' && (INTRINSIC_SIZE_KEYWORDS as readonly string[]).includes(v.value)) return { kind: v.value as (typeof INTRINSIC_SIZE_KEYWORDS)[number] };
  return maxSize(id, get, p, l);
}

// css-sizing-4 §3.1: height, min-height and max-height also take stretch; the engine reads it on a block-level box in block flow
// and refuses it elsewhere.
function blockSize(id: string, get: Get, p: Longhand, l: Lowering): BlockSizeValue {
  const v = get(p);
  if (v.kind === 'keyword' && v.value === 'stretch') return { kind: 'stretch' };
  return size(id, get, p, l);
}

function maxBlockSize(id: string, get: Get, p: Longhand, l: Lowering): MaxBlockSizeValue {
  const v = get(p);
  if (v.kind === 'keyword' && v.value === 'stretch') return { kind: 'stretch' };
  return maxSize(id, get, p, l);
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
  // ZOOM: an authored keyword width is CSS px, which the engine zooms; the initial medium above is device px, which it does not.
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

/**
 * css-multicol-1 §3: a block whose column-width is a px length or whose column-count is a number is a multi-column container
 * (analysis/multicol.ts refuses the ones the engine does not lay out, and every other spelling); column-count auto is 0.
 */
function multicolOf(get: Get): MulticolStyle | null {
  const width = get('column-width');
  const count = get('column-count');
  if (keywordOf(get('display')) !== 'block' || (width.kind !== 'length' && count.kind !== 'number')) return null;
  return {
    count: count.kind === 'number' ? count.value : 0,
    width: width.kind === 'length' && width.unit === 'px' ? { kind: 'px', value: width.value } : { kind: 'auto' },
  };
}

// css-text-3 §8.1: text-indent is a length, a percentage of the line's available width or a calculation, negative allowed.
function textIndent(id: string, get: Get, l: Lowering): TextIndentValue {
  const lp = lengthPercentage(id, get, 'text-indent', 'all', l);
  return lp === null ? fail(id, 'text-indent', get('text-indent'), 'px | % | a viewport length | a calculation') : lp;
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
 * CALC-2: a computed font-size that follows the large viewport (a vw, vh, vi, vb, vmin or vmax length, or a calculation reading one
 * whose em, rem and % analysis/computed.ts made px) as the engine's specified size expression, which it resolves on the device
 * (input.ts FontSpec.specifiedSize). Null for any other value.
 */
export function viewportFontSize(v: CssValue): CalcExpr | null {
  if (v.kind === 'length' && VIEWPORT_AXIS[v.unit] !== undefined) return { kind: 'viewport', value: v.value, axis: VIEWPORT_AXIS[v.unit] as 'width', size: 'large' };
  if (v.kind !== 'other' || !MATH_VALUE_FUNCTIONS.has(v.type.replace('()', ''))) return null;
  const context = mathContextFor('font-size');
  const parsed = 'refused' in context ? null : parseMath(v.text, context);
  if (parsed === null || !parsed.ok || !mathHasViewport(parsed.node)) return null;
  const units = fontUnitsIn(parsed.node);
  if (units.em || units.rem) return null;
  return lowerMathNode(parsed.node, { em: 0, rem: 0 });
}

/**
 * CALC-2: a line-height under a font size that follows the viewport: a percentage of the computed size, an em leaf over its
 * expression, or a calculation over both, which the engine resolves against the computed size (environment.ts
 * resolveLineHeightValue).
 */
function followingLineHeight(id: string, lh: CssValue, size: CalcExpr): LineHeightValue {
  if (lh.kind === 'percentage') return { kind: 'percent', value: lh.value };
  if (lh.kind === 'length' && lh.unit === 'em') return { kind: 'calc', expr: { kind: 'em', value: lh.value, fontSize: size }, range: 'non-negative' };
  const context = mathContextFor('line-height');
  const parsed = lh.kind === 'other' && MATH_VALUE_FUNCTIONS.has(lh.type.replace('()', '')) && !('refused' in context) ? parseMath(lh.text, context) : null;
  if (parsed === null || !parsed.ok || fontUnitsIn(parsed.node).rem) return fail(id, 'line-height', lh, 'normal | <number> | px | % | em | a calculation of them');
  return { kind: 'calc', expr: lowerMathNode(parsed.node, { em: 0, rem: 0, emSize: size }), range: 'non-negative' };
}

/**
 * CALC-2: why lowerFont cannot lower a computed font-size and line-height on the device, or null when it can. A size Chrome takes
 * of a parent that follows the viewport (em, % or a calculation of them) and a line-height whose em or % an ancestor computed
 * against such a size stay relative here, which the engine does not resolve yet. inheritedOverOwnSize: the line-height is inherited
 * while the font-size is the element's own.
 */
export function fontLoweringGap(fs: CssValue, lh: CssValue, inheritedOverOwnSize: boolean): { readonly property: 'font-size' | 'line-height'; readonly reason: string } | null {
  const follows = viewportFontSize(fs);
  if ((fs.kind !== 'length' || fs.unit !== 'px') && follows === null) return { property: 'font-size', reason: 'it is taken of a parent font-size that follows the viewport' };
  if ((lh.kind === 'keyword' && lh.value === 'normal') || lh.kind === 'number' || (lh.kind === 'length' && lh.unit === 'px')) return null;
  // Chrome computes an em or % line-height to px where it is declared, so a child with its own font size inherits that px.
  if (follows === null || inheritedOverOwnSize) return { property: 'line-height', reason: 'it inherits an em or % an ancestor took of a font-size that follows the viewport' };
  if (lh.kind === 'percentage' || (lh.kind === 'length' && lh.unit === 'em')) return null;
  const context = mathContextFor('line-height');
  const parsed = lh.kind === 'other' && MATH_VALUE_FUNCTIONS.has(lh.type.replace('()', '')) && !('refused' in context) ? parseMath(lh.text, context) : null;
  return parsed !== null && parsed.ok && !fontUnitsIn(parsed.node).rem ? null : { property: 'line-height', reason: 'a rem in it under a font-size that follows the viewport' };
}

/** An element's em: its px font size, or the expression of one that follows the viewport (viewportFontSize). */
function emOf(v: CssValue): { readonly em: number | null; readonly emSize: CalcExpr | null } {
  return { em: fontPx(v), emSize: viewportFontSize(v) };
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

/**
 * Where last baseline self-alignment lays out (GRID G3b): align-items on a grid container, align-self on a child of one. Everywhere
 * else (a flex container or item, a block) it stays refused.
 */
export type LastBaselineContext = { readonly items: boolean; readonly self: boolean };
const NO_LAST_BASELINE: LastBaselineContext = { items: false, self: false };

/** zoom is el's zoom chain (analysis/zoom.ts zoomChain). */
export function lowerStyle(el: ResolvedElement, faults: CompilerFaults, ua: UaDataset, rootFontSize: number | null = null, lastBaseline: LastBaselineContext = NO_LAST_BASELINE, zoom: readonly number[] = [], mode: LowerMode | null = null): LayoutStyle {
  const id = el.element.address;
  const get: Get = (p) => (el.props.get(p) as ResolvedValue).value;
  const fonts: StyleFonts = { ...emOf(get('font-size')), rem: rootFontSize, ...(mode === null ? {} : { font: () => lowerFont(id, get, mode).font }) };
  return lowerStyleFrom(id, zoomedGet(id, get, zoom), (p) => isInitialByProvenance(el.props.get(p) as ResolvedValue, p), faults, ua, fonts, lastBaseline, lineClampOf(el), zoom, appliedContainment(el));
}

const keywordOf = (v: CssValue): string => (v.kind === 'keyword' ? v.value : '');

const NO_CONTAINMENT: Containment = { size: 'none', layout: false, style: false, paint: false };

// css-lists-3 §3: a list item without a marker is a block (Blink LayoutListItem is a LayoutBlockFlow); computed-checks.ts refuses the rest.
function displayOfStyle(id: string, get: Get, lineClamp: number): Display {
  const v = get('display');
  if (v.kind === 'keyword' && v.value === 'list-item') return 'block';
  // TXT2-g: a line-clamp container computes to flow-root; with overflow: hidden (analysis/line-clamp.ts) it lays out as a block.
  if (lineClamp > 0) return 'block';
  return keyword<Display>(id, get, 'display', ['block', 'flex', 'grid', 'inline', 'inline-block', 'inline-flex', 'inline-grid']);
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

const VERTICAL_ALIGN_KEYWORDS: readonly VerticalAlignKeyword[] = ['baseline', 'sub', 'super', 'text-top', 'text-bottom', 'middle', 'top', 'bottom'];

// CSS2 §10.8.1: only inline-level boxes read vertical-align, so every other box takes baseline, whatever it computes to.
function verticalAlign(id: string, get: Get, l: Lowering): VerticalAlignValue {
  const display = keywordOf(get('display'));
  if (display !== 'inline' && display !== 'inline-block' && display !== 'inline-flex' && display !== 'inline-grid') return { kind: 'keyword', value: 'baseline' };
  const v = get('vertical-align');
  if (v.kind === 'keyword') return { kind: 'keyword', value: keyword(id, get, 'vertical-align', VERTICAL_ALIGN_KEYWORDS) };
  const lp = lengthPercentage(id, get, 'vertical-align', 'all', l);
  return lp === null ? fail(id, 'vertical-align', v, `${VERTICAL_ALIGN_KEYWORDS.join(' | ')} | px | % | a viewport length | a calculation`) : lp;
}

// css-align-3 §4.2: first baseline is baseline; last baseline has a layout mapping only where lastBaseline allows it (grid).
function alignKeyword<T extends string>(id: string, get: Get, p: Longhand, allowed: readonly T[], lastBaseline: boolean): T {
  const v = get(p);
  if (v.kind === 'keyword' && v.value === 'first baseline') return 'baseline' as T;
  if (v.kind === 'keyword' && v.value === 'last baseline') {
    if (lastBaseline) return 'last baseline' as T;
    return fail(id, p, v, `${allowed.join(' | ')}; last baseline aligns grid items only`);
  }
  return keyword(id, get, p, allowed);
}

/**
 * contain-intrinsic-width or -height as the engine reads it (LayoutStyle containIntrinsicWidth, containIntrinsicHeight): a px
 * length, or none for none and auto none. auto with a px fallback lowers to its fallback, which is the size only while no size has
 * been remembered: analysis/contain-intrinsic.ts refuses auto on a box size containment applies to, so it reaches the engine only
 * where the engine does not read it. Planted fault intrinsicSizeDropped lowers every value as none.
 */
function intrinsicSize(id: string, get: Get, p: 'contain-intrinsic-width' | 'contain-intrinsic-height', faults: CompilerFaults): Px | { readonly kind: 'none' } {
  const v = get(p);
  if (faults.intrinsicSizeDropped || (v.kind === 'keyword' && v.value === 'none')) return { kind: 'none' };
  if (v.kind === 'length' && v.unit === 'px') return { kind: 'px', value: v.value };
  if (v.kind === 'other' && v.type === INTRINSIC_AUTO_TYPE) {
    const fallback = /^auto (\S+)px$/.exec(v.text);
    if (v.text === 'auto none') return { kind: 'none' };
    if (fallback !== null) return { kind: 'px', value: Number(fallback[1]) };
  }
  return fail(id, p, v, 'none | px | auto none | auto px');
}

// css-conditional-5 §2.1: container-type: inline-size gives the box inline-size containment and an independent formatting context;
// analysis/scroll-containment.ts refuses every other value but normal, and inline-size on an inline box or a replaced element.
function containInlineSize(id: string, get: Get): boolean {
  const v = get('container-type');
  if (v.kind === 'keyword' && (v.value === 'normal' || v.value === 'inline-size')) return v.value === 'inline-size';
  return fail(id, 'container-type', v, 'normal | inline-size');
}

/**
 * lineClamp: N for a line-clamp container, decided in analysis from the specified display (analysis/line-clamp.ts lineClampOf), else
 * 0; an anonymous box and a replaced element never clamp.
 */
function lowerStyleFrom(id: string, get: Get, isInitial: IsInitial, faults: CompilerFaults, ua: UaDataset, fonts: StyleFonts, lastBaseline: LastBaselineContext = NO_LAST_BASELINE, lineClamp = 0, zoom: readonly number[] = [], containment: Containment = NO_CONTAINMENT): LayoutStyle {
  const l: Lowering = { em: fonts.em, emSize: fonts.emSize ?? null, rem: fonts.rem, font: fonts.font ?? null, zoomed: zoom.length > 0, faults };
  // css-contain-2 §3.4: paint containment clips the contents to the padding box as overflow: clip does, on an axis that does not already clip.
  const overflow = (p: 'overflow-x' | 'overflow-y'): Overflow => {
    const v = keyword<Overflow>(id, get, p, OVERFLOW_VALUES);
    return containment.paint && v === 'visible' ? 'clip' : v;
  };
  const authoredBoxSizing = keyword<BoxSizing>(id, get, 'box-sizing', ['content-box', 'border-box']);
  const boxSizing: BoxSizing = faults.swapBoxSizing ? (authoredBoxSizing === 'content-box' ? 'border-box' : 'content-box') : authoredBoxSizing;
  const display = displayOfStyle(id, get, lineClamp);
  return {
    display,
    position: keyword<Position>(id, get, 'position', ['static', 'relative', 'absolute', 'fixed', 'sticky']),
    float: floatOf(id, get),
    top: inset(id, get, 'top', l),
    right: inset(id, get, 'right', l),
    bottom: inset(id, get, 'bottom', l),
    left: inset(id, get, 'left', l),
    overflowX: overflow('overflow-x'),
    overflowY: overflow('overflow-y'),
    direction: keyword(id, get, 'direction', ['ltr', 'rtl']),
    boxSizing,
    width: inlineSize(id, get, 'width', l),
    height: blockSize(id, get, 'height', l),
    minWidth: inlineSize(id, get, 'min-width', l),
    minHeight: blockSize(id, get, 'min-height', l),
    maxWidth: maxInlineSize(id, get, 'max-width', l),
    maxHeight: maxBlockSize(id, get, 'max-height', l),
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
    alignItems: alignKeyword<AlignItems>(id, get, 'align-items', ALIGN_ITEMS, lastBaseline.items),
    alignSelf: alignKeyword<AlignSelf>(id, get, 'align-self', ['auto', ...ALIGN_ITEMS], lastBaseline.self),
    alignContent: alignKeyword<AlignContent>(id, get, 'align-content', [
      'normal', 'stretch', 'flex-start', 'flex-end', 'center', 'space-between', 'space-around', 'space-evenly', 'baseline', 'start', 'end',
    ], false),
    rowGap: gap(id, get, 'row-gap', l),
    columnGap: gap(id, get, 'column-gap', l),
    textAlign: keyword<TextAlign>(id, get, 'text-align', ['start', 'end', 'left', 'right', 'center', 'justify']),
    aspectRatio: aspectRatio(id, get),
    verticalAlign: verticalAlign(id, get, l),
    textOverflow: keyword<TextOverflow>(id, get, 'text-overflow', ['clip', 'ellipsis']),
    textIndent: textIndent(id, get, l),
    lineClamp,
    containLayout: containment.layout,
    containPaint: containment.paint,
    // container-type: inline-size is inline-size containment too; contain: size covers both axes already.
    containSize: containment.size !== 'none' ? containment.size : containInlineSize(id, get) ? 'inline-size' : 'none',
    // css-sizing-4 §5.2: the content size a size-contained box takes (analysis/contain-intrinsic.ts refuses auto where it applies).
    containIntrinsicWidth: intrinsicSize(id, get, 'contain-intrinsic-width', faults),
    containIntrinsicHeight: intrinsicSize(id, get, 'contain-intrinsic-height', faults),
    textWrapStyle: textWrapStyle(id, get),
    multicol: multicolOf(get),
    textBoxTrim: textBoxTrim(get, display),
    grid: null,
    gridItem: null,
    zoom,
  };
}

// css-text-4 §5.1: stable lays out as auto; balance and pretty are the engine's passes at zoom 1, which the environment pass zooms
// (computed-checks.ts checkTextWrapStyle refuses the contexts they are not proven in).
function textWrapStyle(id: string, get: Get): TextWrapStyle {
  const k = keyword<'auto' | 'stable' | 'balance' | 'pretty'>(id, get, 'text-wrap-style', ['auto', 'stable', 'balance', 'pretty']);
  if (k === 'balance') return { kind: 'balance', zoom: 1 };
  if (k === 'pretty') return { kind: 'pretty', zoom: 1 };
  return { kind: 'auto' };
}

/**
 * css-inline-3 §5.1-§5.2: text-box-trim on a block, with the under edge of its text-box-edge (alphabetic or text); null for none and
 * off a block (analysis/text-box.ts refuses text-box-trim where the engine does not trim: other displays, cap and ex edges, ...).
 */
function textBoxTrim(get: Get, display: Display): TextBoxTrim | null {
  const trim = keywordOf(get('text-box-trim'));
  if (display !== 'block' || (trim !== 'trim-start' && trim !== 'trim-end' && trim !== 'trim-both')) return null;
  return { start: trim !== 'trim-end', end: trim !== 'trim-start', alphabetic: keywordOf(get('text-box-edge')).endsWith(' alphabetic') };
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

/** The face id of the bundled Ahem, as the engine names it (layout text.ts AHEM_FACE_ID); other faces are sha256:<hex>. */
export const AHEM_FACE = 'Ahem';

/** The lowering's font refusal for a text node, or null: the analysis reports it for every case before any lowering (T005 rec 3). */
export function textFontProblem(t: ResolvedText): string | null {
  const family = (t.props.get('font-family') as ResolvedValue).value;
  if (family.kind === 'family' && family.value === 'Ahem') return null;
  return `font-family: ${valueToString(family)} on ${t.node.address} has no layout mapping (expected ${AHEM_EXPECTED})`;
}

/**
 * TXT1a-1 engine mode: the bundled face an element's or text node's font resolves to (the face id the engine and its hosts key faces
 * by: sha256:<hex> of the bytes), or why the engine cannot lay it out (fallback, synthesis, a variable face).
 */
export type EngineFace = { readonly kind: 'face'; readonly id: string } | { readonly kind: 'refused'; readonly reason: string };

/**
 * The lowering mode: native targets lay out Ahem and the real bundled faces the compiler resolved (TXT1a-2, faceOf refuses every
 * other node); the engine lane also lays out the bundled static faces it resolves.
 */
export type LowerMode = { readonly kind: 'native' | 'engine'; readonly faceOf: (address: string) => EngineFace };

/** The face family the engine reads: Ahem, or in engine mode the resolved bundled face; anything else is a lowering failure. */
function lowerFamily(id: string, family: CssValue, mode: LowerMode): string {
  if (family.kind === 'family' && family.value === 'Ahem') return AHEM_FACE;
  const face = mode.faceOf(id);
  if (mode.kind === 'native' && face.kind === 'refused') return fail(id, 'font-family', family, AHEM_EXPECTED);
  if (face.kind === 'refused') throw new LoweringError(id, 'font-family', `font-family: ${valueToString(family)} on ${id}: ${face.reason}`);
  return face.id;
}

/** A font and line-height as the engine reads them (input.ts FontSpec, LineHeightValue), from resolved font-size and line-height. */
function lowerFont(id: string, get: (p: TextLonghand) => CssValue, mode: LowerMode): { readonly font: FontSpec; readonly lineHeight: LineHeightValue } {
  const face = lowerFamily(id, get('font-family'), mode);
  const fs = get('font-size');
  const follows = viewportFontSize(fs);
  if ((fs.kind !== 'length' || fs.unit !== 'px') && follows === null) fail(id, 'font-size', fs, 'px | a large viewport length | a calculation reading one');
  const lh = get('line-height');
  let lineHeight: LineHeightValue;
  if (lh.kind === 'keyword' && lh.value === 'normal') lineHeight = { kind: 'normal' };
  else if (lh.kind === 'number') lineHeight = { kind: 'number', value: lh.value };
  else if (lh.kind === 'length' && lh.unit === 'px') lineHeight = { kind: 'px', value: lh.value };
  else if (follows !== null) lineHeight = followingLineHeight(id, lh, follows);
  else return fail(id, 'line-height', lh, 'normal | <number> | px');
  // A size that follows the viewport is absolute (ConvertFontSize: no em or percentage remains), and the engine resolves it; size
  // is its placeholder until then (layout environment.ts resolveText).
  if (follows !== null) return { font: { family: face, size: 0, specifiedSize: follows, absoluteSize: true }, lineHeight };
  return { font: { family: face, size: (fs as { readonly value: number }).value, specifiedSize: { kind: 'px', value: (fs as { readonly value: number }).value }, absoluteSize: true }, lineHeight };
}

/** The white-space-collapse values the engine lays out (input.ts WhiteSpaceCollapse). */
const WHITE_SPACE_COLLAPSE: readonly string[] = ['collapse', 'preserve', 'preserve-breaks', 'break-spaces'] satisfies readonly WhiteSpaceCollapse[];

// goal.md principle 3: the text node carries its inherited text styles, so the lowering reads the text node and never its parent.
function lowerText(t: ResolvedText, mode: LowerMode, zoom: readonly number[]): TextLeaf {
  const id = t.node.address;
  const get = zoomedGet(id, (p: TextLonghand): CssValue => (t.props.get(p) as ResolvedValue).value, zoom);
  const { font, lineHeight } = lowerFont(id, get, mode);
  const collapse = get('white-space-collapse');
  if (collapse.kind !== 'keyword' || !WHITE_SPACE_COLLAPSE.includes(collapse.value)) return fail(id, 'white-space-collapse', collapse, WHITE_SPACE_COLLAPSE.join(' | '));
  const wrap = get('text-wrap-mode');
  if (wrap.kind !== 'keyword' || (wrap.value !== 'wrap' && wrap.value !== 'nowrap')) return fail(id, 'text-wrap-mode', wrap, 'wrap | nowrap');
  const overflowWrap = get('overflow-wrap');
  if (overflowWrap.kind !== 'keyword' || !OVERFLOW_WRAP.includes(overflowWrap.value)) return fail(id, 'overflow-wrap', overflowWrap, OVERFLOW_WRAP.join(' | '));
  const wordBreak = get('word-break');
  if (wordBreak.kind !== 'keyword' || !WORD_BREAK.includes(wordBreak.value)) return fail(id, 'word-break', wordBreak, WORD_BREAK.join(' | '));
  return {
    kind: 'text', id, text: t.text, font, lineHeight, whiteSpaceCollapse: collapse.value as WhiteSpaceCollapse, textWrapMode: wrap.value as TextWrapMode, letterSpacing: lowerSpacing(id, 'letter-spacing', get('letter-spacing')), wordSpacing: lowerSpacing(id, 'word-spacing', get('word-spacing')),
    overflowWrap: overflowWrap.value as OverflowWrap, wordBreak: wordBreak.value as WordBreak, smallCaps: t.smallCaps,
  };
}

/** The overflow-wrap and word-break values the engine reads (input.ts OverflowWrap, WordBreak); it refuses auto-phrase, and break-all over anything but ASCII letters, digits and spaces (TXT2-d). */
const OVERFLOW_WRAP: readonly string[] = ['normal', 'break-word', 'anywhere'] satisfies readonly OverflowWrap[];
const WORD_BREAK: readonly string[] = ['normal', 'break-all', 'keep-all', 'break-word', 'auto-phrase'] satisfies readonly WordBreak[];

/** css-text-3 §8.1 and §8.2: a computed word-spacing or letter-spacing as the engine reads it, px (normal is 0); a percentage or calculation is not lowered yet. */
function lowerSpacing(id: string, property: 'letter-spacing' | 'word-spacing', v: CssValue): Px {
  if (v.kind === 'keyword' && v.value === 'normal') return { kind: 'px', value: 0 };
  if (v.kind === 'length' && v.unit === 'px') return { kind: 'px', value: v.value };
  return fail(id, property, v, 'normal | px');
}

/**
 * CSS2 §10.8.1: the strut of a block container with inline content, its own font and line-height; an anonymous box's are its
 * parent's (inherited). The text leaves inherit the same values, so the strut equals their font until inline boxes change it.
 */
function strutOf(el: ResolvedElement, hasInline: boolean, mode: LowerMode, zoom: readonly number[]): LineStrut | null {
  if (!hasInline) return null;
  return lowerFont(el.element.address, zoomedGet(el.element.address, (p: TextLonghand) => (el.props.get(p) as ResolvedValue).value, zoom), mode);
}

const displayOf = (el: ResolvedElement): string => {
  const v = (el.props.get('display') as ResolvedValue).value;
  return v.kind === 'keyword' ? v.value : '';
};

/**
 * css-display-3 §2.5: the children that generate boxes in el's box. display: none ones generate none, and a display: contents
 * element is replaced by its own children (it still passes on its inherited values, which resolve.ts has applied).
 */
function boxChildren(el: ResolvedElement): (ResolvedElement | ResolvedText)[] {
  return el.children.flatMap((c): (ResolvedElement | ResolvedText)[] => {
    if (c.kind === 'text') return [c];
    const d = displayOf(c);
    if (d === 'none') return [];
    if (d !== 'contents') return [c];
    // css-display-3 §2.7 (Appendix B): a replaced element with display: contents computes to none in Chrome; Dragon refuses it.
    if (isReplacedTag(c.element.tag)) throw new LoweringError(c.element.address, 'display', `display: contents on the replaced element ${c.element.address} is not supported`);
    return boxChildren(c);
  });
}

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

/**
 * CSS2 §9.2.4: an atomic inline among inline content: an inline-block, inline-flex or inline-grid box (INL2a, G-INL), or an
 * inline-level replaced element (RF-INL; css-display-3 §2.4: display inline on a replaced element makes it atomic).
 */
const isAtomic = (c: ResolvedElement | ResolvedText): boolean => {
  if (c.kind !== 'element') return false;
  const d = displayOf(c);
  if (isReplacedTag(c.element.tag)) return d === 'inline' || d === 'inline-block' || d === 'inline-flex';
  return d === 'inline-block' || d === 'inline-flex' || d === 'inline-grid';
};

/** CSS2 §9.2.2: inline-level content: text, an element whose box is an inline box (display: inline, <br> included), or an atomic inline. */
const isInlineLevel = (c: ResolvedElement | ResolvedText): boolean => c.kind === 'text' || (displayOf(c) === 'inline' && !isReplacedTag(c.element.tag)) || isAtomic(c);

/**
 * propagated is the element whose overflow the viewport took (viewportOverflow), which uses visible. zoom is the zoom chain of the
 * element whose content is being lowered: the one its text and anonymous boxes take, and the parent chain of its children.
 */
type Lowerer = { readonly faults: CompilerFaults; readonly ua: UaDataset; readonly rootFontSize: number | null; readonly images: ImageNaturals; readonly mode: LowerMode; readonly propagated: string | null; readonly markers: ReadonlyMap<string, ListItemMarker>; readonly zoom: readonly number[] };

/**
 * One piece of inline content (CSS2 §9.2.2): a text leaf, a <br> as a LineBreak, or an inline box with its own font and
 * line-height (the strut it adds to every line it is on, §10.8.1). A block-level box inside an inline box (block-in-inline) is
 * refused. Text in an inline box is laid out with its block container's text-align and direction, so only the container's text
 * carries them (C5).
 */
function lowerInline(c: ResolvedElement | ResolvedText, l: Lowerer): InlineChild {
  if (c.kind === 'text') return lowerText(c, l.mode, l.zoom);
  const id = c.element.address;
  const zoom = zoomChain(c, l.zoom);
  const own = lowerFont(id, zoomedGet(id, (p: TextLonghand) => (c.props.get(p) as ResolvedValue).value, zoom), l.mode);
  if (c.element.tag === 'br') {
    if (l.faults.brAsSpace) return { kind: 'text', id, text: ' ', font: own.font, lineHeight: own.lineHeight, whiteSpaceCollapse: 'collapse', textWrapMode: 'wrap', letterSpacing: { kind: 'px', value: 0 }, wordSpacing: { kind: 'px', value: 0 }, overflowWrap: 'normal', wordBreak: 'normal', smallCaps: false };
    return { kind: 'br', id, font: own.font, lineHeight: own.lineHeight };
  }
  const kids = boxChildren(c);
  const block = kids.find((k) => !isInlineLevel(k) || isAtomic(k));
  if (block !== undefined && block.kind === 'element') {
    if (isAtomic(block)) throw new LoweringError(block.element.address, 'display', `atomic inline <${block.element.tag}> ${block.element.address} inside inline box ${id} is not laid out (INL2c)`);
    throw new LoweringError(block.element.address, 'display', `block-level <${block.element.tag}> ${block.element.address} inside inline box ${id} (CSS2 §9.2.1.1 block-in-inline) is not laid out`);
  }
  // An inline box is never a grid item (a grid blockifies its children, analysis/blockify.ts), so last baseline stays refused on it.
  const inner: Lowerer = { ...l, zoom };
  return { kind: 'inline', id, style: lowerStyle(c, l.faults, l.ua, l.rootFontSize, NO_LAST_BASELINE, zoom, l.mode), font: own.font, lineHeight: own.lineHeight, children: kids.map((k) => lowerInline(k, inner)) };
}

/**
 * A block container's inline-level child: an atomic inline is a box (INL2a), a replaced leaf or an inline-block button (RF-INL)
 * among its inline content, the rest lowerInline.
 */
function lowerInlineLevel(c: ResolvedElement | ResolvedText, l: Lowerer): LayoutBox | ControlBox | ReplacedLeaf | InlineChild {
  if (!isAtomic(c)) return lowerInline(c, l);
  const el = c as ResolvedElement;
  if (isReplacedTag(el.element.tag)) return lowerReplaced(el, l.faults, l.ua, l.rootFontSize, l.images, null, l.zoom, l.mode);
  const box = lowerBox(el, l, null);
  // Of the controls, only an inline-block button is laid out inline (RF-INL); analysis/computed-checks.ts refuses the others.
  if (box.kind === 'control' && !(box.control.kind === 'button-block' && box.style.display === 'inline-block')) throw new LoweringError(box.id, 'display', `the inline-level control ${box.id} is not laid out (RF-INL)`);
  return box;
}

// CSS2 §9.2.1.1 and css-flexbox-1 §4: an anonymous box inherits the inherited properties of its enclosing box and takes the
// initial value of every other property; it is block-level (a block container, blockified as a flex item). It holds a maximal run
// of inline-level content: text, inline boxes and <br>s.
function anonymousBox(parent: ResolvedElement, id: string, items: readonly (ResolvedElement | ResolvedText)[], l: Lowerer): LayoutBox {
  // Every length an anonymous box takes is an initial value, never a calculation, so it reads no font size.
  const values = new Map<Longhand, CssValue>();
  for (const p of LONGHANDS) values.set(p, INHERITED.has(p) ? (parent.props.get(p) as ResolvedValue).value : initialValue(p, l.ua));
  values.set('display', { kind: 'keyword', value: 'block' });
  // Every non-inherited property of an anonymous box is its initial value; in a grid it is a grid item (align-self: auto).
  const parentDisplay = displayOf(parent);
  const lastBaseline: LastBaselineContext = { items: false, self: parentDisplay === 'grid' || parentDisplay === 'inline-grid' };
  // Its effective zoom is its parent's (l.zoom), which its inherited text-indent takes.
  const style = lowerStyleFrom(id, zoomedGet(id, (p) => values.get(p) as CssValue, l.zoom), (p) => !INHERITED.has(p), l.faults, l.ua, { em: null, rem: null }, lastBaseline, 0, l.zoom);
  for (const t of items) if (t.kind === 'text') assertTextCarriesContainer(style, id, t);
  return { kind: 'box', id, boxType: 'anonymous', style, strut: strutOf(parent, items.length > 0, l.mode, l.zoom), marker: null, children: items.map((c) => lowerInlineLevel(c, l)) };
}

/**
 * The layout tree of a document. display: none subtrees generate no boxes (CSS2 §9.2.4), so they are omitted wherever they occur
 * (C4) and a display: none root has no layout tree.
 */
export function lowerTree(root: ResolvedElement, faults: CompilerFaults, ua: UaDataset, images: ImageNaturals, mode: LowerMode): LayoutBox {
  if (displayOf(root) === 'none') throw new LoweringError(root.element.address, 'display', `display: none on the root element ${root.element.address} leaves no layout tree`);
  if (displayOf(root) === 'contents') throw new LoweringError(root.element.address, 'display', `display: contents on the root element ${root.element.address} is not supported`);
  if (isReplacedTag(root.element.tag)) throw new LoweringError(root.element.address, 'display', `the root element ${root.element.address} is a replaced element`);
  if (isControlTag(root.element.tag)) throw new LoweringError(root.element.address, 'display', `the root element ${root.element.address} is a form control`);
  // The engine input's rootFontSize (V2) needs the root's font size in px, so a root whose font-size did not compute to px is refused here.
  const markers = new Map(listItemMarkers(root, faults).map((m) => [m.address, m] as const));
  const box = lowerBox(root, { faults, ua, rootFontSize: rootFontSizeOf(root), images, mode, propagated: viewportOverflow(root, faults).source, markers, zoom: [] }, null);
  if (box.kind !== 'box') throw new LoweringError(root.element.address, 'display', `the root element ${root.element.address} lowered to a control box`);
  return box;
}

const OBJECT_FITS: readonly ObjectFit[] = ['fill', 'contain', 'cover', 'none', 'scale-down'];

/**
 * A replaced element (REPL-a) as a leaf: its box style, natural size, default object size, object-fit and object-position. Its
 * overflow clip (the UA's img and iframe rule) clips only its own content, so the engine takes it as visible; its children are
 * fallback content, which a replaced element never renders.
 */
function lowerReplaced(el: ResolvedElement, faults: CompilerFaults, ua: UaDataset, rootFontSize: number | null, images: ImageNaturals, gridParent: GridContainer | null, parentZoom: readonly number[], mode: LowerMode): ReplacedLeaf {
  const id = el.element.address;
  const zoom = zoomChain(el, parentZoom);
  if (zoomProduct(zoom) !== 1) throw new LoweringError(id, 'zoom', `<${el.element.tag}> ${id} is replaced content at zoom ${zoomProduct(zoom)}, whose natural size native does not zoom yet (ZOOM)`);
  const raw: Get = (p) => (el.props.get(p) as ResolvedValue).value;
  const get: Get = (p) => {
    const v = raw(p);
    return (p === 'overflow-x' || p === 'overflow-y') && v.kind === 'keyword' && v.value === 'clip' ? { kind: 'keyword', value: 'visible' } : v;
  };
  const own = lowerStyleFrom(id, get, (p) => isInitialByProvenance(el.props.get(p) as ResolvedValue, p), faults, ua, { ...emOf(raw('font-size')), rem: rootFontSize, font: () => lowerFont(id, raw, mode).font }, { items: false, self: gridParent !== null }, 0, zoom);
  // css-grid-2 §5: a replaced element establishes no grid container; display: grid on one is not modelled.
  if (own.display === 'grid' || own.display === 'inline-grid') throw new LoweringError(id, 'display', `display: ${own.display} on the replaced element ${id} is not supported`);
  // css-grid-2 §8 and §9: a replaced child of a grid container carries its placement (an absolutely positioned one, its lines).
  const gridItem = gridParent === null ? null : gridStep(id, () => (own.position === 'absolute' || own.position === 'fixed' ? lowerOutOfFlowGridItem(gridParent, raw) : lowerGridItem(gridParent, raw)));
  // css-inline-3 §5.1: a replaced element holds no inline content, so text-box-trim has nothing to trim.
  const style: LayoutStyle = { ...own, textBoxTrim: null, gridItem: gridItem === null ? own.gridItem : gridItem };
  let natural: ReplacedLeaf['natural'] = { kind: 'none' };
  if (el.element.tag === 'img') {
    const src = el.element.attributes.get('src');
    const size = src === undefined ? undefined : images.get(src);
    if (size === undefined) throw new LoweringError(id, 'src', `<img> ${id} has no image the build read`);
    natural = { kind: 'image', width: size.width, height: size.height };
  } else if (el.element.tag === 'video' && videoLoads(el)) {
    // MEDIA-EL: Chrome sizes a video it loads by its stream (videos/compile.ts reads the src into the same map); one without a src,
    // or with preload none, keeps the default object size.
    const size = images.get(el.element.attributes.get('src') as string);
    if (size === undefined) throw new LoweringError(id, 'src', `<video> ${id} has no stream the build read`);
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

// CSS2 §10.2, §10.5, §10.7, §8.3, css-sizing-4 §5.1 and css-overflow-3 §3: a non-replaced inline box takes no width, height, min
// or max size, block margins, ratio or overflow. A block-in-inline box is that inline box (its web output keeps display: inline), so its block box takes none
// of them either (measured against Chrome 145: span { height: 20px; width: 30px; margin-top: 10px } lays out as if unset).
const INLINE_IGNORES = {
  boxSizing: 'content-box',
  width: { kind: 'auto' },
  height: { kind: 'auto' },
  minWidth: { kind: 'auto' },
  minHeight: { kind: 'auto' },
  maxWidth: { kind: 'none' },
  maxHeight: { kind: 'none' },
  marginTop: { kind: 'px', value: 0 },
  marginBottom: { kind: 'px', value: 0 },
  aspectRatio: { kind: 'auto' },
  // css-overflow-3 §3: overflow applies to block containers, so an inline box never clips.
  overflowX: 'visible',
  overflowY: 'visible',
} as const satisfies Partial<LayoutStyle>;

/**
 * The layout tree of one resolved element that generates a box. Inline-level content (text, inline boxes, <br>s) beside block-level
 * boxes, or directly in a flex or grid container, is wrapped in anonymous boxes "<element>:anon<k>", one per maximal run; display:
 * none children are omitted, so they never split a run. The engine never creates boxes. A flex or grid item is blockified
 * (css-display-3 §2.7), so an inline-level element in one is lowered as a box, never an inline box.
 */
function lowerBox(el: ResolvedElement, l: Lowerer, gridParent: GridContainer | null): LayoutBox | ControlBox {
  const id = el.element.address;
  const kids = boxChildren(el);
  const get: Get = (p) => (el.props.get(p) as ResolvedValue).value;
  const display = displayOf(el);
  const zoom = zoomChain(el, l.zoom);
  const lowered = lowerStyle(el, l.faults, l.ua, l.rootFontSize, { items: display === 'grid' || display === 'inline-grid', self: gridParent !== null }, zoom, l.mode);
  // Its text, anonymous boxes and children lower at its effective zoom.
  const lc: Lowerer = { ...l, zoom };
  // css-overflow-3 §3.3: the element the viewport took its overflow from uses visible.
  const own: LayoutStyle = id === l.propagated ? { ...lowered, overflowX: 'visible', overflowY: 'visible' } : lowered;
  // css-grid-2 §7, §8 and §9: a grid container carries its tracks; each child of one carries its placement (an absolutely
  // positioned one, the lines of its containing block).
  const grid = own.display === 'grid' || own.display === 'inline-grid' ? gridStep(id, () => lowerGridContainer(get)) : null;
  const gridItem = gridParent === null ? null : gridStep(id, () => (own.position === 'absolute' || own.position === 'fixed' ? lowerOutOfFlowGridItem(gridParent, get) : lowerGridItem(gridParent, get)));
  const placed: LayoutStyle = grid === null && gridItem === null ? own : { ...own, grid: grid === null ? null : grid.style, gridItem };
  const style: LayoutStyle = isBlockInInline(el) ? { ...placed, ...INLINE_IGNORES } : placed;
  const container = displayOf(el) === 'flex' || displayOf(el) === 'inline-flex' || displayOf(el) === 'grid' || displayOf(el) === 'inline-grid';
  const inline = kids.filter(isInlineLevel);
  const wrap = inline.length > 0 && (container || inline.length !== kids.length);
  const children: (LayoutBox | ControlBox | ReplacedLeaf | InlineChild)[] = [];
  let run: (ResolvedElement | ResolvedText)[] = [];
  let anon = 0;
  const flush = (): void => {
    if (run.length > 0) {
      const box = anonymousBox(el, `${id}:anon${anon++}`, run, lc);
      children.push(grid === null ? box : { ...box, style: { ...box.style, gridItem: ANONYMOUS_GRID_ITEM } });
    }
    run = [];
  };
  for (const c of kids) {
    if (!isInlineLevel(c)) {
      flush();
      children.push(isReplacedTag((c as ResolvedElement).element.tag) ? lowerReplaced(c as ResolvedElement, l.faults, l.ua, l.rootFontSize, l.images, grid, zoom, l.mode) : lowerBox(c as ResolvedElement, lc, grid));
    } else if (wrap) {
      if (l.faults.inlineWrapperPerElement && c.kind === 'element') flush();
      run.push(c);
      if (l.faults.inlineWrapperPerElement && c.kind === 'element') flush();
    }
    else {
      if (c.kind === 'text') assertTextCarriesContainer(style, id, c);
      children.push(lowerInlineLevel(c, lc));
    }
  }
  flush();
  // A line strut only when the box holds inline content: a block-level replaced leaf is a box of its own, not a line (REPL-a with
  // INL1a); an atomic inline is on a line (INL2a, RF-INL).
  const inlineContent = children.some((c) => (c.kind !== 'box' && c.kind !== 'control' && c.kind !== 'replaced') || ((c.kind === 'box' || c.kind === 'control') && (c.style.display === 'inline-block' || c.style.display === 'inline-flex' || c.style.display === 'inline-grid')) || (c.kind === 'replaced' && c.style.display !== 'block' && c.style.display !== 'flex'));
  const strut = strutOf(el, inlineContent, l.mode, zoom);
  // FORM-a: a block button centres its contents (Blink AlignBlockContent), and so does an inline-block one (RF-INL), which Blink
  // lays out with the same BlockLayoutAlgorithm; a flex button is the plain flex container it is.
  if (el.element.tag === 'button' && (style.display === 'block' || style.display === 'inline-block')) return { kind: 'control', id, boxType: 'element', style, control: { kind: 'button-block' }, strut, children };
  const range = rangePartOf(el);
  if (range !== undefined && range.part === null) {
    // A range is a flex container whatever its display (range_input_type.cc CreateLayoutObject); its default track length is
    // FORM-0's captured width of an appearance: none thumb in an auto-width range (the track's content width).
    return { kind: 'control', id, boxType: 'element', style: { ...style, display: 'flex' }, control: { kind: 'range', defaultInlineSize: RANGE_NONE_THUMB.width }, strut, children };
  }
  if (range !== undefined && range.part === 'thumb') {
    const a = range.host.attributes;
    const ratio = rangeRatio({ min: a.get('min') ?? null, max: a.get('max') ?? null, step: a.get('step') ?? null, value: a.get('value') ?? null });
    return { kind: 'control', id, boxType: 'element', style, control: { kind: 'slider-thumb', ratio }, strut, children };
  }
  return { kind: 'box', id, boxType: isBlockInInline(el) ? 'block-in-inline' : 'element', style, strut, marker: display === 'list-item' ? markerOf(el, l, zoom) : null, children };
}

const SYMBOLS: readonly string[] = ['disc', 'circle', 'square'];

/** Whether a list-style-type GEN-c writes is drawn as a symbol (disc, circle, square) rather than as its marker text. */
export const isSymbolMarker = (t: ListStyleType): boolean => t.kind === 'style' && SYMBOLS.includes(t.name);

/**
 * T151 R14: a list item's outside marker in its own font and line-height, a symbol for disc, circle and square and otherwise its
 * compile-time counter text (analysis/markers.ts); null for list-style-type none. computed-checks.ts refuses what GEN-c does not draw.
 */
function markerOf(el: ResolvedElement, l: Lowerer, zoom: readonly number[]): ListMarker | null {
  const id = el.element.address;
  const m = l.markers.get(id);
  if (m === undefined) throw new LoweringError(id, 'display', `the list item ${id} has no ordinal`);
  if (m.type.kind === 'none') return null;
  if (m.type.kind === 'refused') throw new LoweringError(id, 'list-style-type', m.type.reason);
  const { font, lineHeight } = lowerFont(id, zoomedGet(id, (p: TextLonghand) => (el.props.get(p) as ResolvedValue).value, zoom), l.mode);
  const t = m.type.type;
  if (t.kind === 'style' && isSymbolMarker(t)) return { id: `${id}::marker`, kind: 'symbol', symbol: t.name as ListMarker['symbol'], text: null, font, lineHeight };
  return { id: `${id}::marker`, kind: 'text', symbol: null, text: m.text, font, lineHeight };
}
