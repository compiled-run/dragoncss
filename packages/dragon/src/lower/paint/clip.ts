// css-overflow-3 §3: a box whose axes are both not visible (hidden, auto, scroll or clip; at scroll offset 0 a scroll container draws
// like hidden) clips descendants to the padding box, through a Dragon clip view inset by the border widths.
// css-masking-1 §5.1: an absolutely positioned box whose clip is a rect() that is empty at every size paints nothing, nor does any
// descendant (Chrome's clip node covers both), so its view is hidden with everything inside it. Any other applied clip is
// refused (analysis/paint-values/clip.ts).
// css-masking-1 §6.1: clip-path: inset() clips the box and every descendant to its border box inset by the four edges (Chrome's
// clip-path clip node, paint_property_tree_builder.cc UpdateClipPathClip); the box view masks itself and its subviews to that rect.
import type { InsetEdge } from '../../css/properties/clip-path.ts';
import { clipPathEdges } from '../../css/properties/clip-path.ts';
import { clipHidesBox } from '../../css/properties/clip-rect.ts';
import type { PaintLowering } from './types.ts';
import { ProgramError } from './types.ts';

export type ClipWrite =
  | { readonly kind: 'padding-box-clip' }
  | { readonly kind: 'clip-rect-empty' }
  /** The computed inset() edges (top, right, bottom, left), each in px or % of the border box's height (top, bottom) or width. */
  | { readonly kind: 'clip-path-inset'; readonly edges: readonly InsetEdge[] };

export const CLIP_LOWERING: PaintLowering<ClipWrite> = {
  name: 'clip',
  vocabulary: {
    uikit: {
      'padding-box-clip': { key: 'dragonClip.frame', technique: 'native-property', detail: 'a DragonClipView over the padding box with clipsToBounds = true hosts the children; frame in points relative to the node' },
      'clip-rect-empty': { key: 'dragonClipRect.hidden', technique: 'native-property', detail: 'the box view takes isHidden = true, which hides it and every view inside it; 1 when hidden' },
      'clip-path-inset': { key: 'dragonClipPath.frame', technique: 'native-property', detail: "the box view's layer.mask is an opaque CALayer over the inset rect, which clips the box and every view inside it; frame in points relative to the box" },
    },
    'android-views': {
      'padding-box-clip': { key: 'dragonClip.clipBounds', technique: 'native-property', detail: 'a DragonClipView over the padding box with View.clipBounds = its own bounds hosts the children; [left, top, right, bottom] in device px relative to the node' },
      'clip-rect-empty': { key: 'dragonClipRect.hidden', technique: 'native-property', detail: 'the box view takes View.INVISIBLE, which hides it and every view inside it; 1 when invisible' },
      'clip-path-inset': { key: 'dragonClipPath.rect', technique: 'native-property', detail: 'DragonBoxView.draw clips its canvas to the inset rect before it draws itself and its children; [left, top, right, bottom] in device px relative to the box' },
    },
  },
  css: { 'padding-box-clip': ['overflow-x', 'overflow-y'], 'clip-rect-empty': ['clip'], 'clip-path-inset': ['clip-path'] },
  lower: ({ box, el }) => {
    const out: ClipWrite[] = clipsChildren(box) ? [{ kind: 'padding-box-clip' }] : [];
    if (el === null) return out;
    const hides = clipHidesBox(el);
    if (hides === null) throw new ProgramError(`${el.element.address}: clip applies with a rect that is not empty at every size, which has no native technique (MASK-CLIP)`);
    if (hides) out.push({ kind: 'clip-rect-empty' });
    const edges = clipPathEdges(el);
    if (edges !== null) {
      if (edges.some((e) => e.unit !== 'px' && e.unit !== '%')) throw new ProgramError(`${el.element.address}: clip-path has an inset edge not computed to px or %`);
      out.push({ kind: 'clip-path-inset', edges: edges.map((e) => ({ value: e.value, unit: e.unit })) });
    }
    return out;
  },
};

/** Whether a box's children are hosted in a clip view over its padding box; one clipped axis alone has no native technique (OVFL-c). */
export function clipsChildren(box: { readonly id: string; readonly style: { readonly overflowX: string; readonly overflowY: string } }): boolean {
  const x = box.style.overflowX !== 'visible';
  if (x !== (box.style.overflowY !== 'visible')) throw new ProgramError(`${box.id}: overflow clips one axis only, which has no native technique (OVFL-c)`);
  return x;
}
