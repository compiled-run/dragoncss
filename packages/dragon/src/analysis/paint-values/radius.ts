// Computed border radii (css-backgrounds-3 §5.1, css-values-4 §6): each component of a two-component corner computes to px (em
// against the element's font size, rem against the root's) or stays a percentage, and a corner whose two computed components are
// equal is one value, as Chrome 145 serializes it. One-component corners are lengths computeLengths has already made px.
import type { Longhand } from '../../css/properties.ts';
import type { RadiusComponent } from '../../css/properties/radius.ts';
import { cornerComponents, cornerValue, RADIUS_LONGHANDS, RADIUS_PAIR } from '../../css/properties/radius.ts';
import { CANONICAL_LENGTH_UNIT, lengthToPx } from '../../css/units.ts';
import { valueToString } from '../computed.ts';
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
const UNROUNDED_STYLES: ReadonlySet<string> = new Set(['dotted', 'dashed', 'groove', 'ridge', 'inset', 'outset']);
const SIDES = ['top', 'right', 'bottom', 'left'] as const;
const HIDDEN_STYLES: ReadonlySet<string> = new Set(['none', 'hidden']);

/** Why Blink draws a rounded side of this style in a way Dragon does not port yet. */
const UNROUNDED_WHY: { readonly [style: string]: string } = {
  dashed: "Blink strokes the rounded centre line with Skia's dash path effect, fitted to the whole path's length, which Dragon does not port",
  dotted: "Blink strokes the rounded centre line with Skia's dash path effect and round caps, fitted to the whole path's length, which Dragon does not port",
};

/** A computed border value's comparison key: a colour by its channels, whatever its syntax; anything else as it serializes. */
function sideKey(v: ResolvedValue['value']): string {
  return v.kind === 'color' ? JSON.stringify(v.value) : valueToString(v);
}

/** The overflow values under which Chrome clips a rounded img to its padding-edge curve and Dragon draws it with a plain clip view. */
const CLIPPED_IMG_OVERFLOW: ReadonlySet<string> = new Set(['clip', 'hidden']);

const PADDING_LONGHANDS: readonly Longhand[] = ['padding-top', 'padding-right', 'padding-bottom', 'padding-left'];

/**
 * Why a rounded replaced element is refused on a native target, or null. An img under the UA's overflow: clip clips its image to
 * the padding-edge curve (paint_property_tree_builder.cc UpdateInnerBorderRadiusClip: PixelSnappedContouredInnerBorder, then
 * AdjustRoundedClipForOverflowClipMargin to the content box), which the image stage draws through the roundedPath hook. Refused:
 * an iframe (the web view is not clipped round yet), an img with padding (Chrome moves the curve to the content box with
 * OutsetWithCornerCorrection, which Dragon does not compute), and an img whose overflow is not clip or hidden on both axes. Chrome
 * clips an img the same under hidden as under clip (LayoutObject::IsScrollContainer is false for a replaced element, so
 * ComputeOverflowClipAxes gives both axes and ShouldApplyOverflowClipMargin treats every non-visible overflow as clip); visible on
 * an axis builds no rounded clip (NeedsInnerBorderRadiusClip needs the overflow clip along both axes). Auto and scroll, which Chrome
 * also draws as clip on an img, are not proven against Chrome yet.
 */
function unroundedReplaced(el: ResolvedElement, tag: string, t: string): { readonly message: string; readonly manual: string } | null {
  const at = `<${tag}> ${el.element.address}`;
  if (tag !== 'img') {
    return { message: `${at} rounds its corners, but ${t} draws a web view square (a rounded iframe is not supported yet)`, manual: 'Round a wrapper element with overflow: hidden around the frame instead.' };
  }
  const padded = PADDING_LONGHANDS.find((p) => {
    const v = (el.props.get(p) as ResolvedValue).value;
    return !((v.kind === 'length' || v.kind === 'percentage') && v.value === 0);
  });
  if (padded !== undefined) {
    return { message: `${at} rounds its corners and has ${padded}: ${valueToString((el.props.get(padded) as ResolvedValue).value)}; ${t} clips a rounded image only at its padding edge (a rounded img with padding is not supported yet)`, manual: 'Remove the padding of the rounded img, or round a wrapper element around it.' };
  }
  const overflow = (['overflow-x', 'overflow-y'] as const).map((p) => el.props.get(p) as ResolvedValue).find((v) => !(v.value.kind === 'keyword' && CLIPPED_IMG_OVERFLOW.has(v.value.value)));
  if (overflow !== undefined) {
    const value = valueToString(overflow.value);
    const why = value === 'visible' ? 'under which Chrome does not clip the image round' : 'which Dragon has not proven on a rounded img against Chrome yet';
    return { message: `${at} rounds its corners with overflow: ${value}, ${why}; ${t} supports a rounded img only under overflow: clip (the img default) or hidden on both axes`, manual: 'Leave overflow at its default on the rounded img, or set it to hidden.' };
  }
  return null;
}

/** Why a rounded element is refused on a native target, with its fix, or null: what PNT1 does not draw round. */
function unrounded(el: ResolvedElement, t: string): { readonly message: string; readonly manual: string } | null {
  const tag = el.element.tag;
  // css-backgrounds-3 §2.11.2: the root's (or body's) background paints the whole canvas, which border-radius does not round.
  if (tag === 'html' || tag === 'body') {
    return { message: `<${tag}> ${el.element.address} rounds its corners, but its background propagates to the canvas, which ${t} does not paint round`, manual: 'Round a wrapper element inside body instead of html or body.' };
  }
  if (isReplacedTag(tag)) return unroundedReplaced(el, tag, t);
  const side = (part: 'style' | 'width' | 'color', k: number): ResolvedValue['value'] => (el.props.get(`border-${SIDES[k] as string}-${part}` as Longhand) as ResolvedValue).value;
  const visible = (k: number): boolean => {
    const style = side('style', k);
    const width = side('width', k);
    return !(style.kind === 'keyword' && HIDDEN_STYLES.has(style.value)) && !(width.kind === 'length' && width.value === 0);
  };
  for (let k = 0; k < 4; k++) {
    const style = side('style', k);
    if (!visible(k) || style.kind !== 'keyword' || !UNROUNDED_STYLES.has(style.value)) continue;
    const why = UNROUNDED_WHY[style.value] ?? 'Blink draws its two shades along the rounded corners, which Dragon does not port';
    return { message: `${el.element.address} rounds its corners and has a ${style.value} border side; rounded ${style.value} borders are PNT1b, which ${t} does not draw yet (${why})`, manual: 'Use solid borders on a rounded box, or square corners with this border style.' };
  }
  // Blink paints a rounded double border as two rings only when its four sides are double in one colour (PaintBorderFastPath);
  // equal widths keep every side double, or every side solid, at each device scale (BorderEdge::EffectiveStyle).
  const doubled = [0, 1, 2, 3].filter((k) => visible(k) && sideKey(side('style', k)) === 'double');
  if (doubled.length === 0) return null;
  const uniform = (part: 'style' | 'width' | 'color'): boolean => [1, 2, 3].every((k) => sideKey(side(part, k)) === sideKey(side(part, 0)));
  if (doubled.length === 4 && uniform('width') && uniform('color')) return null;
  return { message: `${el.element.address} rounds its corners and has a double border side, but not four double sides of one width and colour; rounded double borders are drawn only as four such sides, which ${t} draws as Blink's two rings (other rounded double borders are PNT1b)`, manual: 'Give every side of the rounded box the same double border, or use solid borders.' };
}

/**
 * A rounded element the native targets cannot draw as Chrome does is refused there at its radius declaration: html and body
 * (their background paints the canvas), the replaced elements unroundedReplaced names, a border with a dashed, dotted or 3D side
 * (Blink strokes dashes and dots along the rounded centre line, box_border_painter.cc DrawCurvedDashedDottedBoxSide), and a double
 * side unless all four sides are double in one width and colour (Blink's DrawDoubleBorder rings, which the border stage draws). The
 * web target draws all of them itself.
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
