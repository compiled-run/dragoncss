// css-overflow-3 §3: a box whose axes are both not visible (hidden, auto, scroll or clip; at scroll offset 0 a scroll container draws
// like hidden) clips descendants to the padding box, through a Dragon clip view inset by the border widths.
// css-masking-1 §5.1: an absolutely positioned box whose clip is a rect() that is empty at every size paints nothing, nor does any
// descendant (Chrome's clip node covers both), so its view is hidden with everything inside it. Any other applied clip is
// refused (analysis/paint-values/clip.ts).
// css-masking-1 §6.1: clip-path: inset() clips the box and every descendant to its border box inset by the four edges (Chrome's
// clip-path clip node, paint_property_tree_builder.cc UpdateClipPathClip); the box view masks itself and its subviews to that rect.
// circle(), ellipse() and polygon() clip them to that shape against the border box (Chrome's mask-based clip-path, an antialiased
// path clip); the box view masks itself and its subviews to the same path.
// Chrome keeps text a clip-path or a mask hides in its accessibility tree (AXObject::IsHiddenViaStyle reads display, visibility and
// content-visibility, not clipping or masking). Neither native technique touches the views' accessibility, and the clip-text write
// proves it on the device: the box's visible text leaves, in tree order, are what the device reads back as exposed to VoiceOver or
// TalkBack among the text views inside the box view.
import type { InlineChild, LayoutNode } from '@dragon/layout';
import type { ResolvedElement } from '../../analysis/resolve.ts';
import { elementMaskGradient } from '../../analysis/mask.ts';
import type { ClipShape, InsetEdge, ShapeLength } from '../../css/properties/clip-path.ts';
import { clipPathShape, shapeLengths } from '../../css/properties/clip-path.ts';
import { clipHidesBox } from '../../css/properties/clip-rect.ts';
import type { PaintLowering } from './types.ts';
import { ProgramError } from './types.ts';

export type ClipWrite =
  | { readonly kind: 'padding-box-clip' }
  | { readonly kind: 'clip-rect-empty' }
  /** The computed inset() edges (top, right, bottom, left), each in px or % of the border box's height (top, bottom) or width. */
  | { readonly kind: 'clip-path-inset'; readonly edges: readonly InsetEdge[] }
  /** A computed circle(), ellipse() or polygon(), every length in px or % of the border box. */
  | { readonly kind: 'clip-path-shape'; readonly shape: Exclude<ClipShape, { readonly kind: 'inset' }> }
  /** The text of each visible text leaf inside a box with a clip-path or a gradient mask, in tree order: what stays accessible. */
  | { readonly kind: 'clip-text'; readonly texts: readonly string[] };

export const CLIP_LOWERING: PaintLowering<ClipWrite> = {
  name: 'clip',
  vocabulary: {
    uikit: {
      'padding-box-clip': { key: 'dragonClip.frame', technique: 'native-property', detail: 'a DragonClipView over the padding box with clipsToBounds = true hosts the children; frame in points relative to the node' },
      'clip-rect-empty': { key: 'dragonClipRect.hidden', technique: 'native-property', detail: 'the box view takes isHidden = true, which hides it and every view inside it; 1 when hidden' },
      'clip-path-inset': { key: 'dragonClipPath.frame', technique: 'native-property', detail: "the box view's layer.mask is an opaque CALayer over the inset rect, which clips the box and every view inside it; frame in points relative to the box" },
      'clip-path-shape': { key: 'dragonClipPath.shape', technique: 'native-property', detail: "the box view's layer.mask is a CAShapeLayer filling the shape's path, which clips the box and every view inside it; circle [cx, cy, r], ellipse [cx, cy, rx, ry] or polygon [evenodd, x0, y0, ...] in points relative to the box" },
      'clip-text': { key: 'dragonClipText.exposed', technique: 'native-property', detail: "the layer mask leaves the text views' accessibility untouched; the accessibilityLabel of each DragonTextView inside the box view that VoiceOver reaches (an accessibility element with a non-empty frame in a window, not hidden, at alpha 0.01 or more, under no hidden, transparent, accessibility-hiding or accessibility-element ancestor), in subview preorder" },
    },
    'android-views': {
      'padding-box-clip': { key: 'dragonClip.clipBounds', technique: 'native-property', detail: 'a DragonClipView over the padding box with View.clipBounds = its own bounds hosts the children; [left, top, right, bottom] in device px relative to the node' },
      'clip-rect-empty': { key: 'dragonClipRect.hidden', technique: 'native-property', detail: 'the box view takes View.INVISIBLE, which hides it and every view inside it; 1 when invisible' },
      'clip-path-inset': { key: 'dragonClipPath.rect', technique: 'native-property', detail: 'DragonBoxView.draw clips its canvas to the inset rect before it draws itself and its children; [left, top, right, bottom] in device px relative to the box' },
      'clip-path-shape': { key: 'dragonClipPath.shape', technique: 'native-property', detail: "DragonBoxView.draw clips its canvas to the shape's antialiased path before it draws itself and its children; circle [cx, cy, r], ellipse [cx, cy, rx, ry] or polygon [evenodd, x0, y0, ...] in device px relative to the box" },
      'clip-text': { key: 'dragonClipText.exposed', technique: 'native-property', detail: "the canvas clip leaves the text views' accessibility untouched; the contentDescription of each DragonTextView inside the box view whose AccessibilityNodeInfo TalkBack reaches (visible to the user, important for accessibility), in child preorder" },
    },
  },
  css: { 'padding-box-clip': ['overflow-x', 'overflow-y'], 'clip-rect-empty': ['clip'], 'clip-path-inset': ['clip-path'], 'clip-path-shape': ['clip-path'], 'clip-text': ['clip-path', 'mask-image', 'visibility'] },
  lower: ({ box, el }) => {
    const out: ClipWrite[] = clipsChildren(box) ? [{ kind: 'padding-box-clip' }] : [];
    if (el === null) return out;
    const hides = clipHidesBox(el);
    if (hides === null) throw new ProgramError(`${el.element.address}: clip applies with a rect that is not empty at every size, which has no native technique (MASK-CLIP)`);
    if (hides) out.push({ kind: 'clip-rect-empty' });
    const shape = clipPathShape(el);
    if (shape !== null) {
      if (shapeLengths(shape).some((e: ShapeLength) => e.unit !== 'px' && e.unit !== '%')) throw new ProgramError(`${el.element.address}: clip-path has a length not computed to px or %`);
      out.push(shape.kind === 'inset' ? { kind: 'clip-path-inset', edges: shape.edges.map((e) => ({ value: e.value, unit: e.unit })) } : { kind: 'clip-path-shape', shape });
    }
    if (shape !== null || elementMaskGradient(el) !== null) {
      const texts = visibleTexts(box, el);
      if (texts.length > 0) out.push({ kind: 'clip-text', texts });
    }
    return out;
  },
};

/**
 * The text of every text leaf in a box's subtree whose element is visibility: visible (the native text view follows its element,
 * native-support.ts textNode; Chrome does not expose hidden text either), in tree order, as the program's text views carry it.
 */
function visibleTexts(box: LayoutNode, el: ResolvedElement): string[] {
  const visible = new Map<string, boolean>();
  const owners = (e: ResolvedElement): void => {
    const v = e.props.get('visibility')?.value;
    for (const c of e.children) {
      if (c.kind === 'element') owners(c);
      else visible.set(c.node.address, v !== undefined && v.kind === 'keyword' && v.value === 'visible');
    }
  };
  owners(el);
  const out: string[] = [];
  const inline = (c: InlineChild): void => {
    if (c.kind === 'text') {
      if (visible.get(c.id) === undefined) throw new ProgramError(`${c.id}: no resolved text for the text leaf`);
      if (visible.get(c.id) === true) out.push(c.text);
    } else if (c.kind === 'inline') c.children.forEach(inline);
  };
  const walk = (b: LayoutNode): void => {
    if (b.kind === 'replaced') return;
    for (const c of b.children) {
      if (c.kind === 'box' || c.kind === 'replaced') walk(c);
      else inline(c);
    }
  };
  walk(box);
  return out;
}

/** Whether a box's children are hosted in a clip view over its padding box; one clipped axis alone has no native technique (OVFL-c). */
export function clipsChildren(box: { readonly id: string; readonly style: { readonly overflowX: string; readonly overflowY: string } }): boolean {
  const x = box.style.overflowX !== 'visible';
  if (x !== (box.style.overflowY !== 'visible')) throw new ProgramError(`${box.id}: overflow clips one axis only, which has no native technique (OVFL-c)`);
  return x;
}
