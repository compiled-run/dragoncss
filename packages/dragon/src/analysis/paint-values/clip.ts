// The clip module's computed values and refusals. clip (css-masking-1 §5.1): each rect() edge computes to px (em against the
// element's font size, rem against the root's), auto edges stay auto. Chrome clips only an absolutely or fixed positioned box, to
// the rect CSS2 §11.1.2 gives against its border box, and that clip node covers the box's own paint and every descendant
// (paint_property_tree_builder.cc UpdateCssClip). Natively Dragon draws one clip: a rect that is empty whatever the box's size
// hides the box view, and with it every view inside it (lower/paint/clip.ts). Refused on the native targets: any other rect on
// such a box, and an empty one whose subtree paints a view outside the box view: an outline (in the root view), the box's own
// box-shadow (a companion beside it) and a layer item with a z-index other than 0 (which may be hosted under a stacking context
// outside it); a box that is not visible as well, whose visibility readback reads the same hidden flag; and text anywhere in the
// subtree, which Chrome keeps in the accessibility tree (the visually-hidden pattern) while the native views that hide it leave it:
// UIKit leaves a hidden view out, and Android's View.isVisibleToUser is false under an ancestor that is not VISIBLE or at alpha 0, and
// under an ancestor's clip bounds that leave nothing (ViewGroup.getChildVisibleRect), so TalkBack skips it. Only text views are
// accessibility elements natively (native-support.ts), so a subtree without text loses nothing there. An em or rem edge whose font
// size has no build-time value is refused for that.
// overflow (css-overflow-3 §3): a box that clips its overflow hosts its children in a native clip view over its padding box
// (lower/paint/clip.ts). A clip view that leaves a text view no visible pixel drops it from the native accessibility tree as
// above (Android's getChildVisibleRect is empty), while Chrome keeps clipped text in its tree. Refused on the native targets, by
// a rule decided from computed values alone: text in a clip box whose width, height, max-width, max-height or flex-basis (without
// flex-grow) is zero or not a plain length; text under a non-zero text-indent anywhere from the
// clip box down; and text under a box between them that is shifted out of flow: absolutely or fixed positioned, offset by
// relative or sticky insets, transformed, or given a negative margin.
// clip-path (css-masking-1 §6.1): an inset() edge computes to px (em and rem as above), a percentage stays a percentage of the
// border box's width or height. Chrome clips the box's own paint and every descendant, positioned ones included, to the inset rect.
// Natively Dragon clips the box view and the views inside it to that rect after layout. Refused on the native targets: the root and
// body, an inline box (whose fragments clip one by one), the box's own box-shadow and an outline in the subtree (views outside the
// box view), and any text in the subtree: the clip covers every descendant, overflowing text and positioned descendants included, so
// any inset can cut text out of sight while Chrome keeps it in the accessibility tree, and the native accessibility tree of a
// clipped view is not proven yet.
import type { Longhand } from '../../css/properties.ts';
import type { InsetEdges } from '../../css/properties/clip-path.ts';
import { clipPathEdges, insetEdgesOf, insetValue } from '../../css/properties/clip-path.ts';
import type { ClipEdges } from '../../css/properties/clip-rect.ts';
import { appliedClipEdges, clipEdgesOf, clipHidesBox, clipRectValue } from '../../css/properties/clip-rect.ts';
import { zIndexOf } from '../../css/properties/effects.ts';
import { paintsOwn, visibilityOf } from '../../css/properties/visibility.ts';
import { SIDES } from '../../css/properties.ts';
import { CANONICAL_LENGTH_UNIT, lengthToPx } from '../../css/units.ts';
import { authored, diagnostic } from '../../diagnostics/catalogue.ts';
import type { Diagnostic } from '../../types.ts';
import type { ResolvedValue } from '../computed.ts';
import { valueToString } from '../computed.ts';
import type { ResolvedElement } from '../resolve.ts';
import { paintedOutlineStyle } from './outline.ts';
import type { PaintCheck, PaintValueContext, PaintValues } from './types.ts';

const keywordOf = (el: Pick<ResolvedElement, 'props'>, p: Longhand): string => {
  const v = el.props.get(p)?.value;
  return v !== undefined && v.kind === 'keyword' ? v.value : '';
};

function computeEdges(edges: ClipEdges, ctx: PaintValueContext): ClipEdges | null {
  const out = edges.map((e) => {
    if (e === null || e.unit === CANONICAL_LENGTH_UNIT) return e;
    if ((e.unit === 'em' && ctx.em === null) || (e.unit === 'rem' && ctx.rem === null)) return undefined;
    const px = lengthToPx(e.value, e.unit, { em: ctx.em ?? 0, rem: ctx.rem ?? 0 });
    return px === null ? undefined : { value: px, unit: CANONICAL_LENGTH_UNIT };
  });
  return out.some((e) => e === undefined) ? null : (out as unknown as ClipEdges);
}

/** The first text in preorder in the subtree of a box (outside display: none), or null. */
export function textInside(el: ResolvedElement): string | null {
  if (keywordOf(el, 'display') === 'none') return null;
  for (const c of el.children) {
    const found = c.kind === 'text' ? c.node.address : textInside(c);
    if (found !== null) return found;
  }
  return null;
}

/** Why each native target loses a hidden view from the accessibility tree. */
const A11Y_DROP: { readonly [t: string]: string } = {
  ios: 'ios hides the box view, and UIKit leaves a hidden view out of the accessibility tree, so VoiceOver would not read it',
  android: 'android makes the box view invisible, and a view under an invisible, transparent or empty-clip-bounds ancestor is not visible to the user (View.isVisibleToUser), so TalkBack would skip it',
};

/** Why the subtree of a box its clip hides paints a view outside the box view, or null: the first such element in preorder. */
export function viewOutsideClip(el: ResolvedElement): string | null {
  if (!paintsOwn(visibilityOf((el.props.get('visibility') as ResolvedValue).value))) return `it is ${valueToString((el.props.get('visibility') as ResolvedValue).value)} too, and the visibility readback reads the same hidden flag`;
  const shadow = el.props.get('box-shadow')?.value;
  if (shadow !== undefined && !(shadow.kind === 'keyword' && shadow.value === 'none')) return 'it has a box-shadow, drawn by a companion view beside the box view';
  const visit = (e: ResolvedElement, root: boolean, flexOrGrid: boolean): string | null => {
    if (keywordOf(e, 'display') === 'none') return null;
    if (paintedOutlineStyle(e) !== null) return `${root ? 'it has' : `${e.element.address} has`} an outline, drawn in the root view`;
    if (!root) {
      const z = zIndexOf((e.props.get('z-index') as ResolvedValue).value);
      if (z !== null && z !== 0 && (keywordOf(e, 'position') !== 'static' || flexOrGrid)) return `${e.element.address} has z-index ${z}, and its layer may be hosted under a stacking context outside the box view`;
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

const checkClip: PaintCheck = (el, targets, diagnostics, reported) => {
  const edges = appliedClipEdges(el);
  if (edges === null) return;
  const v = el.props.get('clip') as ResolvedValue;
  const origin = v.declaration === null ? el.element.node.origin : authored(v.declaration.valueSpan);
  const hides = clipHidesBox(el);
  const why = hides === true ? viewOutsideClip(el) : null;
  const text = hides === true && why === null ? textInside(el) : null;
  if (hides === true && why === null && text === null) return;
  const at = `${el.element.address}`;
  const rect = valueToString(v.value);
  // An edge left in em or rem: compute had no build-time font size for it.
  const unresolved = edges.find((e) => e !== null && e.unit !== CANONICAL_LENGTH_UNIT);
  for (const t of targets) {
    if (t === 'web') continue;
    const id = `${t}|clip|${at}`;
    if (reported.has(id)) continue;
    reported.add(id);
    const message = unresolved !== undefined && unresolved !== null
      ? `${at} has clip: ${rect}, whose ${unresolved.unit} edge has no build-time font size to compute it against; ${t} needs every clip edge in px at build time`
      : hides !== true
        ? `${at} has clip: ${rect}, which clips it to a rect that is not empty at every size; ${t} draws only a clip that hides the whole box (an empty rect, such as rect(0, 0, 0, 0))`
        : text !== null
          ? `${at} has clip: ${rect}, which hides it whole, but its text ${text} stays in Chrome's accessibility tree and screen readers read it; ${A11Y_DROP[t] ?? `${t} would drop it from the accessibility tree`}`
          : `${at} has clip: ${rect}, which hides it whole, but ${why}; ${t} hides the box view and the views inside it only`;
    const manual = unresolved !== undefined && unresolved !== null
      ? `Write the clip edges of ${at} in px, or give the font size they depend on a build-time value.`
      : hides !== true
        ? 'Use an overflow clip on a wrapper sized to the rect, or an empty rect to hide the box.'
        : text !== null
          ? `Keep the text of ${at} visible on native targets, or move it out of ${at}; the native targets hide only boxes without text, so nothing leaves the accessibility tree.`
          : `Move what ${at} must not hide out of it, or remove it from ${at}.`;
    diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_VALUE', { origin, target: t, message, manual, basis: 'computed-value' }));
  }
};

const isZero = (v: ResolvedValue['value'] | undefined): boolean => v !== undefined && (v.kind === 'length' || v.kind === 'percentage') && v.value === 0;
/** A size that can be zero at layout: a zero length or percentage, or a value with no build-time number (calc(), min(), ...). */
const mayBeZero = (v: ResolvedValue['value'] | undefined): boolean => v !== undefined && v.kind !== 'keyword' && (isZero(v) || (v.kind !== 'length' && v.kind !== 'percentage'));
const valueOf = (el: ResolvedElement, p: Longhand): ResolvedValue['value'] | undefined => el.props.get(p)?.value;

/** The size of a box that can be zero at layout (such as "height 0px"), or null. */
function zeroSizeOf(el: ResolvedElement): string | null {
  for (const p of ['width', 'height', 'max-width', 'max-height'] as const) {
    const v = valueOf(el, p);
    if (mayBeZero(v)) return `${p} ${valueToString(v as ResolvedValue['value'])}`;
  }
  // Judged in any parent: flex-basis applies only to a flex item, and its initial value is auto.
  const grow = valueOf(el, 'flex-grow');
  if (mayBeZero(valueOf(el, 'flex-basis')) && !(grow?.kind === 'number' && grow.value > 0)) {
    return `flex-basis ${valueToString(valueOf(el, 'flex-basis') as ResolvedValue['value'])} without flex-grow`;
  }
  return null;
}

/** Why a box can carry the text inside it out of its clip box's padding box, or null; inner is false for the clip box itself. */
function shiftOf(e: ResolvedElement, inner: boolean): string | null {
  const indent = valueOf(e, 'text-indent');
  if (indent !== undefined && !isZero(indent)) return `${inner ? e.element.address : 'it'} has text-indent ${valueToString(indent)}, which can move a line out of the clip`;
  if (!inner) return null;
  const at = e.element.address;
  const position = keywordOf(e, 'position');
  if (position === 'absolute' || position === 'fixed') return `${at} is position: ${position}, which can place it outside the clip`;
  if ((position === 'relative' || position === 'sticky') && SIDES.some((s) => { const v = valueOf(e, s); return v !== undefined && !(v.kind === 'keyword' && v.value === 'auto') && !isZero(v); })) return `${at} is offset by its ${position} insets, which can move it outside the clip`;
  const transform = valueOf(e, 'transform');
  if (transform !== undefined && !(transform.kind === 'keyword' && transform.value === 'none')) return `${at} has transform ${valueToString(transform)}, which can move it outside the clip`;
  for (const s of SIDES) {
    const v = valueOf(e, `margin-${s}`);
    if (v !== undefined && !(v.kind === 'keyword' && v.value === 'auto') && !((v.kind === 'length' || v.kind === 'percentage') && v.value >= 0)) return `${at} has margin-${s} ${valueToString(v)}, which can move it outside the clip`;
  }
  return null;
}

/**
 * Why a native clip view over the padding box of el could clip text inside it out of sight, or null: the first text in preorder and
 * the reason.
 */
export function clipViewHidesText(el: ResolvedElement): { readonly text: string; readonly why: string } | null {
  const first = textInside(el);
  if (first === null) return null;
  const zero = zeroSizeOf(el);
  if (zero !== null) return { text: first, why: `its ${zero} can leave its padding box no area` };
  const visit = (e: ResolvedElement, inner: boolean, shifted: string | null): { readonly text: string; readonly why: string } | null => {
    if (keywordOf(e, 'display') === 'none') return null;
    const why = shifted ?? shiftOf(e, inner);
    for (const c of e.children) {
      const found = c.kind === 'text' ? (why === null ? null : { text: c.node.address, why }) : visit(c, true, why);
      if (found !== null) return found;
    }
    return null;
  };
  return visit(el, false, null);
}

/**
 * The longhand that makes lower/paint/clip.ts host a clip view over the padding box of el, and how a message names it, or null.
 * propagated is the element whose overflow the viewport takes, which hosts none. A new cause of a padding-box clip view adds its
 * line here, so the text refusal below covers it.
 */
export function clipViewCause(el: ResolvedElement, propagated: ResolvedElement | null): { readonly property: Longhand; readonly cause: string } | null {
  const [x, y] = [keywordOf(el, 'overflow-x'), keywordOf(el, 'overflow-y')];
  if (el !== propagated && (x !== 'visible' || y !== 'visible')) return { property: el.props.get('overflow-x')?.declaration ? 'overflow-x' : 'overflow-y', cause: `overflow: ${x === y ? x : `${x} ${y}`}` };
  return null;
}

/**
 * Refuses, on each native target, a clip view over the padding box of el (clipViewCause) that could clip text inside it out of
 * sight; why, when given, is the fact found above el (an ancestor whose size can be zero), else clipViewHidesText decides.
 */
function refuseClipViewText(el: ResolvedElement, propagated: ResolvedElement | null, why: string | null, targets: readonly string[], diagnostics: Diagnostic[], reported: Set<string>): void {
  const host = clipViewCause(el, propagated);
  if (host === null) return;
  const first = why === null ? null : textInside(el);
  const hidden = why === null ? clipViewHidesText(el) : first === null ? null : { text: first, why };
  if (hidden === null) return;
  const at = el.element.address;
  const declared = el.props.get(host.property)?.declaration ?? null;
  const origin = declared === null ? el.element.node.origin : authored(declared.valueSpan);
  for (const t of targets) {
    if (t === 'web') continue;
    const id = `${t}|clip-view-text|${at}`;
    if (reported.has(id)) continue;
    reported.add(id);
    const message = `${at} has ${host.cause}, which ${t} draws as a clip view over its padding box, but ${hidden.why}; its text ${hidden.text} could be clipped out of sight, which Chrome keeps in its accessibility tree and screen readers read, while ${t} would drop it (${CLIP_VIEW_A11Y_DROP[t] ?? 'a fully clipped view leaves the native accessibility tree'})`;
    const manual = `Keep the text of ${at} inside its padding box with build-time sizes (no zero or computed size on it or an ancestor, no text-indent, offset, transform or negative margin), or clip a box without text.`;
    diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_VALUE', { origin, target: t, message, manual, basis: 'computed-value' }));
  }
}

/** The native refusals of text a padding-box clip view could hide: el's own clip view, and every one inside el when el's size can be zero. */
const checkClipViewText: PaintCheck = (el, targets, diagnostics, reported, propagated) => {
  if (!targets.some((t) => t !== 'web')) return;
  refuseClipViewText(el, propagated, null, targets, diagnostics, reported);
  const zero = zeroSizeOf(el);
  if (zero === null) return;
  // A box sized from a zero-size ancestor (an auto or percentage width, a percentage or stretched height) can be zero-size too.
  const why = `its ancestor ${el.element.address} has ${zero}, which can leave it no area too`;
  const visit = (e: ResolvedElement): void => {
    if (keywordOf(e, 'display') === 'none') return;
    for (const c of e.children) {
      if (c.kind !== 'element') continue;
      refuseClipViewText(c, propagated, why, targets, diagnostics, reported);
      visit(c);
    }
  };
  visit(el);
};

const CLIP_VIEW_A11Y_DROP: { readonly [t: string]: string } = {
  ios: 'VoiceOver is not proven to read a view its clipping ancestor shows no pixel of',
  android: 'View.isVisibleToUser is false when ViewGroup.getChildVisibleRect leaves it nothing, so TalkBack skips it',
};

/** The inset() edges with em and rem computed to px against the element's font sizes; null while one has no build-time base. */
function computeInsets(edges: InsetEdges, ctx: PaintValueContext): InsetEdges | null {
  const out = edges.map((e) => {
    if (e.unit === CANONICAL_LENGTH_UNIT || e.unit === '%') return e;
    if ((e.unit === 'em' && ctx.em === null) || (e.unit === 'rem' && ctx.rem === null)) return undefined;
    const px = lengthToPx(e.value, e.unit, { em: ctx.em ?? 0, rem: ctx.rem ?? 0 });
    return px === null ? undefined : { value: px, unit: CANONICAL_LENGTH_UNIT };
  });
  return out.some((e) => e === undefined) ? null : (out as unknown as InsetEdges);
}

/** Why a clip-path clip would lose what Chrome clips with the box, or null: the first such fact, the box's own before its subtree's. */
function clipPathRefusal(el: ResolvedElement): { readonly fact: string; readonly manual: string } | null {
  const at = el.element.address;
  const tag = el.element.tag;
  if (tag === 'html' || tag === 'body') return { fact: `it is <${tag}>, whose background is the canvas's, which Chrome does not clip`, manual: `Move the clip-path from <${tag}> to a box inside it.` };
  const display = keywordOf(el, 'display');
  if (display === 'inline') return { fact: 'it is an inline box, whose content the native runtime places beside its view, not in it, until INL1b', manual: `Give ${at} display: inline-block or block, or move the clip-path to a block.` };
  const shadow = el.props.get('box-shadow')?.value;
  if (shadow !== undefined && !(shadow.kind === 'keyword' && shadow.value === 'none')) return { fact: 'it has a box-shadow, drawn by a companion view beside the box view, outside the clip', manual: `Move the box-shadow of ${at} to a wrapper, or remove it.` };
  const outline = (e: ResolvedElement, root: boolean): string | null => {
    if (keywordOf(e, 'display') === 'none') return null;
    if (paintedOutlineStyle(e) !== null) return root ? 'it has' : `${e.element.address} has`;
    for (const c of e.children) {
      const found = c.kind === 'element' ? outline(c, false) : null;
      if (found !== null) return found;
    }
    return null;
  };
  const ringed = outline(el, true);
  if (ringed !== null) return { fact: `${ringed} an outline, which Dragon draws in the root view, outside the clip`, manual: `Remove the outline inside ${at}, or the clip-path.` };
  // The clip covers every descendant, text that overflows the border box and positioned descendants included, so even an inset of 0
  // or less can hide text whole. Chrome keeps clipped text in the accessibility tree; until a device run proves the native clip keeps
  // it there too (VoiceOver, TalkBack), the native targets refuse a clip-path over any text, as they refuse clip: rect().
  const text = textInside(el);
  if (text !== null) return { fact: `its text ${text} can be clipped out of sight, which Chrome keeps in its accessibility tree and screen readers read; the native accessibility tree of a clipped view is not proven yet`, manual: `Clip a box without text, or move the text out of ${at}.` };
  return null;
}

const checkClipPath: PaintCheck = (el, targets, diagnostics, reported) => {
  const edges = clipPathEdges(el);
  if (edges === null) return;
  const v = el.props.get('clip-path') as ResolvedValue;
  const origin = v.declaration === null ? el.element.node.origin : authored(v.declaration.valueSpan);
  const at = el.element.address;
  const shape = valueToString(v.value);
  const unresolved = edges.find((e) => e.unit !== CANONICAL_LENGTH_UNIT && e.unit !== '%');
  const refusal = unresolved === undefined ? clipPathRefusal(el) : null;
  if (unresolved === undefined && refusal === null) return;
  for (const t of targets) {
    if (t === 'web') continue;
    const id = `${t}|clip-path|${at}`;
    if (reported.has(id)) continue;
    reported.add(id);
    const message = unresolved !== undefined
      ? `${at} has clip-path: ${shape}, whose ${unresolved.unit} edge has no build-time font size to compute it against; ${t} needs every inset edge in px or % at build time`
      : `${at} has clip-path: ${shape}, but ${(refusal as { fact: string }).fact}; ${t} clips the box view and the views inside it only`;
    const manual = unresolved !== undefined ? `Write the inset edges of ${at} in px or %, or give the font size they depend on a build-time value.` : (refusal as { manual: string }).manual;
    diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_VALUE', { origin, target: t, message, manual, basis: 'computed-value' }));
  }
};

export const CLIP_VALUES: PaintValues = {
  name: 'clip',
  compute: (props, ctx) => {
    const v = props.get('clip');
    if (v !== undefined) {
      const edges = clipEdgesOf(v.value);
      const computed = edges === null ? null : computeEdges(edges, ctx);
      if (computed !== null) props.set('clip', { ...v, value: clipRectValue(computed) });
    }
    const p = props.get('clip-path');
    if (p === undefined) return;
    const insets = insetEdgesOf(p.value);
    const computed = insets === null ? null : computeInsets(insets, ctx);
    if (computed !== null) props.set('clip-path', { ...p, value: insetValue(computed) });
  },
  check: (el, targets, diagnostics, reported, propagated) => {
    checkClip(el, targets, diagnostics, reported, propagated);
    checkClipViewText(el, targets, diagnostics, reported, propagated);
    checkClipPath(el, targets, diagnostics, reported, propagated);
  },
};
