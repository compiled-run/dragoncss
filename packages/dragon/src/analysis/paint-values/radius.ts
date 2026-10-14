// Computed border radii (css-backgrounds-3 §5.1, css-values-4 §6): each component of a two-component corner computes to px (em
// against the element's font size, rem against the root's) or stays a percentage, and a corner whose two computed components are
// equal is one value, as Chrome 145 serializes it. One-component corners are lengths computeLengths has already made px.
import type { Longhand } from '../../css/properties.ts';
import type { RadiusComponent } from '../../css/properties/radius.ts';
import { cornerComponents, cornerValue, RADIUS_LONGHANDS, RADIUS_PAIR } from '../../css/properties/radius.ts';
import { CANONICAL_LENGTH_UNIT, lengthToPx } from '../../css/units.ts';
import { serializeColor } from '../../css/color.ts';
import { paintsOwn, visibilityOf } from '../../css/properties/visibility.ts';
import { usedColors } from '../../lower/paint/colors.ts';
import { valueToString } from '../computed.ts';
import type { ResolvedValue } from '../computed.ts';
import { isReplacedTag } from '../elements/replaced.ts';
import type { ResolvedElement } from '../resolve.ts';
import type { AnimationAnalysis } from '../animations.ts';
import type { Diagnostic } from '../../types.ts';
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

type SideValue = (part: 'style' | 'width' | 'color', k: number) => ResolvedValue['value'];

/** A side's computed border style, width or colour (k: top, right, bottom, left). */
const sideOf = (el: ResolvedElement): SideValue => (part, k) => (el.props.get(`border-${SIDES[k] as string}-${part}` as Longhand) as ResolvedValue).value;

/** Whether a side paints: a style other than none or hidden, and a width above 0. */
const visibleSide = (side: SideValue) => (k: number): boolean => {
  const style = side('style', k);
  const width = side('width', k);
  return !(style.kind === 'keyword' && HIDDEN_STYLES.has(style.value)) && !(width.kind === 'length' && width.value === 0);
};

/** Whether all four sides are visible double in one computed width and one colour: Blink's PaintBorderFastPath two rings. */
function fourUniformDoubles(el: ResolvedElement): boolean {
  const side = sideOf(el);
  const visible = visibleSide(side);
  const uniform = (part: 'width' | 'color'): boolean => [1, 2, 3].every((k) => sideKey(side(part, k)) === sideKey(side(part, 0)));
  return [0, 1, 2, 3].every((k) => visible(k) && sideKey(side('style', k)) === 'double') && uniform('width') && uniform('color');
}

/** Whether any corner of the element has both radius components above 0. */
function roundsCorners(el: ResolvedElement): boolean {
  return RADIUS_LONGHANDS.map((p) => cornerComponents((el.props.get(p) as ResolvedValue).value)).some((c) => c !== null && c[0].value > 0 && c[1].value > 0);
}

/** Why a rounded element is refused on a native target, with its fix, or null: what PNT1 does not draw round. */
function unrounded(el: ResolvedElement, t: string): { readonly message: string; readonly manual: string } | null {
  const tag = el.element.tag;
  // css-backgrounds-3 §2.11.2: the root's (or body's) background paints the whole canvas, which border-radius does not round.
  if (tag === 'html' || tag === 'body') {
    return { message: `<${tag}> ${el.element.address} rounds its corners, but its background propagates to the canvas, which ${t} does not paint round`, manual: 'Round a wrapper element inside body instead of html or body.' };
  }
  if (isReplacedTag(tag)) return unroundedReplaced(el, tag, t);
  const side = sideOf(el);
  const visible = visibleSide(side);
  for (let k = 0; k < 4; k++) {
    const style = side('style', k);
    if (!visible(k) || style.kind !== 'keyword' || !UNROUNDED_STYLES.has(style.value)) continue;
    const why = UNROUNDED_WHY[style.value] ?? 'Blink draws its two shades along the rounded corners, which Dragon does not port';
    return { message: `${el.element.address} rounds its corners and has a ${style.value} border side; rounded ${style.value} borders are PNT1b, which ${t} does not draw yet (${why})`, manual: 'Use solid borders on a rounded box, or square corners with this border style.' };
  }
  // Blink paints a rounded double border as two rings only when its four sides are double in one colour (PaintBorderFastPath);
  // equal widths keep every side double, or every side solid, at each device scale (BorderEdge::EffectiveStyle).
  const doubled = [0, 1, 2, 3].filter((k) => visible(k) && sideKey(side('style', k)) === 'double');
  if (doubled.length === 0 || fourUniformDoubles(el)) return null;
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
  if (!roundsCorners(el)) return;
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

/** Whether an element is drawn as a rounded double border: Blink's two rings (four double sides of one width and colour). */
export function roundedDouble(el: ResolvedElement): boolean {
  return !isReplacedTag(el.element.tag) && roundsCorners(el) && fourUniformDoubles(el);
}

/** Whether an element's border colour is currentcolor, so its rounded double border takes color's value (and color's animation). */
export function borderInCurrentColor(el: ResolvedElement): boolean {
  const c = (el.props.get('border-top-color') as ResolvedValue | undefined)?.value;
  return c !== undefined && c.kind === 'keyword' && c.value === 'currentcolor';
}

/**
 * PNT1b (device run 38470185768): a rounded double border in a translucent colour. Chrome fills its two rings with the colour
 * premultiplied to 8 bits by Skia (DrawDoubleBorder's FillDRRect, no layer); the native fills blend it with the platform's own
 * rounding, which no native colour reproduces (Android was one off in a channel at every device scale). Outside the parity lanes
 * both native targets refuse it, at the border colour's declaration, in every state and band the check is run on (project.ts); the
 * lanes compile it to prove the web rows (radius-double-web). A transparent border paints nothing, so it compiles.
 */
export function checkTranslucentRoundedDoubles(root: ResolvedElement, targets: readonly string[], diagnostics: Diagnostic[], reported: Set<string>): void {
  const walk = (el: ResolvedElement): void => {
    const display = (el.props.get('display') as ResolvedValue).value;
    if (display.kind === 'keyword' && display.value === 'none') return;
    const visibility = el.props.get('visibility') as ResolvedValue | undefined;
    if (visibility === undefined) throw new Error(`${el.element.address}: visibility did not resolve`);
    if (paintsOwn(visibilityOf(visibility.value)) && roundedDouble(el)) {
      // fourUniformDoubles compares the computed values, so one side's colour is every side's.
      const color = usedColors(el)['border-top-color'];
      if (color.alpha > 0 && color.alpha < 255) {
        const v = el.props.get('border-top-color') as ResolvedValue;
        const current = v.value.kind === 'keyword' && v.value.value === 'currentcolor';
        const from = current ? (el.props.get('color') as ResolvedValue) : v;
        const origin = from.declaration === null ? el.element.node.origin : authored(from.declaration.valueSpan);
        for (const t of targets) {
          if (t === 'web') continue;
          const id = `${t}|rounded-double-translucent|${el.element.address}`;
          if (reported.has(id)) continue;
          reported.add(id);
          diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_VALUE', {
            origin,
            target: t,
            message: `${el.element.address} is a rounded double border in the translucent colour ${serializeColor(color)}, which Chrome fills with Skia's 8-bit premultiplied colour and ${t} blends with its own rounding; ${t} draws rounded double borders in opaque colours only (PNT1b)`,
            manual: 'Give the rounded double border an opaque colour, or use square corners.',
            basis: 'computed-value',
          }));
        }
      }
    }
    for (const c of el.children) if (c.kind === 'element') walk(c);
  };
  walk(root);
}

/** The per-side colours the native animator feeds the border stage one side at a time (dragonAnimatedSides). */
const SIDE_COLORS: readonly Longhand[] = ['border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color'];

/**
 * PNT1b on the native targets: the border stage draws a rounded double border as Blink's two rings only while its four sides are
 * one colour (dragonDrawRoundedDouble, which traps on any other), and the native animator feeds each side's colour apart
 * (dragonAnimatedSides), so mid-animation the sides differ. An animation or transition of a border side's colour on a box that is a
 * rounded double border in any reachable state is refused, at its animation-name or transition-property (a transition only where a
 * reachable state changes the colour, as BG2c's refuseAnimatedGradients). roots are the resolved roots of the analysed cases, in
 * the analysis's order; the caller runs it per @media band, with one reported set.
 */
export function refuseAnimatedRoundedDoubles(analysis: AnimationAnalysis, roots: readonly ResolvedElement[], nativeTargets: readonly string[], diagnostics: Diagnostic[], reported: Set<string> = new Set()): void {
  if (nativeTargets.length === 0) return;
  const trees = analysis.cases.map((_, i) => {
    const byAddress = new Map<string, ResolvedElement>();
    const walk = (el: ResolvedElement): void => {
      byAddress.set(el.element.address, el);
      for (const k of el.children) if (k.kind === 'element') walk(k);
    };
    const root = roots[i];
    if (root !== undefined) walk(root);
    return byAddress;
  });
  const changes = (address: string, p: Longhand): boolean => new Set(trees.map((t) => JSON.stringify(t.get(address)?.props.get(p)?.value ?? null))).size > 1;
  const roundedDouble = (address: string): boolean => trees.some((t) => {
    const el = t.get(address);
    return el !== undefined && !isReplacedTag(el.element.tag) && roundsCorners(el) && fourUniformDoubles(el);
  });
  analysis.cases.forEach((c, i) => {
    const byAddress = trees[i] as Map<string, ResolvedElement>;
    for (const ea of c.elements.values()) {
      const el = byAddress.get(ea.address);
      if (el === undefined) continue;
      const animated = [...new Set(ea.animations.flatMap((a) => (a.name === 'none' || !a.hasKeyframes ? [] : (analysis.keyframes.get(a.name)?.blocks ?? []).flatMap((b) => b.values.map((v) => v.property)))))].filter((p) => SIDE_COLORS.includes(p as Longhand));
      const transitioned = SIDE_COLORS.filter((p) => {
        const l = ea.listings.get(p);
        return l !== undefined && l.mode === 'listed' && l.delay + l.duration > 0 && changes(ea.address, p);
      });
      if ((animated.length === 0 && transitioned.length === 0) || !roundedDouble(ea.address)) continue;
      for (const [p, what, longhand] of [...animated.map((x) => [x, 'an animation', 'animation-name'] as const), ...transitioned.map((x) => [x, 'a transition', 'transition-property'] as const)]) {
        const d = ea.declarations.find((x) => x.animation?.longhands.has(longhand) === true) ?? ea.declarations[0];
        const origin = d === undefined ? el.element.node.origin : authored(d.valueSpan);
        for (const t of nativeTargets) {
          const id = `${t}|${ea.address}|${p}`;
          if (reported.has(id)) continue;
          reported.add(id);
          diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_VALUE', { origin, target: t, message: `${what} of ${p} on ${ea.address}: the box is a rounded double border, which ${t} draws as Blink's two rings only while its four sides are one colour, and the native animator changes each side's colour apart (animated rounded double borders are PNT1b)`, manual: `Animate ${p} on a box without a rounded double border, or remove the ${longhand === 'animation-name' ? 'animation' : 'transition'}.` }));
        }
      }
    }
  });
}
