// Background layers and CSS gradients (css-backgrounds-3 §2-§3, css-images-3 §3; BG2): the typed reading of every layer
// longhand's items, the gradient syntax Dragon draws exactly (paint-gradient.ts in @dragon/layout ports Chrome 145's raster),
// the build-time refusals, and each box's layers as the lowering hands them to the device. Items are read from the css-tree
// nodes of an authored value (the parse driver) and from the text of a resolved value (the lowering), with one parser.
import { parse } from 'css-tree';
import type { CssNode } from 'css-tree';
import { list } from '../../css/ast.ts';
import type { Rgba8 } from '../../css/color.ts';
import { parseColorNode } from '../../css/color.ts';
import type { BackgroundLayerLonghand } from '../../css/properties/background-layers.ts';
import type { CssValue } from '../../css/values.ts';
import { authored, diagnostic } from '../../diagnostics/catalogue.ts';
import { usedColors } from '../../lower/paint/colors.ts';
import type { Diagnostic } from '../../types.ts';
import type { ResolvedElement, ResolvedValue } from '../resolve.ts';
import type { PaintValues } from './types.ts';
import { stubPaintValues } from './types.ts';

export const GRADIENT_VALUES: PaintValues = stubPaintValues('gradient');

/** Why a background value is refused, and the node it is refused at (null: the whole item). */
export type LayerRefusal = { readonly node: CssNode | null; readonly reason: string };

/** A <length-percentage> of the subset: a percentage or CSS px. */
export type LengthPct = { readonly unit: 'percent' | 'px'; readonly value: number };

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
export type RepeatItem = { readonly x: 'repeat' | 'no-repeat'; readonly y: 'repeat' | 'no-repeat' };
export type BoxItem = 'border-box' | 'padding-box' | 'content-box';

type Item<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly refusal: LayerRefusal };

const ok = <T>(value: T): Item<T> => ({ ok: true, value });
const no = <T>(node: CssNode | null, reason: string): Item<T> => ({ ok: false, refusal: { node, reason } });

const ident = (n: CssNode | undefined): string | null => (n !== undefined && n.type === 'Identifier' ? String(n['name']).toLowerCase() : null);
const isComma = (n: CssNode): boolean => n.type === 'Operator' && n['value'] === ',';

/** BG2b and BG2c name the follow-up packages that lift a refusal (notes/T046-paint-spec.md §5.4, T074). */
export const BG2B = 'BG2b';
export const BG2C = 'BG2c';

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

/** A <length-percentage> token of the subset: px, a percentage, or a unitless zero. */
function lengthPct(n: CssNode, what: string): Item<LengthPct> {
  if (n.type === 'Percentage') return ok({ unit: 'percent', value: Number(n['value']) });
  if (n.type === 'Number' && Number(n['value']) === 0) return ok({ unit: 'px', value: 0 });
  if (n.type === 'Dimension') {
    const unit = String(n['unit']).toLowerCase();
    if (unit === 'px') return ok({ unit: 'px', value: Number(n['value']) });
    return no(n, `${what} in ${unit} is not supported: Dragon draws background and gradient geometry from px and percentages only (${BG2C})`);
  }
  if (n.type === 'Function') return no(n, `${what} as ${String(n['name']).toLowerCase()}() is not supported: Dragon draws background and gradient geometry from px and percentages only (${BG2C})`);
  return no(n, `${what} must be a length or a percentage`);
}

/** Blink ComputeDegrees of an <angle> (math_extras.h Grad2deg, Rad2deg, Turn2deg in double); a unitless zero is 0deg. */
function angleDegrees(n: CssNode): number | null {
  if (n.type === 'Number' && Number(n['value']) === 0) return 0;
  if (n.type !== 'Dimension') return null;
  const v = Number(n['value']);
  const unit = String(n['unit']).toLowerCase();
  if (unit === 'deg') return v;
  if (unit === 'grad') return v * (360 / 400);
  if (unit === 'rad') return v * (180 / Math.PI);
  if (unit === 'turn') return v * 360;
  return null;
}

const SIDES_X = new Set(['left', 'right']);
const SIDES_Y = new Set(['top', 'bottom']);

/**
 * css-values-4 <position> (the gradient centre and background-position): one to four values as { x, y } percentages or px
 * from the left and top edges. An offset from the right or bottom edge computes to a calc() Dragon does not draw (BG2c).
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
      if (k === 'right' || k === 'bottom') return no(offset, `${what}: an offset from the ${k} edge computes to calc(100% - offset), which Dragon does not draw (${BG2C})`);
      if (k === 'center') return no(offset, `${what}: center takes no offset`);
      const o = lengthPct(offset, what);
      if (!o.ok) return o;
      v = o.value;
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
      if (c.type === 'Percentage' || c.type === 'Dimension' || c.type === 'Number') return no(c, `colour hints (a position without a colour) are not supported (${BG2B})`);
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
      if (v.value.value < 0) return no(p, `a negative colour stop position is not supported (${BG2C})`);
      out.push({ color: spec, unit: v.value.unit, value: v.value.value });
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
  const name = String(fn['name']).toLowerCase();
  const repeating = name.startsWith('repeating-');
  const base = repeating ? name.slice('repeating-'.length) : name;
  const groups = commaItems(children(fn));
  const head = groups[0] as CssNode[];
  if (head.some((t) => ident(t) === 'in')) return no(fn, `color interpolation methods (in <color-space>) are not supported (${BG2B})`);
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
  if (base === 'conic-gradient') return no(fn, `conic gradients are not supported (${BG2B})`);
  return no(fn, `${name}() is not supported`);
}

/** One background-image item: none or a gradient; url() and the other images are refused (REPL, BG2b). */
export function imageItem(tokens: readonly CssNode[]): Item<ImageItem> {
  const [t, extra] = tokens as [CssNode?, CssNode?];
  if (t === undefined || extra !== undefined) return no(t ?? null, 'a background image is one value');
  if (ident(t) === 'none') return ok({ kind: 'none' });
  if (t.type === 'Url') return no(t, 'url() images are not supported yet: raster images are drawn by the REPL package');
  if (t.type === 'Function') {
    const name = String(t['name']).toLowerCase();
    if (name === 'linear-gradient' || name === 'radial-gradient' || name === 'repeating-linear-gradient' || name === 'repeating-radial-gradient' || name === 'conic-gradient' || name === 'repeating-conic-gradient') {
      const g = gradient(t);
      return g.ok ? ok({ kind: 'gradient', gradient: g.value }) : g;
    }
    return no(t, `${name}() images are not supported (${BG2B})`);
  }
  return no(t, 'not a background image');
}

/** One background-position-x or -y item: a keyword, px or a percentage; an edge offset is refused (BG2c). */
export function positionAxisItem(tokens: readonly CssNode[], axis: 'x' | 'y'): Item<LengthPct> {
  const [t, off, extra] = tokens as [CssNode?, CssNode?, CssNode?];
  if (t === undefined || extra !== undefined) return no(t ?? null, 'a position axis is a keyword, a length or both');
  const k = ident(t);
  if (off !== undefined) {
    // An offset from the left or top edge is the length itself; from the right or bottom it computes to calc(100% - offset).
    if (k === (axis === 'x' ? 'left' : 'top')) return lengthPct(off, `background-position-${axis}`);
    return no(off, `an offset from the ${k ?? 'edge'} computes to a calc() Dragon does not draw (${BG2C})`);
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
  return ok(v.value);
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

/** One background-repeat item; space and round are refused (BG2c). */
export function repeatItem(tokens: readonly CssNode[]): Item<RepeatItem> {
  const [a, b, extra] = tokens as [CssNode?, CssNode?, CssNode?];
  if (a === undefined || extra !== undefined) return no(a ?? null, 'background-repeat takes one or two keywords');
  const one = (n: CssNode): Item<'repeat' | 'no-repeat'> => {
    const k = ident(n);
    if (k === 'repeat' || k === 'no-repeat') return ok(k);
    if (k === 'space' || k === 'round') return no(n, `background-repeat: ${k} is not supported (${BG2C})`);
    return no(n, `${k ?? 'this value'} is not a repeat keyword`);
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
  return no(t, `${property}: ${k ?? 'this value'} is not supported (${BG2C})`);
}

/** One background-attachment item: scroll; fixed and local are refused (BG2b). */
export function attachmentItem(tokens: readonly CssNode[]): Item<'scroll'> {
  const [t, extra] = tokens as [CssNode?, CssNode?];
  if (t === undefined || extra !== undefined) return no(t ?? null, 'background-attachment is one keyword');
  const k = ident(t);
  if (k === 'scroll') return ok('scroll');
  return no(t, `background-attachment: ${k ?? 'this value'} is not supported (${BG2B})`);
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
  readonly repeatX: 'repeat' | 'no-repeat';
  readonly repeatY: 'repeat' | 'no-repeat';
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

const isZero = (v: LengthPct): boolean => v.value === 0;

/**
 * Why Chrome would tile a layer (the picture shader, which Dragon does not draw), or null when it draws one tile: a
 * repeating axis needs the tile to be its positioning area (size auto, cover or contain), a zero position and a clip box
 * inside the origin box. A no-repeat axis always draws one tile.
 */
export function tilingRefusal(g: LayerGeometrySpec, w: BoxWidths): string | null {
  // The device reads border widths, not padding: a content box with padding has geometry it cannot place (BG2c).
  if ((g.origin === 'content-box' || g.clip === 'content-box') && !w.padding.every((p) => p === 0)) return `background-origin or background-clip content-box on a box with padding is not supported (${BG2C})`;
  for (const axis of ['x', 'y'] as const) {
    const repeat = axis === 'x' ? g.repeatX : g.repeatY;
    if (repeat !== 'repeat') continue;
    const size = axis === 'x' ? g.sizeX : g.sizeY;
    const pos = axis === 'x' ? g.positionX : g.positionY;
    if (g.sizeKind === 'length' && size.unit !== 'auto') return `a layer that repeats on the ${axis} axis with a size other than auto tiles (a picture shader Dragon does not draw); Dragon draws a repeating axis only at size auto (${BG2C})`;
    if (!isZero(pos)) return `a repeating layer at a ${axis} position other than 0 tiles; Dragon draws it only at position 0 (${BG2C})`;
    if (!insideOnAxis(g.clip, g.origin, w, axis === 'x' ? [1, 3] : [0, 2])) return `a repeating layer whose background-clip (${g.clip}) reaches outside its background-origin (${g.origin}) tiles into the border or padding (${BG2C})`;
  }
  return null;
}

/** Whether every stop of a gradient is opaque for an element whose color is `current`. */
export function gradientOpaque(g: GradientSpec, current: Rgba8): boolean {
  return g.stops.every((s) => (s.color.kind === 'currentcolor' ? current.alpha === 255 : s.color.value.alpha === 255));
}

/**
 * Why a box's background stack is not opaque over every pixel a gradient layer paints, or null when it is: either the
 * colour is opaque and clips outside every gradient layer's clip, or an opaque gradient layer that repeats on both axes
 * (so it fills its clip box) clips outside every gradient layer's clip. Dragon composites its raster over the native
 * backdrop, which is exact only where the raster is opaque.
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
  return `the gradient layers are not opaque over every pixel they paint, and Dragon composites them over a backdrop it does not draw itself; give the box an opaque background-color, or an opaque repeating gradient layer beneath (${BG2C})`;
}

const SIDE_NAMES = ['top', 'right', 'bottom', 'left'] as const;

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
 * The element refusals of BG2, for every target (a reject fixture blocks every output): gradients on html and body (they
 * paint the canvas), on inline boxes (painted per line fragment), layers Chrome would tile, and stacks that are not opaque
 * where they paint. Each is reported once at the declaration that set background-image.
 */
export function checkBackgroundLayers(el: ResolvedElement, targets: readonly string[], diagnostics: Diagnostic[], reported: Set<string>): void {
  const image = el.props.get('background-image') as ResolvedValue | undefined;
  if (image === undefined || image.declaration === null) return;
  if (image.value.kind === 'keyword' && image.value.value === 'none') return;
  const layers = resolvedLayers(el);
  if (!layers.some((l) => l.image.kind === 'gradient')) return;
  const tag = el.element.tag;
  const display = (el.props.get('display') as ResolvedValue).value;
  const w = boxWidths(el);
  const colors = usedColors(el);
  let reason: string | null = null;
  if (tag === 'html' || tag === 'body') reason = `a gradient on <${tag}> ${el.element.address} paints the canvas (css-backgrounds-3 §2.11.2), which Dragon does not draw (${BG2C})`;
  else if (display.kind === 'keyword' && display.value === 'inline') reason = `a gradient on the inline box ${el.element.address} is painted per line fragment, which Dragon does not draw (${BG2C})`;
  if (reason === null) {
    for (const l of layers) {
      if (l.image.kind !== 'gradient') continue;
      reason = tilingRefusal(l.geometry, w);
      if (reason !== null) break;
    }
  }
  if (reason === null) reason = translucencyRefusal(layers, colors['background-color'], colors.color, w);
  if (reason === null) return;
  const span = image.declaration.valueSpan;
  for (const t of targets) {
    const id = `${t}|background-layers|${span.source.uri}|${span.start}|${el.element.address}`;
    if (reported.has(id)) continue;
    reported.add(id);
    diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_VALUE', { origin: authored(span), target: t, message: `background-image on ${el.element.address}: ${reason}`, manual: 'Draw one opaque, untiled gradient stack: an opaque background-color or opaque repeating layer beneath, size auto and position 0 on repeating axes.', basis: 'computed-value' }));
  }
}
