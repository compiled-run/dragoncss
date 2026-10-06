// Computed border radii (css-backgrounds-3 §5.1, css-values-4 §6): each component of a two-component corner computes to px (em
// against the element's font size, rem against the root's) or stays a percentage, and a corner whose two computed components are
// equal is one value, as Chrome 145 serializes it. One-component corners are lengths computeLengths has already made px.
import type { Longhand } from '../../css/properties.ts';
import type { RadiusComponent } from '../../css/properties/radius.ts';
import { cornerComponents, cornerValue, RADIUS_LONGHANDS, RADIUS_PAIR } from '../../css/properties/radius.ts';
import { CANONICAL_LENGTH_UNIT, lengthToPx } from '../../css/units.ts';
import type { ResolvedValue } from '../computed.ts';
import { isReplacedTag } from '../elements/replaced.ts';
import type { ResolvedElement } from '../resolve.ts';
import { authored, diagnostic } from '../../diagnostics/catalogue.ts';
import type { PaintCheck, PaintValueContext, PaintValues } from './types.ts';

function computeComponent(c: RadiusComponent, ctx: PaintValueContext): RadiusComponent | null {
  if (c.kind === 'percentage' || c.unit === CANONICAL_LENGTH_UNIT) return c;
  const needs = c.unit === 'em' ? ctx.em : c.unit === 'rem' ? ctx.rem : 0;
  if (needs === null) return null;
  const px = lengthToPx(c.value, c.unit, { em: ctx.em ?? 0, rem: ctx.rem ?? 0 });
  return px === null ? null : { kind: 'length', value: px, unit: CANONICAL_LENGTH_UNIT };
}

const BORDER_STYLE_LONGHANDS: readonly Longhand[] = ['border-top-style', 'border-right-style', 'border-bottom-style', 'border-left-style'];
const UNROUNDED_STYLES: ReadonlySet<string> = new Set(['dotted', 'dashed', 'double', 'groove', 'ridge', 'inset', 'outset']);

/** Why a rounded element is refused on a native target, with its fix, or null: what PNT1 does not draw round. */
function unrounded(el: ResolvedElement, t: string): { readonly message: string; readonly manual: string } | null {
  const tag = el.element.tag;
  // css-backgrounds-3 §2.11.2: the root's (or body's) background paints the whole canvas, which border-radius does not round.
  if (tag === 'html' || tag === 'body') {
    return { message: `<${tag}> ${el.element.address} rounds its corners, but its background propagates to the canvas, which ${t} does not paint round`, manual: 'Round a wrapper element inside body instead of html or body.' };
  }
  // Blink clips replaced content to the rounded content box; the image and web-view stages draw it square.
  if (isReplacedTag(tag)) {
    return { message: `<${tag}> ${el.element.address} rounds its corners, but ${t} draws replaced content square (rounded replaced content is not supported yet)`, manual: 'Round a wrapper element with overflow: hidden around the image or frame instead.' };
  }
  const styled = BORDER_STYLE_LONGHANDS.map((p) => el.props.get(p) as ResolvedValue).find((v, i) => {
    const width = (el.props.get((BORDER_STYLE_LONGHANDS[i] as string).replace('-style', '-width') as Longhand) as ResolvedValue | undefined)?.value;
    return v.value.kind === 'keyword' && UNROUNDED_STYLES.has(v.value.value) && !(width !== undefined && width.kind === 'length' && width.value === 0);
  });
  if (styled === undefined || styled.value.kind !== 'keyword') return null;
  return { message: `${el.element.address} rounds its corners and has a ${styled.value.value} border side; rounded ${styled.value.value} borders are PNT1b, which ${t} does not draw yet`, manual: 'Use solid borders on a rounded box, or square corners with this border style.' };
}

/**
 * A rounded element the native targets cannot draw as Chrome does is refused there at its radius declaration: html and body
 * (their background paints the canvas), replaced elements (their content is clipped round), and a border with a dashed, dotted,
 * double or 3D side (Blink strokes those along the rounded centre line, box_border_painter.cc; PNT1b adds them). The web target
 * draws all of them itself.
 */
const checkRoundedElement: PaintCheck = (el, targets, diagnostics, reported) => {
  const lengths = RADIUS_LONGHANDS.map((p) => cornerComponents((el.props.get(p) as ResolvedValue).value));
  if (!lengths.some((c) => c !== null && c[0].value > 0 && c[1].value > 0)) return;
  const source = RADIUS_LONGHANDS.map((p) => el.props.get(p) as ResolvedValue).find((v) => v.declaration !== null);
  if (source === undefined || source.declaration === null) return;
  const span = source.declaration.valueSpan;
  for (const t of targets) {
    if (t === 'web') continue;
    const why = unrounded(el, t);
    if (why === null) return;
    const id = `${t}|rounded-element|${span.source.uri}|${span.start}|${el.element.address}`;
    if (reported.has(id)) continue;
    reported.add(id);
    diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_VALUE', { origin: authored(span), target: t, message: why.message, manual: why.manual, basis: 'computed-value' }));
  }
};

export const RADIUS_VALUES: PaintValues = {
  name: 'radius',
  check: checkRoundedElement,
  compute: (props, ctx) => {
    for (const p of RADIUS_LONGHANDS as readonly Longhand[]) {
      const v = props.get(p);
      if (v === undefined || v.value.kind !== 'other' || v.value.type !== RADIUS_PAIR) continue;
      const parts = cornerComponents(v.value);
      if (parts === null) continue;
      const h = computeComponent(parts[0], ctx);
      const w = computeComponent(parts[1], ctx);
      if (h === null || w === null) continue;
      const computed: ResolvedValue = { ...v, value: cornerValue(h, w) };
      props.set(p, computed);
    }
  },
};
