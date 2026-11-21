// Computed outlines (css-ui-4 §3): outline-width computes to px (thin 1, medium 3, thick 5), and to 0 when outline-style is none, as
// Chrome 145 serializes it; the webref initial auto of outline-color is Chrome's currentcolor. Lengths are already px here.
import type { Rgba8 } from '../../css/color.ts';
import { serializeColor } from '../../css/color.ts';
import { hasClipPath } from '../../css/properties/clip-path.ts';
import { containsDescendants, paintContained } from '../containment.ts';
import { elementMaskGradient } from '../mask.ts';
import { backfaceHidden } from '../../css/properties/transform-extra.ts';
import { isolates } from '../../css/properties/isolation.ts';
import { blendModeOf, hasBackdropFilter } from '../../css/properties/fx.ts';
import { filterApplies } from '../../css/properties/filter.ts';
import { OUTLINE_WIDTH_KEYWORDS } from '../../css/properties/outline.ts';
import { paintsOwn, visibilityOf } from '../../css/properties/visibility.ts';
import { colorChannels } from '../../lower/paint/colors.ts';
import { cornerComponents, RADIUS_LONGHANDS } from '../../css/properties/radius.ts';
import { clipHidesBox } from '../../css/properties/clip-rect.ts';
import { authored, diagnostic } from '../../diagnostics/catalogue.ts';
import type { Diagnostic } from '../../types.ts';
import type { ResolvedValue } from '../computed.ts';
import type { ResolvedElement } from '../resolve.ts';
import { opacityOf, zIndexOf } from '../../css/properties/effects.ts';
import { stackingOf } from '../../lower/paint/stacking.ts';
import { isTopLayer } from '../top-layer.ts';
import { resolvedStackTree } from './stacking.ts';
import { elementWillChange, transformsDescendants, transformWord } from './transform.ts';
import type { PaintCheck, PaintValues } from './types.ts';

const keywordOf = (el: ResolvedElement, p: string): string => {
  const v = el.props.get(p as never)?.value;
  return v !== undefined && v.kind === 'keyword' ? v.value : '';
};

/** The outline style an element paints, or null when it paints none (no box, style none, or a zero width other than auto's focus ring). */
export function paintedOutlineStyle(el: ResolvedElement): string | null {
  // display: contents generates no box, so nothing paints its outline (css-display-3 §2.5).
  if (keywordOf(el, 'display') === 'contents') return null;
  const style = keywordOf(el, 'outline-style');
  if (style === '' || style === 'none') return null;
  const width = (el.props.get('outline-width') as ResolvedValue | undefined)?.value;
  // auto is the focus ring, whose width is Chrome's own, so it paints at any outline-width.
  if (style !== 'auto' && width !== undefined && width.kind === 'length' && width.value === 0) return null;
  return style;
}

const outlineOrigin = (el: ResolvedElement) => {
  const style = el.props.get('outline-style') as ResolvedValue;
  return style.declaration === null ? el.element.node.origin : authored(style.declaration.valueSpan);
};

function refuse(el: ResolvedElement, what: string, why: string, manual: string, targets: readonly string[], diagnostics: Diagnostic[], reported: Set<string>): void {
  for (const t of targets) {
    if (t === 'web') continue;
    const id = `${t}|outline-${what}|${el.element.address}`;
    if (reported.has(id)) continue;
    reported.add(id);
    diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_VALUE', { origin: outlineOrigin(el), target: t, message: `${el.element.address} ${why}; ${t} draws ${NATIVE_OUTLINES} (PNT1)`, manual, basis: 'computed-value' }));
  }
}

const NATIVE_OUTLINES = 'solid and double outlines, and dotted, dashed, groove, ridge, inset and outset ones on square corners';

/**
 * Whether the side painter would meet a rounded corner: either component of a corner radius is positive (a percentage counts, as it
 * may resolve so). Blink's FloatRoundedRect::Radii::IsZero is SizeF::IsZero (both components zero), so a corner such as 6px 0 is on
 * the rounded path: the outline's outset grows its positive component, and the sides beside it (every side, for groove and ridge)
 * take DrawCurvedBoxSide or DrawCurvedDashedDottedBoxSide.
 */
/** Whether any corner of an element has a non-zero radius. */
export const rounds = (el: ResolvedElement): boolean =>
  RADIUS_LONGHANDS.some((p) => {
    const c = cornerComponents((el.props.get(p) as ResolvedValue).value);
    return c !== null && (c[0].value > 0 || c[1].value > 0);
  });

/**
 * The native targets draw solid and double outlines as rings, and dotted, dashed, groove, ridge, inset and outset ones with Blink's
 * side painter (lower/paint/outline.ts). Refused there: auto, Chrome's focus ring, whose shape takes in the descendants' outline
 * rects (OutlineRects with kIncludeBlockInkOverflow) and whose ring is two anti-aliased strokes; a rounded outline in a style other
 * than solid or double, which Blink strokes along the rounded centre line (BoxBorderPainter's curved sides, PNT1b); and an outline
 * on an inline box, which Blink outlines per line fragment. outline: none and a zero width paint nothing, so they compile. The web
 * target paints every outline itself.
 */
const checkOutline: PaintCheck = (el, targets, diagnostics, reported) => {
  const style = paintedOutlineStyle(el);
  if (style === null) return;
  if (style === 'auto') {
    refuse(el, 'style', "has outline-style auto, Chrome's focus ring, whose ring follows the descendants' outline rects", 'Use a solid outline, or outline: none.', targets, diagnostics, reported);
    return;
  }
  if (style !== 'solid' && style !== 'double' && rounds(el)) {
    refuse(el, 'style', `has a ${style} outline on rounded corners, which Blink strokes along the rounded centre line (PNT1b)`, `Use a solid or double outline on a rounded box, or square corners with a ${style} outline.`, targets, diagnostics, reported);
    return;
  }
  if (keywordOf(el, 'display') === 'inline') refuse(el, 'inline', 'has an outline on an inline box, which Blink draws around each line fragment', 'Outline a block or flex box, or give the element display: inline-block.', targets, diagnostics, reported);
};

/**
 * Why a box paints its content as a group, which holds its descendants' outlines (an opacity below 1, a transform, will-change:
 * transform or opacity, a clip-path, containment, a mask image, isolation: isolate, backface-visibility: hidden, a mix-blend-mode,
 * a filter, or the top layer), or null.
 */
function groupReason(el: ResolvedElement, transforms = true): string | null {
  const opacity = opacityOf((el.props.get('opacity') as ResolvedValue).value);
  if (opacity !== null && opacity < 1) return `opacity: ${opacity}`;
  if (hasBackdropFilter(el.props.get('backdrop-filter')?.value)) return 'a backdrop-filter';
  if (transforms && transformsDescendants(el)) return transformWord(el);
  if (elementWillChange(el).includes('opacity')) return 'will-change: opacity';
  if (hasClipPath(el)) return 'a clip-path';
  if (containsDescendants(el)) return `contain: ${keywordOf(el, 'contain')}`;
  if (elementMaskGradient(el) !== null) return 'a mask-image';
  if (isolates(el)) return 'isolation: isolate';
  if (backfaceHidden(el)) return 'backface-visibility: hidden';
  const mode = blendModeOf(el.props.get('mix-blend-mode')?.value);
  if (mode !== 'normal') return `mix-blend-mode: ${mode}`;
  if (isTopLayer(el)) return 'the top layer';
  const filter = el.props.get('filter') as ResolvedValue | undefined;
  if (filter !== undefined && filterApplies(filter.value)) return 'a filter';
  return null;
}

/**
 * Why a layer item of the stacking tree (lower/paint/stacking.ts: a positioned box, a flex or grid item with a z-index, or a box
 * that paints as a group) paints in a layer of its own rather than in its context's flow.
 */
function layerReason(el: ResolvedElement): string {
  const position = keywordOf(el, 'position');
  if (['relative', 'absolute', 'fixed', 'sticky'].includes(position)) return `position: ${position}`;
  const group = groupReason(el);
  if (group !== null) return group;
  // A static box's z-index makes it a layer item only as a flex or grid item (resolvedStackTree), the one reason left.
  const z = zIndexOf((el.props.get('z-index') as ResolvedValue).value);
  if (z !== null) return `z-index: ${z} on a flex or grid item`;
  throw new Error(`${el.element.address}: a layer item with no reason to be one`);
}

const CLIPPING = ['hidden', 'clip', 'scroll', 'auto'];
const clips = (el: ResolvedElement): boolean => CLIPPING.includes(keywordOf(el, 'overflow-x')) || CLIPPING.includes(keywordOf(el, 'overflow-y')) || paintContained(el);

/**
 * Where the native outline paints: in its paint layer's view (stacking facts paintLayer: the box itself when it is a layer item,
 * else its nearest ancestor that is one, else the root), after that layer's flow content and before the layer items hosted
 * there, each box's descendants' outlines before its own. That is Blink's order (PaintLayerPainter::PaintLayerContents paints a
 * layer's foreground, then its descendant and self outlines, then kNormalFlowAndPositiveZOrderChildren), so an outline under a
 * positioned or sticky box is covered by it, and one inside it paints in its layer. The native targets refuse at the outline:
 * an outline under an overflow clip or scroller (the clip check), an outline inside a layer that paints as a group (opacity,
 * transform, filter and the like: the outline would have to join the group's composite), and the own outline of a layer item
 * that clips its overflow (its view clips the views it hosts). propagated is the element whose overflow the viewport takes
 * (css-overflow-3 §3.3), which does not clip.
 */
export function checkOutlinePlacement(root: ResolvedElement, propagated: ResolvedElement | null, targets: readonly string[], diagnostics: Diagnostic[], reported: Set<string>): void {
  const outlined: { readonly el: ResolvedElement; readonly clip: ResolvedElement | null; readonly ancestors: readonly ResolvedElement[] }[] = [];
  const walk = (el: ResolvedElement, clip: ResolvedElement | null, ancestors: readonly ResolvedElement[]): void => {
    if (keywordOf(el, 'display') === 'none') return;
    const style = paintedOutlineStyle(el);
    // An outline refused by its style (checkOutline) is not placed: auto, and a rounded one in a style other than solid or double.
    if (style !== null && style !== 'auto' && (style === 'solid' || style === 'double' || !rounds(el))) outlined.push({ el, clip, ancestors });
    const inner = el !== root && el !== propagated && clips(el) ? el : clip;
    for (const c of el.children) if (c.kind === 'element') walk(c, inner, [...ancestors, el]);
  };
  walk(root, null, []);
  if (outlined.length === 0) return;
  // The stacking tree is built only for a case with a painting outline.
  const stacking = stackingOf(resolvedStackTree(root, propagated));
  const facts = stacking.facts;
  // A layer item kept under a clip (lower/paint/stacking.ts underClip) sits in the clip's view among its flow, so it paints before its
  // layer's outlines on the device; Chrome paints it after them.
  const kept = [...stacking.writes.keys()].find((id) => facts.get(id)?.underClip === true);
  const factsOf = (el: ResolvedElement) => {
    const f = facts.get(el.element.address);
    if (f === undefined) throw new Error(`${el.element.address} is not in the stacking tree`);
    return f;
  };
  for (const { el, clip, ancestors } of outlined) {
    if (clip !== null) {
      refuse(el, 'clip', `has an outline inside the overflow clip of ${clip.element.address}, and Dragon draws native outlines in their paint layer's view, outside that clip`, `Move the outline to a box outside ${clip.element.address}, or let ${clip.element.address} overflow visibly.`, targets, diagnostics, reported);
      continue;
    }
    // A 2D transform (or will-change: transform, or perspective) moves its view, and the outline view inside it with it.
    const grouped = [...ancestors, el].reverse().find((a) => groupReason(a, false) !== null);
    if (grouped !== undefined) {
      const why = groupReason(grouped, false) as string;
      const where = grouped === el ? 'and has' : `inside ${grouped.element.address}, which has`;
      refuse(el, 'stacking', `has an outline ${where} ${why}, and Dragon draws native outlines only in the layer of a positioned or transformed box, a z-index or the root, not yet inside a layer made by ${why}`, `Outline a box outside the ${why} box, or outline: none.`, targets, diagnostics, reported);
      continue;
    }
    // A clip: rect() that hides its box hides the box view, and every view inside it (lower/paint/clip.ts clip-rect-empty and -label).
    const hidden = [...ancestors, el].reverse().find((a) => clipHidesBox(a) === true);
    if (hidden !== undefined) {
      const where = hidden === el ? 'and has' : `inside ${hidden.element.address}, which has`;
      refuse(el, 'stacking', `has an outline ${where} a clip: rect() that hides its box, and the native targets hide that box's view, with the outline view inside it`, `Outline a box outside the clipped box, or outline: none.`, targets, diagnostics, reported);
      continue;
    }
    if (kept !== undefined) {
      refuse(el, 'stacking', `has an outline, and ${kept} is a layer item Dragon keeps under the overflow clip of ${facts.get(kept)?.host ?? 'an ancestor'}, so it would paint beneath the outlines its layer paints before it`, `Let the clipping ancestor of ${kept} overflow visibly, or outline: none.`, targets, diagnostics, reported);
      continue;
    }
    if (el !== root && factsOf(el).paintLayer === el.element.address && el !== propagated && clips(el)) {
      refuse(el, 'stacking', `has an outline and ${layerReason(el)}, and clips its overflow; Dragon draws a layer's own outline in its view, inside that clip`, 'Outline a box that does not clip its overflow, or let it overflow visibly.', targets, diagnostics, reported);
    }
  }
}

/** The styles Blink and Dragon paint with the side painter (paint-dash.ts outlinePaintOps), the others being solid and double rings. */
const SIDE_PAINTER_STYLES: readonly string[] = ['dotted', 'dashed', 'groove', 'ridge', 'inset', 'outset'];

/**
 * The colour an element's outline paints in: outline-color, or color for currentcolor (lower/paint/outline.ts), with the
 * declaration that set it.
 */
function outlineColor(el: ResolvedElement): { readonly color: Rgba8; readonly value: ResolvedValue } {
  const c = el.props.get('outline-color') as ResolvedValue | undefined;
  const own = el.props.get('color') as ResolvedValue | undefined;
  if (c === undefined || own === undefined) throw new Error(`${el.element.address}: outline-color did not resolve`);
  const current = c.value.kind === 'keyword' && c.value.value === 'currentcolor';
  return current ? { color: colorChannels(own.value, el.element.address), value: own } : { color: colorChannels(c.value, el.element.address), value: c };
}

/**
 * The style of the visible dotted, dashed or 3D outline the native side painter would draw for an element, or null. A rounded one
 * and one on an inline box are refused by checkOutline already, so they are left to it.
 */
export function sidePainterOutline(el: ResolvedElement): string | null {
  const style = paintedOutlineStyle(el);
  if (style === null || !SIDE_PAINTER_STYLES.includes(style) || rounds(el) || keywordOf(el, 'display') === 'inline') return null;
  const visibility = el.props.get('visibility') as ResolvedValue | undefined;
  if (visibility === undefined) throw new Error(`${el.element.address}: visibility did not resolve`);
  return paintsOwn(visibilityOf(visibility.value)) ? style : null;
}

/** Whether an element's outline-color is currentcolor, so its outline takes color's value (and color's animation). */
export function outlineInCurrentColor(el: ResolvedElement): boolean {
  const c = (el.props.get('outline-color') as ResolvedValue | undefined)?.value;
  return c !== undefined && c.kind === 'keyword' && c.value === 'currentcolor';
}

/**
 * PNT1 (device run 38470185768): a dotted, dashed, groove, ridge, inset or outset outline in a translucent colour paints its four
 * sides into one transparency layer of the colour's alpha (Blink PaintOpacityGroup, translated in paint-dash.ts), which UIKit's
 * transparency layer and Android's saveLayerAlpha composite with their own rounding, one off Chrome's Skia in a channel. Outside the
 * parity lanes the native targets refuse it, at the colour's declaration, in every state and band the check is run on (project.ts);
 * the lanes compile it to prove the web rows (outline-web). A transparent outline paints nothing, so it compiles.
 */
export function checkTranslucentOutlines(root: ResolvedElement, targets: readonly string[], diagnostics: Diagnostic[], reported: Set<string>): void {
  const walk = (el: ResolvedElement): void => {
    if (keywordOf(el, 'display') === 'none') return;
    const style = sidePainterOutline(el);
    if (style !== null) {
      const { color, value } = outlineColor(el);
      if (color.alpha > 0 && color.alpha < 255) {
        const origin = value.declaration === null ? outlineOrigin(el) : authored(value.declaration.valueSpan);
        for (const t of targets) {
          if (t === 'web') continue;
          const id = `${t}|outline-translucent|${el.element.address}`;
          if (reported.has(id)) continue;
          reported.add(id);
          diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_VALUE', {
            origin,
            target: t,
            message: `${el.element.address} has a ${style} outline in the translucent colour ${serializeColor(color)}, which Blink paints through a transparency layer of the colour's alpha, and ${t} composites that layer with its own rounding, one off Chrome's Skia in a channel; ${t} draws ${style} outlines in opaque colours only (PNT1)`,
            manual: `Give the ${style} outline an opaque colour, or use a solid or double outline.`,
            basis: 'computed-value',
          }));
        }
      }
    }
    for (const c of el.children) if (c.kind === 'element') walk(c);
  };
  walk(root);
}

export const OUTLINE_VALUES: PaintValues = {
  name: 'outline',
  check: checkOutline,
  compute: (props) => {
    const color = props.get('outline-color');
    if (color !== undefined && color.value.kind === 'keyword' && color.value.value === 'auto') props.set('outline-color', { ...color, value: { kind: 'keyword', value: 'currentcolor' } });
    const style = props.get('outline-style');
    const width = props.get('outline-width');
    if (style === undefined || width === undefined) return;
    const none = style.value.kind === 'keyword' && style.value.value === 'none';
    const keyword = width.value.kind === 'keyword' ? OUTLINE_WIDTH_KEYWORDS[width.value.value] : undefined;
    if (none) props.set('outline-width', { ...width, value: { kind: 'length', value: 0, unit: 'px' } });
    else if (keyword !== undefined) props.set('outline-width', { ...width, value: { kind: 'length', value: keyword, unit: 'px' } });
  },
};
