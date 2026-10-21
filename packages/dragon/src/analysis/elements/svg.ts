// SVG-a1 (docs/goals/milestone-2-proof/notes/T-svg-a-spec.md): an inline <svg> is a replaced box (elements/replaced.ts) whose
// content is its <path>, <rect> and
// <circle> children. This module holds what the compiler reads from their attributes and geometry properties: the geometry attributes, the presentation
// attributes of the svg property family (and the svg's width and height), the viewBox, and the refusals of everything else.
import { parse } from 'css-tree';
import type { CssNode } from 'css-tree';
import { parsePathData, parseSvgLength, parseViewBox } from './svg-path.ts';
import type { SvgShape, ViewBox } from '@dragon/layout';
import type { Rgba8 } from '../../css/color.ts';
import { TRANSPARENT } from '../../css/color.ts';
import { opacityOf } from '../../css/properties/effects.ts';
import { dashArrayOf } from '../../css/properties/svg-dash.ts';
import { paintsStrokeFirst } from '../../css/properties/svg-paint-order.ts';
import type { Longhand } from '../../css/properties.ts';
import type { CssValue, Declaration } from '../../css/stylesheet.ts';
import { parseValue } from '../../css/stylesheet.ts';
import type { ResolvedValue } from '../computed.ts';
import type { LinkedElement } from '../link.ts';
import type { ResolvedElement } from '../resolve.ts';

export const SVG_TAG = 'svg';

/** The presentation attributes Dragon maps to its svg property family (SVG 2 §6.6); author rules beat them. */
export type SvgPaintAttribute = 'fill' | 'stroke' | 'stroke-width' | 'fill-opacity' | 'stroke-opacity' | 'stroke-linecap' | 'stroke-linejoin' | 'stroke-miterlimit' | 'fill-rule' | 'stroke-dasharray' | 'stroke-dashoffset' | 'paint-order' | 'vector-effect' | 'clip-rule' | 'marker-start' | 'marker-mid' | 'marker-end' | 'stop-color' | 'stop-opacity' | 'flood-color' | 'flood-opacity' | 'lighting-color' | 'mask-type' | 'text-anchor' | 'dominant-baseline' | 'alignment-baseline';
export const SVG_PAINT_ATTRIBUTES: readonly SvgPaintAttribute[] = ['fill', 'stroke', 'stroke-width', 'fill-opacity', 'stroke-opacity', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', 'fill-rule', 'stroke-dasharray', 'stroke-dashoffset', 'paint-order', 'vector-effect', 'clip-rule', 'marker-start', 'marker-mid', 'marker-end', 'stop-color', 'stop-opacity', 'flood-color', 'flood-opacity', 'lighting-color', 'mask-type', 'text-anchor', 'dominant-baseline', 'alignment-baseline'];

/** The attributes each SVG tag compiles: its geometry, the paint presentation attributes, and xmlns (no effect in HTML). */
export const SVG_HANDLED_ATTRIBUTES: { readonly [tag: string]: readonly string[] } = {
  svg: ['width', 'height', 'viewBox', 'xmlns', ...SVG_PAINT_ATTRIBUTES],
  path: ['d', ...SVG_PAINT_ATTRIBUTES],
  rect: ['x', 'y', 'width', 'height', 'rx', 'ry', ...SVG_PAINT_ATTRIBUTES],
  circle: ['cx', 'cy', 'r', ...SVG_PAINT_ATTRIBUTES],
};

/** The package that owns a refused SVG attribute's effect. */
const SVG_ATTRIBUTE_OWNERS: { readonly [name: string]: string } = {
  transform: 'the SVG transform package SVG-transform',
  preserveAspectRatio: 'the SVG transform package SVG-transform',
  opacity: 'the SVG opacity package SVG-opacity',
  'clip-path': 'the clipping package MASK-CLIP',
  mask: 'the clipping package MASK-CLIP',
  // SVG-dash: pathLength scales the dashes (Blink SVGLayoutSupport::ApplyStrokeStyleToStrokeData's dash_scale_factor).
  'pathLength': 'the SVG path length package SVG-pathlength',
};

/** Whether a tag is an SVG shape an <svg> draws. */
export function isSvgShapeTag(tag: string): boolean {
  return tag === 'path' || tag === 'rect' || tag === 'circle';
}

/** Whether an attribute compiles on an SVG tag. */
export function svgAttributeHandled(tag: string, name: string): boolean {
  return Object.hasOwn(SVG_HANDLED_ATTRIBUTES, tag) && (SVG_HANDLED_ATTRIBUTES[tag] as readonly string[]).includes(name);
}

/** The owner of a refused attribute on an SVG tag, or null when this module does not name one. */
export function svgAttributeOwner(tag: string, name: string): string | null {
  if (!Object.hasOwn(SVG_HANDLED_ATTRIBUTES, tag)) return null;
  return Object.hasOwn(SVG_ATTRIBUTE_OWNERS, name) ? (SVG_ATTRIBUTE_OWNERS[name] as string) : null;
}

/**
 * Why a computed fill or stroke value is not drawn yet (a paint server or a context keyword), or (SVG-inert) a marker other than
 * none, or null.
 */
export function svgPaintRefusal(property: string, v: CssValue): string | null {
  if (property === 'marker-start' || property === 'marker-mid' || property === 'marker-end') {
    return v.kind === 'keyword' && v.value === 'none' ? null : '<marker> elements are not built yet (package SVG-b)';
  }
  if (property !== 'fill' && property !== 'stroke') return null;
  if (v.kind === 'color' || (v.kind === 'keyword' && ['none', 'currentcolor', 'transparent'].includes(v.value))) return null;
  return 'paint servers (url()) and the context-fill and context-stroke keywords are not built yet (package SVG-paint)';
}

/** A presentation attribute's value as its property's CSS value, or why it does not compile. */
export function paintAttributeValue(property: SvgPaintAttribute, text: string): { readonly ok: true; readonly value: CssValue } | { readonly ok: false; readonly reason: string } {
  let node: CssNode;
  try {
    node = parse(text, { context: 'value', positions: true });
  } catch {
    return { ok: false, reason: `"${text}" does not parse as a value of ${property}` };
  }
  const tokens = (node['children'] as { toArray(): CssNode[] }).toArray().filter((n) => n.type !== 'WhiteSpace');
  const base = { source: { uri: 'dragon-svg-attribute', revision: '0', hash: '0' }, start: 0, end: text.length };
  const parsed = parseValue(property, node, tokens, base, text);
  if (parsed.kind === 'ok' && parsed.longhands.length === 1) {
    const v = (parsed.longhands[0] as { readonly value: CssValue }).value;
    if (v.kind === 'keyword' && ['inherit', 'initial', 'unset', 'revert', 'revert-layer'].includes(v.value)) return { ok: false, reason: `a CSS-wide keyword in a presentation attribute is not supported (Chrome ignores it)` };
    const why = svgPaintRefusal(property, v);
    return why === null ? { ok: true, value: v } : { ok: false, reason: why };
  }
  if (parsed.kind === 'token') return { ok: false, reason: `${text} is unsupported: ${parsed.reason}` };
  if (parsed.kind === 'refused') return { ok: false, reason: parsed.diagnostic.message };
  return { ok: false, reason: `"${text}" is not a valid ${property}, so Chrome ignores the attribute` };
}

/**
 * Why a computed stroke-width, stroke-dasharray or stroke-dashoffset with a percentage does not compile, or null: a percentage of
 * them is of the viewport diagonal (SVG 2 §8.9), which is not resolved yet.
 */
export function svgPercentageRefusal(name: string, v: CssValue): string | null {
  const percentage = name === 'stroke-dasharray' ? v.kind !== 'keyword' && dashArrayOf(v) === 'percentage' : (name === 'stroke-width' || name === 'stroke-dashoffset') && v.kind === 'percentage';
  return percentage ? `a percentage ${name} is relative to the viewport diagonal, which is not built yet (package SVG-units)` : null;
}

/**
 * Why an attribute value of an SVG tag cannot compile, or null. Chrome ignores an invalid geometry or paint attribute, or renders a
 * path up to its first error; Dragon has no proof of those outcomes, so it refuses them.
 */
export function svgAttributeRefusal(tag: string, name: string, text: string): string | null {
  if (!svgAttributeHandled(tag, name)) return null;
  if ((SVG_PAINT_ATTRIBUTES as readonly string[]).includes(name)) {
    const v = paintAttributeValue(name as SvgPaintAttribute, text);
    if (!v.ok) return v.reason;
    return svgPercentageRefusal(name, v.value);
  }
  if (name === 'xmlns') return text === 'http://www.w3.org/2000/svg' ? null : 'an xmlns other than the SVG namespace';
  if (name === 'viewBox') return parseViewBox(text) === null ? 'a viewBox must be four numbers with a positive width and height (Chrome ignores any other)' : null;
  if (name === 'd') {
    const d = parsePathData(text);
    return d.ok ? null : d.arc ? d.reason : `the path data does not parse (${d.reason}); Chrome would draw it only up to the error`;
  }
  const v = parseSvgLength(text);
  if (v === null) return svgRadiusAttributeOf(name, text) === null ? 'only numbers and px lengths are built (package SVG-units)' : null;
  if ((name === 'width' || name === 'height' || name === 'r') && v < 0) return 'a negative value is an error, which disables rendering in Chrome';
  return null;
}

/**
 * SVG-rrect: the px value a rect's rx or ry attribute hints, or null when the text is a length Dragon does not build (a percentage,
 * em, a calculation: package SVG-units). Chrome keeps a negative attribute as the computed value and paints it as auto
 * (svgRectRadii), and computes text that is no length at all (auto, inherit, a word, empty, "5 px", "5.") to 0. Text with a function
 * (var(), calc(), env()) or another dimension may resolve to a length in Chrome, so it is refused.
 */
function svgRadiusAttributeOf(name: string, text: string): number | null {
  if (name !== 'rx' && name !== 'ry') return null;
  const v = parseSvgLength(text);
  if (v !== null) return v;
  return text.includes('(') || /^[ \t\n\r\f]*[+-]?(?:[0-9]+(?:\.[0-9]+)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?(?:[a-zA-Z]+|%)[ \t\n\r\f]*$/.test(text) ? null : 0;
}

/** The geometry properties each shape tag maps its attributes to (SVG 2 §10.3, §10.4); a rect's width and height are below. */
const SVG_GEOMETRY_HINTS: { readonly [tag: string]: readonly SvgGeometryProperty[] } = { rect: ['x', 'y', 'rx', 'ry'], circle: ['cx', 'cy', 'r'] };

/** The SVG geometry properties a shape draws from (SVG-geometry, and SVG-rrect's corner radii). */
export type SvgGeometryProperty = 'cx' | 'cy' | 'r' | 'x' | 'y' | 'rx' | 'ry';

/**
 * The presentation hints of an SVG element: the svg property family, an svg's width and height, and (SVG-geometry) a rect's x, y,
 * width and height and a circle's cx, cy and r, and (SVG-rrect) a rect's rx and ry, as CSS values.
 */
export function svgPresentationHints(tag: string, attributes: ReadonlyMap<string, string>): Map<Longhand, CssValue> {
  const out = new Map<Longhand, CssValue>();
  if (!Object.hasOwn(SVG_HANDLED_ATTRIBUTES, tag)) return out;
  for (const p of SVG_PAINT_ATTRIBUTES) {
    const text = attributes.get(p);
    if (text === undefined) continue;
    const v = paintAttributeValue(p, text);
    if (v.ok) out.set(p, v.value);
  }
  for (const p of SVG_GEOMETRY_HINTS[tag] ?? []) {
    const text = attributes.get(p);
    const v = text === undefined ? null : p === 'rx' || p === 'ry' ? svgRadiusAttributeOf(p, text) : parseSvgLength(text);
    if (v !== null && !(p === 'r' && v < 0)) out.set(p, { kind: 'length', value: v, unit: 'px' });
  }
  // An svg's width and height, and a rect's, are geometry properties their attributes map to (SVG 2 §10.4, §11.2).
  if (tag === SVG_TAG || tag === 'rect') {
    for (const p of ['width', 'height'] as const) {
      const text = attributes.get(p);
      const v = text === undefined ? null : parseSvgLength(text);
      if (v !== null && v >= 0) out.set(p, { kind: 'length', value: v, unit: 'px' });
    }
  }
  return out;
}

/** An svg's viewBox, or null when it has none. */
export function viewBoxOf(attributes: ReadonlyMap<string, string>): ViewBox | null {
  const text = attributes.get('viewBox');
  return text === undefined ? null : parseViewBox(text);
}

/**
 * A shape's computed geometry property in user units (a px length, or a number, Chrome's SVG attribute mode), or null for one that
 * is not resolved yet: a percentage of the viewport, or a calculation (computed-checks.ts checkSvg refuses both). An rx or ry of
 * auto is 'auto'.
 */
export function svgGeometryOf(el: ResolvedElement, p: SvgGeometryProperty): number | 'auto' | null {
  const v = (el.props.get(p) as ResolvedValue | undefined)?.value;
  if (v === undefined) throw new Error(`${el.element.address}: ${p} did not resolve`);
  if ((p === 'rx' || p === 'ry') && v.kind === 'keyword' && v.value === 'auto') return 'auto';
  return v.kind === 'length' && v.unit === 'px' ? v.value : v.kind === 'number' ? v.value : null;
}

/** A geometry property that has no auto: its user units, or null when it is not resolved yet (svgGeometryOf). */
function svgLengthOf(el: ResolvedElement, p: 'cx' | 'cy' | 'r' | 'x' | 'y'): number | null {
  const v = svgGeometryOf(el, p);
  if (v === 'auto') throw new Error(`${el.element.address}: ${p} computed to auto`);
  return v;
}

/**
 * SVG-rrect: a rect's used corner radii from its computed rx and ry, as SVG 2 §10.4 resolves them: an auto radius takes the other's
 * value (both auto are 0), then each is at most half the rect's width or height. A negative radius (only an attribute gives one)
 * paints as auto, as Chrome paints it. Null when one is not resolved yet.
 */
export function svgRectRadii(rx: number | 'auto' | null, ry: number | 'auto' | null, width: number, height: number): { readonly rx: number; readonly ry: number } | null {
  if (rx === null || ry === null) return null;
  const ax = rx === 'auto' || rx < 0 ? 'auto' : rx;
  const ay = ry === 'auto' || ry < 0 ? 'auto' : ry;
  const x = ax === 'auto' ? (ay === 'auto' ? 0 : ay) : ax;
  const y = ay === 'auto' ? x : ay;
  return { rx: Math.min(x, width / 2), ry: Math.min(y, height / 2) };
}

/**
 * A shape's geometry (an absent d is an empty path), or null when it is refused. A path's d and a rect's width and height come from
 * the attributes (absent ones are 0); SVG-geometry: a rect's x and y and a circle's cx, cy and r are the computed properties, which
 * the attributes are presentation hints of. SVG-rrect: a rect's rx and ry round its corners (svgRectRadii); a rect with a zero
 * radius is square, as Skia's SkRRect::setRectXY makes it.
 */
export function shapeOf(el: ResolvedElement): SvgShape | null {
  const tag = el.element.tag;
  const attributes = el.element.attributes;
  const num = (name: string): number | null => {
    const text = attributes.get(name);
    return text === undefined ? 0 : parseSvgLength(text);
  };
  if (tag === 'path') {
    const d = parsePathData(attributes.get('d') ?? '');
    return d.ok ? { kind: 'path', segments: d.segments } : null;
  }
  if (tag === 'rect') {
    const [x, y, width, height] = [svgLengthOf(el, 'x'), svgLengthOf(el, 'y'), num('width'), num('height')];
    if (x === null || y === null || width === null || height === null) return null;
    const radii = svgRectRadii(svgGeometryOf(el, 'rx'), svgGeometryOf(el, 'ry'), width, height);
    if (radii === null) return null;
    return radii.rx > 0 && radii.ry > 0 ? { kind: 'rect', x, y, width, height, rx: radii.rx, ry: radii.ry } : { kind: 'rect', x, y, width, height };
  }
  if (tag === 'circle') {
    const [cx, cy, r] = [svgLengthOf(el, 'cx'), svgLengthOf(el, 'cy'), svgLengthOf(el, 'r')];
    return cx === null || cy === null || r === null ? null : { kind: 'circle', cx, cy, r };
  }
  return null;
}

/** A shape's paint: none, or a colour (currentcolor resolved against the shape's own color). */
export type SvgPaint = { readonly kind: 'none' } | { readonly kind: 'color'; readonly color: Rgba8 };

/** One drawn shape of an <svg>: its address, geometry in user units, and paint. strokeWidth is in user units (px before the viewBox). */
/** painted: whether Chrome paints the shape (svgShapePainted); one it does not still has its box and bbox. */
export type SvgShapeScene = {
  readonly address: string;
  readonly tag: string;
  readonly shape: SvgShape;
  readonly fill: SvgPaint;
  readonly stroke: SvgPaint;
  readonly strokeWidth: number;
  readonly fillOpacity: number;
  readonly strokeOpacity: number;
  /** SVG-stroke: the computed stroke-linecap, stroke-linejoin, stroke-miterlimit and fill-rule. */
  readonly cap: SvgLineCap;
  readonly join: SvgLineJoin;
  readonly miterLimit: number;
  readonly fillRule: SvgFillRule;
  /**
   * SVG-dash: the dash lengths in user units as Chrome strokes them (Blink StrokeData::SetLineDash): [] for a solid stroke (none,
   * or dashes that sum to 0, which Skia's dash effect rejects), an odd list repeated to an even one; and the computed
   * stroke-dashoffset in user units.
   */
  readonly dashes: readonly number[];
  readonly dashOffset: number;
  /** SVG-paint-order: whether the computed paint-order paints the stroke before the fill (paintsStrokeFirst). */
  readonly strokeFirst: boolean;
  /**
   * SVG-vector-effect: whether the computed vector-effect is non-scaling-stroke, so the stroke width and dashes are in the svg's
   * px (Chrome strokes the path mapped to the svg root, without the page zoom, an observation); the viewBox scale is uniform.
   */
  readonly nonScalingStroke: boolean;
  readonly painted: boolean;
};

export type SvgLineCap = 'butt' | 'round' | 'square';
export type SvgLineJoin = 'miter' | 'round' | 'bevel';
export type SvgFillRule = 'nonzero' | 'evenodd';

/** An <svg>'s drawing: its viewBox and its shapes in paint order. */
export type SvgScene = { readonly address: string; readonly viewBox: ViewBox | null; readonly shapes: readonly SvgShapeScene[] };

/** A shape's computed fill-opacity or stroke-opacity, in [0, 1]. */
function opacityOfProp(el: ResolvedElement, p: 'fill-opacity' | 'stroke-opacity'): number {
  const v = (el.props.get(p) as ResolvedValue).value;
  if (v.kind !== 'number') throw new Error(`${el.element.address}: ${p} did not compute to a number`);
  return v.value;
}

/** A shape's computed keyword of a property, checked against the keywords Chrome parses for it. */
function keywordOfProp<K extends string>(el: ResolvedElement, p: 'stroke-linecap' | 'stroke-linejoin' | 'fill-rule' | 'vector-effect', keywords: readonly K[]): K {
  const v = (el.props.get(p) as ResolvedValue).value;
  if (v.kind !== 'keyword' || !(keywords as readonly string[]).includes(v.value)) throw new Error(`${el.element.address}: ${p} did not compute to one of ${keywords.join(', ')}`);
  return v.value as K;
}

function paintOf(el: ResolvedElement, p: 'fill' | 'stroke'): SvgPaint {
  const v = (el.props.get(p) as ResolvedValue).value;
  if (v.kind === 'keyword' && v.value === 'none') return { kind: 'none' };
  if (v.kind === 'color') return { kind: 'color', color: v.value };
  if (v.kind === 'keyword' && v.value === 'transparent') return { kind: 'color', color: TRANSPARENT };
  if (v.kind === 'keyword' && v.value === 'currentcolor') {
    const c = (el.props.get('color') as ResolvedValue).value;
    if (c.kind === 'color') return { kind: 'color', color: c.value };
  }
  throw new Error(`${el.element.address}: ${p} did not resolve to a colour or none`);
}

/**
 * Whether Chrome renders nothing for a shape (Blink's IsShapeEmpty): a rect with a zero width or height, a circle with a zero
 * radius ("a value of zero disables rendering", SVG 2 §10.2, §10.3), or a path with no segments. It still has a box and a bbox.
 */
export function svgShapeEmpty(shape: SvgShape): boolean {
  if (shape.kind === 'rect') return shape.width === 0 || shape.height === 0;
  if (shape.kind === 'circle') return shape.r === 0;
  return shape.segments.length === 0;
}

/**
 * Whether a shape has a zero-length subpath: one that draws (a line, curve or close after its moveto) without leaving its start
 * point, control points included. SVG 2 §13.6.6 strokes it as a dot or square when the cap is round or square; native draws such
 * a cap with its own orientation rules, which nothing proves against Chrome yet. A lone moveto is not stroked (SVG 2 §9.5.1).
 */
export function svgZeroLengthSubpath(shape: SvgShape): boolean {
  if (shape.kind !== 'path') return false;
  let start: { x: number; y: number } | null = null;
  let draws = false;
  let zero = true;
  const at = (x: number, y: number): boolean => start !== null && x === start.x && y === start.y;
  for (const v of shape.segments) {
    if (v.kind === 'move') {
      if (draws && zero) return true;
      start = { x: v.x, y: v.y };
      draws = false;
      zero = true;
      continue;
    }
    draws = true;
    if (v.kind === 'line') zero &&= at(v.x, v.y);
    else if (v.kind === 'quad') zero &&= at(v.x1, v.y1) && at(v.x, v.y);
    else if (v.kind === 'cubic') zero &&= at(v.x1, v.y1) && at(v.x2, v.y2) && at(v.x, v.y);
    else {
      // A close ends the subpath; a command after it starts a new one at the same point.
      if (zero) return true;
      draws = false;
      zero = true;
    }
  }
  return draws && zero;
}

/**
 * Whether Chrome paints a shape: not at visibility hidden or collapse (collapse is hidden off tables, css-display-3 §4), and not at
 * a computed opacity of 0 (or below, which clamps to 0), where the shape's layer is fully transparent.
 */
export function svgShapePainted(el: ResolvedElement): boolean {
  const visibility = (el.props.get('visibility') as ResolvedValue).value;
  if (!(visibility.kind === 'keyword' && visibility.value === 'visible')) return false;
  return opacityOf((el.props.get('opacity') as ResolvedValue).value) !== 0;
}

/**
 * The scene of a resolved <svg>; null for any other element. A shape with display: none has no box and is left out; one Chrome does
 * not paint (svgShapePainted) keeps its box and bbox, marked unpainted, and draws nothing.
 */
export function svgSceneOf(el: ResolvedElement): SvgScene | null {
  if (el.element.tag !== SVG_TAG) return null;
  const shapes: SvgShapeScene[] = [];
  for (const c of el.children) {
    if (c.kind !== 'element' || !isSvgShapeTag(c.element.tag)) continue;
    const display = (c.props.get('display') as ResolvedValue).value;
    if (display.kind === 'keyword' && display.value === 'none') continue;
    const shape = shapeOf(c);
    if (shape === null) throw new Error(`${c.element.address}: a refused shape reached the scene`);
    const sw = (c.props.get('stroke-width') as ResolvedValue).value;
    const strokeWidth = sw.kind === 'length' && sw.unit === 'px' ? sw.value : sw.kind === 'number' ? sw.value : null;
    if (strokeWidth === null) throw new Error(`${c.element.address}: stroke-width did not compute to px`);
    const dashArray = dashArrayOf((c.props.get('stroke-dasharray') as ResolvedValue).value);
    if (dashArray === 'percentage') throw new Error(`${c.element.address}: a percentage stroke-dasharray reached the scene`);
    const off = (c.props.get('stroke-dashoffset') as ResolvedValue).value;
    const dashOffset = off.kind === 'length' && off.unit === 'px' ? off.value : off.kind === 'number' ? off.value : null;
    if (dashOffset === null) throw new Error(`${c.element.address}: stroke-dashoffset did not compute to px`);
    const miter = (c.props.get('stroke-miterlimit') as ResolvedValue).value;
    if (miter.kind !== 'number') throw new Error(`${c.element.address}: stroke-miterlimit did not compute to a number`);
    shapes.push({
      address: c.element.address,
      tag: c.element.tag,
      shape,
      fill: paintOf(c, 'fill'),
      stroke: paintOf(c, 'stroke'),
      strokeWidth,
      fillOpacity: opacityOfProp(c, 'fill-opacity'),
      strokeOpacity: opacityOfProp(c, 'stroke-opacity'),
      cap: keywordOfProp(c, 'stroke-linecap', ['butt', 'round', 'square'] as const),
      join: keywordOfProp(c, 'stroke-linejoin', ['miter', 'round', 'bevel'] as const),
      miterLimit: miter.value,
      fillRule: keywordOfProp(c, 'fill-rule', ['nonzero', 'evenodd'] as const),
      dashes: dashArray.reduce((a, b) => a + b, 0) > 0 ? (dashArray.length % 2 === 0 ? dashArray : [...dashArray, ...dashArray]) : [],
      dashOffset,
      strokeFirst: paintsStrokeFirst((c.props.get('paint-order') as ResolvedValue).value),
      nonScalingStroke: keywordOfProp(c, 'vector-effect', ['none', 'non-scaling-stroke'] as const) === 'non-scaling-stroke',
      painted: svgShapePainted(c),
    });
  }
  return { address: el.element.address, viewBox: viewBoxOf(el.element.attributes), shapes };
}

/**
 * The stand-in declaration of an SVG paint presentation attribute (SVG_PAINT_ATTRIBUTES), located at the attribute (its
 * element's start tag), or null for any other hint. Its value then reaches the profile check (usedKeys) as a CSS declaration's does.
 */
export function svgHintDeclaration(el: LinkedElement, property: Longhand, value: CssValue): Declaration | null {
  if (!(SVG_PAINT_ATTRIBUTES as readonly string[]).includes(property) || !Object.hasOwn(SVG_HANDLED_ATTRIBUTES, el.tag)) return null;
  const attr = el.node.attributes.find((a) => a.name === property);
  const text = el.attributes.get(property);
  if (attr === undefined || text === undefined || attr.origin.kind !== 'authored') return null;
  const span = attr.origin.span;
  return { property, text, span, valueSpan: span, longhands: [{ property, value, explicit: true }], order: -1, presentationHint: true };
}
