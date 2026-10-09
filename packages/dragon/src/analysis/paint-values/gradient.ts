// Background layers and CSS gradients (css-backgrounds-3 §2-§3, css-images-3 §3; BG2, notes/T074-bg2-spec.md): the typed reading
// of every layer longhand's items, the gradient syntax Dragon draws exactly (paint-gradient.ts in @dragon/layout ports Chrome 145's
// raster), the refusals, and each box's layers as the lowering hands them to the device. Items are read from the css-tree nodes of
// an authored value (the parse driver) and from the text of a resolved value (the lowering), with one parser. A refusal at parse
// time blocks every target; what only the native raster cannot draw (an angle off the measured grid, a corner, a tiled or
// translucent stack, an unmodelled composited layer) is refused on ios and android by the element check, and web compiles it.
import { generate, parse } from 'css-tree';
import type { CssNode } from 'css-tree';
import { list } from '../../css/ast.ts';
import type { Rgba8 } from '../../css/color.ts';
import { asciiLower, canonicalizeEscapes } from '../../css/escapes.ts';
import { parseColorNode } from '../../css/color.ts';
import type { Longhand } from '../../css/properties.ts';
import type { BackgroundLayerLonghand } from '../../css/properties/background-layers.ts';
import { BACKGROUND_LAYERS_LONGHANDS } from '../../css/properties/background-layers.ts';
import { layerValue } from '../../css/shorthands/background.ts';
import { lengthToPx, normalizeUnit, unitEntry } from '../../css/units.ts';
import type { CssValue } from '../../css/values.ts';
import { authored, diagnostic } from '../../diagnostics/catalogue.ts';
import { usedColors } from '../../lower/paint/colors.ts';
import { elementWillChange } from './transform.ts';
import { linearSlope } from '../../paint-data/libm.ts';
import type { Diagnostic } from '../../types.ts';
import { cornerComponents, RADIUS_LONGHANDS } from '../../css/properties/radius.ts';
import type { ResolvedElement, ResolvedValue } from '../resolve.ts';
import type { PaintCheck, PaintValueContext, PaintValues } from './types.ts';

export { linearSlope } from '../../paint-data/libm.ts';

/** Why a background value is refused, and the node it is refused at (null: the whole item). */
export type LayerRefusal = { readonly node: CssNode | null; readonly reason: string };

/**
 * A <length-percentage> of the subset: a percentage or CSS px; em, rem and absolute units fold to px at computed-value time (R7). A
 * position may also be an offset from the right or bottom edge (end-percent, end-px).
 */
export type LengthPct = { readonly unit: 'percent' | 'px' | 'end-percent' | 'end-px'; readonly value: number };

/** A stop colour: 8-bit channels, or currentcolor (resolved against the element's color when the layer is lowered). */
export type StopColorSpec = { readonly kind: 'rgba'; readonly value: Rgba8 } | { readonly kind: 'currentcolor' };

export type StopSpec = { readonly color: StopColorSpec; readonly unit: 'auto' | 'percent' | 'px'; readonly value: number };

/**
 * One gradient, in the shape paint-gradient.ts GradientImage takes (with colours still to resolve). direction 'angle' holds
 * the angle in degrees as Blink's ComputeDegrees gives it; 'side' holds a side or, with both set, a corner.
 */
export type GradientSpec = {
  readonly radial: boolean;
  readonly repeating: boolean;
  readonly direction: 'default' | 'angle' | 'side';
  readonly angleDeg: number;
  readonly sideX: 'none' | 'left' | 'right';
  readonly sideY: 'none' | 'top' | 'bottom';
  readonly circle: boolean;
  readonly extent: 'closest-side' | 'closest-corner' | 'farthest-side' | 'farthest-corner' | 'explicit';
  readonly radiusX: LengthPct;
  readonly radiusY: LengthPct;
  readonly centerX: LengthPct;
  readonly centerY: LengthPct;
  readonly stops: readonly StopSpec[];
};

export type ImageItem = { readonly kind: 'none' } | { readonly kind: 'gradient'; readonly gradient: GradientSpec };
export type SizeComponent = { readonly unit: 'auto' | 'percent' | 'px'; readonly value: number };
export type SizeItem = { readonly kind: 'length' | 'cover' | 'contain'; readonly x: SizeComponent; readonly y: SizeComponent };
export type RepeatKeyword = 'repeat' | 'no-repeat' | 'space' | 'round';
export type RepeatItem = { readonly x: RepeatKeyword; readonly y: RepeatKeyword };
export type BoxItem = 'border-box' | 'padding-box' | 'content-box';

type Item<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly refusal: LayerRefusal };

const ok = <T>(value: T): Item<T> => ({ ok: true, value });
const no = <T>(node: CssNode | null, reason: string): Item<T> => ({ ok: false, refusal: { node, reason } });

const ident = (n: CssNode | undefined): string | null => (n !== undefined && n.type === 'Identifier' ? asciiLower(String(n['name'])) : null);
const isComma = (n: CssNode): boolean => n.type === 'Operator' && n['value'] === ',';

/** The packages that lift a refusal (notes/T074-bg2-spec.md §1). */
export const BG2B = 'BG2b';
export const BG2C = 'BG2c';
export const BG2_CONIC = 'BG2-c';
export const BG2_URL = 'BG2-u';
export const BG2_TILING = 'BG2-t';
export const CALC_P = 'CALC-p';

/** Splits the top-level tokens of a value into its comma-separated items (white space already removed). */
export function commaItems(tokens: readonly CssNode[]): CssNode[][] {
  const out: CssNode[][] = [[]];
  for (const t of tokens) {
    if (isComma(t)) out.push([]);
    else (out[out.length - 1] as CssNode[]).push(t);
  }
  return out;
}

/** The non-white-space children of a function or value node. */
function children(n: CssNode): CssNode[] {
  return list(n, 'children').filter((c) => c.type !== 'WhiteSpace');
}

/**
 * A <length-percentage> token of the subset: a percentage, a unitless zero, px, or a unit that folds to px at computed-value time
 * (em, rem and the absolute units, R7). A viewport unit would need the device viewport, and a calculation is refused, as PNT1
 * refuses them in radii and shadows (CALC-p). A folded length reads as px here only after GRADIENT_VALUES.compute.
 */
function lengthPct(n: CssNode, what: string): Item<LengthPct> {
  if (n.type === 'Percentage') return ok({ unit: 'percent', value: Number(n['value']) });
  if (n.type === 'Number' && Number(n['value']) === 0) return ok({ unit: 'px', value: 0 });
  if (n.type === 'Dimension') {
    const unit = normalizeUnit(String(n['unit']));
    if (unit === 'px') return ok({ unit: 'px', value: Number(n['value']) });
    const c = unitEntry(unit)?.conversion;
    if (c === undefined) return no(n, `${what} in ${unit} is not a length`);
    if (c.kind === 'viewport') return no(n, `${what} in a viewport unit would need the device viewport on the native side (${CALC_P})`);
    if (c.kind === 'refused') return no(n, `${what}: ${c.reason}`);
    // An absolute unit is px times its ratio; em and rem fold to px against the element's font sizes in GRADIENT_VALUES.compute
    // (valueItems refuses one left unfolded), and stand as their number until then.
    if (c.kind === 'absolute') return ok({ unit: 'px', value: Number(n['value']) * c.pxPer });
    return ok({ unit: 'px', value: Number(n['value']) });
  }
  if (n.type === 'Function') return no(n, `${what} as ${asciiLower(String(n['name']))}() is not supported: Dragon draws background and gradient geometry from lengths and percentages (${CALC_P})`);
  return no(n, `${what} must be a length or a percentage`);
}

/** Calls f on every node of a parsed value, children before later siblings (an explicit stack, as escapes.ts walks). */
function eachNode(root: CssNode, f: (n: CssNode) => void): void {
  const stack: CssNode[] = [root];
  while (stack.length > 0) {
    const n = stack.pop() as CssNode;
    f(n);
    const kids = (n as { children?: { toArray(): CssNode[] } | null }).children;
    if (kids !== undefined && kids !== null) for (const c of kids.toArray()) stack.push(c);
  }
}

/** Whether a length token still needs folding to px (an em, rem or absolute unit). */
function foldsToPx(n: CssNode, absolute: boolean): boolean {
  if (n.type !== 'Dimension') return false;
  const c = unitEntry(normalizeUnit(String(n['unit'])))?.conversion;
  return c !== undefined && (c.kind === 'font-relative' || (absolute && c.kind === 'absolute'));
}

/** Blink ComputeDegrees of an <angle> (WTF's Grad2deg, Rad2deg and Turn2deg, in double); a unitless zero is 0deg. */
function angleDegrees(n: CssNode): number | null {
  if (n.type === 'Number' && Number(n['value']) === 0) return 0;
  if (n.type !== 'Dimension') return null;
  const v = Number(n['value']);
  const unit = asciiLower(String(n['unit']));
  if (unit === 'deg') return v;
  if (unit === 'grad') return v * (360 / 400);
  if (unit === 'rad') return v * (180 / Math.PI);
  if (unit === 'turn') return v * 360;
  return null;
}

const SIDES_X = new Set(['left', 'right']);
const SIDES_Y = new Set(['top', 'bottom']);

/**
 * css-values-4 <position> (the gradient centre and background-position): one to four values as { x, y } percentages or px from
 * the left and top edges, or offsets from the right and bottom edges (R7).
 */
export function position(tokens: readonly CssNode[], what: string): Item<{ readonly x: LengthPct; readonly y: LengthPct }> {
  const kwPct = (k: string): LengthPct => ({ unit: 'percent', value: k === 'left' || k === 'top' ? 0 : k === 'center' ? 50 : 100 });
  const isKw = (n: CssNode | undefined): boolean => ident(n) !== null;
  const first = tokens[0];
  if (first === undefined || tokens.length > 4) return no(null, `${what} needs one to four values`);
  if (tokens.length <= 2) {
    const [a, b] = tokens as [CssNode, CssNode?];
    const ka = ident(a);
    const kb = b === undefined ? null : ident(b);
    const one = (n: CssNode, axis: 'x' | 'y'): Item<LengthPct> => {
      const k = ident(n);
      if (k === null) return lengthPct(n, what);
      if (k === 'center' || (axis === 'x' ? SIDES_X.has(k) : SIDES_Y.has(k))) return ok(kwPct(k));
      return no(n, `${k} is not a ${axis === 'x' ? 'horizontal' : 'vertical'} position`);
    };
    if (b === undefined) {
      if (ka !== null && SIDES_Y.has(ka)) return ok({ x: kwPct('center'), y: kwPct(ka) });
      const x = one(a, 'x');
      return x.ok ? ok({ x: x.value, y: kwPct('center') }) : x;
    }
    const swapped = (ka !== null && SIDES_Y.has(ka)) || (kb !== null && SIDES_X.has(kb));
    const x = one(swapped ? b : a, 'x');
    const y = one(swapped ? a : b, 'y');
    if (!x.ok) return x;
    if (!y.ok) return y;
    return ok({ x: x.value, y: y.value });
  }
  // Three or four values: [ edge offset? ]{2} with keywords.
  let x: LengthPct | null = null;
  let y: LengthPct | null = null;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i] as CssNode;
    const k = ident(t);
    if (k === null) return no(t, `${what}: an offset must follow an edge keyword`);
    const next = tokens[i + 1];
    const offset = next !== undefined && !isKw(next) ? next : null;
    if (offset !== null) i++;
    let v: LengthPct = kwPct(k);
    if (offset !== null) {
      if (k === 'center') return no(offset, `${what}: center takes no offset`);
      const o = lengthPct(offset, what);
      if (!o.ok) return o;
      // R7: an offset from the right or bottom edge is measured from the far edge.
      v = k === 'right' || k === 'bottom' ? { unit: o.value.unit === 'percent' ? 'end-percent' : 'end-px', value: o.value.value } : o.value;
    }
    if (SIDES_X.has(k)) x = v;
    else if (SIDES_Y.has(k)) y = v;
    else if (x === null) x = v;
    else y = v;
  }
  if (x === null || y === null) return no(null, `${what} names the same axis twice`);
  return ok({ x, y });
}

const EXTENTS = new Set(['closest-side', 'closest-corner', 'farthest-side', 'farthest-corner']);

/** The colour stops of a gradient: <color> [<length-percentage>{1,2}]?, with hints and angles refused. */
function stops(groups: readonly CssNode[][], fn: CssNode): Item<StopSpec[]> {
  const out: StopSpec[] = [];
  for (const g of groups) {
    const [c, p1, p2, extra] = g as [CssNode?, CssNode?, CssNode?, CssNode?];
    if (c === undefined) return no(fn, 'an empty colour stop');
    if (extra !== undefined) return no(extra, 'a colour stop takes a colour and at most two positions');
    const color = parseColorNode(c);
    if (!color.ok) {
      if (c.type === 'Percentage' || c.type === 'Dimension' || c.type === 'Number') return no(c, `colour hints (a position without a colour) are not supported: Blink turns them into stops with double pow and log (${BG2B}, after COL4)`);
      return no(c, `${color.reason}`);
    }
    const spec: StopColorSpec = color.kind === 'keyword' ? (color.keyword === 'currentcolor' ? { kind: 'currentcolor' } : { kind: 'rgba', value: { r: 0, g: 0, b: 0, alpha: 0 } }) : { kind: 'rgba', value: color.value };
    if (p1 === undefined) {
      out.push({ color: spec, unit: 'auto', value: 0 });
      continue;
    }
    for (const p of p2 === undefined ? [p1] : [p1, p2]) {
      const v = lengthPct(p, 'a colour stop position');
      if (!v.ok) return v;
      // A negative position is normalised by Blink's AddStops, which paint-gradient.ts ports (R7).
      out.push({ color: spec, unit: v.value.unit === 'percent' ? 'percent' : 'px', value: v.value.value });
    }
  }
  if (out.length < 2) return no(fn, 'a gradient needs at least two colour stops');
  return ok(out);
}

const BASE: Omit<GradientSpec, 'radial' | 'repeating' | 'stops'> = {
  direction: 'default', angleDeg: 0, sideX: 'none', sideY: 'none', circle: false, extent: 'farthest-corner',
  radiusX: { unit: 'px', value: 0 }, radiusY: { unit: 'px', value: 0 }, centerX: { unit: 'percent', value: 50 }, centerY: { unit: 'percent', value: 50 },
};

/** A linear or radial gradient function (css-images-3 §3.1-§3.2); conic gradients and interpolation syntax are refused (BG2b). */
export function gradient(fn: CssNode): Item<GradientSpec> {
  const name = asciiLower(String(fn['name']));
  const repeating = name.startsWith('repeating-');
  const base = repeating ? name.slice('repeating-'.length) : name;
  const groups = commaItems(children(fn));
  const head = groups[0] as CssNode[];
  if (head.some((t) => ident(t) === 'in')) return no(fn, `color interpolation methods (in <color-space>) are not supported (${BG2B}, after COL4)`);
  if (base === 'linear-gradient') {
    const first = head[0];
    const angle = first === undefined ? null : angleDegrees(first);
    if (angle !== null && head.length === 1) {
      const s = stops(groups.slice(1), fn);
      return s.ok ? ok({ ...BASE, radial: false, repeating, direction: 'angle', angleDeg: angle, stops: s.value }) : s;
    }
    if (ident(first) === 'to') {
      const keys = head.slice(1).map(ident);
      const x = keys.find((k) => k !== null && SIDES_X.has(k)) ?? null;
      const y = keys.find((k) => k !== null && SIDES_Y.has(k)) ?? null;
      if (keys.length < 1 || keys.length > 2 || keys.length !== (x === null ? 0 : 1) + (y === null ? 0 : 1)) return no(fn, 'to takes a side or a corner');
      const s = stops(groups.slice(1), fn);
      return s.ok ? ok({ ...BASE, radial: false, repeating, direction: 'side', sideX: (x ?? 'none') as GradientSpec['sideX'], sideY: (y ?? 'none') as GradientSpec['sideY'], stops: s.value }) : s;
    }
    const s = stops(groups, fn);
    return s.ok ? ok({ ...BASE, radial: false, repeating, stops: s.value }) : s;
  }
  if (base === 'radial-gradient') {
    // [ <ending-shape> || <size> ]? [ at <position> ]? , stops; a first group without shape, size or at is a stop.
    const isShapeGroup = head.some((t) => {
      const k = ident(t);
      return k === 'circle' || k === 'ellipse' || k === 'at' || (k !== null && EXTENTS.has(k));
    }) || (head.length <= 2 && head.every((t) => t.type === 'Dimension' || t.type === 'Percentage') && parseColorNode(head[0] as CssNode).ok === false);
    if (!isShapeGroup) {
      const s = stops(groups, fn);
      return s.ok ? ok({ ...BASE, radial: true, repeating, stops: s.value }) : s;
    }
    const at = head.findIndex((t) => ident(t) === 'at');
    const shapeTokens = at < 0 ? head : head.slice(0, at);
    let spec: GradientSpec = { ...BASE, radial: true, repeating, stops: [] };
    let shape: 'circle' | 'ellipse' | null = null;
    const sizes: CssNode[] = [];
    for (const t of shapeTokens) {
      const k = ident(t);
      if (k === 'circle' || k === 'ellipse') shape = k;
      else if (k !== null && EXTENTS.has(k)) spec = { ...spec, extent: k as GradientSpec['extent'] };
      else sizes.push(t);
    }
    if (sizes.length > 0) {
      const circle = shape === 'circle' || (shape === null && sizes.length === 1);
      if (circle && (sizes.length !== 1 || sizes[0]?.type === 'Percentage')) return no(sizes[0] as CssNode, 'a circle takes one length radius');
      if (!circle && sizes.length !== 2) return no(sizes[0] as CssNode, 'an ellipse takes two radii');
      const rx = lengthPct(sizes[0] as CssNode, 'a gradient radius');
      if (!rx.ok) return rx;
      const ry = circle ? rx : lengthPct(sizes[1] as CssNode, 'a gradient radius');
      if (!ry.ok) return ry;
      if (rx.value.value < 0 || ry.value.value < 0) return no(sizes[0] as CssNode, 'a gradient radius cannot be negative');
      spec = { ...spec, extent: 'explicit', circle, radiusX: rx.value, radiusY: ry.value };
    } else spec = { ...spec, circle: shape === 'circle' };
    if (at >= 0) {
      const p = position(head.slice(at + 1), 'a gradient centre');
      if (!p.ok) return p;
      spec = { ...spec, centerX: p.value.x, centerY: p.value.y };
    }
    const s = stops(groups.slice(1), fn);
    return s.ok ? ok({ ...spec, stops: s.value }) : s;
  }
  if (base === 'conic-gradient') return no(fn, `conic gradients are not supported yet (${BG2_CONIC})`);
  return no(fn, `${name}() is not supported`);
}

/** One background-image item: none or a gradient; url() and the other images are refused (REPL, BG2b). */
export function imageItem(tokens: readonly CssNode[]): Item<ImageItem> {
  const [t, extra] = tokens as [CssNode?, CssNode?];
  if (t === undefined || extra !== undefined) return no(t ?? null, 'a background image is one value');
  if (ident(t) === 'none') return ok({ kind: 'none' });
  if (t.type === 'Url') return no(t, `url() images are not supported yet: background images take REPL-a's image assets (${BG2_URL})`);
  if (t.type === 'Function') {
    const name = asciiLower(String(t['name']));
    if (name === 'linear-gradient' || name === 'radial-gradient' || name === 'repeating-linear-gradient' || name === 'repeating-radial-gradient' || name === 'conic-gradient' || name === 'repeating-conic-gradient') {
      const g = gradient(t);
      return g.ok ? ok({ kind: 'gradient', gradient: g.value }) : g;
    }
    return no(t, `${name}() images are not supported (${BG2B})`);
  }
  return no(t, 'not a background image');
}

/**
 * One background-position-x or -y item: a keyword, a length or a percentage, or an edge and its offset; an offset from the right
 * or bottom edge is measured from the far edge (Chrome computes it to calc(100% - offset) or 100% - p, R7).
 */
export function positionAxisItem(tokens: readonly CssNode[], axis: 'x' | 'y'): Item<LengthPct> {
  const [t, off, extra] = tokens as [CssNode?, CssNode?, CssNode?];
  if (t === undefined || extra !== undefined) return no(t ?? null, 'a position axis is a keyword, a length or both');
  const k = ident(t);
  if (off !== undefined) {
    const v = lengthPct(off, `background-position-${axis}`);
    if (!v.ok) return v;
    if (k === (axis === 'x' ? 'left' : 'top')) return v;
    if (k === (axis === 'x' ? 'right' : 'bottom')) return ok({ unit: v.value.unit === 'percent' ? 'end-percent' : 'end-px', value: v.value.value });
    return no(off, `${k ?? 'this value'} takes no offset on the ${axis} axis`);
  }
  if (k === null) return lengthPct(t, `background-position-${axis}`);
  if (k === 'center') return ok({ unit: 'percent', value: 50 });
  if (k === (axis === 'x' ? 'left' : 'top')) return ok({ unit: 'percent', value: 0 });
  if (k === (axis === 'x' ? 'right' : 'bottom')) return ok({ unit: 'percent', value: 100 });
  return no(t, `${k} positions are not supported (${BG2C})`);
}

function sizeComponent(t: CssNode): Item<SizeComponent> {
  if (ident(t) === 'auto') return ok({ unit: 'auto', value: 0 });
  const v = lengthPct(t, 'background-size');
  if (!v.ok) return v;
  if (v.value.value < 0) return no(t, 'background-size cannot be negative');
  return ok({ unit: v.value.unit === 'percent' ? 'percent' : 'px', value: v.value.value });
}

/** One background-size item: cover, contain, or one or two components (the second defaulting to auto). */
export function sizeItem(tokens: readonly CssNode[]): Item<SizeItem> {
  const [a, b, extra] = tokens as [CssNode?, CssNode?, CssNode?];
  const auto: SizeComponent = { unit: 'auto', value: 0 };
  if (a === undefined || extra !== undefined) return no(a ?? null, 'background-size takes one or two values');
  const k = ident(a);
  if (k === 'cover' || k === 'contain') return b === undefined ? ok({ kind: k, x: auto, y: auto }) : no(b, `${k} takes no second value`);
  const x = sizeComponent(a);
  if (!x.ok) return x;
  const y = b === undefined ? ok(auto) : sizeComponent(b);
  if (!y.ok) return y;
  return ok({ kind: 'length', x: x.value, y: y.value });
}

/** One background-repeat item; space and round parse, and the native targets refuse them (BG2-t, the element check). */
export function repeatItem(tokens: readonly CssNode[]): Item<RepeatItem> {
  const [a, b, extra] = tokens as [CssNode?, CssNode?, CssNode?];
  if (a === undefined || extra !== undefined) return no(a ?? null, 'background-repeat takes one or two keywords');
  const one = (n: CssNode): Item<RepeatKeyword> => {
    const k = ident(n);
    if (k === 'repeat' || k === 'no-repeat' || k === 'space' || k === 'round') return ok(k);
    return no(n, `${k ?? 'this value'} is not a repeat keyword Dragon reads (repeat-block and repeat-inline are not in Chrome 145)`);
  };
  const k = ident(a);
  if (b === undefined) {
    if (k === 'repeat-x') return ok({ x: 'repeat', y: 'no-repeat' });
    if (k === 'repeat-y') return ok({ x: 'no-repeat', y: 'repeat' });
    const v = one(a);
    return v.ok ? ok({ x: v.value, y: v.value }) : v;
  }
  const x = one(a);
  if (!x.ok) return x;
  const y = one(b);
  if (!y.ok) return y;
  return ok({ x: x.value, y: y.value });
}

/** One background-origin or background-clip item. */
export function boxItem(tokens: readonly CssNode[], property: string): Item<BoxItem> {
  const [t, extra] = tokens as [CssNode?, CssNode?];
  if (t === undefined || extra !== undefined) return no(t ?? null, `${property} is one keyword`);
  const k = ident(t);
  if (k === 'border-box' || k === 'padding-box' || k === 'content-box') return ok(k);
  return no(t, `${property}: ${k ?? 'this value'} is not supported: Dragon clips backgrounds to a box (${BG2C})`);
}

/** One background-attachment item: scroll; fixed and local are refused (BG2b). */
export function attachmentItem(tokens: readonly CssNode[]): Item<'scroll'> {
  const [t, extra] = tokens as [CssNode?, CssNode?];
  if (t === undefined || extra !== undefined) return no(t ?? null, 'background-attachment is one keyword');
  const k = ident(t);
  if (k === 'scroll') return ok('scroll');
  return no(t, `background-attachment: ${k ?? 'this value'} is not supported: Dragon draws backgrounds that scroll with their box (${BG2B})`);
}

/** Checks one item of a layer longhand; the refusal, or null when Dragon draws it. */
export function checkLayerItem(property: BackgroundLayerLonghand, tokens: readonly CssNode[]): LayerRefusal | null {
  const r = (i: Item<unknown>): LayerRefusal | null => (i.ok ? null : i.refusal);
  switch (property) {
    case 'background-image':
      return r(imageItem(tokens));
    case 'background-position-x':
      return r(positionAxisItem(tokens, 'x'));
    case 'background-position-y':
      return r(positionAxisItem(tokens, 'y'));
    case 'background-size':
      return r(sizeItem(tokens));
    case 'background-repeat':
      return r(repeatItem(tokens));
    case 'background-attachment':
      return r(attachmentItem(tokens));
    case 'background-origin':
    case 'background-clip':
      return r(boxItem(tokens, property));
  }
}

// ---------------------------------------------------------------- resolved values to typed layers (the lowering)

const textCache = new Map<string, CssNode[][]>();

/** The items of a resolved layer longhand's value, as css-tree tokens. */
export function valueItems(v: CssValue): CssNode[][] {
  const text = v.kind === 'keyword' ? v.value : v.kind === 'percentage' ? `${v.value}%` : v.kind === 'length' ? `${v.value}${v.unit}` : v.kind === 'other' ? v.text : null;
  if (text === null) throw new Error(`a background layer value of kind ${v.kind}`);
  const hit = textCache.get(text);
  if (hit !== undefined) return hit;
  const node = parse(text, { context: 'value' });
  canonicalizeEscapes(node);
  eachNode(node, (n) => {
    if (foldsToPx(n, false)) throw new Error(`a background layer value reached the lowering with ${generate(n)}, which computed values fold to px`);
  });
  const items = commaItems(children(node));
  textCache.set(text, items);
  return items;
}

export function must<T>(i: Item<T>, what: string): T {
  if (!i.ok) throw new Error(`${what} reached the lowering unsupported: ${i.refusal.reason}`);
  return i.value;
}

// ---------------------------------------------------------------- an element's layers (css-backgrounds-3 §2.2)

/** One layer's geometry, in the shape paint-gradient.ts LayerGeometry takes. */
export type LayerGeometrySpec = {
  readonly sizeKind: 'length' | 'cover' | 'contain';
  readonly sizeX: SizeComponent;
  readonly sizeY: SizeComponent;
  readonly positionX: LengthPct;
  readonly positionY: LengthPct;
  readonly repeatX: RepeatKeyword;
  readonly repeatY: RepeatKeyword;
  readonly origin: BoxItem;
  readonly clip: BoxItem;
};

export type ElementLayer = { readonly image: ImageItem; readonly geometry: LayerGeometrySpec };

/** The item of a list for layer i: lists shorter than the layer count repeat (css-backgrounds-3 §2.2). */
function nth(items: readonly CssNode[][], i: number): CssNode[] {
  return items[i % items.length] as CssNode[];
}

/**
 * The layers of a resolved element, top first: background-image's items fix the count and every other longhand's items
 * repeat to it. Every item was checked when its declaration was parsed, so a refusal here is a compiler bug.
 */
export function elementLayers(value: (p: BackgroundLayerLonghand) => CssValue): ElementLayer[] {
  const images = valueItems(value('background-image'));
  const px = valueItems(value('background-position-x'));
  const py = valueItems(value('background-position-y'));
  const size = valueItems(value('background-size'));
  const repeat = valueItems(value('background-repeat'));
  const origin = valueItems(value('background-origin'));
  const clip = valueItems(value('background-clip'));
  return images.map((img, i) => {
    const s = must(sizeItem(nth(size, i)), 'background-size');
    const r = must(repeatItem(nth(repeat, i)), 'background-repeat');
    return {
      image: must(imageItem(img), 'background-image'),
      geometry: {
        sizeKind: s.kind,
        sizeX: s.x,
        sizeY: s.y,
        positionX: must(positionAxisItem(nth(px, i), 'x'), 'background-position-x'),
        positionY: must(positionAxisItem(nth(py, i), 'y'), 'background-position-y'),
        repeatX: r.x,
        repeatY: r.y,
        origin: must(boxItem(nth(origin, i), 'background-origin'), 'background-origin'),
        clip: must(boxItem(nth(clip, i), 'background-clip'), 'background-clip'),
      },
    };
  });
}

const BOX_DEPTH: { readonly [B in BoxItem]: number } = { 'border-box': 0, 'padding-box': 1, 'content-box': 2 };

/**
 * A box's compile-time border and padding widths per side (top, right, bottom, left; null when a padding is a percentage), and
 * whether each border side hides the background under it at every scale (BorderEdge::ObscuresBackground: an opaque solid side).
 */
export type BoxWidths = { readonly borders: readonly number[]; readonly padding: readonly (number | null)[]; readonly obscures: readonly boolean[] };

/**
 * Blink BorderEdge::ObscuresBackground per side: 'never' for a translucent colour or a hidden, dotted or dashed side, 'double'
 * for a double side (it obscures only below 3 device px, where Blink draws it solid), 'always' otherwise.
 */
export type Obscures = 'always' | 'never' | 'double';

export function obscuresOf(style: string, color: Rgba8): Obscures {
  if (color.alpha !== 255 || style === 'hidden' || style === 'dotted' || style === 'dashed') return 'never';
  return style === 'double' ? 'double' : 'always';
}

/**
 * Whether box `inner` lies inside box `outer` on an axis: it is the same or a deeper box, or every border and padding between
 * them on that axis's two sides is zero at build time.
 */
function insideOnAxis(inner: BoxItem, outer: BoxItem, w: BoxWidths, sides: readonly number[]): boolean {
  if (BOX_DEPTH[inner] >= BOX_DEPTH[outer]) return true;
  for (const s of sides) {
    // A border-box clip stops at a side that obscures the background (ComputeDestRectAdjustments).
    if (BOX_DEPTH[outer] >= 1 && BOX_DEPTH[inner] < 1 && (w.borders[s] as number) !== 0 && w.obscures[s] !== true) return false;
    if (BOX_DEPTH[outer] >= 2 && BOX_DEPTH[inner] < 2 && w.padding[s] !== 0) return false;
  }
  return true;
}

/** Whether a position is the start edge: 0 from the left or top, or 100% from the right or bottom. */
const atStart = (v: LengthPct): boolean => ((v.unit === 'percent' || v.unit === 'px') && v.value === 0) || (v.unit === 'end-percent' && v.value === 100);

/**
 * Why Chrome would tile a layer (the picture shader with resampling, which Dragon does not draw yet), or null when it draws one
 * tile (R8): a repeating axis needs the tile to be its positioning area (size auto, cover or contain), a start position and a clip
 * box inside the origin box. A no-repeat axis always draws one tile. space and round always tile.
 */
export function tilingRefusal(g: LayerGeometrySpec, w: BoxWidths): string | null {
  for (const axis of ['x', 'y'] as const) {
    const repeat = axis === 'x' ? g.repeatX : g.repeatY;
    if (repeat === 'no-repeat') continue;
    if (repeat === 'space' || repeat === 'round') return `background-repeat: ${repeat} tiles the layer, which the native targets do not draw yet (${BG2_TILING})`;
    const size = axis === 'x' ? g.sizeX : g.sizeY;
    const pos = axis === 'x' ? g.positionX : g.positionY;
    if (g.sizeKind === 'length' && size.unit !== 'auto') return `a layer that repeats on the ${axis} axis with a size other than auto tiles (Chrome's picture shader); the native targets draw a repeating axis only at size auto (${BG2_TILING})`;
    if (!atStart(pos)) return `a repeating layer at a ${axis} position other than the start edge tiles; the native targets draw it only there (${BG2_TILING})`;
    if (!insideOnAxis(g.clip, g.origin, w, axis === 'x' ? [1, 3] : [0, 2])) return `a repeating layer whose background-clip (${g.clip}) reaches outside its background-origin (${g.origin}) tiles into the border or padding (${BG2_TILING})`;
  }
  return null;
}

/** Whether every stop of a gradient is opaque for an element whose color is `current`. */
export function gradientOpaque(g: GradientSpec, current: Rgba8): boolean {
  return g.stops.every((s) => (s.color.kind === 'currentcolor' ? current.alpha === 255 : s.color.value.alpha === 255));
}

/**
 * Why a box's background stack is translucent over a backdrop Dragon does not know, or null (R6). Dragon composites the colour and
 * every layer into one bitmap over transparent, which equals Chrome whatever lies behind only (a) where the stack is opaque: an
 * opaque colour, or an opaque gradient layer repeating on both axes, whose clip holds every gradient layer's clip. A box that
 * isolates its own paint (opacity below 1) waits for PNT1, which makes opacity a longhand. A single solid colour certified behind
 * every painted pixel is not offered: no program fact certifies it per pixel.
 */
export function translucencyRefusal(layers: readonly ElementLayer[], color: Rgba8, current: Rgba8, w: BoxWidths): string | null {
  const painted = layers.filter((l) => l.image.kind === 'gradient');
  if (painted.length === 0) return null;
  const bottom = layers[layers.length - 1] as ElementLayer;
  const covers = (clip: BoxItem): boolean => painted.every((l) => insideOnAxis(l.geometry.clip, clip, w, [1, 3]) && insideOnAxis(l.geometry.clip, clip, w, [0, 2]));
  if (color.alpha === 255 && covers(bottom.geometry.clip)) return null;
  for (const l of painted) {
    if (l.image.kind !== 'gradient' || !gradientOpaque(l.image.gradient, current)) continue;
    if (l.geometry.repeatX === 'repeat' && l.geometry.repeatY === 'repeat' && covers(l.geometry.clip)) return null;
  }
  return `the gradient layers are not opaque over every pixel they paint, and the native targets composite them over a backdrop they do not draw; give the box an opaque background-color or an opaque repeating gradient layer beneath (${BG2C})`;
}

const SIDE_NAMES = ['top', 'right', 'bottom', 'left'] as const;

/**
 * The native background colour fills the border box, but Chrome clips the colour to the bottom layer's clip and shows the
 * backdrop under the border outside it: equal only where every side with a border hides what is under it (opaque solid).
 */
export function colourClipRefusal(layers: readonly ElementLayer[], color: Rgba8, w: BoxWidths): string | null {
  const bottom = layers[layers.length - 1];
  if (bottom === undefined || bottom.geometry.clip === 'border-box' || color.alpha === 0) return null;
  const open = SIDE_NAMES.filter((_s, i) => (w.borders[i] as number) !== 0 && w.obscures[i] !== true);
  if (open.length > 0) return `the background colour is clipped to the ${bottom.geometry.clip}, and the ${open.join(', ')} border${open.length > 1 ? 's' : ''} (not opaque solid) show${open.length > 1 ? '' : 's'} what is behind the box outside that clip, but Dragon's native background colour fills the border box (${BG2C})`;
  // A content-box clip leaves the padding showing the backdrop, which the native colour would fill too.
  const padded = bottom.geometry.clip === 'content-box' ? SIDE_NAMES.filter((_s, i) => w.padding[i] !== 0) : [];
  if (padded.length > 0) return `the background colour is clipped to the content-box, and the ${padded.join(', ')} padding shows what is behind the box outside that clip, but Dragon's native background colour fills the border box (${BG2C})`;
  return null;
}

/** A resolved element's compile-time border and padding widths in px (a percentage padding other than 0% is unknown). */
export function boxWidths(el: ResolvedElement): BoxWidths {
  const px = (p: string): number | null => {
    const v = (el.props.get(p as never) as ResolvedValue).value;
    if (v.kind === 'length' && v.unit === 'px') return v.value;
    if (v.kind === 'percentage' && v.value === 0) return 0;
    return null;
  };
  const colors = usedColors(el);
  const styleOf = (s: string): string => {
    const v = (el.props.get(`border-${s}-style` as never) as ResolvedValue).value;
    return v.kind === 'keyword' ? v.value : '';
  };
  const borders = SIDE_NAMES.map((s) => (styleOf(s) === 'none' || styleOf(s) === 'hidden' ? 0 : (px(`border-${s}-width`) ?? 1)));
  const obscures = SIDE_NAMES.map((s) => obscuresOf(styleOf(s), colors[`border-${s}-color`]) === 'always');
  return { borders, padding: SIDE_NAMES.map((s) => px(`padding-${s}`)), obscures };
}

/** The layers of a resolved element (elementLayers over its props). */
export function resolvedLayers(el: ResolvedElement): ElementLayer[] {
  return elementLayers((p) => (el.props.get(p) as ResolvedValue).value);
}

/**
 * R4: Chrome rasters a gradient box in the root scroller's layer unless the box or an ancestor has a compositing reason; then the
 * layer's origin starts the cc tiles, the dither and the shader matrix, which Dragon does not model. will-change: transform or
 * opacity is the one such reason Dragon compiles (every other one is refused where it is parsed).
 */
export function compositesSubtree(el: ResolvedElement): boolean {
  return elementWillChange(el).some((f) => f === 'transform' || f === 'opacity');
}

/** Refuses, on the native targets, every gradient box in the subtree of `root`, which rasters in its own composited layer (R4). */
function refuseComposited(el: ResolvedElement, root: ResolvedElement, native: readonly string[], diagnostics: Diagnostic[], reported: Set<string>): void {
  const image = el.props.get('background-image') as ResolvedValue | undefined;
  if (image !== undefined && resolvedLayers(el).some((l) => l.image.kind === 'gradient')) {
    refuse(el, image, native, 'background-layers-layer', `background-image on ${el.element.address}: the box rasters in the composited layer of ${root.element.address} (will-change), which Dragon does not model (${BG2C})`, 'Remove will-change: transform and opacity from the gradient box and its ancestors.', diagnostics, reported);
  }
  for (const c of el.children) if (c.kind === 'element') refuseComposited(c, root, native, diagnostics, reported);
}

/** A located element refusal: at the declaration of `at`, for the targets given. */
function refuse(el: ResolvedElement, at: ResolvedValue, targets: readonly string[], key: string, message: string, manual: string, diagnostics: Diagnostic[], reported: Set<string>): void {
  const origin = at.declaration === null ? el.element.node.origin : authored(at.declaration.valueSpan);
  for (const t of targets) {
    const id = `${t}|${key}|${el.element.address}`;
    if (reported.has(id)) continue;
    reported.add(id);
    diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_VALUE', { origin, target: t, message, manual, basis: 'computed-value' }));
  }
}

/**
 * The element refusals of BG2. Every target: a gradient on html or body (it paints the canvas) or on an inline box (painted per
 * line fragment), which no target models yet (BG2c). The native targets only: a background colour clipped inside a border that
 * shows the backdrop (reported at background-clip); an angle off the measured grid or a corner (R3, BG2b); a layer Chrome would
 * tile (R8, BG2-t); a stack translucent over an unknown backdrop (R6, BG2c); a composited layer Dragon does not model (R4, BG2c).
 */
/**
 * The first length of a layer longhand's computed value that compute left unfolded (an em or rem whose font size is not known at
 * compile time, e.g. under font-size: larger), as its text, or null. The layers are read only when every length is px.
 */
export function unfoldedLength(v: CssValue): string | null {
  const text = v.kind === 'other' ? v.text : null;
  if (text === null) return null;
  let found: string | null = null;
  eachNode(parse(text, { context: 'value' }), (n) => {
    if (found === null && foldsToPx(n, false)) found = generate(n);
  });
  return found;
}

const checkBackgroundLayers: PaintCheck = (el, targets, diagnostics, reported) => {
  const native = targets.filter((t) => t !== 'web');
  if (compositesSubtree(el)) refuseComposited(el, el, native, diagnostics, reported);
  for (const p of BACKGROUND_LAYERS_LONGHANDS) {
    const v = el.props.get(p as Longhand);
    const length = v === undefined ? null : unfoldedLength(v.value);
    if (v === undefined || length === null) continue;
    refuse(el, v, targets, `background-layers-unfolded-${p}`, `${p} on ${el.element.address}: ${length} is relative to a font size Dragon does not know at compile time, so the layer cannot be computed (${CALC_P})`, 'Give the element (or its root, for rem) a font-size in px, or write the length in px.', diagnostics, reported);
    return;
  }
  const clip = el.props.get('background-clip') as ResolvedValue | undefined;
  if (clip !== undefined && clip.declaration !== null) {
    const reason = colourClipRefusal(resolvedLayers(el), usedColors(el)['background-color'], boxWidths(el));
    if (reason !== null) refuse(el, clip, native, 'background-clip', `background-clip on ${el.element.address}: ${reason}`, 'Clip the background to the border box, or give every side with a border an opaque solid style.', diagnostics, reported);
  }
  const image = el.props.get('background-image') as ResolvedValue | undefined;
  if (image === undefined || (image.value.kind === 'keyword' && image.value.value === 'none')) return;
  const layers = resolvedLayers(el);
  if (!layers.some((l) => l.image.kind === 'gradient')) return;
  const tag = el.element.tag;
  const display = (el.props.get('display') as ResolvedValue).value;
  if (tag === 'html' || tag === 'body') {
    refuse(el, image, targets, 'background-layers-canvas', `background-image on ${el.element.address}: a gradient on <${tag}> paints the canvas (css-backgrounds-3 §2.11.2), which Dragon does not model (${BG2C})`, 'Put the gradient on a descendant box that covers the page.', diagnostics, reported);
    return;
  }
  if (display.kind === 'keyword' && display.value === 'inline') {
    refuse(el, image, targets, 'background-layers-inline', `background-image on ${el.element.address}: a gradient on an inline box is painted per line fragment, which Dragon does not model (${BG2C})`, 'Put the gradient on a block box.', diagnostics, reported);
    return;
  }
  for (const l of layers) {
    if (l.image.kind !== 'gradient') continue;
    const g = l.image.gradient;
    if (!g.radial && g.direction === 'side' && g.sideX !== 'none' && g.sideY !== 'none') {
      refuse(el, image, native, 'background-layers-corner', `background-image on ${el.element.address}: a gradient to a corner takes its angle from atan2 and tan of the box size at paint time, libm results the native targets do not have (${BG2B})`, 'Write the gradient with an angle in degrees, on the 0.01deg grid.', diagnostics, reported);
      return;
    }
    if (!g.radial && g.direction === 'angle' && linearSlope(g.angleDeg) === null) {
      refuse(el, image, native, 'background-layers-angle', `background-image on ${el.element.address}: the angle ${g.angleDeg}deg is off the 0.01deg grid whose tan the capture host measured (${BG2B})`, 'Round the angle to 0.01deg.', diagnostics, reported);
      return;
    }
    const tiles = tilingRefusal(l.geometry, boxWidths(el));
    if (tiles !== null) {
      refuse(el, image, native, 'background-layers-tiling', `background-image on ${el.element.address}: ${tiles}`, 'Draw one tile: size auto (or cover or contain) and a start position on a repeating axis, or no-repeat.', diagnostics, reported);
      return;
    }
  }
  // The device clips the one raster to the radius module's rounded border box; Chrome clips a padding-box or content-box layer
  // (and the colour) to the inner rounded box instead.
  const rounded = RADIUS_LONGHANDS.some((p) => {
    const c = cornerComponents((el.props.get(p) as ResolvedValue).value);
    return c !== null && c[0].value > 0 && c[1].value > 0;
  });
  if (rounded && (layers[layers.length - 1]?.geometry.clip !== 'border-box' || layers.some((l) => l.image.kind === 'gradient' && l.geometry.clip !== 'border-box'))) {
    refuse(el, image, native, 'background-layers-rounded-clip', `background-image on ${el.element.address}: a rounded box clips a padding-box or content-box layer to its inner rounded box, and the native targets clip the layers to the rounded border box only (${BG2C})`, 'Clip the background to the border box on a rounded box.', diagnostics, reported);
    return;
  }
  const colors = usedColors(el);
  const translucent = translucencyRefusal(layers, colors['background-color'], colors.color, boxWidths(el));
  if (translucent !== null) {
    refuse(el, image, native, 'background-layers-translucent', `background-image on ${el.element.address}: ${translucent}`, 'Give the box an opaque background-color or an opaque repeating gradient layer beneath.', diagnostics, reported);
    return;
  }
  // Until BG2-a3's lowering, the native programs carry no gradient write, so nothing would draw the layers.
  refuse(el, image, native, 'background-layers-native', `background-image on ${el.element.address}: the native targets draw gradient layers from BG2-a3 on`, 'Compile for web, or wait for BG2-a3.', diagnostics, reported);
};

/**
 * The layer longhands' em and rem lengths as px (R7, as PNT1 radius.ts computeComponent folds radii), and the absolute lengths of
 * positions and sizes, as Chrome 145 computes them; a gradient keeps its absolute lengths as written, as Chrome serializes it.
 */
function foldLayerLengths(v: ResolvedValue, property: BackgroundLayerLonghand, ctx: PaintValueContext): ResolvedValue | null {
  const text = v.value.kind === 'other' ? v.value.text : null;
  if (text === null) return null;
  const node = parse(text, { context: 'value' });
  let changed = false;
  let unknown = false;
  const absolute = property !== 'background-image';
  eachNode(node, (n) => {
    if (!foldsToPx(n, absolute)) return;
    const unit = normalizeUnit(String(n['unit']));
    if ((unit === 'em' && ctx.em === null) || (unit === 'rem' && ctx.rem === null)) {
      unknown = true;
      return;
    }
    const px = lengthToPx(Number(n['value']), unit, { em: ctx.em ?? 0, rem: ctx.rem ?? 0 });
    if (px === null) {
      unknown = true;
      return;
    }
    const m = n as unknown as { value: string; unit: string };
    m.value = String(px);
    m.unit = 'px';
    changed = true;
  });
  if (!changed || unknown) return null;
  return { ...v, value: layerValue(property, commaItems(children(node))) };
}

export const GRADIENT_VALUES: PaintValues = {
  name: 'gradient',
  check: checkBackgroundLayers,
  compute: (props, ctx) => {
    for (const p of BACKGROUND_LAYERS_LONGHANDS) {
      const v = props.get(p as Longhand);
      if (v === undefined) continue;
      const folded = foldLayerLengths(v, p, ctx);
      if (folded !== null) props.set(p as Longhand, folded);
    }
  },
};
