// SVG-a1 (docs/goals/milestone-2-proof/notes/T-svg-a-spec.md): an inline <svg> is a replaced box (elements/replaced.ts) whose
// content is its <path>, <rect> and
// <circle> children. This module holds what the compiler reads from their attributes: the geometry attributes, the presentation
// attributes fill, stroke and stroke-width (and the svg's width and height), the viewBox, and the refusals of everything else.
import { parse } from 'css-tree';
import type { CssNode } from 'css-tree';
import { parsePathData, parseSvgLength, parseViewBox } from './svg-path.ts';
import type { SvgShape, ViewBox } from '@dragon/layout';
import type { Rgba8 } from '../../css/color.ts';
import { TRANSPARENT } from '../../css/color.ts';
import type { Longhand } from '../../css/properties.ts';
import type { CssValue, Declaration } from '../../css/stylesheet.ts';
import { parseValue } from '../../css/stylesheet.ts';
import type { ResolvedValue } from '../computed.ts';
import type { LinkedElement } from '../link.ts';
import type { ResolvedElement } from '../resolve.ts';

export const SVG_TAG = 'svg';

/** The presentation attributes Dragon maps to its svg property family (SVG 2 §6.6); author rules beat them. */
export const SVG_PAINT_ATTRIBUTES: readonly ('fill' | 'stroke' | 'stroke-width')[] = ['fill', 'stroke', 'stroke-width'];

/** The attributes each SVG tag compiles: its geometry, the paint presentation attributes, and xmlns (no effect in HTML). */
export const SVG_HANDLED_ATTRIBUTES: { readonly [tag: string]: readonly string[] } = {
  svg: ['width', 'height', 'viewBox', 'xmlns', ...SVG_PAINT_ATTRIBUTES],
  path: ['d', ...SVG_PAINT_ATTRIBUTES],
  rect: ['x', 'y', 'width', 'height', ...SVG_PAINT_ATTRIBUTES],
  circle: ['cx', 'cy', 'r', ...SVG_PAINT_ATTRIBUTES],
};

/** The package that owns a refused SVG attribute's effect. */
const SVG_ATTRIBUTE_OWNERS: { readonly [name: string]: string } = {
  transform: 'the SVG transform package SVG-transform',
  preserveAspectRatio: 'the SVG transform package SVG-transform',
  rx: 'the SVG structure package SVG-b (rounded rects)',
  ry: 'the SVG structure package SVG-b (rounded rects)',
  'fill-opacity': 'the SVG opacity package SVG-opacity',
  'stroke-opacity': 'the SVG opacity package SVG-opacity',
  opacity: 'the SVG opacity package SVG-opacity',
  'stroke-dasharray': 'the SVG dash package SVG-dash',
  'stroke-dashoffset': 'the SVG dash package SVG-dash',
  'stroke-linecap': 'the SVG stroke package SVG-stroke',
  'stroke-linejoin': 'the SVG stroke package SVG-stroke',
  'stroke-miterlimit': 'the SVG stroke package SVG-stroke',
  'fill-rule': 'the SVG stroke package SVG-stroke',
  'clip-path': 'the clipping package MASK-CLIP',
  mask: 'the clipping package MASK-CLIP',
  'pathLength': 'the SVG dash package SVG-dash',
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

/** Why a computed fill or stroke value is not drawn yet (a paint server or a context keyword), or null. */
export function svgPaintRefusal(property: string, v: CssValue): string | null {
  if (property !== 'fill' && property !== 'stroke') return null;
  if (v.kind === 'color' || (v.kind === 'keyword' && ['none', 'currentcolor', 'transparent'].includes(v.value))) return null;
  return 'paint servers (url()) and the context-fill and context-stroke keywords are not built yet (package SVG-paint)';
}

/** A presentation attribute's value as its property's CSS value, or why it does not compile. */
export function paintAttributeValue(property: 'fill' | 'stroke' | 'stroke-width', text: string): { readonly ok: true; readonly value: CssValue } | { readonly ok: false; readonly reason: string } {
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
 * Why an attribute value of an SVG tag cannot compile, or null. Chrome ignores an invalid geometry or paint attribute, or renders a
 * path up to its first error; Dragon has no proof of those outcomes, so it refuses them.
 */
export function svgAttributeRefusal(tag: string, name: string, text: string): string | null {
  if (!svgAttributeHandled(tag, name)) return null;
  if ((SVG_PAINT_ATTRIBUTES as readonly string[]).includes(name)) {
    const v = paintAttributeValue(name as 'fill' | 'stroke' | 'stroke-width', text);
    if (!v.ok) return v.reason;
    return v.value.kind === 'percentage' ? 'a percentage stroke-width is relative to the viewport diagonal, which is not built yet (package SVG-units)' : null;
  }
  if (name === 'xmlns') return text === 'http://www.w3.org/2000/svg' ? null : 'an xmlns other than the SVG namespace';
  if (name === 'viewBox') return parseViewBox(text) === null ? 'a viewBox must be four numbers with a positive width and height (Chrome ignores any other)' : null;
  if (name === 'd') {
    const d = parsePathData(text);
    return d.ok ? null : d.arc ? d.reason : `the path data does not parse (${d.reason}); Chrome would draw it only up to the error`;
  }
  const v = parseSvgLength(text);
  if (v === null) return 'only numbers and px lengths are built (package SVG-units)';
  if ((name === 'width' || name === 'height' || name === 'r') && v < 0) return 'a negative value is an error, which disables rendering in Chrome';
  return null;
}

/** The presentation hints of an SVG element: fill, stroke and stroke-width, and an svg's width and height, as CSS values. */
export function svgPresentationHints(tag: string, attributes: ReadonlyMap<string, string>): Map<Longhand, CssValue> {
  const out = new Map<Longhand, CssValue>();
  if (!Object.hasOwn(SVG_HANDLED_ATTRIBUTES, tag)) return out;
  for (const p of SVG_PAINT_ATTRIBUTES) {
    const text = attributes.get(p);
    if (text === undefined) continue;
    const v = paintAttributeValue(p, text);
    if (v.ok) out.set(p, v.value);
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

/** A shape's geometry from its attributes (absent attributes are 0, and an absent d is an empty path), or null when it is refused. */
export function shapeOf(tag: string, attributes: ReadonlyMap<string, string>): SvgShape | null {
  const num = (name: string): number | null => {
    const text = attributes.get(name);
    return text === undefined ? 0 : parseSvgLength(text);
  };
  if (tag === 'path') {
    const d = parsePathData(attributes.get('d') ?? '');
    return d.ok ? { kind: 'path', segments: d.segments } : null;
  }
  if (tag === 'rect') {
    const [x, y, width, height] = [num('x'), num('y'), num('width'), num('height')];
    return x === null || y === null || width === null || height === null ? null : { kind: 'rect', x, y, width, height };
  }
  if (tag === 'circle') {
    const [cx, cy, r] = [num('cx'), num('cy'), num('r')];
    return cx === null || cy === null || r === null ? null : { kind: 'circle', cx, cy, r };
  }
  return null;
}

/** A shape's paint: none, or a colour (currentcolor resolved against the shape's own color). */
export type SvgPaint = { readonly kind: 'none' } | { readonly kind: 'color'; readonly color: Rgba8 };

/** One drawn shape of an <svg>: its address, geometry in user units, and paint. strokeWidth is in user units (px before the viewBox). */
export type SvgShapeScene = { readonly address: string; readonly tag: string; readonly shape: SvgShape; readonly fill: SvgPaint; readonly stroke: SvgPaint; readonly strokeWidth: number };

/** An <svg>'s drawing: its viewBox and its shapes in paint order. */
export type SvgScene = { readonly address: string; readonly viewBox: ViewBox | null; readonly shapes: readonly SvgShapeScene[] };

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

/** The scene of a resolved <svg>; null for any other element. A shape with display: none has no box and is left out. */
export function svgSceneOf(el: ResolvedElement): SvgScene | null {
  if (el.element.tag !== SVG_TAG) return null;
  const shapes: SvgShapeScene[] = [];
  for (const c of el.children) {
    if (c.kind !== 'element' || !isSvgShapeTag(c.element.tag)) continue;
    const display = (c.props.get('display') as ResolvedValue).value;
    if (display.kind === 'keyword' && display.value === 'none') continue;
    const shape = shapeOf(c.element.tag, c.element.attributes);
    if (shape === null) throw new Error(`${c.element.address}: a refused shape reached the scene`);
    const sw = (c.props.get('stroke-width') as ResolvedValue).value;
    const strokeWidth = sw.kind === 'length' && sw.unit === 'px' ? sw.value : sw.kind === 'number' ? sw.value : null;
    if (strokeWidth === null) throw new Error(`${c.element.address}: stroke-width did not compute to px`);
    shapes.push({ address: c.element.address, tag: c.element.tag, shape, fill: paintOf(c, 'fill'), stroke: paintOf(c, 'stroke'), strokeWidth });
  }
  return { address: el.element.address, viewBox: viewBoxOf(el.element.attributes), shapes };
}

/**
 * The stand-in declaration of an SVG paint presentation attribute (fill, stroke, stroke-width), located at the attribute (its
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
