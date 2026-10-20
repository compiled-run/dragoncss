// Computed opacity (css-color-4 §14.1): a number, or a percentage computed to its number, clamped to [0, 1]. On the native targets
// only 0 and 1 are drawn: UIKit and Android composite a translucent view with exact /255 rounding, where Chrome's Skia blits use its
// own (a 256-scale product, measured one off in a channel on device), so no native alpha reproduces Chrome's pixels; a fractional
// opacity is refused there until the pre-composited package (PNT1-opacity-b) draws it. The parity lanes compile it on native anyway
// (project.ts, lane-only): such a case proves web rows only, and the device pixel lanes skip what a translucent group paints.
// PNT1-opacity-b (first part): a group whose only paint is one opaque background fill is drawn on native. Chrome folds the layer
// alpha of a group of one draw into that draw's paint alpha (cc PlaybackFoldingIterator), so such a box paints as
// its background colour with alpha opacityAlpha8(opacity) and no group: measured in Chrome 145 equal on every pixel for opaque
// fills over 765 opacities around each byte boundary, at DPR 1 and 3 (rounded fills too, not yet admitted); a fill with a border
// or text in the group, or a translucent fill, differs. The lowering folds such a box (lower/paint/background.ts, effects.ts), and
// native draws the folded fill as Chrome's opaque bytes over its backdrop (emit/paint/background.ts): drawn as a translucent colour,
// the platform blend was one off Chrome's blit (device batch 3, of-a 97,66,68 for Chrome's 96,65,67).
import { opacityOf } from '../../css/properties/effects.ts';
import { SIDES } from '../../css/properties.ts';
import { usedColors } from '../../lower/paint/colors.ts';
import { isReplacedTag, SVG_SHAPE_TAGS } from '../elements/replaced.ts';
import { authored, diagnostic } from '../../diagnostics/catalogue.ts';
import type { Diagnostic } from '../../types.ts';
import type { ResolvedValue } from '../computed.ts';
import type { ResolvedElement } from '../resolve.ts';
import { paintedOutlineStyle, rounds } from './outline.ts';
import type { PaintValues } from './types.ts';

/** The fractional-opacity refusal above, on every element of a case that generates a box (display: none subtrees do not). */
export function checkTranslucent(root: ResolvedElement, targets: readonly string[], diagnostics: Diagnostic[], reported: Set<string>): void {
  const walk = (el: ResolvedElement): void => {
    const d = (el.props.get('display') as ResolvedValue).value;
    if (d.kind === 'keyword' && d.value === 'none') return;
    checkOpacity(el, targets, diagnostics, reported);
    for (const c of el.children) if (c.kind === 'element') walk(c);
  };
  walk(root);
}

// The displays whose box is one plain box with no marker or table parts.
const FOLD_DISPLAYS: readonly string[] = ['block', 'inline-block', 'flow-root', 'flex', 'inline-flex', 'grid', 'inline-grid'];
// The tags whose box paints something of its own beyond its background (a control, replaced content), or whose background
// propagates to the canvas (html, body).
const FOLD_TAGS_OUT: ReadonlySet<string> = new Set(['html', 'body', 'input', 'button', 'select', 'option', 'optgroup', 'textarea', 'progress', 'meter', 'fieldset', 'legend', 'details', 'summary', 'dialog', 'video', 'audio', 'canvas', 'object', 'embed']);
// The longhands that must hold these values, as anything else paints, composites (a layer Chrome does not fold into) or moves the
// box; a longhand the build does not resolve is not set. An animated or transitioned fill is refused by analysis/animations.ts.
const FOLD_KEYWORDS: readonly (readonly [string, readonly string[]])[] = [
  ['box-shadow', ['none']], ['background-image', ['none']], ['border-image-source', ['none']], ['mask-image', ['none']], ['filter', ['none']],
  ['backdrop-filter', ['none']], ['mix-blend-mode', ['normal']], ['clip-path', ['none']], ['clip', ['auto']], ['transform', ['none']],
  ['rotate', ['none']], ['scale', ['none']], ['translate', ['none']], ['perspective', ['none']], ['transform-style', ['flat']],
  ['backface-visibility', ['visible']], ['will-change', ['auto']], ['position', ['static', 'relative', 'absolute']],
  ['overflow-x', ['visible', 'hidden', 'clip']], ['overflow-y', ['visible', 'hidden', 'clip']],
];

/**
 * Whether an element's opacity group holds one opaque background fill and nothing else (PNT1-opacity-b, first part): a plain box
 * of an HTML element with no children or text, no painted border, outline or radius, and no other paint, layer or transform; its
 * background is opaque or transparent (a transparent one paints nothing).
 */
export function opacityFolds(el: ResolvedElement): boolean {
  const kw = (p: string): string | null => {
    const v = el.props.get(p as never)?.value;
    return v === undefined ? null : v.kind === 'keyword' ? v.value : '';
  };
  if (FOLD_TAGS_OUT.has(el.element.tag) || isReplacedTag(el.element.tag) || SVG_SHAPE_TAGS.includes(el.element.tag)) return false;
  if (el.children.length > 0) return false;
  if (!FOLD_DISPLAYS.includes(kw('display') ?? '')) return false;
  for (const [p, ok] of FOLD_KEYWORDS) {
    const k = kw(p);
    if (k !== null && !ok.includes(k)) return false;
  }
  for (const side of SIDES) {
    const style = kw(`border-${side}-style`);
    if (style === 'none' || style === 'hidden') continue;
    const w = el.props.get(`border-${side}-width` as never)?.value;
    if (w === undefined || w.kind !== 'length' || w.value !== 0) return false;
  }
  // A rounded fill folds in Chrome too, but the paint models and device lanes prove rounded translucent fills elsewhere; later.
  if (paintedOutlineStyle(el) !== null || rounds(el)) return false;
  const bg = usedColors(el)['background-color'].alpha;
  return bg === 0 || bg === 255;
}

function checkOpacity(el: ResolvedElement, targets: readonly string[], diagnostics: Diagnostic[], reported: Set<string>): void {
  const v = el.props.get('opacity') as ResolvedValue;
  const n = opacityOf(v.value);
  if (n === null) throw new Error(`${el.element.address}: opacity did not compute to a number`);
  if (n === 0 || n === 1 || opacityFolds(el)) return;
  const origin = v.declaration === null ? el.element.node.origin : authored(v.declaration.valueSpan);
  for (const t of targets) {
    if (t === 'web') continue;
    const id = `${t}|opacity|${el.element.address}`;
    if (reported.has(id)) continue;
    reported.add(id);
    diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_VALUE', {
      origin,
      target: t,
      message: `${el.element.address} has opacity ${n}; ${t} composites a translucent view with its own rounding, one off Chrome's Skia blend in a channel, so Dragon draws a fractional opacity only on a box whose one paint is an opaque background, which Chrome folds into the fill, until package PNT1-opacity-b pre-composites the rest`,
      manual: 'Use opacity 0 or 1, put the opacity on a box with only an opaque background and no content, or use a translucent colour (rgba) instead.',
      basis: 'computed-value',
    }));
  }
}

export const EFFECTS_VALUES: PaintValues = {
  name: 'effects',
  // SVG-opacity: fill-opacity and stroke-opacity compute as opacity does (css-fill-stroke-3 §3.4, §4.4).
  compute: (props) => {
    for (const p of ['opacity', 'fill-opacity', 'stroke-opacity'] as const) {
      const v = props.get(p);
      if (v === undefined || (v.value.kind !== 'number' && v.value.kind !== 'percentage')) continue;
      const n = opacityOf(v.value);
      if (n === null) continue;
      props.set(p, { ...v, value: { kind: 'number', value: n } });
    }
  },
  // The fractional-opacity refusal is lane-gated, so project.ts runs checkTranslucent itself, not checkComputed.
  check: null,
};
