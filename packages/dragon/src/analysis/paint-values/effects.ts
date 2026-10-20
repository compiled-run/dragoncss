// Computed opacity (css-color-4 §14.1): a number, or a percentage computed to its number, clamped to [0, 1]. On the native targets
// only 0 and 1 are drawn: UIKit and Android composite a translucent view with exact /255 rounding, where Chrome's Skia blits use its
// own (a 256-scale product, measured one off in a channel on device), so no native alpha reproduces Chrome's pixels; a fractional
// opacity is refused there until the pre-composited package (PNT1-opacity-b) draws it. The parity lanes compile it on native anyway
// (project.ts, lane-only): such a case proves web rows only, and the device pixel lanes skip what a translucent group paints.
// PNT1-opacity-b (first part): a group whose only paint is one opaque background fill is drawn on native. Chrome folds the layer
// alpha of a group of one draw into that draw's paint alpha (cc PlaybackFoldingIterator), so such a box paints as
// its background colour with alpha opacityAlpha8(opacity) and no group: measured in Chrome 145 equal on every pixel for opaque
// fills over 765 opacities around each byte boundary, at DPR 1 and 3 (rounded fills too, not yet admitted); a fill with a border
// or text in the group, or a translucent fill, differs. The lowering folds such a box (lower/paint/background.ts, effects.ts) and native draws it as it
// draws any translucent background.
import { opacityOf } from '../../css/properties/effects.ts';
import type { FilterFunction } from '../../css/properties/filter.ts';
import { colorMatrixFilters, filterApplies } from '../../css/properties/filter.ts';
import { SIDES } from '../../css/properties.ts';
import { usedColors } from '../../lower/paint/colors.ts';
import { isReplacedTag, SVG_SHAPE_TAGS } from '../elements/replaced.ts';
import { authored, diagnostic } from '../../diagnostics/catalogue.ts';
import type { Diagnostic } from '../../types.ts';
import type { ResolvedValue } from '../computed.ts';
import type { ResolvedElement } from '../resolve.ts';
import { paintedOutlineStyle, rounds } from './outline.ts';
import type { PaintValues } from './types.ts';
import type { AnimationAnalysis } from '../animations.ts';
import { elementWillChange } from './transform.ts';
import { stackingOf, transformedForStacking } from '../../lower/paint/stacking.ts';
import { resolvedStackTree } from './stacking.ts';

/** The fractional-opacity refusal above, on every element of a case that generates a box (display: none subtrees do not). */
export function checkTranslucent(root: ResolvedElement, targets: readonly string[], diagnostics: Diagnostic[], reported: Set<string>): void {
  const plans = opacityGroupPlans(root);
  const walk = (el: ResolvedElement): void => {
    const d = (el.props.get('display') as ResolvedValue).value;
    if (d.kind === 'keyword' && d.value === 'none') return;
    checkOpacity(el, plans.get(el.element.address) ?? null, targets, diagnostics, reported);
    checkFilterGroup(el, plans.get(el.element.address) ?? null, targets, diagnostics, reported);
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

function checkOpacity(el: ResolvedElement, plan: GroupPlan | null, targets: readonly string[], diagnostics: Diagnostic[], reported: Set<string>): void {
  const v = el.props.get('opacity') as ResolvedValue;
  const n = opacityOf(v.value);
  if (n === null) throw new Error(`${el.element.address}: opacity did not compute to a number`);
  if (n === 0 || n === 1 || plan?.kind === 'group' || plan?.kind === 'nested' || (plan === null && opacityFolds(el))) return;
  const origin = v.declaration === null ? el.element.node.origin : authored(v.declaration.valueSpan);
  for (const t of targets) {
    if (t === 'web') continue;
    const id = `${t}|opacity|${el.element.address}`;
    if (reported.has(id)) continue;
    reported.add(id);
    diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_VALUE', {
      origin,
      target: t,
      message: `${el.element.address} has opacity ${n}; ${t} composites a translucent view with its own rounding, one off Chrome's Skia blend in a channel, so Dragon draws a fractional opacity only on a box whose one paint is an opaque background, which Chrome folds into the fill, or on a group it pre-composites (PNT1-opacity-b), and this one is not: ${plan === null ? 'it is not a group' : plan.kind === 'refused' ? plan.reason : 'it is a group'}`,
      manual: 'Use opacity 0 or 1, keep the group to square fills, solid borders (translucent ones on all four sides or one) and opaque text over opaque square fills, or use a translucent colour (rgba) instead.',
      basis: 'computed-value',
    }));
  }
}

/** The colour-matrix functions of an element's filter (empty for none), or null for a list Dragon does not draw (checkFilter refuses it). */
function matrixFilterOf(el: ResolvedElement): readonly FilterFunction[] | null {
  const read = colorMatrixFilters((el.props.get('filter') as ResolvedValue).value);
  return read.kind === 'none' ? [] : read.kind === 'list' ? read.functions : null;
}

// PNT1-filter: a colour-matrix filter is drawn on native only by a pre-composited group's overlay (filter, then opacity), so a filter
// on a box that is no admitted group is refused there; a box of opacity 0 draws nothing, filtered or not.
function checkFilterGroup(el: ResolvedElement, plan: GroupPlan | null, targets: readonly string[], diagnostics: Diagnostic[], reported: Set<string>): void {
  const fns = matrixFilterOf(el);
  if (fns === null || fns.length === 0 || opacityAt(el) <= 0 || plan?.kind === 'group') return;
  const reason = plan === null ? 'it is not a group' : plan.kind === 'refused' ? plan.reason : 'it is a group nested in another, which Dragon draws only without a filter';
  const v = el.props.get('filter') as ResolvedValue;
  const origin = v.declaration === null ? el.element.node.origin : authored(v.declaration.valueSpan);
  for (const t of targets) {
    if (t === 'web') continue;
    const id = `${t}|filter-group|${el.element.address}`;
    if (reported.has(id)) continue;
    reported.add(id);
    diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_VALUE', {
      origin,
      target: t,
      message: `${el.element.address} has filter: ${fns.map((f) => `${f.name}(${f.amount})`).join(' ')}; ${t} has no filter that rounds as Chrome's Skia pipeline does, so Dragon draws a colour-matrix filter only on a group it pre-composites (PNT1-filter), and this one is not: ${reason}`,
      manual: 'Remove the filter, or keep the filtered box to square fills, solid borders and opaque text over opaque square fills, outside any other group.',
      basis: 'computed-value',
    }));
  }
}

// ---------------------------------------------------------------- pre-composited groups (PNT1-opacity-b, S1)
// Native keeps a group G at alpha 1 and covers it with an overlay that shows Q, Chrome's composite: G's layer (rendered by the
// platform) over a software backdrop, blitted per cc raster tile as Chrome does (@dragon/layout paint-group.ts). The backdrop
// is modelled from G's backdrop box B (the nearest ancestor that clips and has an opaque background, or the canvas) and the
// painters before G inside it, so each of them must be a square opaque fill, solid border sides in one opaque colour, or an earlier
// such group. G's own content must be what the platform renders exactly at whole device px: square opaque fills and solid
// opaque borders, and opaque text, with nothing that composites, moves or animates. PNT1-filter: G may instead (or as well) have a
// colour-matrix filter, which the overlay applies to G's layer before its opacity (layout paint-group.ts groupFilterComposite).
// S2: G's content may also hold translucent square fills, translucent solid borders on all four sides in one colour or on one side,
// and nested groups (a fractional opacity, no filter) of the same content. The device then builds G's layer in software from the
// draw list, as Chrome's raster draws into a layer (paint-group.ts groupFill, groupFoldAlpha, groupComposite into the parent's
// layer), with only the text drawn by the platform into it. Measured equal to Chrome 145 on random nested trees of such boxes.
// Translucent text stays refused: the platform blends a translucent glyph with its own rounding, and the device has no software
// text blit to replace it. Translucent borders on two or three sides are refused: Chrome draws them otherwise (measured one off).

/**
 * An admitted group: its colour-matrix filter (empty for none), its backdrop box (null for the canvas) and the painters before it
 * there, in paint order; a group nested in an admitted group (its outer group's overlay composites it); or why not.
 */
export type GroupPlan =
  | { readonly kind: 'group'; readonly filter: readonly FilterFunction[]; readonly backdrop: string | null; readonly painters: readonly string[] }
  | { readonly kind: 'nested'; readonly outer: string }
  | { readonly kind: 'refused'; readonly reason: string };

/** The plans opacityGroupPlans made, by element: the lowering reads whether a box is a nested group (lower/paint/background.ts). */
const planByElement = new WeakMap<ResolvedElement, GroupPlan>();

/** The plan of an element of a tree whose plans were made (opacityGroupPlans), or null. */
export function groupPlanAt(el: ResolvedElement): GroupPlan | null {
  return planByElement.get(el) ?? null;
}

const GROUP_KEYWORDS = FOLD_KEYWORDS.filter(([p]) => p !== 'position' && p !== 'overflow-x' && p !== 'overflow-y');
const keywordAt = (el: ResolvedElement, p: string): string | null => {
  const v = el.props.get(p as never)?.value;
  return v === undefined ? null : v.kind === 'keyword' ? v.value : '';
};
const opacityAt = (el: ResolvedElement): number => {
  const n = opacityOf((el.props.get('opacity') as ResolvedValue).value);
  if (n === null) throw new Error(`${el.element.address}: opacity did not compute to a number`);
  return n;
};
const clipsAt = (el: ResolvedElement): boolean => (keywordAt(el, 'overflow-x') ?? 'visible') !== 'visible';

/**
 * Why a box cannot be drawn by the overlay's models (null when it can): as a member of a group (its paint rendered by the
 * platform) or as a backdrop painter (its paint modelled in software); a painter that is an ancestor of the group may clip.
 */
function boxProblem(el: ResolvedElement, role: 'group' | 'member' | 'painter' | 'ancestor-painter', viewportScroller = false): string | null {
  const a = el.element.address;
  const tag = el.element.tag;
  const canvasTag = tag === 'html' || tag === 'body';
  const content = role === 'group' || role === 'member';
  if ((FOLD_TAGS_OUT.has(tag) && !(canvasTag && !content)) || isReplacedTag(tag) || SVG_SHAPE_TAGS.includes(tag)) return `${a} is a <${tag}>, a control, replaced or svg box`;
  if (!FOLD_DISPLAYS.includes(keywordAt(el, 'display') ?? '')) return `${a} has display ${keywordAt(el, 'display')}, not a plain block or inline-block box`;
  for (const [p, ok] of GROUP_KEYWORDS) {
    // The group's own filter is what the overlay applies (matrixFilterOf admits it).
    if (p === 'filter' && role === 'group') continue;
    const k = keywordAt(el, p);
    if (k !== null && !ok.includes(k)) return `${a} has a ${p} (a shadow, image, filter, clip, transform or will-change)`;
  }
  const position = keywordAt(el, 'position') ?? 'static';
  if (position !== 'static' && position !== 'relative') return `${a} has position ${position}`;
  const allowed = role === 'ancestor-painter' ? ['visible', 'hidden', 'clip'] : ['visible'];
  // The element whose overflow the viewport takes neither clips nor scrolls itself.
  if (!viewportScroller) for (const p of ['overflow-x', 'overflow-y']) if (!allowed.includes(keywordAt(el, p) ?? 'visible')) return `${a} has ${p}: ${keywordAt(el, p)}${role === 'ancestor-painter' ? ', a scroller' : ', a clip or scroller'}`;
  if ((keywordAt(el, 'visibility') ?? 'visible') !== 'visible') return `${a} is not visible`;
  if (paintedOutlineStyle(el) !== null) return `${a} has an outline`;
  if (rounds(el)) return `${a} has a border radius`;
  const colors = usedColors(el);
  const bg = colors['background-color'].alpha;
  if (bg !== 0 && bg !== 255 && !content) return `${a} has a translucent background`;
  if (canvasTag && bg !== 0) return `${a} has a background, which Chrome paints on the canvas`;
  const sides: string[] = [];
  let translucent = false;
  for (const side of SIDES) {
    const style = keywordAt(el, `border-${side}-style`);
    if (style === null || style === 'none' || style === 'hidden') continue;
    const w = el.props.get(`border-${side}-width` as never)?.value;
    if (w === undefined || w.kind !== 'length') return `${a} has a border width that is not a length`;
    if (w.value === 0) continue;
    if (style !== 'solid') return `${a} has a ${style} border`;
    const c = colors[`border-${side}-color` as 'border-top-color'];
    if (c.alpha !== 255) {
      // Blink still records a transparent side's box as a display item, which the fold count would miss (measured).
      if (!content || c.alpha === 0) return `${a} has a border side that is not opaque`;
      translucent = true;
    }
    sides.push(`${c.r},${c.g},${c.b},${c.alpha}`);
  }
  if (new Set(sides).size > 1) return `${a} has border sides in more than one colour, which meet on a diagonal`;
  // Chrome draws translucent sides in one colour as one op on all four sides or one, and otherwise differently (measured).
  if (translucent && sides.length !== 4 && sides.length !== 1) return `${a} has a translucent border on ${sides.length} sides, which Chrome draws otherwise than four sides or one`;
  if (canvasTag && sides.length > 0) return `${a} has a border`;
  return null;
}

/** Why a text run of a group cannot be rendered as Chrome draws it (null when it can): an opaque fill and nothing else. */
function textProblem(owner: ResolvedElement): string | null {
  const a = owner.element.address;
  if (usedColors(owner).color.alpha !== 255) return `the text of ${a} is not opaque`;
  for (const [p, ok] of [['text-shadow', ['none']], ['text-decoration-line', ['none']], ['-webkit-text-fill-color', ['currentcolor']]] as const) {
    const k = keywordAt(owner, p);
    if (k !== null && !(ok as readonly string[]).includes(k)) return `the text of ${a} has a ${p}`;
  }
  const stroke = owner.props.get('-webkit-text-stroke-width' as never)?.value;
  if (stroke !== undefined && !(stroke.kind === 'length' && stroke.value === 0)) return `the text of ${a} has a -webkit-text-stroke`;
  return null;
}

const groupPlansOf = new WeakMap<ResolvedElement, ReadonlyMap<string, GroupPlan>>();

/** The plan of every fractional, unfolded opacity and every colour-matrix filter of a case (by address); computed once per resolved tree. */
export function opacityGroupPlans(root: ResolvedElement): ReadonlyMap<string, GroupPlan> {
  const known = groupPlansOf.get(root);
  if (known !== undefined) return known;
  const byId = new Map<string, ResolvedElement>();
  const parentOf = new Map<string, ResolvedElement | null>();
  const walk = (el: ResolvedElement, parent: ResolvedElement | null): void => {
    if (keywordAt(el, 'display') === 'none') return;
    byId.set(el.element.address, el);
    parentOf.set(el.element.address, parent);
    for (const c of el.children) if (c.kind === 'element') walk(c, el);
  };
  walk(root, null);
  // The element whose overflow the viewport takes (css-overflow-3 §3.3) does not clip (computed-checks.ts propagatedFrom).
  const visible = (el: ResolvedElement): boolean => !clipsAt(el) && (keywordAt(el, 'overflow-y') ?? 'visible') === 'visible';
  const body = root.children.find((c): c is ResolvedElement => c.kind === 'element' && c.element.tag === 'body');
  const propagated = !visible(root) ? root : body !== undefined && !visible(body) ? body : null;
  const order = stackingOf(resolvedStackTree(root, propagated)).order;
  const index = new Map(order.map((id, k) => [id, k]));
  const ancestors = (el: ResolvedElement): ResolvedElement[] => {
    const out: ResolvedElement[] = [];
    for (let p = parentOf.get(el.element.address) ?? null; p !== null; p = parentOf.get(p.element.address) ?? null) out.push(p);
    return out;
  };
  const within = (el: ResolvedElement, top: ResolvedElement): boolean => el === top || ancestors(el).includes(top);
  const plans = new Map<string, GroupPlan>();
  const admitted = (el: ResolvedElement): boolean => plans.get(el.element.address)?.kind === 'group';

  const planOf = (g: ResolvedElement, filter: readonly FilterFunction[]): GroupPlan => {
    const refused = (reason: string): GroupPlan => ({ kind: 'refused', reason });
    // The group's own content.
    const members: ResolvedElement[] = [];
    const collect = (el: ResolvedElement): void => {
      members.push(el);
      for (const c of el.children) if (c.kind === 'element' && keywordAt(c, 'display') !== 'none') collect(c);
    };
    collect(g);
    for (const m of members) {
      const bad = boxProblem(m, m === g ? 'group' : 'member');
      if (bad !== null) return refused(bad);
      if (m !== g && opacityAt(m) <= 0) return refused(`${m.element.address} inside it has opacity 0`);
      if (m.children.some((c) => c.kind === 'text')) {
        const t = textProblem(m);
        if (t !== null) return refused(t);
      }
      // A decoration reaches the text of the boxes inside its box too.
      const line = keywordAt(m, 'text-decoration-line') ?? 'none';
      if (line !== 'none' && members.some((x) => x !== m && x.children.some((c) => c.kind === 'text') && ancestors(x).includes(m))) return refused(`${m.element.address} has a text-decoration-line, which reaches the text inside it`);
    }
    // What composites it differently: an enclosing group, layer, scroller or fixed box, or a decoration from above.
    const up = ancestors(g);
    for (const a of up) {
      const at = a.element.address;
      if (opacityAt(a) < 1) return refused(`it is inside ${at}, which has opacity ${opacityAt(a)}`);
      if (filterApplies((a.props.get('filter') as ResolvedValue).value)) return refused(`it is inside ${at}, which has a filter`);
      if (transformedForStacking(a)) return refused(`it is inside ${at}, which is transformed or will change`);
      const position = keywordAt(a, 'position') ?? 'static';
      // An absolute box's containing block may skip the backdrop's clip.
      if (position === 'fixed' || position === 'sticky' || position === 'absolute') return refused(`it is inside ${at}, which has position ${position}`);
      if (a !== propagated) for (const p of ['overflow-x', 'overflow-y']) if (['auto', 'scroll'].includes(keywordAt(a, p) ?? 'visible')) return refused(`it is inside ${at}, a scroller`);
      if ((keywordAt(a, 'text-decoration-line') ?? 'none') !== 'none') return refused(`it is inside ${at}, whose text decoration reaches its text`);
    }
    // The backdrop box and the painters before the group inside it.
    const b = up.find((a) => a !== propagated && clipsAt(a) && keywordAt(a, 'display') !== 'inline' && usedColors(a)['background-color'].alpha === 255) ?? null;
    const gi = index.get(g.element.address);
    const bi = b === null ? 0 : index.get(b.element.address);
    if (gi === undefined || bi === undefined) throw new Error(`${g.element.address}: the group or its backdrop is not in the paint order`);
    const painters: string[] = [];
    for (const id of order.slice(bi, gi)) {
      const text = id.indexOf(':text#');
      const el = byId.get(text < 0 ? id : id.slice(0, text));
      if (el === undefined) throw new Error(`${id}: a painter that is not an element of the case`);
      if (b !== null && !within(el, b)) return refused(`${id} paints between its backdrop ${b.element.address} and it, outside the backdrop`);
      // Inside an earlier group: that group's composite covers it.
      if ([el, ...ancestors(el)].some((x) => x !== el && admitted(x)) || (text >= 0 && admitted(el))) continue;
      if (text >= 0) return refused(`the text of ${el.element.address} paints before it in its backdrop ${b === null ? 'the canvas' : b.element.address}`);
      if (admitted(el)) {
        painters.push(id);
        continue;
      }
      if (opacityAt(el) < 1) return refused(`${id} paints before it with opacity ${opacityAt(el)}`);
      const bad = boxProblem(el, up.includes(el) ? 'ancestor-painter' : 'painter', el === propagated);
      if (bad !== null) return refused(`a painter before it in its backdrop: ${bad}`);
      painters.push(id);
    }
    return { kind: 'group', filter, backdrop: b === null ? null : b.element.address, painters };
  };

  for (const id of order) {
    const el = byId.get(id);
    if (el === undefined) continue;
    const o = opacityAt(el);
    // A fractional opacity inside an admitted group, which admitted it as content: its outer group's overlay composites it.
    const outer = ancestors(el).find((a) => plans.get(a.element.address)?.kind === 'group');
    if (outer !== undefined && o > 0 && o < 1) {
      plans.set(id, { kind: 'nested', outer: outer.element.address });
      continue;
    }
    // A filter list Dragon does not draw is refused by checkFilter; its box is no group.
    const filter = matrixFilterOf(el);
    if (o <= 0 || filter === null) continue;
    if (filter.length === 0 && (o >= 1 || opacityFolds(el))) continue;
    plans.set(id, elementWillChange(el).includes('opacity') ? { kind: 'refused', reason: 'it has will-change: opacity, a compositor layer' } : planOf(el, filter));
  }
  for (const [id, plan] of plans) {
    const el = byId.get(id);
    if (el !== undefined) planByElement.set(el, plan);
  }
  groupPlansOf.set(root, plans);
  return plans;
}

/** Every address an admitted group's overlay reads: the groups' members and their backdrop painters (animations.ts refuses motion there). */
export function groupScope(root: ResolvedElement): ReadonlySet<string> {
  const out = new Set<string>();
  const plans = opacityGroupPlans(root);
  const visit = (el: ResolvedElement, inGroup: boolean): void => {
    const g = inGroup || plans.get(el.element.address)?.kind === 'group';
    if (g) out.add(el.element.address);
    for (const c of el.children) if (c.kind === 'element') visit(c, g);
  };
  visit(root, false);
  for (const p of plans.values()) if (p.kind === 'group') for (const id of p.painters) out.add(id);
  return out;
}

/**
 * A transition or animation on a box a pre-composited group's overlay reads (a member or a backdrop painter): the overlay recomputes
 * on layout and paint changes only, which the native animator does not make, so it is refused on native (a lane-only case in the
 * parity lanes, as checkTranslucent is).
 */
export function refuseAnimatedGroups(analysis: AnimationAnalysis, roots: readonly ResolvedElement[], nativeTargets: readonly string[], diagnostics: Diagnostic[], reported: Set<string> = new Set()): void {
  if (nativeTargets.length === 0) return;
  analysis.cases.forEach((c, i) => {
    const root = roots[i];
    if (root === undefined) return;
    const scope = groupScope(root);
    if (scope.size === 0) return;
    for (const ea of c.elements.values()) {
      if (!scope.has(ea.address)) continue;
      const animates = ea.animations.some((a) => a.name !== 'none' && a.hasKeyframes);
      const transitions = [...ea.listings.values()].some((l) => l.mode === 'listed' && l.delay + l.duration > 0);
      if (!animates && !transitions) continue;
      const d = ea.declarations[0];
      for (const t of nativeTargets) {
        const id = `${t}|group-motion|${ea.address}`;
        if (reported.has(id)) continue;
        reported.add(id);
        diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_VALUE', {
          origin: d === undefined ? root.element.node.origin : authored(d.valueSpan),
          target: t,
          message: `${animates ? 'an animation' : 'a transition'} on ${ea.address}, which a pre-composited opacity or filter group draws or composites over: the group's composite is recomputed on layout and paint changes, not on animation frames (package PNT1-opacity-b)`,
          manual: 'Remove the animation or transition, or move it out of the opacity group and the boxes beneath it.',
        }));
      }
    }
  });
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
