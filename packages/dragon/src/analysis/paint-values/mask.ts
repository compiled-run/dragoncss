// MASK-CLIP (css-masking-1 §7): the one mask Dragon draws, a single linear-gradient() mask-image over every other mask longhand at
// its initial value (mask-size auto, position 0% 0%, repeat, origin and clip border-box, composite add, mode match-source), so the
// mask is one tile of the gradient over the border box, painted as Blink paints a background layer (BoxPainterBase::PaintFillLayers
// over the mask layers) and applied by its alpha (kDstIn). Every other mask value stays refused on every target
// (computed-checks.ts checkMask). The web target lets Chrome draw it. iOS and Android rasterise the gradient's alpha with the
// translated paint-gradient.ts and mask the box view and every view inside it (lower/paint/mask.ts); neither mechanism changes a
// view's visibility, so the text inside stays in the accessibility tree, as Chrome keeps it. The native targets refuse what that
// does not draw as Chrome does, or what the samples cannot hold to Chrome exactly: Chrome paints the masked subtree into a layer
// over transparent and composites it, so a pixel equals the unmasked paint only where that layer is opaque or empty, and the native
// targets refuse every translucent paint inside the mask (UNPROVEN_CONTEXT).
import { parse } from 'css-tree';
import type { CssNode } from 'css-tree';
import { list } from '../../css/ast.ts';
import { canonicalizeEscapes } from '../../css/escapes.ts';
import type { Longhand } from '../../css/properties.ts';
import { COLOR_LONGHANDS } from '../../css/properties.ts';
import { hasClipPath } from '../../css/properties/clip-path.ts';
import { opacityOf } from '../../css/properties/effects.ts';
import { isInitialMask, MASK_LAYER_VALUE_TYPE, MASK_LONGHANDS } from '../../css/properties/mask.ts';
import { authored, diagnostic } from '../../diagnostics/catalogue.ts';
import { usedColors } from '../../lower/paint/colors.ts';
import type { Diagnostic } from '../../types.ts';
import type { ResolvedValue } from '../computed.ts';
import type { ResolvedElement } from '../resolve.ts';
import { REPLACED_TAGS } from '../elements/replaced.ts';
import type { GradientSpec } from './gradient.ts';
import { BG2B, CALC_P, commaItems, compositesSubtree, imageItem, linearSlope, transformsSubtree, unfoldedLength } from './gradient.ts';
import { transformsDescendants } from './transform.ts';
import type { PaintCheck, PaintValues } from './types.ts';

/** The package that lifts these refusals. */
export const MASK_CLIP = 'MASK-CLIP';

/** Form controls and media the native targets draw with views of their own, which the mask proof does not cover. */
const OWN_VIEW_TAGS: readonly string[] = [...REPLACED_TAGS, 'input', 'button', 'select', 'textarea', 'video', 'audio', 'canvas', 'object', 'embed'];

const keyword = (el: ResolvedElement, p: Longhand): string => {
  const v = el.props.get(p);
  return v !== undefined && v.value.kind === 'keyword' ? v.value.value : '';
};

/** Whether a longhand resolved to a value other than none. */
const notNone = (el: ResolvedElement, p: Longhand): boolean => {
  const v = el.props.get(p);
  return v !== undefined && !(v.value.kind === 'keyword' && v.value.value === 'none');
};

/** The items of a mask-image value kept as written (css/properties/mask.ts), as css-tree tokens; null for none. */
function maskImageItems(v: ResolvedValue): CssNode[][] | null {
  if (v.value.kind === 'keyword' && v.value.value === 'none') return null;
  if (v.value.kind !== 'other' || v.value.type !== MASK_LAYER_VALUE_TYPE) return [];
  let node: CssNode;
  try {
    node = parse(v.value.text, { context: 'value' });
  } catch {
    return [];
  }
  canonicalizeEscapes(node);
  return commaItems(list(node, 'children').filter((c) => c.type !== 'WhiteSpace'));
}

/** Whether an element has a mask image: mask-image other than none (ComputedStyle::HasMask), which makes a stacking context. */
export function hasMaskImage(el: Pick<ResolvedElement, 'props'>): boolean {
  const v = el.props.get('mask-image');
  return v !== undefined && !(v.value.kind === 'keyword' && v.value.value === 'none');
}

/**
 * The gradient of an element's mask when it is the one Dragon draws: mask-image one non-repeating linear-gradient() that the
 * background gradient parser takes (paint-values/gradient.ts imageItem), and every other mask longhand initial. Else null, for no mask
 * and for every mask checkMask refuses.
 */
export function gradientMaskOf(el: Pick<ResolvedElement, 'props'>): GradientSpec | null {
  const v = el.props.get('mask-image');
  if (v === undefined) return null;
  const items = maskImageItems(v);
  if (items === null || items.length !== 1) return null;
  if (MASK_LONGHANDS.some((p) => p !== 'mask-image' && !isInitialMask(p, (el.props.get(p) as ResolvedValue).value))) return null;
  const item = imageItem(items[0] as CssNode[]);
  if (!item.ok || item.value.kind !== 'gradient') return null;
  const g = item.value.gradient;
  return g.radial || g.repeating ? null : g;
}

/** A refusal on the native targets, once per target and element, at the mask-image declaration. */
function refuse(el: ResolvedElement, native: readonly string[], key: string, message: string, manual: string, diagnostics: Diagnostic[], reported: Set<string>, code: 'DRAGON_UNSUPPORTED_VALUE' | 'DRAGON_UNPROVEN_CONTEXT'): void {
  const at = el.props.get('mask-image') as ResolvedValue;
  const origin = at.declaration === null ? el.element.node.origin : authored(at.declaration.valueSpan);
  for (const t of native) {
    const id = `${t}|mask-${key}|${el.element.address}`;
    if (reported.has(id)) continue;
    reported.add(id);
    diagnostics.push(code === 'DRAGON_UNSUPPORTED_VALUE' ? diagnostic(code, { origin, target: t, message, manual, basis: 'computed-value' }) : diagnostic(code, { origin, target: t, message, manual }));
  }
}

/** Every masked element of a subtree (root included), in tree order. */
function maskedIn(root: ResolvedElement): ResolvedElement[] {
  const out: ResolvedElement[] = [];
  const walk = (e: ResolvedElement): void => {
    if (hasMaskImage(e)) out.push(e);
    for (const c of e.children) if (c.kind === 'element') walk(c);
  };
  walk(root);
  return out;
}

/** The alpha a colour longhand paints with: its own, transparent's 0, or currentcolor's. */
function alphaOf(el: ResolvedElement, p: Longhand): number {
  const v = (el.props.get(p) as ResolvedValue | undefined)?.value;
  if (v === undefined) return 255;
  if (v.kind === 'color') return v.value.alpha;
  if (v.kind === 'keyword' && v.value === 'transparent') return 0;
  return usedColors(el).color.alpha;
}

/**
 * Why a box inside a mask (the masked box included) paints something Chrome's masked layer does not keep equal to the unmasked paint
 * at every opaque mask pixel, or that the native mask does not cover; null when it paints only opaque colours or nothing.
 */
export function maskedContentRefusal(e: ResolvedElement): string | null {
  const tag = e.element.tag;
  if (OWN_VIEW_TAGS.includes(tag)) return `<${tag}> is drawn by a view of its own, which the mask proof does not cover`;
  const opacity = e.props.get('opacity');
  if (opacity !== undefined && opacityOf(opacity.value) !== 1) return 'an opacity below 1 is a translucent group in the masked layer';
  for (const p of COLOR_LONGHANDS) {
    const a = usedColors(e)[p].alpha;
    if (a !== 0 && a !== 255) return `${p} is translucent, and the masked layer composites it over transparent`;
  }
  if (notNone(e, 'text-decoration-line' as Longhand)) {
    const a = alphaOf(e, 'text-decoration-color' as Longhand);
    if (a !== 0 && a !== 255) return 'text-decoration-color is translucent, and the masked layer composites it over transparent';
  }
  if (notNone(e, 'background-image')) return 'a background image is drawn by its own raster, which the mask proof does not cover';
  if (notNone(e, 'box-shadow')) return 'a box-shadow paints blurred and outside the box, where the mask clips it';
  if (notNone(e, 'text-shadow')) return 'a text-shadow is drawn by a shadow view whose blur the mask proof does not cover';
  if (notNone(e, 'outline-style')) return 'an outline paints outside the box, where the mask clips it';
  if (compositesSubtree(e)) return 'a scroll container or will-change scrolls or composites in a layer of its own';
  return null;
}

/**
 * The native refusals of a gradient mask. From a transformed or composited element, every mask below it (R13, as BG2-x refuses
 * gradients there; R4, the composited layer's origin). On a masked element: a mask on html or body (it masks the canvas) or on an
 * inline box (per fragment); a gradient to a corner or at an angle off the measured grid (BG2b), a currentcolor stop, a stop length
 * relative to a font size Dragon does not know; a clip-path beside it (both mask the box view's layer); and every box inside it
 * that maskedContentRefusal names.
 */
const checkMaskImage: PaintCheck = (el, targets, diagnostics, reported, propagated) => {
  const native = targets.filter((t) => t !== 'web');
  if (native.length === 0) return;
  const context = (root: ResolvedElement, why: string): void => {
    for (const m of maskedIn(root)) {
      refuse(m, native, 'context', `mask-image on ${m.element.address}: ${why}, which the native mask does not model (${MASK_CLIP})`, `Remove the mask from ${m.element.address}, or the transform, will-change or scrolling from ${root.element.address}.`, diagnostics, reported, 'DRAGON_UNPROVEN_CONTEXT');
    }
  };
  if (transformsSubtree(el) || transformsDescendants(el)) context(el, `the mask is inside ${el.element.address}, whose transform Chrome rasterises the mask under`);
  if (compositesSubtree(el, propagated)) context(el, `the mask is inside ${el.element.address}, which rasters in a composited layer of its own`);
  if (!hasMaskImage(el)) return;
  const g = gradientMaskOf(el);
  if (g === null) return;
  const address = el.element.address;
  const unsupported = (key: string, why: string, manual: string): void => refuse(el, native, key, `mask-image on ${address}: ${why}`, manual, diagnostics, reported, 'DRAGON_UNSUPPORTED_VALUE');
  const tag = el.element.tag;
  if (tag === 'html' || tag === 'body') return unsupported('canvas', `a mask on <${tag}> masks what paints the canvas, which Dragon does not model (${MASK_CLIP})`, 'Put the mask on a descendant box.');
  if (keyword(el, 'display') === 'inline') return unsupported('inline', `a mask on an inline box is painted per line fragment, which Dragon does not model (${MASK_CLIP})`, 'Put the mask on a block or inline-block box.');
  if (g.direction === 'side' && g.sideX !== 'none' && g.sideY !== 'none') return unsupported('corner', `a gradient to a corner takes its angle from atan2 and tan of the box size at paint time, libm results the native targets do not have (${BG2B})`, 'Write the gradient with an angle in degrees, on the 0.01deg grid.');
  if (g.direction === 'angle' && linearSlope(g.angleDeg) === null) return unsupported('angle', `the angle ${g.angleDeg}deg is off the 0.01deg grid whose tan the capture host measured (${BG2B})`, 'Round the angle to 0.01deg.');
  if (g.stops.some((s) => s.color.kind === 'currentcolor')) return unsupported('currentcolor', `a currentcolor stop takes its alpha from color, which the native mask raster does not follow (${MASK_CLIP})`, 'Write each stop colour explicitly.');
  const length = unfoldedLength((el.props.get('mask-image') as ResolvedValue).value);
  if (length !== null) return unsupported('unfolded', `${length} is relative to a font size, which the native mask raster does not compute (${CALC_P})`, 'Write the stop positions in px or percentages.');
  const unproven = (key: string, why: string, manual: string): void => refuse(el, native, key, `mask-image on ${address}: ${why} (${MASK_CLIP})`, manual, diagnostics, reported, 'DRAGON_UNPROVEN_CONTEXT');
  if (hasClipPath(el)) return unproven('clip-path', 'a clip-path on the masked box masks the same view, which the native targets do not combine', 'Move the clip-path or the mask to a wrapper box.');
  const walk = (e: ResolvedElement): string | null => {
    if (keyword(e, 'display') === 'none') return null;
    const why = maskedContentRefusal(e);
    if (why !== null) return `${e.element.address}: ${why}`;
    for (const c of e.children) {
      if (c.kind !== 'element') continue;
      const w = walk(c);
      if (w !== null) return w;
    }
    return null;
  };
  const inside = walk(el);
  if (inside !== null) unproven('content', `inside the mask, ${inside}`, 'Give the masked boxes opaque colours and no shadows, outlines, images, scrolling or opacity, or remove the mask.');
};

export const MASK_VALUES: PaintValues = { name: 'mask', compute: () => {}, check: checkMaskImage };
