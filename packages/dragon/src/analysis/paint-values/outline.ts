// Computed outlines (css-ui-4 §3): outline-width computes to px (thin 1, medium 3, thick 5), and to 0 when outline-style is none, as
// Chrome 145 serializes it; the webref initial auto of outline-color is Chrome's currentcolor. Lengths are already px here.
import { OUTLINE_WIDTH_KEYWORDS } from '../../css/properties/outline.ts';
import { authored, diagnostic } from '../../diagnostics/catalogue.ts';
import type { Diagnostic } from '../../types.ts';
import type { ResolvedValue } from '../computed.ts';
import type { ResolvedElement } from '../resolve.ts';
import { opacityOf, zIndexOf } from '../../css/properties/effects.ts';
import { stackingOf } from '../../lower/paint/stacking.ts';
import { resolvedStackTree } from './stacking.ts';
import { elementWillChange, transformsDescendants } from './transform.ts';
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
    diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_VALUE', { origin: outlineOrigin(el), target: t, message: `${el.element.address} ${why}; ${t} draws solid and double outlines only (PNT1)`, manual, basis: 'computed-value' }));
  }
}

/**
 * The native targets draw solid and double outlines (lower/paint/outline.ts). An outline in another style is refused there: dotted
 * and dashed take P6a's fitted side painter, groove, ridge, inset and outset its 3D colours, and auto is Chrome's focus ring. An
 * outline on an inline box is refused too: Blink outlines each of its line fragments. outline: none and a zero width paint nothing,
 * so they compile. The web target paints every outline itself.
 */
const checkOutline: PaintCheck = (el, targets, diagnostics, reported) => {
  const style = paintedOutlineStyle(el);
  if (style === null) return;
  if (style !== 'solid' && style !== 'double') {
    const why = style === 'auto' ? "has outline-style auto, Chrome's focus ring" : `has a ${style} outline, which needs P6a's border side painter`;
    refuse(el, 'style', why, 'Use a solid or double outline, or outline: none.', targets, diagnostics, reported);
    return;
  }
  if (keywordOf(el, 'display') === 'inline') refuse(el, 'inline', 'has an outline on an inline box, which Blink draws around each line fragment', 'Outline a block or flex box, or give the element display: inline-block.', targets, diagnostics, reported);
};

/**
 * Why a layer item of the stacking tree (lower/paint/stacking.ts: a positioned box, a flex item with a z-index, a box with opacity
 * below 1, a transform, or will-change: transform or opacity) paints in a layer of its own rather than in its context's flow.
 */
function layerReason(el: ResolvedElement): string {
  const position = keywordOf(el, 'position');
  if (['relative', 'absolute', 'fixed', 'sticky'].includes(position)) return `position: ${position}`;
  const opacity = opacityOf((el.props.get('opacity') as ResolvedValue).value);
  if (opacity !== null && opacity < 1) return `opacity: ${opacity}`;
  if (transformsDescendants(el)) return 'a transform';
  if (elementWillChange(el).includes('opacity')) return 'will-change: opacity';
  // A static box's z-index makes it a layer item only as a flex item (resolvedStackTree), the one reason left.
  const z = zIndexOf((el.props.get('z-index') as ResolvedValue).value);
  if (z !== null) return `z-index: ${z} on a flex item`;
  throw new Error(`${el.element.address}: a layer item with no reason to be one`);
}

const CLIPPING = ['hidden', 'clip', 'scroll', 'auto'];
const clips = (el: ResolvedElement): boolean => CLIPPING.includes(keywordOf(el, 'overflow-x')) || CLIPPING.includes(keywordOf(el, 'overflow-y'));

/**
 * Where the native outline paints. Dragon draws every solid or double outline in the root view after all the case's content, each
 * box's descendants' outlines before its own: Chrome's order for the root stacking context's outline phase when every box paints in
 * that context's flow (Blink PaintLayerPainter paints a layer's outlines after its foreground). Two cases would differ, so the
 * native targets refuse them at the outline: an outline under an overflow clip or scroller (the root view is outside it, so the
 * clip would not apply), and an outline in a case with a layer item of the stacking tree (lower/paint/stacking.ts), which Chrome
 * paints in a layer above the outlines of its stacking context, or whose own layer holds the outlines inside it (with its opacity).
 * propagated is the element whose overflow the viewport takes (css-overflow-3 §3.3), which does not clip.
 */
export function checkOutlinePlacement(root: ResolvedElement, propagated: ResolvedElement | null, targets: readonly string[], diagnostics: Diagnostic[], reported: Set<string>): void {
  const outlined: { readonly el: ResolvedElement; readonly clip: ResolvedElement | null }[] = [];
  const boxes: ResolvedElement[] = [];
  const walk = (el: ResolvedElement, clip: ResolvedElement | null): void => {
    if (keywordOf(el, 'display') === 'none') return;
    const style = paintedOutlineStyle(el);
    if (style === 'solid' || style === 'double') outlined.push({ el, clip });
    if (el !== root) boxes.push(el);
    const inner = el !== root && el !== propagated && clips(el) ? el : clip;
    for (const c of el.children) if (c.kind === 'element') walk(c, inner);
  };
  walk(root, null);
  if (outlined.length === 0) return;
  // The first layer item in tree order (the stacking tree is built only for a case with a painting outline).
  const facts = stackingOf(resolvedStackTree(root, propagated)).facts;
  const stacked = boxes.find((el) => {
    const f = facts.get(el.element.address);
    if (f === undefined) throw new Error(`${el.element.address} is not in the stacking tree`);
    return f.layer !== 'flow';
  });
  for (const { el, clip } of outlined) {
    if (clip !== null) {
      refuse(el, 'clip', `has an outline inside the overflow clip of ${clip.element.address}, and Dragon draws native outlines in the root view, outside that clip, until it hosts them in their stacking context`, `Move the outline to a box outside ${clip.element.address}, or let ${clip.element.address} overflow visibly.`, targets, diagnostics, reported);
    } else if (stacked !== undefined) {
      refuse(el, 'stacking', `has an outline, and ${stacked.element.address} has ${layerReason(stacked)}, which Chrome paints in a layer of its own, above the outlines of its stacking context (CSS2 Appendix E); Dragon draws native outlines after all the content until it hosts them in their stacking context`, 'Use outlines in a view without positioned, translucent or transformed boxes, or outline: none.', targets, diagnostics, reported);
    }
  }
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
