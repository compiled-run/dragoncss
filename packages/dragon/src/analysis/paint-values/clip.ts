// The clip module's computed values and refusals. clip (css-masking-1 §5.1): each rect() edge computes to px (em against the
// element's font size, rem against the root's), auto edges stay auto. Chrome clips only an absolutely or fixed positioned box, to
// the rect CSS2 §11.1.2 gives against its border box, and that clip node covers the box's own paint and every descendant
// (paint_property_tree_builder.cc UpdateCssClip). Natively Dragon draws one clip: a rect that is empty whatever the box's size
// hides the box view, and with it every view inside it (lower/paint/clip.ts). Refused on the native targets: any other rect on
// such a box, and an empty one whose subtree paints a view outside the box view: an outline (in the root view), the box's own
// box-shadow (a companion beside it) and a layer item with a z-index other than 0 (which may be hosted under a stacking context
// outside it); a box that is not visible as well, whose visibility readback reads the same hidden flag. A hidden view leaves the
// accessibility tree natively (UIKit leaves a hidden view out; Android's View.isVisibleToUser is false under an INVISIBLE ancestor),
// while Chrome keeps clipped text there (the visually-hidden pattern), so a box with text takes the clip label write instead: it
// draws nothing and carries the text as its accessibility label, and text one label cannot carry is refused (clip-label.ts). Only text views are
// accessibility elements natively (native-support.ts), so a subtree without text loses nothing there. An em or rem edge whose font
// size has no build-time value is refused for that.
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
import { CANONICAL_LENGTH_UNIT, lengthToPx } from '../../css/units.ts';
import { authored, diagnostic } from '../../diagnostics/catalogue.ts';
import type { ResolvedValue } from '../computed.ts';
import { valueToString } from '../computed.ts';
import type { ResolvedElement } from '../resolve.ts';
import { clipLabelRefusal } from './clip-label.ts';
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

/** How each native target keeps the text of a box its clip hides: the one accessibility element it reads. */
const A11Y_LABEL: { readonly [t: string]: string } = {
  ios: 'ios carries the text only as the accessibilityLabel of the box view, which VoiceOver reads as one element',
  android: 'android carries the text only as the contentDescription of the box view, which TalkBack reads as one node',
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
  const unlabelled = text === null ? null : clipLabelRefusal(el);
  if (hides === true && why === null && unlabelled === null) return;
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
          ? `${at} has clip: ${rect}, which hides it whole, and its text ${text} stays in Chrome's accessibility tree, but ${unlabelled}; ${A11Y_LABEL[t] ?? `${t} carries the text as one accessibility label only`}`
          : `${at} has clip: ${rect}, which hides it whole, but ${why}; ${t} hides the box view and the views inside it only`;
    const manual = unresolved !== undefined && unresolved !== null
      ? `Write the clip edges of ${at} in px, or give the font size they depend on a build-time value.`
      : hides !== true
        ? 'Use an overflow clip on a wrapper sized to the rect, or an empty rect to hide the box.'
        : text !== null
          ? `Keep only plain text in ${at} (div, span, p and inline emphasis, nothing focusable and no accessibility attributes), or move the rest out of it.`
          : `Move what ${at} must not hide out of it, or remove it from ${at}.`;
    diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_VALUE', { origin, target: t, message, manual, basis: 'computed-value' }));
  }
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
    checkClipPath(el, targets, diagnostics, reported, propagated);
  },
};
