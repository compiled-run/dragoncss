// MASK-CLIP gradient masks on the native targets (css-masking-1 §7): Chrome paints a gradient mask-image with every other mask
// longhand initial as one layer over the border box (origin and clip border-box, size auto, repeat), the same fill layer paint as a
// background (BoxPainterBase::PaintFillLayers), into a DstIn layer over the box's whole paint: the box's own paint and every
// descendant's, overflow included, keep the mask's alpha and nothing outside the border box shows. Natively the translated
// paint-gradient.ts rasterises that layer at every layout (lower/paint/gradient.ts, the mask-layer write), and the device masks the
// box view with its alpha: on iOS the view layer's mask, on Android a DST_IN draw over a saveLayer of the view's draw. Chrome
// keeps masked text in its accessibility tree; neither native mask touches the views' accessibility, so text is kept too.
// Refused on the native targets, where the device mask would differ from Chrome's: the root and body (the canvas), an inline box
// (painted per fragment), an SVG shape (no box view), a paint outside the box view (its box-shadow companion, an outline in the
// root view, a layer item hosted under another stacking context), a clip-path (which takes the view layer's mask on iOS), a
// raster origin the engine does not model (a
// composited or transformed box or ancestor, R4 and R13), the gradient refusals of BG2 (a corner, an angle off the grid), and a
// currentcolor stop, whose alpha the raster bakes in while the native animator patches colours without a layout.
// The backdrop: Chrome composites the masked layer over what is painted behind it with Skia's 8-bit blend, which is one off the
// native compositors' in a channel over most colours (as opacity, PNT1), and exact where every backdrop channel is 0 or 255, where
// both reduce to whole numbers (packages/parity/test/mask-gradient.test.ts). So the native targets take a mask only over the canvas,
// when the canvas colour is such a colour: no ancestor paints a background under the masked box (the one whose background is the
// canvas's aside), and the box is not positioned, so it is laid over its ancestors alone. Content another box overflows onto it
// is not known before layout, and is the author's to avoid.
import { zIndexOf } from '../css/properties/effects.ts';
import type { MaskLonghand } from '../css/properties/mask.ts';
import { maskGradientOf } from '../css/properties/mask.ts';
import type { GradientSpec } from './paint-values/gradient.ts';
import { compositesSubtree, linearSlope, transformsSubtree } from './paint-values/gradient.ts';
import { paintedOutlineStyle } from './paint-values/outline.ts';
import { usedColors } from '../lower/paint/colors.ts';
import type { Rgba8 } from '../css/color.ts';
import type { ResolvedElement, ResolvedValue } from './resolve.ts';

const keywordOf = (el: ResolvedElement, p: string): string => {
  const v = el.props.get(p as MaskLonghand)?.value;
  return v !== undefined && v.kind === 'keyword' ? v.value : '';
};

/** The gradient mask of an element, or null when its mask-image is none or a value Dragon does not draw. */
export function elementMaskGradient(el: ResolvedElement): GradientSpec | null {
  const v = el.props.get('mask-image') as ResolvedValue | undefined;
  return v === undefined ? null : maskGradientOf(v.value);
}

/** A native refusal: the fact Chrome's mask depends on that the device mask lacks, and what to do about it. */
export type MaskRefusal = { readonly fact: string; readonly manual: string };

/** Why the device mask of a box with a gradient mask would differ from Chrome's, or null: the box's own facts before its subtree's. */
export function maskRefusal(el: ResolvedElement, g: GradientSpec, propagated: ResolvedElement | null): MaskRefusal | null {
  const at = el.element.address;
  const tag = el.element.tag;
  if (tag === 'html' || tag === 'body') return { fact: `it is <${tag}>, whose background is the canvas's, which the box view does not paint`, manual: `Move the mask from <${tag}> to a box inside it.` };
  if (keywordOf(el, 'display') === 'inline') return { fact: 'it is an inline box, which Chrome masks fragment by fragment and whose content the native runtime places beside its view', manual: `Give ${at} display: inline-block or block, or move the mask to a block.` };
  const shadow = el.props.get('box-shadow')?.value;
  if (shadow !== undefined && !(shadow.kind === 'keyword' && shadow.value === 'none')) return { fact: 'it has a box-shadow, drawn by a companion view beside the box view, outside the mask', manual: `Move the box-shadow of ${at} to a wrapper, or remove it.` };
  const clipPath = el.props.get('clip-path')?.value;
  if (clipPath !== undefined && !(clipPath.kind === 'keyword' && clipPath.value === 'none')) return { fact: 'it has a clip-path too, which takes the view layer\'s one mask on iOS', manual: `Move the clip-path of ${at} to a wrapper, or remove it.` };
  if (transformsSubtree(el)) return { fact: 'it has a transform, under which Chrome rasterises the mask with the transform in the shader matrix and the native targets would resample the raster', manual: `Move the transform of ${at} to a wrapper inside the masked box, or remove it.` };
  if (compositesSubtree(el, propagated)) return { fact: 'it rasters in a composited layer of its own (will-change, or a scroll container), whose origin starts the dither, which Dragon does not model', manual: `Remove will-change: transform and opacity, and overflow auto and scroll, from ${at}.` };
  if (!g.radial && g.direction === 'side' && g.sideX !== 'none' && g.sideY !== 'none') return { fact: 'its gradient goes to a corner, whose angle Chrome takes from atan2 and tan of the box size at paint time, libm results the native targets do not have', manual: 'Write the gradient with an angle in degrees, on the 0.01deg grid.' };
  if (!g.radial && g.direction === 'angle' && linearSlope(g.angleDeg) === null) return { fact: `its angle ${g.angleDeg}deg is off the 0.01deg grid whose tan the capture host measured`, manual: 'Round the angle to 0.01deg.' };
  if (g.stops.some((s) => s.color.kind === 'currentcolor')) return { fact: 'its gradient has a currentcolor stop, whose alpha the raster bakes in once per layout while the native animator changes colours without one', manual: 'Write the stop colours of the mask out, such as black and transparent.' };
  const visit = (e: ResolvedElement, root: boolean, flexOrGrid: boolean): MaskRefusal | null => {
    if (keywordOf(e, 'display') === 'none') return null;
    if (paintedOutlineStyle(e) !== null) return { fact: `${root ? 'it has' : `${e.element.address} has`} an outline, which Dragon draws in the root view, outside the mask`, manual: `Remove the outline inside ${at}, or the mask.` };
    if (!root) {
      const z = zIndexOf((e.props.get('z-index') as ResolvedValue).value);
      if (z !== null && z !== 0 && (keywordOf(e, 'position') !== 'static' || flexOrGrid)) return { fact: `${e.element.address} has z-index ${z}, and its layer may be hosted under a stacking context outside the box view`, manual: `Give ${e.element.address} z-index auto or 0, or move it out of ${at}.` };
    }
    const display = keywordOf(e, 'display');
    const container = display === 'flex' || display === 'inline-flex' || display === 'grid' || display === 'inline-grid';
    for (const c of e.children) {
      if (c.kind !== 'element') continue;
      const found = visit(c, false, container);
      if (found !== null) return found;
    }
    return null;
  };
  return visit(el, true, false);
}

/** The masked boxes in the subtree of root, below it, in preorder: those whose raster origin root moves (a transform or a composited layer). */
export function masksInside(root: ResolvedElement): ResolvedElement[] {
  const out: ResolvedElement[] = [];
  const walk = (e: ResolvedElement): void => {
    for (const c of e.children) {
      if (c.kind !== 'element') continue;
      if (elementMaskGradient(c) !== null) out.push(c);
      walk(c);
    }
  };
  walk(root);
  return out;
}

/** Whether an element paints a background: an opaque or translucent colour, or an image. */
function paintsBackground(el: ResolvedElement): boolean {
  const image = el.props.get('background-image')?.value;
  return usedColors(el)['background-color'].alpha !== 0 || !(image === undefined || (image.kind === 'keyword' && image.value === 'none'));
}

/** Whether a colour is opaque with every channel 0 or 255, over which Chrome's blend and the native compositors' agree. */
const pure = (c: Rgba8): boolean => c.alpha === 255 && [c.r, c.g, c.b].every((v) => v === 0 || v === 255);

const rgb = (c: Rgba8): string => (c.alpha === 255 ? `rgb(${c.r}, ${c.g}, ${c.b})` : `rgba(${c.r}, ${c.g}, ${c.b}, ${c.alpha}/255)`);

/**
 * The backdrop refusal of every masked box in a resolved document, in preorder: a canvas colour other than a pure one (from html,
 * or body when html paints none; white when neither does), an ancestor that paints a background under the box, or a positioned box.
 */
export function maskBackdropRefusals(root: ResolvedElement): { readonly el: ResolvedElement; readonly refusal: MaskRefusal }[] {
  const body = root.children.find((c): c is ResolvedElement => c.kind === 'element' && c.element.tag === 'body') ?? null;
  const canvasFrom = paintsBackground(root) ? root : body !== null && paintsBackground(body) ? body : null;
  const canvasColor: Rgba8 = canvasFrom === null ? { r: 255, g: 255, b: 255, alpha: 255 } : usedColors(canvasFrom)['background-color'];
  const canvasImage = canvasFrom !== null && !(canvasFrom.props.get('background-image')?.value.kind === 'keyword' && (canvasFrom.props.get('background-image')?.value as { value: string }).value === 'none');
  const out: { el: ResolvedElement; refusal: MaskRefusal }[] = [];
  const walk = (e: ResolvedElement, under: ResolvedElement | null): void => {
    if (keywordOf(e, 'display') === 'none') return;
    if (elementMaskGradient(e) !== null) {
      const at = e.element.address;
      const position = keywordOf(e, 'position');
      const manual = `Put ${at} straight on the page, with no background on its ancestors and a page background of white, black or another colour whose every channel is 0 or 255.`;
      if (canvasImage) out.push({ el: e, refusal: { fact: `the canvas has a background image, over which Chrome's blend of the masked box and the native compositors' differ`, manual } });
      else if (!pure(canvasColor)) out.push({ el: e, refusal: { fact: `the canvas is ${rgb(canvasColor)}, over which Chrome's 8-bit blend of the masked box is one off the native compositors' in a channel; they agree only over a backdrop whose every channel is 0 or 255`, manual } });
      else if (under !== null) out.push({ el: e, refusal: { fact: `${under.element.address} paints a background under it, over which Chrome's 8-bit blend of the masked box is one off the native compositors' in a channel; the native targets mask a box over the canvas only`, manual } });
      else if (position !== 'static' && position !== '') out.push({ el: e, refusal: { fact: `it is position: ${position}, so it may lie over boxes other than its ancestors, over which Chrome's blend and the native compositors' differ; the native targets mask a box over the canvas only`, manual: `Give ${at} position: static, or move the mask to a static box.` } });
    }
    const paints = e !== canvasFrom && paintsBackground(e) ? e : under;
    for (const c of e.children) if (c.kind === 'element') walk(c, paints);
  };
  walk(root, null);
  return out;
}
